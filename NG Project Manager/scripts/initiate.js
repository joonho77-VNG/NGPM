#!/usr/bin/env node
// Create the Jira subtask + QA defect log for one planned window.
//
//   node initiate.js 102            do W#102
//   node initiate.js 102 --dry-run  show exactly what would happen, write nothing
//
// THIS IS THE ONLY SCRIPT IN THE PROJECT THAT WRITES TO JIRA.
//
// Every step is idempotent and checked independently, so a run that dies half way can simply
// be run again: an existing defect log is not overwritten, an existing subtask is not
// duplicated, and a description is only set if the subtask has none.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('./config.js').req('exceljs');
const { jget, jql, jpost, jput } = require('./jira.js');
const C = require('./config.js');
const { V } = require('./vx.js');

const PROJECT = '10115';            // VISAR
const ISSUETYPE = '10315';          // Subtask-Vision Team
const PARENT = 'VISAR-6166';        // Main AR
const TEMPLATE = 'QA Defect Log - Template.xlsx';
const PLANNING = `${C.ROOT}/Vision NG - Sprint Planning.xlsx`;

const W = (process.argv[2] || '').trim();
const DRY = process.argv.includes('--dry-run');
if (!DRY && W) C.lock('initiate W#' + W);
if (!W) { console.error('usage: node initiate.js <W#> [--dry-run]'); process.exit(2); }

const log = s => process.stdout.write(s + '\n');
const step = (n, s) => log(`  ${n}. ${s}`);

// ---- the description, rebuilt to match the existing subtasks exactly ----
const A = require('./adf.js');
function description(defectUrl) {
  return A.doc([
    A.para('Defect Sheet'), A.link(defectUrl),
    A.para(), A.para(), A.para(), A.para(),
    ...A.hoursLog(),
  ]);
}

(async () => {
  // ---- look the window up ----
  const pipe = require(require('./config.js').local('pipeline.json'));
  const p = pipe.find(r => String(r.B) === W);
  if (!p) { console.error(`W#${W} is not in the Pipeline Plan.`); process.exit(1); }
  const name = p.D, obj = p.E;

  // Sprint # is the Lead BSA's call and lives in the planning sheet - never inferred.
  const pwb = new ExcelJS.Workbook(); await pwb.xlsx.readFile(PLANNING);
  const pws = pwb.worksheets.find(w => w.name.trim() === 'Sprint Planning') || pwb.worksheets[0];
  let prow = 0, sprint = '', existing = '';
  for (let r = 2; r <= pws.rowCount; r++) {
    if (String(V(pws.getRow(r).getCell(3))).trim() === W) {
      prow = r; sprint = String(V(pws.getRow(r).getCell(1))).trim();
      existing = String(V(pws.getRow(r).getCell(2))).trim(); break; }
  }
  if (!prow)   { console.error(`W#${W} is not in the Sprint Planning worksheet.`); process.exit(1); }
  if (!sprint) { console.error(`W#${W} has no Sprint # in the planning sheet. The Lead BSA sets that first.`); process.exit(1); }

  const summary = `${sprint} - ${name} - ${obj}`;
  // Windows forbids \/:*?"<>| in file names (W#17.1 "Close Elig? Button"). The refresh matches
  // logs on letters and digits only, so the stripped name still finds its window.
  const dlName = `QA Defect Log - ${name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()}.xlsx`;
  const dlUrl = C.DEFECT_URL + encodeURIComponent(dlName);

  log('');
  log(`W#${W}  ${name}`);
  log(`  summary : ${summary}`);
  log(`  parent  : ${PARENT}   type: Subtask-Vision Team   assignee: (none)`);
  log(`  defects : ${dlName}`);
  log(`  link    : ${dlUrl}`);
  log('');

  // ---- 1. defect log ----
  const dlPath = path.join(C.DEFECTS, dlName);
  if (fs.existsSync(dlPath)) step(1, `defect log already exists - left alone`);
  else if (DRY)              step(1, `would copy ${TEMPLATE} -> ${dlName}`);
  else { fs.copyFileSync(path.join(C.DEFECTS, TEMPLATE), dlPath); step(1, `created ${dlName}`); }

  // ---- 2. subtask ----
  // Trust the planning sheet first, then fall back to a summary search, so a run that died
  // after creating the issue but before writing the key back still finds it.
  let key = existing;
  if (!key) {
    const hit = await jql(`parent=${PARENT} AND summary~"${name.replace(/"/g,'')}"`, 'summary');
    const exact = hit.find(h => h.fields.summary === summary);
    if (exact) key = exact.key;
  }
  if (key)      step(2, `subtask already exists: ${key} - not recreated`);
  else if (DRY) step(2, `would create subtask "${summary}"`);
  else {
    const r = await jpost('/rest/api/3/issue', {fields:{
      project:{id:PROJECT}, parent:{key:PARENT}, issuetype:{id:ISSUETYPE}, summary}});
    key = r.key; step(2, `created ${key}`);
  }

  // ---- 3. description ----
  if (DRY) step(3, `would set the description with the defect-sheet link and hours table`);
  else {
    const cur = await jget(`/rest/api/3/issue/${key}`, {fields:'description'});
    if (cur.fields.description) step(3, `description already set - left alone`);
    else { await jput(`/rest/api/3/issue/${key}`, {fields:{description: description(dlUrl)}});
           step(3, `description set`); }
  }

  // ---- 4. write the key back to planning ----
  if (key && existing === key) step(4, `planning sheet already has ${key}`);
  else if (DRY)         step(4, `would write ${key || '<new key>'} into the planning sheet`);
  else {
    try { fs.closeSync(fs.openSync(PLANNING, 'r+')); }
    catch (e) { log(`  4. planning sheet is open/locked - key NOT written. Close it and re-run; nothing else will be duplicated.`);
                log(''); log(`W#${W} -> ${key}`); return; }
    pws.getRow(prow).getCell(2).value = key;
    await pwb.xlsx.writeFile(PLANNING);
    step(4, `planning sheet updated with ${key}`);
  }

  log('');
  log(`W#${W} -> ${key || '(dry run)'}`);
})().catch(e => { console.error('FAILED: ' + (e.message || e)); process.exit(1); });
