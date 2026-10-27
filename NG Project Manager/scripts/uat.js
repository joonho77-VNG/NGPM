// Reads the UAT Defect Log - one DEFECTS sheet, each window introduced by an orange header row:
//   col B = window name, col K = "UAT Release: mm/dd/yy Sign-Off Date: mm/dd/yy", col O = "Deployment Date: ..."
// Data rows under it carry a pre-numbered ID; a defect exists only when Description is filled.
const ExcelJS = require('./config.js').req('exceljs');
const path = require('path');
const C = require('./config.js');

const FILE = path.join(C.ROOT, 'Vision NG - UAT Defect Log.xlsx');
const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');

// UAT section title -> QA defect log name, where the plain names do not line up.
const ALIAS = {
  unlockcase: 'Unlock Case - Case Lock Maintenance',
  violationsagencyxref: 'Violation Agency XRef',
};

// UAT statuses that mean "developers owe a fix" -> copied to the QA log as New.
const PUSH = new Set(['fixinprogress','returnedtocts']);

const txt = v => { if (v && typeof v === 'object' && !(v instanceof Date))
    v = v.result ?? v.text ?? (v.richText ? v.richText.map(t=>t.text).join('') : '');
  if (v instanceof Date) return v.toISOString().slice(0,10);
  return String(v ?? '').trim(); };

// "09/21/26" -> "2026-09-21"; "TBD" or anything else -> ''
function mdy(s) { const m = String(s||'').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (!m) return '';
  const y = m[3].length === 2 ? '20'+m[3] : m[3];
  return `${y}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`; }

async function read() {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.getWorksheet('DEFECTS');
  if (!ws) throw new Error('UAT Defect Log has no DEFECTS sheet');
  // headers live on row 2; locate by name so an inserted column does not break the read
  const H = {}; ws.getRow(2).eachCell((c,i) => { H[norm(txt(c.value))] = i; });
  const col = k => H[k] || 0;
  const cID=col('id'), cWin=col('window'), cTested=col('datetested'), cDept=col('reporterdept'),
        cRep=col('reporter'), cTester=col('tester'), cSev=col('severity'), cStat=col('status'),
        cDesc=col('descriptionfindingsstepstorecreate'), cReported=col('datereported'),
        cIter=col('uatiteration'), cCom=col('commentsdecisions');
  if (!cStat || !cDesc) throw new Error('UAT Defect Log: Status/Description headers not found on row 2');

  const sections = []; let cur = null;
  const last = ws.actualRowCount + 5;
  for (let r = 3; r <= last; r++) {
    const row = ws.getRow(r);
    const a = txt(row.getCell(cID || 1).value);
    const k = txt(row.getCell(cDesc).value);
    // header row: text (not a number) in the ID column and "UAT Release" in Description
    if (a && !/^\d+$/.test(a) && /UAT Release/i.test(k)) {
      const sign = (k.match(/Sign-?Off Date:\s*(\S+)/i) || [])[1];
      cur = { title: a, key: norm(a), row: r,
              release: mdy((k.match(/UAT Release:\s*(\S+)/i) || [])[1]), signOff: mdy(sign), defects: [] };
      cur.qaName = ALIAS[cur.key] || null;
      sections.push(cur); continue;
    }
    if (!cur || !k) continue;
    const g = i => i ? txt(row.getCell(i).value) : '';
    cur.defects.push({ row: r, id: a, window: g(cWin), tested: g(cTested), dept: g(cDept), reporter: g(cRep),
      tester: g(cTester), severity: g(cSev), status: g(cStat), desc: k, reported: g(cReported),
      iteration: g(cIter), comments: g(cCom), push: PUSH.has(norm(g(cStat))) });
  }
  return sections;
}

// Resolve a section to a QA defect log file name from the list of files present.
function qaFileFor(section, files) {
  const by = {}; files.forEach(f => { by[norm(f.replace(/^QA Defect Log - /i,'').replace(/\.xlsx$/i,''))] = f; });
  if (section.qaName) return by[norm(section.qaName)] || null;
  return by[section.key] || null;
}

module.exports = { read, qaFileFor, norm, FILE, PUSH };
