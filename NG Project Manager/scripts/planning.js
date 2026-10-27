#!/usr/bin/env node
// Sprint Planning worksheet.
//
//   node planning.js add 102,103,110      add windows (accepts 102-111 ranges and decimals)
//   node planning.js list                 show the worksheet
//   node planning.js remove 103,104       pull windows back out
//   node planning.js status               fill the Subtask Status column from the last Jira pull (refresh runs it)
//
// The Lead Developer EDITS this file, so it is never regenerated wholesale.
// Existing rows and their values are always preserved; adds append, removes delete rows.

const ExcelJS = require('./config.js').req('exceljs');
const fs = require('fs');
const path = require('path');
const C = require('./config.js');
const { V } = require('./vx.js');

const FILE = path.join(C.ROOT, 'Vision NG - Sprint Planning.xlsx');
const SHEET = 'Sprint Planning';

// Column order mirrors the "Next Sprint Windows" section of the TEMP dashboard.
// 'Previous Days to QA' and 'Notes' are deliberately omitted for now.
const COLS = [
  ['Sprint #',   'sprint',  11],   // manual
  ['Subtask',    'subtask', 13],   // filled when the sprint is initiated in Jira
  ['W#',         'W',        8],
  ['Menu Group', 'menu',    16],
  ['Window / Subscreen Name', 'name', 34],
  ['Object Name','obj',     32],
  ['Grouping',   'grouping',13],
  ['Dev',        'dev',      7],   // manual
  ['BSA',        'bsa',      7],   // manual
  ['DEV LEAD LOE','loe',    13],   // manual - days to first QA, per Lead Developer
];
const MANUAL = new Set(['sprint','dev','bsa','loe']);

// Subtask Status (2026-10-26): Active = the subtask has left Subtask Created, so a developer is on it.
// Ready = subtask, Dev and DEV LEAD LOE are all in place. Planning = any of the three is missing.
// The team adds its own columns after DEV LEAD LOE (Orig LOE, a hand-kept Status, notes), so this
// one is found by header, appended past the last used column when absent, and never overwrites a
// value it did not write.
const STATUS_HDR = 'Subtask Status';
const STATUS_FILL = {Active:'FFE2F0D9', Ready:'FFDDEBF7', Planning:'FFFFF2CC'};
const IDLE = new Set(['', 'Subtask Created', 'On-Hold', 'Backlog', 'Canceled']);
function jiraStatus() {
  try { const g = require(C.local('gathered.json')), out = {};
        Object.values(g.derived || {}).forEach(d => out[d.key] = d.jira); return out; }
  catch (e) { return {}; }
}
function statusOf(r, jira) {
  if (r.subtask && !IDLE.has(jira[r.subtask] || '')) return 'Active';
  return r.subtask && r.dev && r.loe ? 'Ready' : 'Planning';
}
function headerCol(ws, text) {
  let at = 0; ws.getRow(1).eachCell((c, i) => { if (String(V(c)).trim().toLowerCase() === text.toLowerCase()) at = i; });
  return at;
}
function paintStatus(cell) {
  const argb = STATUS_FILL[V(cell)];
  if (argb) cell.fill = {type:'pattern',pattern:'solid',fgColor:{argb}};
  cell.font = {size:10, bold:true, color:{argb:'FF15181D'}};
  cell.alignment = {horizontal:'center'};
}

const HDR = {
  fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FF1F3864'}},
  font:{bold:true,color:{argb:'FFFFFFFF'},size:10},
  alignment:{vertical:'middle',horizontal:'center',wrapText:true},
};

