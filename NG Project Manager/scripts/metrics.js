// Metric Analysis page. Built by refresh.js after build.js, from rows.json; reads nothing else.
//
// Effort Tracking (2026-10-13): hours spent per window against two estimates.
//   Development           vs  Dev Lead LOE to QA   - the lead's estimate of work up to the first QA handoff
//   Development+Mitigation vs  Complexity Dev LOE   - that LOE includes defect resolution
//   QA                    vs  Complexity QA LOE
// Everything is shown in HOURS. LOE is recorded in days and converted at HPD hours a day.
// Scope: completed windows and active ones. Not Started, In Sprint Planning, Canceled and patches are out.
const fs = require('fs');
const C = require('./config.js');
const R = require(C.local('rows.json'));

const HPD = 8;          // hours in one LOE day
const BAND = 0.10;      // within +/-10% of the LOE counts as on target
const ACTIVE = ['In Development', 'In QA - BSA', 'In QA - Dev', 'In UAT', 'On Hold', 'Backlog', 'Ready for Deployment'];
const JB = C.JIRA_BROWSE;

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const num = v => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
const hrs = v => num(v) == null ? null : num(v) * HPD;
const DASH = '<span class="dim">—</span>';
const f1 = v => v == null ? DASH : (Math.round(v * 10) / 10).toLocaleString('en-US');
const PT = new Intl.DateTimeFormat('en-US', {timeZone:'America/Los_Angeles', dateStyle:'full', timeStyle:'short'});

const rows = R.rows.filter(r => r.subtask && (r.status === 'Deployed' || ACTIVE.includes(r.status)))
  .map(r => {
    const dev = num(r.eDev), mit = num(r.eMit);
    return { ...r, done: r.status === 'Deployed', aDev: dev, aMit: mit, aQA: num(r.eQA),
      aBuild: dev == null && mit == null ? null : (dev || 0) + (mit || 0),
      lead: hrs(r.loeToQA), cDev: hrs(r.loeDev), cQA: hrs(r.loeQA) };
  })
  .sort((a, b) => (a.sprint || 'zz').localeCompare(b.sprint || 'zz') || (parseFloat(a.W) || 999) - (parseFloat(b.W) || 999));

// One comparison = three cells: actual, LOE, variance. The bar's track is 0-200% of the LOE, tick at 100%.
function cmp(loe, act, done, sep) {
  const first = `<td class="num${sep ? ' sep' : ''}">`;
  if (loe == null) return `${first}${f1(act)}</td><td class="num">${DASH}</td><td><span class="dim">no LOE</span></td>`;
  if (act == null) return `${first}${DASH}</td><td class="num">${f1(loe)}</td><td><span class="dim">no hours</span></td>`;
  const d = act - loe, pct = act / loe;
  const cls = !done ? 'prog' : pct > 1 + BAND ? 'over' : pct < 1 - BAND ? 'under' : 'on';
  const lbl = (d > 0 ? '+' : d < 0 ? '−' : '±') + (Math.round(Math.abs(d) * 10) / 10) + 'h';
  return `${first}${f1(act)}</td><td class="num">${f1(loe)}</td>`
    + `<td><span class="bar ${cls}" title="${Math.round(pct * 100)}% of LOE"><i style="width:${(Math.min(pct / 2, 1) * 100).toFixed(0)}%"></i><b></b></span>`
    + `<span class="pill ${cls}">${lbl}</span><span class="pct">${Math.round(pct * 100)}%${done ? '' : ' so far'}</span></td>`;
}

