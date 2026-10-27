#!/usr/bin/env node
// Assign planned subtasks once the Lead Developer has filled in Dev, BSA and LOE.
//
//   node assign.js                 DRY RUN over every ready row - writes nothing
//   node assign.js --apply         assign them all
//   node assign.js 102 --apply     just W#102
//
// Convention, taken from the subtasks already in flight:
//   assignee     = Dev
//   Project Team = [Dev, BSA]   (customfield_10375)
// DEV LEAD LOE is deliberately NOT written to Jira - it lives in the planning sheet and the
// master only. Nothing here transitions status; a developer starting work does that.
const ExcelJS = require('./config.js').req('exceljs');
const { jget, jput } = require('./jira.js');
const C = require('./config.js');
const { V } = require('./vx.js');
const roster = require(require('./config.js').shared('roster.json'));

const TEAM = 'customfield_10375';
const PLANNING = `${C.ROOT}/Vision NG - Sprint Planning.xlsx`;
const APPLY = process.argv.includes('--apply');
const ONLY = process.argv.slice(2).find(a => !a.startsWith('--')) || null;
if (APPLY) C.lock('assign');
const log = s => process.stdout.write(s + '\n');

(async () => {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(PLANNING);
  const ws = wb.worksheets.find(w => w.name.trim() === 'Sprint Planning') || wb.worksheets[0];

  const rows = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const g = ws.getRow(r);
    const W = String(V(g.getCell(3))).trim(); if (!W) continue;
    rows.push({W, sprint:String(V(g.getCell(1))).trim(), key:String(V(g.getCell(2))).trim(),
               name:String(V(g.getCell(5))).trim(), dev:String(V(g.getCell(8))).trim(),
               bsa:String(V(g.getCell(9))).trim(), loe:String(V(g.getCell(10))).trim()});
  }

  const pick = ONLY ? rows.filter(r => r.W === ONLY) : rows;
  if (ONLY && !pick.length) { console.error(`W#${ONLY} is not in the planning sheet.`); process.exit(1); }

  const ready = [], skip = [];
  for (const r of pick) {
    const why = !r.key ? 'no subtask yet - run initiate.js first'
              : !r.dev ? 'no Dev'
              : !r.bsa ? 'no BSA'
              : !r.loe ? 'no DEV LEAD LOE'
              : !roster[r.dev] ? `Dev "${r.dev}" is not in roster.json`
              : !roster[r.bsa] ? `BSA "${r.bsa}" is not in roster.json`
              : null;
    if (why) skip.push({...r, why}); else ready.push(r);
  }

  if (skip.length) {
    log('');
    log(`not ready (${skip.length}):`);
    skip.forEach(r => log(`  W#${r.W.padEnd(7)} ${r.name.slice(0,34).padEnd(36)} ${r.why}`));
  }

  if (!ready.length) { log(''); log('nothing ready to assign.'); return; }

  log('');
  log(`${APPLY ? 'ASSIGNING' : 'DRY RUN - would assign'} ${ready.length} subtask(s):`);
  for (const r of ready) {
    const dev = roster[r.dev], bsa = roster[r.bsa];
    const cur = await jget(`/rest/api/3/issue/${r.key}`, {fields:`assignee,${TEAM}`});
    const has = cur.fields.assignee;
    const hasTeam = (cur.fields[TEAM] || []).length > 0;

    const parts = [];
    if (has) parts.push(`assignee already ${has.displayName} - left alone`);
    else parts.push(`assignee -> ${dev.displayName}`);
    if (hasTeam) parts.push('Project Team already set - left alone');
    else parts.push(`team -> ${dev.displayName} + ${bsa.displayName}`);

    log(`  W#${r.W.padEnd(7)} ${r.key.padEnd(12)} ${parts.join(' | ')}`);

    if (!APPLY) continue;
    const fields = {};
    if (!has)     fields.assignee = {accountId: dev.accountId};
    if (!hasTeam) fields[TEAM] = [{accountId: dev.accountId}, {accountId: bsa.accountId}];
    if (Object.keys(fields).length) await jput(`/rest/api/3/issue/${r.key}`, {fields});
  }

  log('');
  log(APPLY ? `assigned ${ready.length}. Run the dashboard refresh to pick it up.`
            : `dry run - nothing written. Re-run with --apply to perform these.`);
})().catch(e => { console.error('FAILED: ' + (e.message || e)); process.exit(1); });
