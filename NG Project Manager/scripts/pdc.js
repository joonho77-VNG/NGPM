// PDC (Project Delivery Coordinator) Dashboard (2026-10-26). Built at the end of every real
// refresh (since 2026-10-27); not linked from the other pages. Can also be run on its own.
// Reads rows.json only, so it shows whatever the last refresh pulled.
//
// The PDC's job is to see a window coming to UAT two weeks out, then schedule and assist UAT.
//   2 Week Heads Up    a window enters on the Monday on/after its 2 Week Start (Committed Delivery);
//                      PDC Target Date to UAT = that Monday + 14 days
//   1 Week Planning    the same windows once that target is 7 days away or less (or past)
//   In UAT             = Sent to UAT on the project dashboard, plus Days in UAT
//   UAT Returned       = UAT Mitigation on the project dashboard, but Open UAT Def is read from the
//                      UAT Defect Log itself, not from the UAT rows copied into the QA log (2026-10-26)
//   Signed Off         User windows signed off in UAT, still Ready for Deployment
const fs = require('fs');
const C = require('./config.js');
const R = require(C.local('rows.json'));
const U = require('./uat.js');

const OUT = C.PDC;
const JB = C.JIRA_BROWSE;
const UATLOG = C.SP_BASE + encodeURIComponent('Vision NG - UAT Defect Log.xlsx');

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const DASH = '<span class="dim">—</span>';
const PT = new Intl.DateTimeFormat('en-US', {timeZone:'America/Los_Angeles', dateStyle:'full', timeStyle:'short'});
const todayISO = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles'}).format(new Date());
const D = s => new Date(s + 'T00:00:00Z');
const iso = d => d.toISOString().slice(0, 10);
const plus = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const days = (a, b) => Math.round((D(a) - D(b)) / 86400000);       // a - b
const dow = s => new Date(D(s)).toLocaleDateString('en-US', {timeZone:'UTC', weekday:'short'});
// The Monday on or after a date: a window committed on a Monday shows that same Monday.
const mondayOf = s => plus(s, (8 - D(s).getUTCDay()) % 7);

// Open UAT Def, from the UAT Defect Log. A UAT defect is open until UAT marks it Resolved or No Action,
// so Returned to UAT (fixed, awaiting retest) still counts. A row finds its UAT section the way
// build.js does: through the QA log file both are matched to.
const UAT_CLOSED = new Set(['resolved','noaction']);
const ymd = s => { if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  return m ? `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}` : ''; };
async function uatCounts() {
  const secs = await U.read();
  const files = fs.readdirSync(C.DEFECTS).filter(f => /\.xlsx$/i.test(f) && !/Template/i.test(f));
  secs.forEach(s => {
    const f = U.qaFileFor(s, files); if (!f) return;
    const st = s.defects.map(d => ({ date: ymd(d.reported || d.tested), open: !UAT_CLOSED.has(U.norm(d.status)) }));
    R.rows.filter(r => r.dlFile === f && r.status !== 'Not Started').forEach(r => {
      const since = r.uatStart ? st.filter(d => !d.date || d.date >= r.uatStart) : null;
      r.uatLog = { open: st.filter(d => d.open).length,
                   added: since && since.length, closed: since && since.filter(d => !d.open).length };
    });
  });
}

const active = R.rows.filter(r => r.subtask && !['Canceled','Deployed','Not Started'].includes(r.status));

// Same population as Committed Delivery Windows on the project dashboard.
const committed = active.filter(r => r.target && !['In UAT','Ready for Deployment'].includes(r.status))
  .map(r => { const heads = mondayOf(r.twoWk); return { ...r, heads, pdcTarget: plus(heads, 14) }; });
const shown = committed.filter(r => r.heads <= todayISO);
const waiting = committed.filter(r => r.heads > todayISO);
const nextMon = waiting.map(r => r.heads).sort()[0];
// UAT Returned membership, shared with the In UAT section's UAT State column.
const returned = r => (r.uatSub && r.uatSubOpen) || r.uatNeed === 'create';

