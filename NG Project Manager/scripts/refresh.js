#!/usr/bin/env node
// NG Dashboard refresh. Re-pulls Jira, rebuilds Master Tracking, regenerates the dashboard.
//
//   node refresh.js              full refresh
//   node refresh.js --dry-run    recompute and report, write nothing
//   node refresh.js --no-jira    reuse the last Jira pull (fast; for layout work only)
//   node refresh.js --fresh      ignore the changelog and defect-log caches and re-read everything
//
// Credentials come from the ATLASSIAN_* environment variables. Nothing is stored on disk.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const C = require('./config.js');

const ARGS = process.argv.slice(2);
const DRY = ARGS.includes('--dry-run');
const NOJIRA = ARGS.includes('--no-jira');
const FRESH = ARGS.includes('--fresh');   // propagated to every child; activity.js reads argv itself
const HERE = __dirname;
const log = s => process.stdout.write(s + '\n');

function need(v, name) { if (!process.env[v]) { log(`FAIL  ${name} is not set. Set ATLASSIAN_SITE_URL, ATLASSIAN_USER_EMAIL and ATLASSIAN_API_TOKEN, then restart the app.`); process.exit(2); } }
need('ATLASSIAN_SITE_URL','ATLASSIAN_SITE_URL');
need('ATLASSIAN_USER_EMAIL','ATLASSIAN_USER_EMAIL');
need('ATLASSIAN_API_TOKEN','ATLASSIAN_API_TOKEN');
if (!DRY) { C.lock('refresh'); process.env.NG_LOCK_HELD = '1'; }   // children inherit it

const run = (file) => execFileSync(process.execPath, FRESH ? [file,'--fresh'] : [file], {cwd: HERE, encoding:'utf8', maxBuffer: 32*1024*1024});
const grab = (txt, re) => { const m = txt.match(re); return m ? m[1] : null; };

function locked(p) { try { fs.closeSync(fs.openSync(p, 'r+')); return false; } catch (e) { return e.code || true; } }

