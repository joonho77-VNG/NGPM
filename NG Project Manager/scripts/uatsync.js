#!/usr/bin/env node
// Copies UAT defects that need a developer fix into the window's QA defect log.
//
//   node uatsync.js                    add every pending UAT defect, report drift
//   node uatsync.js --dry-run          show what would be added; write nothing
//   node uatsync.js --only "Priors"    limit to one UAT window (matched on its section title)
//   node uatsync.js --seed "JBSIS"     record that window's pending defects as already copied by
//                                      hand - nothing is written to the QA log
//
// Rules (agreed 2026-09-22):
//   - A UAT row is copied when Status is Fix In-Progress or Returned to CTS and Description is filled.
//   - It lands in the QA log as Status=New, tagged "[UAT #n]" at the front of Summary, and
//     "UAT" in QA Cycle where the log has that column.
//   - Insert-only. Once copied, the QA row belongs to QA; this never edits or deletes it.
//     Drift between the two logs is reported instead.
//   - The ledger (NG Dashboard State/uat-sync.json, shared by every runner) is what prevents
//     a second copy; the [UAT #n] tag in the QA log is a second check.
//
// Writes go through Excel itself (uatwrite.ps1), not ExcelJS: the QA logs keep their Status /
// Bug Type dropdowns as cross-sheet validations that ExcelJS drops on save.
const ExcelJS = require('./config.js').req('exceljs');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const C = require('./config.js');
const U = require('./uat.js');
const { OPEN } = require('./defects.js');

const ARGS = process.argv.slice(2);
const DRY = ARGS.includes('--dry-run');
const opt = n => { const i = ARGS.indexOf(n); return i >= 0 ? ARGS[i+1] : null; };
const ONLY = opt('--only'), SEED = opt('--seed');
const LEDGER = path.join(C.STATEDIR, 'uat-sync.json');
const norm = U.norm;
const log = s => console.log(s);
const TODAY = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles'}).format(new Date());

const txt = v => { if (v && typeof v === 'object' && !(v instanceof Date))
    v = v.result ?? v.text ?? (v.richText ? v.richText.map(t=>t.text).join('') : '');
  if (v instanceof Date) return v.toISOString().slice(0,10);
  return String(v ?? '').trim(); };

const lkey = (sec, id) => `${sec.key}#${id}`;
const matches = (sec, q) => q && (sec.key.includes(norm(q)) || norm(q).includes(sec.key));

// Excel leaves "~$" + name (first two chars dropped on long names) beside an open workbook.
function isOpen(file) {
  const dir = path.dirname(file), base = path.basename(file);
  if (fs.existsSync(path.join(dir, '~$' + base)) || fs.existsSync(path.join(dir, '~$' + base.slice(2)))) return 'open in Excel';
  try { fs.closeSync(fs.openSync(file, 'r+')); return false; } catch (e) { return e.code || 'locked'; }
}

// Locate columns by header text - the 55 logs use 12 layouts.
function layout(ws) {
  const H = []; for (let i = 1; i <= 20; i++) H[i] = norm(txt(ws.getRow(1).getCell(i).value));
  const find = re => { const i = H.findIndex(h => h && re.test(h)); return i > 0 ? i : 0; };
  return {
    id: find(/^id$/), cycle: find(/^qacycle$/), date: find(/^date(tested|reported)$/),
    tester: find(/^testerinitials$/), bug: find(/^bugtype$/), status: find(/^status$/),
    loc: find(/^windowtab$/) || find(/^windowsections?$/) || find(/^windowcolumns?$/) || find(/^tabs?$/),
    summary: find(/^summary$/), defect: find(/^defect|^ngdisplayscenario$/),
    comments: find(/^(testing|test|bsatestscenario)comments$/),
  };
}