const SECTIONS = [
  { id:'twoweek', title:'2 Week Heads Up',
    note:'Committed Delivery windows, from the first Monday after the two-week timer started. Target Date to UAT is that Monday + 14 days.'
      + (waiting.length ? ` ${waiting.length} more window(s) join on Monday ${nextMon}.` : ''),
    rows: shown.filter(r => days(r.pdcTarget, todayISO) > 7),
    cols: ['sprint','subtask','w','pdctarget','name','dev','bsa'] },
  { id:'oneweek', title:'1 Week Planning',
    note:'',
    todo:'Windows coming to UAT in 1 week or less. Please start planning the UAT and add the first UAT date in the UAT log under UAT Release.',
    rows: shown.filter(r => days(r.pdcTarget, todayISO) <= 7),
    cols: ['sprint','subtask','w','pdctarget','name','dev','bsa'] },
  { id:'inuat', title:'In UAT',
    note:'User-facing work in UAT. Days in UAT counts from UAT Start: amber at 7 days, red at 14. UAT State: Fix Pending = also in UAT Returned; Not Started = no UAT Start yet; In Progress = testing, nothing back with Dev.',
    rows: active.filter(r => r.track === 'User' && r.status === 'In UAT'),
    cols: ['sprint','subtask','w','touat','name','dev','bsa','uatstart','uatdays','uatstate','uatlog'] },
  { id:'returned', title:'UAT Returned',
    note:'These windows have UAT defects. Will be removed once all defects are addressed. Dev fixes, BSA runs QA, then the PDC confirms with the SMEs and closes the UAT subtask.',
    todo:'PDC Review indicates there is a defect in the UAT defect log that has been addressed by Vision and needs review for Clearing and retest. Please validate the fix and update the UAT defect log. If all UAT defects are addressed, Please close the UAT Subtask.',
    rows: R.rows.filter(returned),
    cols: ['sprint','uatkey','w','uatstart','name','dev','bsa','uatdef','fixstatus','uatlog'] },
  { id:'signed', title:'Signed Off',
    note:'Signed off in UAT and waiting to deploy. Drops off once deployed.',
    rows: active.filter(r => r.track === 'User' && r.status === 'Ready for Deployment' && r.signedOff),
    cols: ['sprint','subtask','w','name','dev','bsa','uatstart','signed'] },
];

const HEAD = {sprint:'Sprint #', subtask:'Subtask', w:'W#', name:'Window / Subscreen Name', dev:'Dev', bsa:'BSA',
  pdctarget:'Target Date to UAT', touat:'To UAT', uatstart:'UAT Start', uatdays:'Days in UAT', uatstate:'UAT State', uatkey:'UAT Subtask',
  uatdef:'Open UAT Def', fixstatus:'Fix Status', uatlog:'UAT Log', signed:'Signed Off'};
const NUM = new Set(['uatdays']);
const link = k => `<a href="${JB}${esc(k)}" target="_blank" rel="noopener">${esc(k)}</a>`;