const sprintTag = r => {
  const g = r.groupLabel || '';
  if (!g) return '<span class="tag tag-none">unplanned</span>';
  return `<span class="tag tag-${r.track === 'Internal' ? 'int' : 'user'}">${esc(g)}</span>`;
};
const tr = r => `<tr>
<td>${sprintTag(r)}</td><td>${esc(r.status)}</td><td class="mono">${esc(r.W)}</td>
<td><a href="${JB}${esc(r.subtask)}" target="_blank" rel="noopener">${esc(r.subtask)}</a></td>
<td class="name">${esc(r.name)}</td><td>${esc(r.grouping) || DASH}</td><td>${esc(r.dev) || DASH}</td><td>${esc(r.bsa) || DASH}</td>
${cmp(r.lead, r.aDev, r.done, true)}
<td class="num sep">${f1(r.aMit)}</td>${cmp(r.cDev, r.aBuild, r.done)}
${cmp(r.cQA, r.aQA, r.done, true)}
</tr>`;
const HEAD = `<thead>
<tr class="grp"><th colspan="8">Window</th><th colspan="3">Development vs Dev Lead LOE to QA</th><th colspan="4">Build effort (Dev + Mitigation) vs Complexity Dev LOE</th><th colspan="3">QA vs Complexity QA LOE</th></tr>
<tr><th>Sprint #</th><th>Status</th><th>W#</th><th>Subtask</th><th>Window / Subscreen Name</th><th>Grouping</th><th>Dev</th><th>BSA</th>
<th class="num sep">Dev (h)</th><th class="num">LOE to QA (h)</th><th>Variance</th>
<th class="num sep">Mitigation (h)</th><th class="num">Dev + Mit (h)</th><th class="num">Dev LOE (h)</th><th>Variance</th>
<th class="num sep">QA (h)</th><th class="num">QA LOE (h)</th><th>Variance</th></tr></thead>`;
const section = (id, title, note, list) => `<section id="${id}">
<h3>${esc(title)} <span class="count">${list.length}</span></h3>
<p class="note">${esc(note)}</p>
<div class="tw"><table>${HEAD}<tbody>${list.length ? list.map(tr).join('\n')
  : '<tr><td colspan="18" class="empty">No windows in this section.</td></tr>'}</tbody></table></div>
</section>`;
const deployed = rows.filter(r => r.done), active = rows.filter(r => !r.done);

// ---- calibration: completed windows averaged by complexity grouping ----
const key = g => String(g || '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim() || '(no grouping)';
const blank = () => ({ n: 0, loe: 0, act: 0, over: 0 });
const add = (o, loe, act) => { o.n++; o.loe += loe; o.act += act; if (act > loe * (1 + BAND)) o.over++; };
const G = {};
deployed.forEach(r => {
  const k = key(r.grouping); G[k] = G[k] || { d: blank(), q: blank() };
  if (r.cDev != null && r.aBuild != null) add(G[k].d, r.cDev, r.aBuild);
  if (r.cQA != null && r.aQA != null) add(G[k].q, r.cQA, r.aQA);
});
const ORDER = ['Low', 'Low High', 'Medium', 'Medium High', 'High', 'Very High'];
const rank = k => ORDER.indexOf(k) < 0 ? 99 : ORDER.indexOf(k);
const gKeys = Object.keys(G).sort((a, b) => rank(a) - rank(b));
const tot = f => gKeys.reduce((t, k) => ({ n: t.n + G[k][f].n, loe: t.loe + G[k][f].loe, act: t.act + G[k][f].act, over: t.over + G[k][f].over }), blank());
const T = tot('d'), TQ = tot('q');
const half = g => g.n
  ? `<td class="num sep">${g.n}</td>${cmp(g.loe / g.n, g.act / g.n, true)}<td class="num">${g.over} of ${g.n}</td>`
  : `<td class="num sep">0</td><td class="num">${DASH}</td><td class="num">${DASH}</td><td></td><td></td>`;
const grow = (k, d, q, bold) => `<tr${bold ? ' class="tot"' : ''}><td>${esc(k)}</td>${half(d)}${half(q)}</tr>`;
const pc = t => t.loe ? Math.round(t.act / t.loe * 100) + '%' : '—';
const lead = rows.filter(r => r.lead != null && r.aDev != null);
const txt = v => v == null ? '—' : (Math.round(v * 10) / 10).toLocaleString('en-US');

const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vision NG Metric Analysis</title>
<style>
:root{
  --bg:#f6f7f9; --panel:#fff; --ink:#15181d; --dim:#6b7280; --line:#e3e6ea;
  --accent:#1f3864; --ok:#137333; --warn:#b3261e; --prog:#9aa3b2;
  --user:#1f3864; --int:#6d28d9; --none:#6b7280;
}
@media (prefers-color-scheme:dark){ :root:not([data-theme="light"]){
  --bg:#0f1115; --panel:#171a20; --ink:#e7e9ee; --dim:#9aa3b2; --line:#272c35;
  --accent:#9db8e8; --ok:#5dd47f; --warn:#ff8b80; --prog:#6b7280;
  --user:#9db8e8; --int:#c4b5fd; --none:#9aa3b2;
}}
:root[data-theme="dark"]{
  --bg:#0f1115; --panel:#171a20; --ink:#e7e9ee; --dim:#9aa3b2; --line:#272c35;
  --accent:#9db8e8; --ok:#5dd47f; --warn:#ff8b80; --prog:#6b7280;
  --user:#9db8e8; --int:#c4b5fd; --none:#9aa3b2;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
.wrap{max-width:1760px;margin:0 auto;padding:28px 16px 64px}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:baseline;justify-content:space-between;margin-bottom:6px}
h1{font-size:24px;margin:0;letter-spacing:-.2px}
.ref{color:var(--dim);font-size:12.5px}
.sub{color:var(--dim);font-size:13px;margin:0 0 20px}
.cards{display:flex;flex-wrap:wrap;gap:12px;margin:0 0 26px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px;flex:1 1 220px}
.card b{display:block;font-size:20px}
.card span{color:var(--dim);font-size:12.5px}
nav{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 26px}
nav a{background:var(--panel);border:1px solid var(--line);border-radius:99px;padding:6px 13px;
  text-decoration:none;color:var(--ink);font-size:13px}
nav a:hover{border-color:var(--accent)}
.pagenav{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 10px}
.pbtn{background:var(--accent);color:var(--panel);border-radius:7px;padding:6px 14px;text-decoration:none;font-size:13px;font-weight:600}
.pbtn:hover{opacity:.85}
section{margin:0 0 30px}
h2{font-size:19px;margin:0 0 4px}
h3{font-size:16.5px;margin:0 0 3px;display:flex;align-items:center;gap:9px}
.count{background:var(--accent);color:var(--panel);border-radius:99px;font-size:11.5px;padding:1px 9px;font-weight:700}
.note{color:var(--dim);font-size:12.5px;margin:0 0 11px}
.tw{overflow-x:auto;background:var(--panel);border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);white-space:nowrap;vertical-align:middle}
th{background:var(--bg);font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--dim)}
tr.grp th{text-align:center;color:var(--ink);font-size:11.5px;border-left:2px solid var(--line)}
tr.grp th:first-child{border-left:0}
tbody tr:last-child td{border-bottom:0}
tbody tr:hover td{background:color-mix(in srgb,var(--accent) 6%,transparent)}
tr.tot td{font-weight:700;border-top:2px solid var(--line)}
td.num,th.num{text-align:right}
.sep{border-left:2px solid var(--line)}
.name{white-space:normal;min-width:190px}
a{color:var(--accent)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}
.dim{color:var(--dim)}
.tag{display:inline-block;padding:1px 8px;border-radius:99px;font-size:11.5px;font-weight:600;border:1px solid currentColor}
.tag-user{color:var(--user)} .tag-int{color:var(--int)} .tag-none{color:var(--none);font-weight:400;font-style:italic}
.bar{display:inline-block;position:relative;width:90px;height:8px;background:var(--line);border-radius:99px;
  vertical-align:middle;margin-right:8px;overflow:hidden}