(async () => {
  const started = Date.now();
  const notes = [];
  let gatherHoursBad = [];

  // 1 - Jira
  if (NOJIRA && fs.existsSync(C.local('gathered.json'))) {
    notes.push('reused the previous Jira pull (--no-jira)');
  } else {
    log('Pulling Jira ...');
    const out = run('gather.js');
    log('  ' + (grab(out, /(Jira: .*)/) || 'done'));
    const cl = grab(out, /(Changelogs: .*)/); if (cl) log('  ' + cl);
    const hl = grab(out, /(Hours logs: .*)/); if (hl) log('  ' + hl);
    gatherHoursBad = out.split(/\r?\n/).filter(l => /hours not a number/.test(l));
  }

  // 2 - Pipeline Plan
  log('Reading Pipeline Plan ...');
  run('pipe.js');

  // 2b - protect hand edits before anything is rebuilt
  log('Checking Master Tracking for hand edits ...');
  try { log(run('preserve.js').trimEnd() || '  (none)'); }
  catch (e) {
    if (e.status === 3) { log(String(e.stdout || '').trimEnd()); log('REFRESH STOPPED - nothing written.'); process.exit(3); }
    log('  preserve step failed: ' + (e.message || e).slice(0, 160));
  }

  // 2c - copy UAT defects awaiting a dev fix into the QA logs (before build, so counts include them)
  log('Syncing UAT Defect Log -> QA defect logs ...');
  let uatLines = [];
  try {
    const out = execFileSync(process.execPath, DRY ? ['uatsync.js','--dry-run'] : ['uatsync.js'],
      {cwd: HERE, encoding:'utf8', maxBuffer: 8*1024*1024, timeout: 600000});
    uatLines = out.split(/\r?\n/).filter(l => /^UAT SYNC:|^\s{3}[+!~?] /.test(l));
    log('  ' + (uatLines[0] || 'done'));
  } catch (e) { uatLines = ['UAT SYNC FAILED: ' + String(e.stderr || e.message || e).trim().slice(0, 200)]; log('  ' + uatLines[0]); }

  // 3 - rows
  log('Rebuilding master rows ...');
  let b = run('build.js');
  const dlLine = grab(b, /(  defect logs: .*)/); if (dlLine) log(dlLine);

  // 3b - UAT fix subtasks. A real refresh CREATES them (and comments new defects onto an open one)
  // without asking - decided 2026-09-24. uatinit keeps its own guards: a live-Jira re-check before
  // every create, the shared ledger, and it holds rather than guesses when Dev/BSA/object is missing.
  // --dry-run still only reports.
  let uatSubLines = [];
  try {
    const out = execFileSync(process.execPath, DRY ? ['uatinit.js'] : ['uatinit.js','--apply'],
      {cwd: HERE, encoding:'utf8', maxBuffer: 8*1024*1024, timeout: 300000});
    uatSubLines = out.split(/\r?\n/).filter(l => /^UAT SUBTASKS:|^\s{3}[+!~?^(] /.test(l));
  } catch (e) { uatSubLines = ['UAT SUBTASKS FAILED: ' + String(e.stderr || e.message || e).trim().slice(0, 200)]; }
  // Anything just written to Jira is not in this run's pull yet: re-pull and rebuild so the
  // workbook and dashboard show the new subtask now, not an hour from now.
  if (uatSubLines.some(l => /^\s{3}\+ (created|commented) /.test(l))) {
    log('New UAT subtask work in Jira - re-pulling and rebuilding ...');
    run('gather.js');
    b = run('build.js');
  }
  const rows      = grab(b, /Master rows:\s*(\d+)/);
  const mapped    = grab(b, /mapped to Jira:\s*(\d+)/);
  const overrides = grab(b, /manual overrides applied:\s*(\d+)/);
  const conflicts = grab(b, /crosswalk conflicts:\s*(\d+)/);
  const validation= grab(b, /RULE VALIDATION:\s*(.+)/);
  const hoursLine = grab(b, /(hours from Jira logs: .*)/);
  const sprints   = (b.match(/^\s{3}SG\d+:.*$/gm) || []).map(s => s.trim());
  const statusLine= grab(b, /status distribution:\s*(\{.*\})/);

  // 4 - workbook
  let wrote = false, lockNote = null;
  if (DRY) {
    lockNote = 'dry run - workbook not written';
  } else {
    const lk = locked(C.MASTER);
    if (lk) {
      lockNote = `Master Tracking is open or syncing (${lk}) - workbook NOT written. Close it and re-run.`;
    } else {
      // rollback copy before overwriting
      try {
        fs.mkdirSync(C.BASELINE, {recursive:true});
        const stamp = new Date().toISOString().replace(/[-:T]/g,'').slice(0,13);
        fs.copyFileSync(C.MASTER, path.join(C.BASELINE, `Master Tracking_${stamp}.xlsx`));
      } catch (e) { notes.push('could not take a rollback copy: ' + e.code); }
      log('Writing Master Tracking ...');
      run('write.js');
      wrote = true;
    }
  }

  // 4b - Subtask Status column of the Sprint Planning worksheet (Active / Ready / Planning), from this pull
  let planStatus = [];
  if (!DRY) {
    try { planStatus = execFileSync(process.execPath, ['planning.js','status'], {cwd: HERE, encoding:'utf8'}).trimEnd().split(/\r?\n/); }
    catch (e) { planStatus = ['PLANNING STATUS FAILED: ' + String(e.stderr || e.message || e).trim().slice(0, 200)]; }
  }

  // 5 - activity log, dashboard, landing page
  log('Collecting activity and building pages ...');
  const A = require('./activity.js');
  const merged = A.merge(await A.collect());
  // dashboard.js builds synchronously, so hand it the Sprint Planning rows as a snapshot file.
  if (!DRY) {
    const P = await require('./landing.js').planningSummary();
    fs.writeFileSync(C.local('planning-rows.json'), JSON.stringify(P ? P.rows : [], null, 1));
    require('./dashboard.js');
    require('./metrics.js');     // Metric Analysis page, from the same rows.json
  }
  if (!DRY) await require('./landing.js').build(merged.log);
  // A PDC page failure must not fail the refresh: the other pages and the workbook are already written.
  let pdcLines = [];
  if (!DRY) {
    try { pdcLines = execFileSync(process.execPath, ['pdc.js'], {cwd: HERE, encoding:'utf8'}).trimEnd().split(/\r?\n/).filter(l => !l.startsWith('WROTE:')); }
    catch (e) { notes.push('PDC dashboard not written: ' + String(e.stderr || e.message).trim()); }
  }

  // ---- report ----
  const secs = ((Date.now()-started)/1000).toFixed(0);
  log('');
  log('================ NG DASHBOARD REFRESH ================');
  log(`Rows ${rows}   mapped to Jira ${mapped}   overrides ${overrides}   crosswalk conflicts ${conflicts}`);
  log(`Rule validation: ${validation}`);
  if (statusLine) log(`Status: ${statusLine}`);
  log('');
  log('Sprint readiness:');
  sprints.forEach(s => log('  ' + s));
  log('');
  uatLines.forEach(l => log(l.startsWith(' ') ? l.slice(1) : l));
  uatSubLines.forEach(l => log(l.startsWith(' ') ? l.slice(1) : l));
  planStatus.forEach(l => log(l.startsWith(' ') ? l.slice(1) : l));
  if (hoursLine) log('Hours: ' + hoursLine.replace(/^hours from Jira logs: /, ''));
  (gatherHoursBad || []).forEach(l => log('  ' + l.trim()));
  const uatDates = (b.match(/^\s+UAT log dates:.*$|^\s{5}W#\S+ (uatStart|signedOff) .*$/gm) || []).map(s => s.trim());
  uatDates.forEach(s => log('  ' + s));
  log('');
  log(`Activity log: +${merged.added} new, ${merged.updated} updated, ${merged.total} retained`);
  merged.log.slice(0, 8).forEach(e =>
    log(`  ${e.date} ${(e.time||'').padStart(8)}  ${e.text.replace(/<[^>]+>/g,'').replace(/&mdash;/g,'-').replace(/&ndash;/g,'-')}`));
  log('');
  log(`Workbook : ${wrote ? 'written' : (lockNote || 'not written')}`);
  log(`Dashboard: ${DRY ? 'dry run - not written' : C.DASHBOARD}`);
  log(`Analysis : ${DRY ? 'dry run - not written' : C.ANALYSIS}`);
  log(`Landing  : ${DRY ? 'dry run - not written' : C.LANDING}`);
  log(`PDC      : ${DRY ? 'dry run - not written' : (pdcLines.length ? C.PDC : 'not written')}`);
  pdcLines.forEach(l => log(l));
  notes.forEach(n => log(`Note     : ${n}`));
  log(`Completed in ${secs}s`);
  log('======================================================');
})().catch(e => { console.error('REFRESH FAILED: ' + (e.message || e)); process.exit(1); });