function cell(r, c) {
  switch (c) {
    case 'sprint': {
      const g = r.groupLabel || '';
      if (!g) return '<span class="tag tag-none">unplanned</span>';
      return `<span class="tag tag-${r.track === 'Internal' ? 'int' : 'user'}">${esc(g)}</span>`;
    }
    case 'subtask': return link(r.subtask);
    case 'w': return `<span class="mono">${esc(r.W || '—')}</span>`;
    case 'name': return `<span class="name">${esc(r.name)}</span>`;
    case 'dev': return esc(r.dev) || DASH;
    case 'bsa': return esc(r.bsa) || DASH;
    case 'pdctarget': {
      const d = days(r.pdcTarget, todayISO);
      const cls = d < 0 ? 'late' : d <= 3 ? 'soon' : 'ok';
      const lbl = d < 0 ? `D+${Math.abs(d)}` : `D-${d}`;
      return `<span title="Heads up ${esc(dow(r.heads))} ${esc(r.heads)}; 2 Week Start ${esc(r.twoWk)}">${esc(r.pdcTarget)}</span> <span class="pill ${cls}">${lbl}</span>`;
    }
    case 'touat': {                  // as on the project dashboard: against the Committed Delivery target
      if (!r.toUAT) return DASH;
      if (!r.target) return esc(r.toUAT);
      const v = days(r.toUAT, r.target);
      const cls = v > 0 ? 'late' : 'ok';
      const lbl = v > 0 ? `${v}d late` : v === 0 ? 'on time' : `${Math.abs(v)}d early`;
      return `${esc(r.toUAT)} <span class="pill ${cls}">${lbl}</span>`;
    }
    case 'uatstart': return esc(r.uatStart) || '<span class="dim">not started</span>';
    case 'uatdays': {
      if (!r.uatStart) return '<span class="dim">not started</span>';
      const n = days(todayISO, r.uatStart);
      return `<span class="pill ${n >= 14 ? 'late' : n >= 7 ? 'soon' : 'ok'}">${n}d</span>`;
    }
    case 'uatstate': {               // Fix Pending wins: a window can be in UAT and UAT Returned at once
      if (returned(r)) return '<span class="pill late" title="Also listed in UAT Returned: a fix is owed to UAT">Fix Pending</span>';
      if (!r.uatStart) return '<span class="tag tag-none">Not Started</span>';
      // Started, nothing back with Dev, but UAT has logged defects not yet sent for a fix
      const n = r.uatLog ? r.uatLog.open : 0;
      return '<span class="pill ok">In Progress</span>'
        + (n ? ` <span class="pill soon" title="Open in the UAT Defect Log, not yet sent back for a fix">${n} open</span>` : '');
    }
    case 'uatkey': return r.uatSub && r.uatSubOpen ? link(r.uatSub)
      : `<span class="pill late" title="${esc(r.uatPending)} UAT defect(s) at Fix In-Progress with no UAT subtask yet">needs subtask</span>`;
    case 'uatdef': {                 // UAT Defect Log, with movement since UAT Start
      const u = r.uatLog;
      if (!u) return DASH;
      const base = u.open > 0 ? `<b class="warn">${u.open}</b>` : `<span class="ok">0</span>`;
      if (u.added == null) return base;
      const up = u.added, dn = u.closed;
      const tip = `UAT Defect Log since UAT Start ${r.uatStart}: ${up} defect(s) reported, ${dn} closed`;
      return `<span class="nowrap">${base}`
        + ` <span class="mv${up ? ' up' : ' zero'}" title="${esc(tip)}">&#9650;${up}</span>`
        + ` <span class="mv${dn ? ' dn' : ' zero'}" title="${esc(tip)}">&#9660;${dn}</span></span>`;
    }
    case 'uatlog': return `<a href="${UATLOG}" target="_blank" rel="noopener">UAT log</a>`;
    case 'fixstatus': {              // PDC Review: the BSA's QA copy of the UAT subtask is done and the QA log has nothing open
      const qaOpen = Number(r.openD) || 0;
      if (r.uatQaSub && !r.uatQaOpen && !qaOpen)
        return `<span class="pill ok" title="QA copy ${esc(r.uatQaSub)} is ${esc(r.uatQaStatus)}; no open defects in the QA defect log">PDC Review</span>`;
      const why = r.uatQaOpen ? `QA copy ${r.uatQaSub} is ${r.uatQaStatus}` : r.uatQaSub ? `${qaOpen} open defect(s) in the QA defect log` : 'not yet in QA';
      return `<span class="pill soon" title="${esc(why)}">Fixing</span>`;
    }
    case 'signed': return esc(r.signedOff) || DASH;
    default: return '';
  }
}