.bar i{display:block;height:100%}
.bar b{position:absolute;left:50%;top:0;width:2px;height:100%;background:var(--ink)}
.bar.over i{background:var(--warn)} .bar.under i{background:var(--ok)} .bar.on i{background:var(--accent)} .bar.prog i{background:var(--prog)}
.pill{display:inline-block;min-width:54px;text-align:center;padding:0 7px;border-radius:99px;font-size:11.5px;font-weight:700;border:1px solid currentColor}
.pill.over{color:var(--warn)} .pill.under{color:var(--ok)} .pill.on{color:var(--accent)} .pill.prog{color:var(--dim)}
.pct{color:var(--dim);font-size:12px;margin-left:7px}
.legend{font-size:12.5px;color:var(--dim);margin:0 0 22px}
.empty{color:var(--dim);text-align:center;padding:20px}
footer{color:var(--dim);font-size:12px;border-top:1px solid var(--line);padding-top:14px;margin-top:34px}
.stale{margin-top:8px;padding:8px 12px;border-radius:6px;font-size:13px;font-weight:600;background:#5c2018;color:#ffd9d2;border:1px solid #8c3227}
.stale.warn{background:#5c4a18;color:#ffeccc;border-color:#8c7127}
@media print{body{background:#fff}nav,.cards,.pagenav{display:none}.tw{border:0}}
</style></head>
<body><div class="wrap">
<header>
  <h1>Vision NG Metric Analysis</h1>
  <div class="ref" id="reftime" data-gen="${new Date().toISOString()}">Last refreshed ${esc(PT.format(new Date()))} PT</div>
  <div id="stale" class="stale" hidden></div>
</header>
<div class="pagenav"><a class="pbtn" href="Vision%20NG%20Project%20Management.html">&#8962; Home</a><a class="pbtn" href="Vision%20NG%20Project%20Dashboard.html">Dashboard</a></div>
<p class="sub">${deployed.length} deployed and ${active.length} active windows &middot; hours from the Vision NG Metrics sheet and the Jira hours logs, LOE from the Pipeline Plan and the Complexity LOE sheet.</p>

<nav><a href="#calibration">Complexity LOE calibration</a><a href="#deployed">Deployed Windows</a><a href="#active">Active Windows</a></nav>

<h2>Effort Tracking</h2>
<p class="note">All effort is in hours. LOEs are recorded in days and converted at 1 day = ${HPD} hours. The bar runs from 0 to 200% of the LOE, with the tick at 100%.</p>
<p class="legend"><span class="pill over">+16h</span> more than ${BAND * 100}% over LOE &nbsp; <span class="pill on">±0h</span> within ${BAND * 100}% &nbsp; <span class="pill under">−16h</span> more than ${BAND * 100}% under &nbsp; <span class="pill prog">+8h</span> still in progress</p>

<div class="cards">
<div class="card"><b>${txt(T.act)}h vs ${txt(T.loe)}h</b><span>build effort (Dev + Mitigation) vs Complexity Dev LOE: ${pc(T)}, ${T.over} of ${T.n} deployed windows over</span></div>
<div class="card"><b>${txt(TQ.act)}h vs ${txt(TQ.loe)}h</b><span>QA hours vs Complexity QA LOE: ${pc(TQ)}, ${TQ.over} of ${TQ.n} deployed windows over</span></div>
<div class="card"><b>${lead.length}</b><span>windows with both a Dev Lead LOE to QA and development hours</span></div>
</div>

<section id="calibration">
<h3>Complexity LOE calibration</h3>
<p class="note">Deployed windows only. Average actual hours against the average Complexity LOE for each grouping.</p>
<div class="tw"><table><thead>
<tr class="grp"><th></th><th colspan="5">Build effort (Dev + Mitigation) vs Complexity Dev LOE</th><th colspan="5">QA vs Complexity QA LOE</th></tr>
<tr><th>Grouping</th><th class="num sep">Windows</th><th class="num">Avg actual (h)</th><th class="num">Avg LOE (h)</th><th>Variance</th><th class="num">Over LOE</th>
<th class="num sep">Windows</th><th class="num">Avg actual (h)</th><th class="num">Avg LOE (h)</th><th>Variance</th><th class="num">Over LOE</th></tr></thead>
<tbody>${gKeys.map(k => grow(k, G[k].d, G[k].q)).join('\n')}${grow('All groupings', T, TQ, true)}</tbody></table></div>
</section>

${section('deployed', 'Deployed Windows', 'Completed work: the hours are final, so the variance is the result.', deployed)}
${section('active', 'Active Windows', 'Work still in progress: the actual is the effort so far, so the variance shows how much of the LOE is used, not the outcome.', active)}

<footer>
  Generated from <b>Vision NG - Master Tracking.xlsx</b> data on every dashboard refresh.
  <b>Hours</b> add the Vision NG Metrics sheet (Development = Stage 1 + 2 + 3, QA = Total QA Hours, Mitigation = Stage 4, UAT = Stage 5)
  to the Jira hours logs and Jira time tracking on the window's dev, QA-cycle and UAT subtasks.
  <b>LOE to QA</b> is the Dev Lead's estimate from Sprint Planning. <b>Dev LOE</b> and <b>QA LOE</b> come from the Pipeline Plan;
  Pre-Sprint windows use the Complexity LOE Tracking sheet.
  Windows sharing a subtask show its Jira hours once, on one row. UAT hours are not part of any comparison here.
</footer>
</div><script>
(function(){
  var el = document.getElementById("stale"), rt = document.getElementById("reftime");
  if (!el || !rt) return;
  var gen = new Date(rt.getAttribute("data-gen"));
  if (isNaN(gen)) return;
  var hrs = (Date.now() - gen) / 3600000;
  var WARN = 18, BAD = 30;
  if (hrs < WARN) return;
  var age = hrs < 48 ? Math.round(hrs) + " hours" : Math.round(hrs/24) + " days";
  el.className = "stale" + (hrs < BAD ? " warn" : "");
  el.textContent = (hrs < BAD ? "⚠ " : "⛔ ")
    + "This page is " + age + " old. The automatic refresh has not run. "
    + "Run “Refresh NG Dashboard” from the shared folder to bring it up to date.";
  el.hidden = false;
})();
</script>
</body></html>`;

fs.writeFileSync(C.ANALYSIS, html, 'utf8');
console.log('WROTE: ' + C.ANALYSIS);
console.log('  Deployed Windows'.padEnd(44) + deployed.length + ' rows');
console.log('  Active Windows'.padEnd(44) + active.length + ' rows');
console.log(`  build ${txt(T.act)}h vs ${txt(T.loe)}h LOE (${T.n} windows) | QA ${txt(TQ.act)}h vs ${txt(TQ.loe)}h LOE (${TQ.n} windows)`);