function expand(spec) {
  const out = [];
  for (const part of String(spec).split(',').map(s => s.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
    if (m) {
      const a = Math.ceil(Number(m[1])), b = Math.floor(Number(m[2]));
      for (let i = a; i <= b; i++) out.push(String(i));
    } else out.push(part);
  }
  return [...new Set(out)];
}

async function load() {
  const wb = new ExcelJS.Workbook();
  if (fs.existsSync(FILE)) {
    await wb.xlsx.readFile(FILE);
    if (wb.getWorksheet(SHEET)) return wb;
  }
  const ws = wb.addWorksheet(SHEET, {views:[{state:'frozen', ySplit:1}]});
  ws.columns = COLS.map(c => ({header:c[0], key:c[1], width:c[2]}));
  ws.getRow(1).eachCell(c => Object.assign(c, HDR));
  ws.getRow(1).height = 30;
  return wb;
}

const readRows = ws => {
  const out = [], sc = headerCol(ws, STATUS_HDR);
  for (let r = 2; r <= ws.rowCount; r++) {
    const o = {row:r};
    COLS.forEach((c, i) => o[c[1]] = V(ws.getRow(r).getCell(i + 1)));
    o.status = sc ? V(ws.getRow(r).getCell(sc)) : '';
    if (o.W) out.push(o);
  }
  return out;
};

// exceljs spliceRows leaves phantom rows behind, so rewrite the sheet from its own data.
// Every column is read first, so the Lead Developer's manual entries always survive.
function rewrite(wb, rows) {
  wb.removeWorksheet(wb.getWorksheet(SHEET).id);
  const ws = wb.addWorksheet(SHEET, {views:[{state:'frozen', ySplit:1}]});
  ws.columns = COLS.map(c => ({header:c[0], key:c[1], width:c[2]}));
  ws.getRow(1).eachCell(c => Object.assign(c, HDR));
  ws.getRow(1).height = 30;
  rows.sort((a,b) => parseFloat(a.W) - parseFloat(b.W))
      .forEach(r => { const o = {}; COLS.forEach(c => o[c[1]] = r[c[1]] ?? ''); ws.addRow(o); });
  style(ws);
  return ws;
}

function style(ws) {
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    // "done" means fully planned AND in Jira - a subtask alone is not enough, since an
    // unassigned subtask (W#8/8.1) is precisely what still needs planning.
    const initiated = V(row.getCell(2)) && V(row.getCell(1)) && V(row.getCell(8))
                   && V(row.getCell(9)) && V(row.getCell(10));
    row.eachCell({includeEmpty:true}, (cell, i) => {
      const key = COLS[i - 1] && COLS[i - 1][1];
      cell.font = {size:10, color:{argb: initiated ? 'FF9AA3B2' : 'FF15181D'}};
      if (initiated) cell.fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFEFEFEF'}};
      else if (MANUAL.has(key) && !V(cell))              // highlight what a human still owes
        cell.fill = {type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF6DA'}};
    });
  }
  ws.autoFilter = {from:{row:1,column:1}, to:{row:1,column:COLS.length}};
}

async function save(wb) {
  try { fs.closeSync(fs.openSync(FILE, 'r+')); } catch (e) {
    if (e.code !== 'ENOENT') {
      console.log(`FAIL  Sprint Planning is open in Excel (${e.code}). Close it and run again.`);
      process.exit(4);
    }
  }
  await wb.xlsx.writeFile(FILE);
}

(async () => {
  const [cmd, spec] = process.argv.slice(2);
  const wb = await load();
  const ws = wb.getWorksheet(SHEET);
  const existing = readRows(ws);

  if (!cmd || cmd === 'list') {
    console.log(`Sprint Planning  (${existing.length} window(s))`);
    console.log(`file: ${FILE}\n`);
    if (!existing.length) { console.log('  (empty)'); return; }
    console.log('  Sprint  Subtask       W#      Window                          Dev  BSA  LOE  Status');
    existing.forEach(r => console.log(
      `  ${(r.sprint||'-').padEnd(7)} ${(r.subtask||'-').padEnd(13)} ${String(r.W).padEnd(7)} ` +
      `${(r.name||'').slice(0,30).padEnd(31)} ${(r.dev||'-').padEnd(4)} ${(r.bsa||'-').padEnd(4)} ${String(r.loe||'-').padEnd(4)} ${r.status||'-'}`));
    const complete = r => r.sprint && r.dev && r.bsa && r.loe;
    const pend = existing.filter(r => !complete(r));
    if (pend.length) {
      console.log(`\n  ${pend.length} row(s) still need manual entry:`);
      pend.forEach(r => {
        const miss = ['sprint','dev','bsa','loe'].filter(k => !r[k])
          .map(k => ({sprint:'Sprint #',dev:'Dev',bsa:'BSA',loe:'DEV LEAD LOE'}[k]));
        console.log(`    W#${String(r.W).padEnd(7)} missing ${miss.join(', ')}`);
      });
    }
    const ready = existing.filter(complete);
    const toCreate = ready.filter(r => !r.subtask);
    const toAssign = ready.filter(r => r.subtask);
    console.log(`\n  ready to assign: ${ready.length}`);
    if (toCreate.length) console.log(`     create subtask : ${toCreate.map(r=>'W#'+r.W).join(', ')}`);
    if (toAssign.length) console.log(`     assign existing: ${toAssign.map(r=>'W#'+r.W+' ('+r.subtask+')').join(', ')}`);
    return;
  }

  // Fill the Status column in place - no rewrite, so the Lead Developer's formatting survives.
  // Saves only when a value changed, and skips quietly when the worksheet is open.
  if (cmd === 'status') {
    if (!fs.existsSync(FILE)) { console.log('PLANNING STATUS: no worksheet'); return; }
    const jira = jiraStatus(), changed = [], kept = [];
    let col = headerCol(ws, STATUS_HDR);
    if (!col) {
      col = ws.columnCount + 1;              // past every used column, headed or not (notes have no header)
      const head = ws.getRow(1).getCell(col);
      head.value = STATUS_HDR; Object.assign(head, HDR); ws.getColumn(col).width = 15;
      changed.push('header');
    }
    existing.forEach(r => {
      const cell = ws.getRow(r.row).getCell(col), cur = String(V(cell)).trim(), s = statusOf(r, jira);
      if (cur === s) return;
      if (cur && !STATUS_FILL[cur]) { kept.push(`W#${r.W} "${cur}"`); return; }   // a person's value
      cell.value = s; paintStatus(cell);
      changed.push(`W#${r.W} ${cur || '(blank)'} -> ${s}`);
    });
    const n = k => existing.filter(r => statusOf(r, jira) === k).length;
    const tally = `Active ${n('Active')}, Ready ${n('Ready')}, Planning ${n('Planning')}`;
    const rows = changed.filter(c => c !== 'header');
    const keptNote = kept.length ? `; ${kept.length} hand-entered value(s) left alone` : '';
    if (!changed.length) { console.log(`PLANNING STATUS: unchanged (${tally})${keptNote}`); kept.forEach(k => console.log('   ! ' + k)); return; }
    try { fs.closeSync(fs.openSync(FILE, 'r+')); }
    catch (e) { console.log(`PLANNING STATUS: worksheet is open (${e.code}) - not updated`); return; }
    await wb.xlsx.writeFile(FILE);
    console.log(`PLANNING STATUS: ${rows.length} row(s) updated in column ${col} (${tally})${keptNote}`);
    rows.forEach(c => console.log('   ' + c));
    kept.forEach(k => console.log('   ! ' + k));
    return;
  }

  const R = require(require('./config.js').local('rows.json'));
  const byW = {}; R.rows.forEach(r => { if (r.W) byW[r.W] = r; });
  const have = new Set(existing.map(r => String(r.W)));
  const want = expand(spec || '');
  if (!want.length) { console.log('No window numbers given. Example: node planning.js add 102,103,110'); process.exit(1); }

  if (cmd === 'remove') {
    const gone = [], kept = [];
    const keep = existing.filter(r => {
      if (!want.includes(String(r.W))) return true;
      if (r.subtask && r.dev) { kept.push(r.W); return true; }      // assigned and in flight
      gone.push(r.W); return false;
    });
    rewrite(wb, keep); await save(wb);
    console.log(`removed ${gone.length}: ${gone.join(', ') || '(none)'}`);
    if (kept.length) console.log(`kept ${kept.length} (already has a Jira subtask): ${kept.join(', ')}`);
    return;
  }

  if (cmd !== 'add') { console.log('Commands: add | remove | list | status'); process.exit(1); }

  const added = [], rejected = [];
  const rows = existing.slice();
  for (const w of want) {
    const m = byW[w];
    if (!m)                     { rejected.push([w, 'not a known window']); continue; }
    if (have.has(w))            { rejected.push([w, 'already in Sprint Planning']); continue; }
    // A subtask that exists but has no Dev is exactly what planning is for: it was created
    // and never assigned. Carry its key across so initiate ASSIGNS rather than re-creates.
    if (m.subtask && m.dev)     { rejected.push([w, `already assigned in Jira (${m.subtask}, Dev ${m.dev})`]); continue; }
    if (m.status === 'Canceled'){ rejected.push([w, 'canceled']); continue; }
    rows.push({sprint:m.subtask ? m.sprint : '', subtask:m.subtask || '', W:w, menu:m.menu,
               name:m.name, obj:m.obj, grouping:m.grouping, dev:'', bsa:'', loe:''});
    have.add(w); added.push(w);
  }

  rewrite(wb, rows);
  await save(wb);

  console.log(`Sprint Planning: ${FILE}`);
  console.log(`added ${added.length}: ${added.join(', ') || '(none)'}`);
  if (rejected.length) {
    console.log(`rejected ${rejected.length}:`);
    rejected.forEach(([w, why]) => console.log(`   W#${String(w).padEnd(7)} ${why}`));
  }
  console.log(`\nworksheet now holds ${rows.length} window(s).`);
  console.log('Lead Developer fills Sprint #, Dev, BSA and DEV LEAD LOE (highlighted), then saves.');
})().catch(e => { console.error('ERR ' + (e.message || e)); process.exit(1); });