const sectionOf = s => {
  const rows = s.rows.slice().sort((a,b) =>
    (a.sprint||'zz').localeCompare(b.sprint||'zz') || (parseFloat(a.W)||999) - (parseFloat(b.W)||999));
  const body = rows.length
    ? rows.map(r => `<tr>${s.cols.map(c => `<td${NUM.has(c)?' class="num"':''}>${cell(r,c)}</td>`).join('')}</tr>`).join('\n')
    : `<tr><td colspan="${s.cols.length}" class="empty">No windows in this section.</td></tr>`;
  return `<section id="${s.id}">
  <h2>${esc(s.title)} <span class="count">${rows.length}</span></h2>
  ${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}
  ${s.todo ? `<div class="todo"><b>PDC action</b>${esc(s.todo)}</div>` : ''}
  <div class="tw"><table>
    <thead><tr>${s.cols.map(c => `<th${NUM.has(c)?' class="num"':''}>${esc(HEAD[c])}</th>`).join('')}</tr></thead>
    <tbody>${body}</tbody>
  </table></div>
</section>`;
};

(async () => {
await uatCounts();

const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vision NG PDC Dashboard</title>
<style>
:root{
  --bg:#f6f7f9; --panel:#fff; --ink:#15181d; --dim:#6b7280; --line:#e3e6ea;
  --accent:#1f3864; --ok:#137333; --warn:#b3261e; --soon:#8a6100;
  --user:#1f3864; --int:#6d28d9; --none:#6b7280;
}
@media (prefers-color-scheme:dark){ :root{
  --bg:#0f1115; --panel:#171a20; --ink:#e7e9ee; --dim:#9aa3b2; --line:#272c35;
  --accent:#9db8e8; --ok:#5dd47f; --warn:#ff8b80; --soon:#e5b567;
  --user:#9db8e8; --int:#c4b5fd; --none:#9aa3b2;
}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
.wrap{max-width:1500px;margin:0 auto;padding:28px 16px 64px}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:baseline;justify-content:space-between;margin-bottom:6px}
h1{font-size:24px;margin:0;letter-spacing:-.2px}
.ref{color:var(--dim);font-size:12.5px}
.sub{color:var(--dim);font-size:13px;margin:0 0 20px}
nav{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 26px}
nav a{background:var(--panel);border:1px solid var(--line);border-radius:99px;padding:6px 13px;
  text-decoration:none;color:var(--ink);font-size:13px}
nav a:hover{border-color:var(--accent)}
nav b{background:var(--accent);color:var(--panel);border-radius:99px;font-size:11px;padding:0 7px;margin-left:5px}
section{margin:0 0 34px}
h2{font-size:16.5px;margin:0 0 3px;display:flex;align-items:center;gap:9px}
.count{background:var(--accent);color:var(--panel);border-radius:99px;font-size:11.5px;
  padding:1px 9px;font-weight:700}
.note{color:var(--dim);font-size:12.5px;margin:0 0 11px}
/* instructions the PDC must act on, set apart from the descriptive notes */
.todo{margin:6px 0 12px;padding:10px 14px;font-size:15px;font-weight:600;line-height:1.4;
  border:1px solid var(--soon);border-left-width:5px;border-radius:8px;
  background:color-mix(in srgb,var(--soon) 10%,var(--panel))}
.todo b{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--soon);margin-bottom:2px}
.tw{overflow-x:auto;background:var(--panel);border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{text-align:left;padding:8px 11px;border-bottom:1px solid var(--line);white-space:nowrap;vertical-align:top}
th{background:var(--bg);font-size:11.5px;text-transform:uppercase;letter-spacing:.5px;
  color:var(--dim);position:sticky;top:0;z-index:1}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover td{background:color-mix(in srgb,var(--accent) 6%,transparent)}
td.num,th.num{text-align:right}
.name{white-space:normal;min-width:180px;display:inline-block}
a{color:var(--accent)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}
.dim{color:var(--dim)}
.ok{color:var(--ok)} .warn{color:var(--warn)}
.tag{display:inline-block;padding:1px 8px;border-radius:99px;font-size:11.5px;font-weight:600;
  border:1px solid currentColor}
.tag-user{color:var(--user)} .tag-int{color:var(--int)}
.tag-none{color:var(--none);font-weight:400;font-style:italic}
.pill{display:inline-block;padding:0 7px;border-radius:99px;font-size:11px;font-weight:700;
  border:1px solid currentColor;margin-left:5px}
.pill.ok{color:var(--ok)} .pill.late{color:var(--warn)} .pill.soon{color:var(--soon)}
.nowrap{white-space:nowrap}
.mv{font-size:12px;font-weight:700;margin-left:4px;cursor:help}
.mv.up{color:var(--ok)} .mv.dn{color:var(--warn)} .mv.zero{opacity:.35}
.empty{color:var(--dim);text-align:center;padding:20px}
footer{color:var(--dim);font-size:12px;border-top:1px solid var(--line);padding-top:14px;margin-top:34px}
.stale{margin-top:8px;padding:8px 12px;border-radius:6px;font-size:13px;font-weight:600;background:#5c4a18;color:#ffeccc;border:1px solid #8c7127}
@media print{body{background:#fff}nav{display:none}.tw{border:0}th{position:static}}
</style></head>
<body><div class="wrap">
<header>
  <h1>Vision NG PDC Dashboard</h1>
  <div class="ref" id="reftime" data-gen="${new Date().toISOString()}">Last built ${esc(PT.format(new Date()))} PT</div>
  <div id="stale" class="stale" hidden></div>
</header>
<p class="sub">Project Delivery Coordinator view: windows heading to UAT, in UAT, returned from UAT and signed off. Built from the last NG Dashboard refresh.</p>

<nav>${SECTIONS.map(s => `<a href="#${s.id}">${esc(s.title)}<b>${s.rows.length}</b></a>`).join('')}</nav>

${SECTIONS.map(sectionOf).join('\n')}

<footer>
  <b>Target Date to UAT</b> here is the PDC's date: the first Monday on or after the window's 2 Week Start, plus 14 days.
  It can differ from the Target Date on the project dashboard, which is 2 Week Start + 14 days. Hover a target to see both dates.
  <b>To UAT</b> is measured against the project dashboard's Target Date. <b>UAT Start</b> and <b>Signed Off</b> come from the UAT Defect Log.
  In UAT Returned, <b>Open UAT Def</b> counts defects in the UAT Defect Log not yet Resolved or No Action (Returned to UAT still counts);
  the green &#9650; is UAT defects reported since UAT Start and the red &#9660; those since closed.
</footer>
</div><script>
(function(){
  var el = document.getElementById("stale"), rt = document.getElementById("reftime");
  var gen = new Date(rt.getAttribute("data-gen"));
  if (isNaN(gen)) return;
  var hrs = (Date.now() - gen) / 3600000;
  if (hrs < 24) return;
  el.textContent = "\\u26A0 This page is " + (hrs < 48 ? Math.round(hrs) + " hours" : Math.round(hrs/24) + " days")
    + " old. Run a dashboard refresh to bring it up to date.";
  el.hidden = false;
})();
</script>
</body></html>`;

fs.writeFileSync(OUT, html, 'utf8');
console.log('WROTE: ' + OUT);
SECTIONS.forEach(s => console.log('  ' + s.title.padEnd(20) + s.rows.length + ' rows'));
if (waiting.length) console.log(`  (${waiting.length} committed window(s) join 2 Week Heads Up on ${nextMon})`);
SECTIONS[3].rows.forEach(r => console.log(`    UAT Returned W#${r.W} ${r.name}: open UAT def ${r.uatLog ? r.uatLog.open : '-'} (QA-log copy said ${r.uatOpen})`));
})().catch(e => { console.error('PDC FAILED: ' + (e.message || e)); process.exit(1); });