async function readQA(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(C.DEFECTS, file));
  const ws = wb.getWorksheet('DEFECTS');
  if (!ws) return null;
  const L = layout(ws);
  if (!L.summary || !L.status) return null;
  let last = 1, maxId = 0; const tags = {}, byId = {};
  for (let r = 2; r <= ws.actualRowCount + 5; r++) {
    const g = i => i ? txt(ws.getRow(r).getCell(i).value) : '';
    const sum = g(L.summary), st = g(L.status), def = g(L.defect);
    if (!sum && !st && !def) continue;
    last = r;
    const id = g(L.id); if (/^\d+$/.test(id)) maxId = Math.max(maxId, Number(id));
    byId[id] = { row: r, status: st, summary: sum };
    const t = sum.match(/^\[UAT #(\d+)\]/i); if (t) tags[t[1]] = { id, row: r, status: st };
  }
  return { L, last, maxId, tags, byId };
}

// Build the cell values for one QA row from one UAT defect.
function qaRow(sec, d, L, id) {
  const cut = d.desc.indexOf(' - ');
  const loc = cut > 0 && cut <= 40 ? d.desc.slice(0, cut).trim() : '';
  let rest = (loc ? d.desc.slice(cut + 3) : d.desc).replace(/\s+/g, ' ').trim();
  if (rest.length > 100) rest = rest.slice(0, 100).replace(/\s+\S*$/, '') + '...';
  const who = [d.dept, d.reporter && 'reporter ' + d.reporter, d.tester && 'tester ' + d.tester,
               d.severity && 'severity ' + d.severity, d.iteration && 'UAT iteration ' + d.iteration].filter(Boolean).join('; ');
  const v = {};
  const set = (c, val, kind) => { if (c && val !== '' && val != null) v[c] = { val, kind: kind || 'text' }; };
  set(L.id, id, 'number');
  set(L.cycle, 'UAT');
  set(L.date, d.reported || d.tested || TODAY, 'date');
  set(L.tester, d.tester);
  set(L.bug, /high/i.test(d.severity) ? 'Major' : 'Minor');
  set(L.status, 'New');
  set(L.loc, loc);
  set(L.summary, `[UAT #${d.id}] ${rest}`);
  set(L.defect, d.desc);
  set(L.comments, `From UAT Defect Log - ${sec.title} #${d.id} (${who}).` + (d.comments ? ' ' + d.comments : ''));
  return v;
}

(async () => {
  const ledger = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : {};
  const files = fs.readdirSync(C.DEFECTS).filter(f => /\.xlsx$/i.test(f) && !/^~\$/.test(f) && !/Template/i.test(f));
  const sections = await U.read();

  // --seed: record a window's pending rows as copied by hand, then stop.
  if (SEED) {
    const hit = sections.filter(s => matches(s, SEED));
    if (!hit.length) { log(`  no UAT window matches "${SEED}"`); process.exit(1); }
    let n = 0;
    hit.forEach(s => s.defects.filter(d => d.push).forEach(d => {
      if (ledger[lkey(s, d.id)]) return;
      ledger[lkey(s, d.id)] = { window: s.title, uatId: d.id, qaFile: U.qaFileFor(s, files), qaId: null, by: 'manual', date: TODAY };
      log(`  seeded ${s.title} #${d.id} (copied by hand)`); n++;
    }));
    if (!DRY) fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
    log(`  ${n} UAT defect(s) marked as already in the QA log${DRY ? ' (dry run - ledger not saved)' : ''}`);
    return;
  }

  const plan = {}, unmatched = [], drift = [];
  const qaCache = {};
  const getQA = async f => (qaCache[f] = qaCache[f] || await readQA(f));

  for (const s of sections) {
    const pending = s.defects.filter(d => d.push);
    const inScope = !ONLY || matches(s, ONLY);
    const f = U.qaFileFor(s, files);
    if (!f) { if (pending.length) unmatched.push(`${s.title} (${pending.length} pending)`); continue; }

    // Drift: anything already copied, whether or not it is still pending in UAT.
    for (const d of s.defects) {
      const e = ledger[lkey(s, d.id)]; if (!e || e.qaId == null) continue;
      const qa = await getQA(f); const q = qa && qa.byId[String(e.qaId)]; if (!q) continue;
      const qaOpen = OPEN.has(norm(q.status));
      if (d.push && !qaOpen) drift.push(`${s.title} UAT #${d.id}: QA row ${e.qaId} is ${q.status} but UAT still says ${d.status} - return it to UAT`);
      // UAT "New" = staff re-reviewing it, not a verdict - only flag when UAT has actually moved on
      if (!d.push && qaOpen && norm(d.status) !== 'new') drift.push(`${s.title} UAT #${d.id}: UAT is ${d.status} but QA row ${e.qaId} is still ${q.status}`);
    }

    if (!inScope) continue;
    for (const d of pending) {
      if (ledger[lkey(s, d.id)]) continue;
      const qa = await getQA(f);
      if (!qa) { unmatched.push(`${s.title} -> ${f} (no DEFECTS sheet / Summary+Status headers)`); break; }
      if (qa.tags[d.id]) {                               // already there (added by an earlier runner)
        ledger[lkey(s, d.id)] = { window: s.title, uatId: d.id, qaFile: f, qaId: qa.tags[d.id].id, by: 'found', date: TODAY };
        continue;
      }
      const p = plan[f] = plan[f] || { file: f, section: s, qa, rows: [] };
      const id = qa.maxId + p.rows.length + 1;
      p.rows.push({ uat: d, id, row: qa.last + p.rows.length + 1, values: qaRow(s, d, qa.L, id) });
    }
  }

  // ---- write ----
  const added = [], skipped = [];
  for (const p of Object.values(plan)) {
    const full = path.join(C.DEFECTS, p.file);
    p.rows.forEach(r => log(`  ${DRY ? 'would add' : 'adding'}: ${p.file.replace(/^QA Defect Log - |\.xlsx$/g,'')} row ${r.row} ID ${r.id}  <- UAT ${p.section.title} #${r.uat.id}  "${r.values[p.qa.L.summary].val}"`));
    if (DRY) continue;
    const lk = isOpen(full);
    if (lk) { skipped.push(`${p.file} (${lk}) - ${p.rows.length} row(s) held for next refresh`); continue; }
    fs.mkdirSync(C.BASELINE, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:T]/g,'').slice(0,13);
    fs.copyFileSync(full, path.join(C.BASELINE, p.file.replace(/\.xlsx$/i, `_${stamp}.xlsx`)));
    const job = path.join(C.STATE, 'uatwrite-job.json');
    fs.writeFileSync(job, JSON.stringify({ file: full.split('/').join('\\'), fmtFrom: p.qa.last,
      rows: p.rows.map(r => ({ row: r.row, cells: Object.entries(r.values).map(([c, x]) => ({ col: Number(c), val: String(x.val), kind: x.kind })) })) }));
    try {
      const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(__dirname, 'uatwrite.ps1'), job], { encoding: 'utf8', timeout: 180000 });
      if (!/^OK/m.test(out)) throw new Error(out.trim().slice(0, 300));
      p.rows.forEach(r => {
        ledger[lkey(p.section, r.uat.id)] = { window: p.section.title, uatId: r.uat.id, qaFile: p.file, qaId: r.id, by: 'sync', date: TODAY };
        added.push(`${p.section.title} #${r.uat.id} -> ${p.file} ID ${r.id}`);
      });
      fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));   // after every file, so a later failure cannot cause a re-add
    } catch (e) { skipped.push(`${p.file} - write failed: ${(e.stderr || e.message || e).toString().trim().slice(0, 200)}`); }
  }
  if (!DRY) fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));

  // ---- report (refresh.js greps these lines) ----
  const planned = Object.values(plan).reduce((n, p) => n + p.rows.length, 0);
  log(`UAT SYNC: ${DRY ? planned + ' to add (dry run)' : added.length + ' added'}, ${skipped.length} file(s) skipped, ${drift.length} drift, ${unmatched.length} unmatched`);
  added.forEach(a => log(`   + ${a}`));
  skipped.forEach(s => log(`   ! skipped ${s}`));
  drift.forEach(d => log(`   ~ ${d}`));
  unmatched.forEach(u => log(`   ? no QA log for UAT window ${u}`));
})().catch(e => { console.error('UAT SYNC FAILED: ' + (e.message || e)); process.exit(1); });
