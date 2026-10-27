// One parse of each QA defect log, shared by build.js (open/total) and activity.js (today's churn).
//
// Before this module the logs were parsed twice per refresh - 35 workbooks, ~19 MB, ~19s each pass.
// Two things fix that:
//   1. results are cached on (mtime, size), so an untouched log is never re-parsed;
//   2. a log whose mtime predates today cannot contain a row dated today, so its
//      added/resolved counts are known to be zero without opening it.
// Statting all 38 files costs ~2ms; parsing them costs ~19s.
//
// Failure mode is slow, never wrong: if OneDrive touches a file's mtime we do a needless
// parse, but a real edit always moves mtime, so an event can never be missed.
const ExcelJS = require('./config.js').req('exceljs');
const fs = require('fs');
const path = require('path');
const C = require('./config.js');

const CACHE = require('./config.js').local('defect-cache.json');
// Same Pacific-time day boundary activity.js uses - a UTC date would roll over mid-afternoon.
const PTDATE = d => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles'}).format(new Date(d));
const TODAY = PTDATE(new Date());
// The one definition of an active defect; uatsync.js imports it. Both spellings of Return(ed) to Dev count.
const OPEN = new Set(['new','returntodev','returnedtodev','retestinprogress']);
const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');

const hv = (ws,i) => { let v = ws.getRow(1).getCell(i).value;
  if (v && typeof v === 'object') v = v.result ?? v.text ?? (v.richText?v.richText.map(t=>t.text).join(''):'');
  return String(v||'').replace(/\s+/g,' ').trim(); };

const cv = (ws,r,i) => { let v = ws.getRow(r).getCell(i).value;
  if (v instanceof Date) return v.toISOString().slice(0,10);
  if (v && typeof v === 'object') { if (v.result instanceof Date) return v.result.toISOString().slice(0,10);
    v = v.result ?? v.text ?? (v.richText?v.richText.map(t=>t.text).join(''):''); }
  if (v instanceof Date) return v.toISOString().slice(0,10);
  return String(v==null?'':v).trim(); };

async function parse(file, today) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(C.DEFECTS, file));
  const ws = wb.getWorksheet('DEFECTS');
  if (!ws) return null;
  let cRep=0,cStat=0,cSum=0,cRe=0,cCyc=0;
  for (let i=1;i<=18;i++) { const h=hv(ws,i);
    if (/^date\s*(reported|tested)$/i.test(h)) cRep=i;
    if (/^status$/i.test(h)) cStat=i;
    if (/^summary$/i.test(h)) cSum=i;
    if (/^date\s*retest$/i.test(h)) cRe=i;
    if (/^qa\s*cycle$/i.test(h)) cCyc=i; }
  if (!cSum || !cStat) return null;
  let open=0,total=0,added=0,resolved=0,uatOpen=0;
  const uatRows=[];                             // {date, open} per UAT-origin row; build.js compares to UAT Start
  for (let r=2;r<=ws.rowCount;r++) {
    const sum = cv(ws,r,cSum);
    if (!sum) continue;                         // a defect exists only if Summary is filled
    total++;
    const st = cv(ws,r,cStat);
    const isOpen = OPEN.has(norm(st));
    if (isOpen) open++;
    // UAT-origin: tagged "[UAT #n]" by uatsync.js, or QA Cycle = UAT when the team adds it by hand
    if (/^\[UAT #/i.test(sum) || (cCyc && /^uat$/i.test(cv(ws,r,cCyc)))) {
      if (isOpen) uatOpen++;
      uatRows.push({date: cRep ? cv(ws,r,cRep) : '', open: isOpen});
    }
    if (cRep && cv(ws,r,cRep) === today) added++;
    if (cRe && cv(ws,r,cRe) === today && /resolved/i.test(st)) resolved++;
  }
  return {open,total,added,resolved,uatOpen,uatRows,layout:'status='+String.fromCharCode(64+cStat)};
}

// Returns { file -> {open,total,added,resolved} | null } plus a {parsed,cached,skipped} tally.
async function scan(files, today, fresh) {
  let cache = {};
  if (!fresh) { try { cache = JSON.parse(fs.readFileSync(CACHE,'utf8')); } catch (e) {} }
  const out = {}, next = {};
  let parsed=0, cached=0, skipped=0;
  for (const f of files) {
    let stat; try { stat = fs.statSync(path.join(C.DEFECTS, f)); } catch (e) { out[f]=null; continue; }
    const mtime = stat.mtimeMs, size = stat.size;
    const day = PTDATE(stat.mtime);
    const c = cache[f];
    // entries cached before the UAT rows were collected are re-parsed once
    const unchanged = c && c.mtime === mtime && c.size === size && (!c.v || 'uatRows' in c.v);
    if (unchanged && day < today) {             // untouched today -> no row can be dated today
      out[f] = c.v && {...c.v, added:0, resolved:0}; next[f]=c; skipped++; continue;
    }
    if (unchanged && c.day === today) {         // already parsed this file, this day
      out[f] = c.v; next[f]=c; cached++; continue;
    }
    out[f] = await parse(f, today);
    next[f] = {mtime, size, day: today, v: out[f]};
    parsed++;
  }
  try { fs.writeFileSync(CACHE, JSON.stringify(next)); } catch (e) {}
  return {counts: out, stats: {parsed, cached, skipped}};
}

module.exports = {scan, OPEN, norm, PTDATE, TODAY};
