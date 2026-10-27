#!/usr/bin/env node
// Protects hand edits to Master Tracking from being wiped by the wholesale rebuild.
//
// Runs BEFORE build.js. Compares the workbook as it stands now against the snapshot of
// what the last refresh wrote. Any cell that differs was changed by a human, so:
//
//   human-owned field  -> carried forward silently (derivation never produces these)
//   derived field      -> recorded in manual-overrides.json, applied by build.js,
//                         shown in the Overridden column, and reported. Never silent.
//
// Delete an entry from manual-overrides.json to let derivation take that field back.

const ExcelJS = require('./config.js').req('exceljs');
const fs = require('fs');
const path = require('path');
const C = require('./config.js');
const { V } = require('./vx.js');

const SNAP = C.shared('last-write.json');
const MANUAL = C.shared('manual-overrides.json');

// header text -> internal row key
const MAP = {
  'Sprint #':'sprint', 'Status':'status', 'QA Cycle':'qaCycle', 'Dev':'dev', 'BSA':'bsa',
  'Date Started':'started', 'To QA':'toQA', '2 Week Start':'twoWk', 'Target Date':'target',
  'To UAT':'toUAT', 'UAT Start':'uatStart', 'Signed Off':'signedOff', 'Deployed':'deployed',
  'Build #':'build', 'LOE to QA':'loeToQA', 'Development':'hDev', 'QA Test':'hQA',
  'Mitigation':'hMit', 'UAT':'hUAT',
};
// Derivation never produces these, so a value here is always the human's and is simply kept.
// All four hours buckets are derived from the Jira hours logs since 2026-09-23, so a hand edit
// to any of them is pinned and reported like any other derived field, never carried silently.
const HUMAN = new Set(['uatStart','signedOff','deployed','build']);

function readWorkbookRows(ws) {
  const H = {}; ws.getRow(1).eachCell((c, i) => H[V(c)] = i);
  const wcol = H['W#'], scol = H['Subtask'];
  const out = {};
  for (let r = 2; r <= ws.rowCount; r++) {
    const w = V(ws.getRow(r).getCell(wcol));
    const key = w || V(ws.getRow(r).getCell(scol));       // patch rows have no W#
    if (!key) continue;
    const o = {};
    Object.entries(MAP).forEach(([hdr, f]) => { if (H[hdr]) o[f] = V(ws.getRow(r).getCell(H[hdr])); });
    out[key] = o;
  }
  return out;
}

(async () => {
  if (!fs.existsSync(C.MASTER)) { console.log('  no existing workbook - nothing to preserve'); return; }
  if (!fs.existsSync(SNAP)) {
    console.log('  no snapshot from a previous refresh yet - edits cannot be detected this run');
    return;
  }

  // A copy matching an OLDER write means OneDrive has not pulled the newest one down yet.
  // Comparing it to the newest snapshot would mistake old values for hand edits and pin them.
  let meta = null;
  try { meta = JSON.parse(fs.readFileSync(C.shared('last-write.meta.json'), 'utf8')); } catch (e) {}
  if (meta) {
    const h = C.sha(C.MASTER);
    if (h !== meta.hash && (meta.history || []).includes(h)) {
      console.log(`  STALE: Master Tracking on this PC is older than the last refresh (${meta.who}, ${meta.at}).`);
      console.log('  OneDrive has not finished syncing it. Wait a minute and re-run.');
      process.exit(3);
    }
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(C.MASTER);
  const ws = wb.getWorksheet('Master Tracking');
  if (!ws) { console.log('  Master Tracking sheet missing - skipping'); return; }

  const now = readWorkbookRows(ws);
  const prev = JSON.parse(fs.readFileSync(SNAP, 'utf8'));
  const manual = fs.existsSync(MANUAL) ? JSON.parse(fs.readFileSync(MANUAL, 'utf8')) : {};

  const carried = [], pinned = [];
  for (const [key, cur] of Object.entries(now)) {
    const was = prev[key]; if (!was) continue;               // new row, nothing to compare
    for (const [f, v] of Object.entries(cur)) {
      const before = was[f] ?? '';
      if (String(v) === String(before)) continue;            // unchanged
      if (v === '' && before !== '') continue;               // cleared - let derivation decide
      manual[key] = manual[key] || {};
      manual[key][f] = v;
      (HUMAN.has(f) ? carried : pinned).push({key, f, from: before, to: v});
    }
  }

  fs.writeFileSync(MANUAL, JSON.stringify(manual, null, 1));

  if (!carried.length && !pinned.length) { console.log('  no hand edits detected'); return; }
  if (carried.length) {
    console.log(`  carried forward ${carried.length} hand-entered value(s):`);
    carried.forEach(c => console.log(`     ${c.key.padEnd(8)} ${c.f.padEnd(10)} "${c.to}"`));
  }
  if (pinned.length) {
    console.log(`  PINNED ${pinned.length} edit(s) to DERIVED field(s) - these now beat Jira:`);
    pinned.forEach(c => console.log(`     ${c.key.padEnd(8)} ${c.f.padEnd(10)} "${c.from}" -> "${c.to}"`));
    console.log('     (remove from manual-overrides.json to let Jira drive them again)');
  }
})().catch(e => { console.error('ERR ' + (e.message || e)); process.exit(1); });
