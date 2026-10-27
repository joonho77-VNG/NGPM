// Hours come from the "Hours Log Sheet" table in each subtask's Jira description.
//
//   | Hours (6 cols)                                              | Note |
//   | Date | Initials | Development | QA | Defect Mitigation | UAT |      |
//
// Rules (agreed 2026-09-23):
//   - The COLUMN decides the bucket, whoever typed it and whichever subtask it is on.
//   - A window's hours are every log on its dev subtask, its UAT subtask(s) and their QA copies.
//   - The log is re-read in full every refresh, so an edited entry simply changes the total.
//
// QA copies need one extra rule. The In QA automation duplicates the dev subtask's description,
// so a copy starts out holding every row the developer had logged by then. Counting those again
// would double them. A row on a copy is therefore skipped when it is identical to a row on an
// original (dev or UAT subtask), or dated before the copy existed. What remains is what the BSA
// logged on the copy itself.
const COLS = { date: /^date$/, initials: /^initials?$/, dev: /^development$/, qa: /^qa$/,
               mit: /^(defect\s*)?mitigation$/, uat: /^uat$/ };
const BUCKETS = ['dev', 'qa', 'mit', 'uat'];

const text = n => { let s = ''; (function w(x) { if (!x) return;
  if (x.type === 'text') s += x.text; else if (x.type === 'hardBreak' || x.type === 'paragraph') s += ' ';
  (x.content || []).forEach(w); })(n); return s.replace(/\s+/g, ' ').trim(); };

// "3:00" "1:30" "2.5" "2h" "1h 30m" "45m" "2 hrs" -> hours.  '' -> null.  Anything else -> NaN.
function num(s) {
  s = String(s || '').trim().toLowerCase(); if (!s) return null;
  let m;
  if ((m = s.match(/^(\d+):(\d{1,2})$/))) return Number(m[1]) + Number(m[2]) / 60;
  if (/^\d*\.?\d+$/.test(s)) return Number(s);
  if ((m = s.match(/^(\d*\.?\d+)\s*h(?:rs?|ours?)?\.?\s*(?:(\d+)\s*m(?:ins?|inutes?)?\.?)?$/))) return Number(m[1]) + (m[2] ? Number(m[2]) / 60 : 0);
  if ((m = s.match(/^(\d+)\s*m(?:ins?|inutes?)?\.?$/))) return Number(m[1]) / 60;
  return NaN;
}

// "09/21/2026" "9/21/26" "2026-09-21" -> "2026-09-21"; anything else -> ''
function day(s) {
  s = String(s || '').trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)))
    return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
  return '';
}

// ADF description -> { table: bool, rows: [{date, initials, dev, qa, mit, uat}], bad: [text] }
function parse(doc) {
  const out = { table: false, rows: [], bad: [] };
  if (!doc) return out;
  const tables = []; (function walk(n) { if (!n) return; if (n.type === 'table') tables.push(n); (n.content || []).forEach(walk); })(doc);
  for (const t of tables) {
    const rows = (t.content || []).map(r => (r.content || []).map(text));
    const h = rows.findIndex(r => r.some(c => COLS.dev.test(c.toLowerCase())));
    if (h < 0) continue;
    out.table = true;
    const at = {}; rows[h].forEach((c, i) => { for (const [k, re] of Object.entries(COLS)) if (at[k] == null && re.test(c.toLowerCase())) at[k] = i; });
    for (const r of rows.slice(h + 1)) {
      const e = { date: day(r[at.date]), rawDate: r[at.date] || '', initials: String(r[at.initials] || '').toUpperCase() };
      let any = false;
      for (const b of BUCKETS) {
        const v = at[b] == null ? null : num(r[at[b]]);
        if (Number.isNaN(v)) { out.bad.push(`"${r[at[b]]}" under ${b}`); e[b] = 0; continue; }
        e[b] = v || 0; if (v) any = true;
      }
      if (any) out.rows.push(e);
    }
  }
  return out;
}

const sig = e => [e.date || e.rawDate, e.initials, ...BUCKETS.map(b => e[b].toFixed(2))].join('|');

// issues: [{key, kind: 'dev'|'uat'|'qa'|'uatqa', created: 'YYYY-MM-DD', rows}]
// -> {dev, qa, mit, uat, total, entries, skipped}
function combine(issues) {
  const tot = { dev: 0, qa: 0, mit: 0, uat: 0, entries: 0, skipped: 0 };
  const orig = new Set();
  issues.filter(i => i.kind === 'dev' || i.kind === 'uat').forEach(i => i.rows.forEach(e => orig.add(sig(e))));
  for (const i of issues) {
    const copy = i.kind === 'qa' || i.kind === 'uatqa';
    for (const e of i.rows) {
      if (copy && (orig.has(sig(e)) || (e.date && i.created && e.date < i.created))) { tot.skipped++; continue; }
      BUCKETS.forEach(b => tot[b] += e[b]); tot.entries++;
    }
    // Jira time tracking (issue.wl, hours) has no column, so the subtask's kind decides the bucket:
    // a QA copy's time is QA, a UAT subtask's is UAT, a dev subtask's is Development.
    if (i.wl) { tot[i.kind === 'dev' ? 'dev' : i.kind === 'uat' ? 'uat' : 'qa'] += i.wl; tot.entries++; tot.worklog = (tot.worklog || 0) + i.wl; }
  }
  BUCKETS.forEach(b => tot[b] = Math.round(tot[b] * 100) / 100);
  tot.total = Math.round((tot.dev + tot.qa + tot.mit + tot.uat) * 100) / 100;
  return tot;
}

module.exports = { parse, combine, num, day, BUCKETS };
