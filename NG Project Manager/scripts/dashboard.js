const fs = require('fs');
const R = require(require('./config.js').local('rows.json'));
const G = require(require('./config.js').local('gathered.json'));
const { dashStatus } = require('./status.js');

const OUT = require("./config.js").DASHBOARD;
// Where this page lives when it is NOT inside SharePoint's preview frame. Injected at build time
// rather than read from location.href, because the frame's src is a tokenised, expiring URL.
const SELFURL = require("./config.js").SP_BASE + 'Vision%20NG%20Project%20Dashboard.html';
const JB = 'https://ocsuperiorcourt.atlassian.net/browse/';
const DLURL = 'https://occourts.sharepoint.com/sites/Vision_ILJ/General%20Documentation/Knowledge%20Sharing%20Documents/Vision%20Team%20Knowledge/Vision%20NG%20-%20Grouping/QA%20Defect%20Logs/';
// One workbook for every window; SharePoint cannot reliably deep-link to a window's header row.
const UATLOG = require("./config.js").SP_BASE + encodeURIComponent('Vision NG - UAT Defect Log.xlsx');

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ---- carry forward notes from the most recent decisions file ----
// The dashboard is regenerated wholesale, so notes must be re-seeded or they vanish.
const PRIOR = (() => {
  try {
    const C = require('./config.js');
    const dir = C.DECISIONS;
    if (!fs.existsSync(dir)) return {};
    const f = fs.readdirSync(dir).filter(x => /^ng-decisions-.*\.json$/i.test(x)).sort().pop();
    if (!f) return {};
    const j = JSON.parse(fs.readFileSync(require('path').join(dir, f), 'utf8'));
    const map = {};
    (j.notes || []).forEach(n => { if (n.note) map[n.id] = n.note; });
    console.log(`  seeded ${Object.keys(map).length} note(s) from ${f}`);
    return map;
  } catch (e) { return {}; }
})();
const PT = new Intl.DateTimeFormat('en-US', {timeZone:'America/Los_Angeles', dateStyle:'full', timeStyle:'short'});
const todayPT = new Date(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles'}).format(new Date()) + 'T00:00:00Z');
const days = (a,b) => Math.round((new Date(a+'T00:00:00Z') - b) / 86400000);

// ---- patch rows live only in the writer; rebuild them here ----
const patch = Object.values(G.derived).filter(d=>d.isPatch).map(d=>({
  W:'', sprint:'Patch', track:'Patch', groupLabel:'Patch', mainAR:'VISAR-7396', subtask:d.key,
  menu:'', name:d.summary.replace(/^NG PATCH - /,''), obj:'', grouping:'',
  status: dashStatus(d.jira, {everQA:d.qaEntries>0, started:!!d.started}), jira:d.jira,
  dev:'', bsa:'', started:d.started, toQA:d.toQA, twoWk:'', target:'', toUAT:d.toUAT,
  uatStart:'', signedOff:'', deployed:'', build:'', loeTotal:'', openD:'', totD:'', dlFile:''
}));

const all = [...R.rows, ...patch];
const active = all.filter(r => r.subtask && !['Canceled','Deployed','Not Started'].includes(r.status));

// Page order (2026-09-23): furthest along first, then To Be Deployed; Sprint Planning renders last.
const SECTIONS = [
  // Not limited to `active`: a UAT fix runs on its own subtask whatever state the dev subtask is in.
  { id:'uatmit', title:'UAT Mitigation',
    note:'UAT defects owed a fix. One UAT subtask per dev subtask: Dev fixes, BSA runs QA, then the PDC confirms with the SMEs and closes it.',
    rows: all.filter(r => (r.uatSub && r.uatSubOpen) || r.uatNeed === 'create'),
    cols: ['sprint','uatkey','w','uatstart','name','uatstatus','uatqa','dev','bsa','uatdef','log','uatlog'] },
  { id:'uat', title:'Sent to UAT',
    note:'User-facing work in UAT. Once signed off (Ready for Deployment) it moves to To Be Deployed.',
    rows: active.filter(r => r.track==='User' && r.status==='In UAT'),
    cols: ['sprint','subtask','w','touat','name','dev','bsa','uatstart','uatsub','log'] },
  { id:'committed', title:'Committed Delivery Windows (Timer On)',
    note:'Two-week countdown running. Target Date shows days remaining.',
    rows: active.filter(r => r.target && !['In UAT','Ready for Deployment'].includes(r.status)),
    cols: ['sprint','subtask','w','target','name','status','qacycle','qasub','grouping','dev','bsa','open','log'] },
  // In Flight is split by who holds the ball (2026-10-13). On Hold and Backlog sit with Dev.
  { id:'inflight-dev', title:'In Flight - Dev',
    note:'With the developer, before the two-week UAT countdown: In Development, In QA - Dev (defects back with Dev), On Hold and Backlog.',
    rows: active.filter(r => !r.target && ['In Development','In QA - Dev','On Hold','Backlog'].includes(r.status)),
    cols: ['sprint','subtask','w','menu','name','status','qacycle','qasub','grouping','dev','bsa','open','loe','log'] },
  { id:'inflight-bsa', title:'In Flight - BSA',
    note:'With the BSA for QA testing (In QA - BSA), before the two-week UAT countdown.',
    rows: active.filter(r => !r.target && r.status==='In QA - BSA'),
    cols: ['sprint','subtask','w','menu','name','status','qacycle','qasub','grouping','dev','bsa','open','loe','log'] },
  { id:'deploy', title:'To Be Deployed',
    // Every Ready for Deployment row, whatever its track (2026-09-24). User work arrives from UAT;
    // Internal and Patch skip UAT and come straight from QA.
    note:'Ready for Deployment, grouped by the sprint it ships with. User work arrives after UAT sign-off; Internal and Patch work comes straight from QA.',
    rows: active.filter(r => r.status==='Ready for Deployment'),
    cols: ['sprint','subtask','w','deploywith','name','dev','bsa','signed'] },
  // Not from `active`, which drops Deployed. No notes box: finished work is not a meeting item (2026-10-13).
  { id:'completed', title:'Completed', noNotes:true,
    note:'Delivered work (Jira Subtask Completed). Deployed is the Jira Deployment Date; Pre-Sprint means it shipped before sprint grouping began.',
    rows: all.filter(r => r.subtask && r.status==='Deployed'),
    cols: ['sprint','subtask','w','name','dev','bsa','started','signed','deployed','build','qacycle','totdef','log'] },
];

const HEAD = {sprint:'Sprint #', subtask:'Subtask', w:'W#', menu:'Menu Group', name:'Window / Subscreen Name',
  status:'Status', qacycle:'QA Cycle', qasub:'QA Subtask', grouping:'Grouping', dev:'Dev', bsa:'BSA', open:'Open Def', loe:'Est LOE (d)', log:'Defect Log',
  target:'Target Date to UAT', touat:'To UAT', obj:'Object Name', uatstart:'UAT Start', signed:'Signed Off',
  build:'Build #', started:'Started', deployed:'Deployed', totdef:'Total Def', deploywith:'Deploy With', uatsub:'UAT Subtask', uatkey:'UAT Subtask', uatstatus:'UAT Status', uatqa:'QA VISAR',
  uatdef:'Open UAT Def', uatlog:'UAT Log'};

const NUM = new Set(['open','loe','qacycle','totdef']);
const { isOpen } = require('./kinds.js');

function cell(r, c) {
  switch (c) {
    case 'sprint': {
      const g = r.groupLabel || '';
      if (!g) return '<span class="tag tag-none">unplanned</span>';
      const k = r.track==='Patch' ? 'patch' : r.track==='Internal' ? 'int' : 'user';
      return `<span class="tag tag-${k}">${esc(g)}</span>`;
    }
    case 'subtask': return `<a href="${JB}${esc(r.subtask)}" target="_blank" rel="noopener">${esc(r.subtask)}</a>`;
    case 'w': return `<span class="mono">${esc(r.W || '—')}</span>`;
    case 'menu': return esc(r.menu);
    case 'name': return `<span class="name">${esc(r.name)}</span>`;
    case 'obj': return `<span class="mono dim">${esc(r.obj)}</span>`;
    case 'status': return `<span class="st st-${r.status.toLowerCase().replace(/[^a-z]+/g,'-')}">${esc(r.status)}</span>`;
    case 'grouping': return esc(r.grouping);
    case 'dev': return esc(r.dev) || '<span class="dim">—</span>';
    case 'bsa': return esc(r.bsa) || '<span class="dim">—</span>';
    case 'open': {
      if (r.openD === '' || r.openD == null) return '<span class="dim">—</span>';
      // UAT-origin defects still open in the QA log = a fix owed back to UAT testers
      const uat = Number(r.uatOpen) > 0 ? ` <span class="pill late" title="Open defects copied from the UAT Defect Log">UAT fix pending (${r.uatOpen})</span>` : '';
      return (Number(r.openD) > 0 ? `<b class="warn">${r.openD}</b>` : `<span class="ok">0</span>`) + uat;
    }
    case 'uatsub': {                 // Sent to UAT: the window's open UAT fix subtask; a closed one drops off
      if (r.uatSub && r.uatSubOpen)
        return `<a href="${JB}${esc(r.uatSub)}" target="_blank" rel="noopener">${esc(r.uatSub)}</a>`;
      return r.uatNeed === 'create' ? '<span class="pill late" title="UAT defects need a fix - run uatinit.js">needed</span>'
                                    : '<span class="dim">—</span>';
    }
    case 'uatkey': return r.uatSub && r.uatSubOpen
      ? `<a href="${JB}${esc(r.uatSub)}" target="_blank" rel="noopener">${esc(r.uatSub)}</a>`
      : `<span class="pill late" title="${esc(r.uatPending)} UAT defect(s) at Fix In-Progress with no UAT subtask yet">needs subtask</span>`;
    case 'uatstatus': {
      if (!(r.uatSub && r.uatSubOpen)) return '<span class="dim">—</span>';
      return `<span class="st st-${r.uatSubStatus.toLowerCase().replace(/[^a-z]+/g,'-')}">${esc(r.uatSubStatus)}</span>`;
    }
    case 'uatqa': {                  // the In QA automation's copy of the UAT subtask; hidden once QA completes it
      if (!(r.uatSub && r.uatSubOpen) || !r.uatQaSub || !r.uatQaOpen) return '<span class="dim">—</span>';
      return `<a href="${JB}${esc(r.uatQaSub)}" target="_blank" rel="noopener" title="${esc(r.uatQaStatus)}">${esc(r.uatQaSub)}</a>`;
    }
    case 'uatdef': {                 // UAT-origin defects only - the QA cycle's own defects are not this fix
      if (r.uatOpen === '' || r.uatOpen == null) return '<span class="dim">—</span>';
      const n = Number(r.uatOpen) || 0;
      const base = n > 0 ? `<b class="warn">${n}</b>` : `<span class="ok">0</span>`;
      if (r.uatAdded === '' || r.uatAdded == null) return base;
      const up = Number(r.uatAdded) || 0, dn = Number(r.uatClosed) || 0;
      const tip = `Since UAT Start ${r.uatStart}: ${up} UAT defect(s) added, ${dn} closed`;
      return `<span class="nowrap">${base}`
        + ` <span class="mv${up ? ' up' : ' zero'}" title="${esc(tip)}">&#9650;${up}</span>`
        + ` <span class="mv${dn ? ' dn' : ' zero'}" title="${esc(tip)}">&#9660;${dn}</span></span>`;
    }
    case 'uatlog': return `<a href="${UATLOG}" target="_blank" rel="noopener">UAT log</a>`;
    case 'qasub': {                  // the In QA automation's QA-cycle copy of the dev subtask, while open.
      // gather.js files QA - UAT copies separately (uatQaList), so they never appear here.
      const obj = (G.derived[r.subtask] || {}).obj || r.obj;
      const open = obj ? (G.qaList || []).filter(q => q.obj === obj && isOpen(q.status)) : [];
      if (!open.length) return '<span class="dim">—</span>';
      return open.map(q => `<a href="${JB}${esc(q.key)}" target="_blank" rel="noopener" title="${esc(q.status)}">${esc(q.key)}</a>`).join('<br>');
    }
    case 'qacycle': return (r.qaCycle === '' || r.qaCycle == null || Number(r.qaCycle) === 0)
      ? '<span class="dim">—</span>' : esc(r.qaCycle);
    case 'loe': return r.loeTotal === '' ? '<span class="dim">—</span>' : esc(r.loeTotal);
    case 'log': return r.dlFile
      ? `<a href="${DLURL}${encodeURIComponent(r.dlFile)}" target="_blank" rel="noopener">log</a>`
      : '<span class="dim">—</span>';
    case 'target': {
      if (!r.target) return '<span class="dim">—</span>';
      const d = days(r.target, todayPT);
      const cls = d < 0 ? 'late' : d <= 3 ? 'soon' : 'ok';
      const lbl = d < 0 ? `D+${Math.abs(d)}` : `D-${d}`;
      return `${esc(r.target)} <span class="pill ${cls}">${lbl}</span>`;
    }
    case 'touat': {
      if (!r.toUAT) return '<span class="dim">—</span>';
      if (!r.target) return esc(r.toUAT);
      const v = days(r.toUAT, new Date(r.target+'T00:00:00Z'));
      const cls = v > 0 ? 'late' : 'ok';
      const lbl = v > 0 ? `${v}d late` : v === 0 ? 'on time' : `${Math.abs(v)}d early`;
      return `${esc(r.toUAT)} <span class="pill ${cls}">${lbl}</span>`;
    }
    case 'uatstart': return esc(r.uatStart) || '<span class="dim">not started</span>';
    case 'signed': return esc(r.signedOff) || '<span class="dim">—</span>';
    case 'started': return esc(r.started) || '<span class="dim">—</span>';
    case 'deployed': return esc(r.deployed) || '<span class="dim">—</span>';
    case 'totdef': return (r.totD === '' || r.totD == null) ? '<span class="dim">—</span>' : esc(r.totD);
    case 'build': return esc(r.build) || '<span class="dim">—</span>';
    case 'deploywith': return /^SG\d+$/.test(r.sprint)
      ? `<b>Deploy with ${esc(r.sprint)}</b>` : '<span class="dim">independent</span>';
    default: return '';
  }
}

// sprint readiness
const bySprint = {};
all.filter(r => /^SG\d+$/.test(r.sprint) && r.status !== 'Canceled')
   .forEach(r => (bySprint[r.sprint] = bySprint[r.sprint] || []).push(r));
const sprintCards = Object.keys(bySprint).sort().map(s => {
  const a = bySprint[s];
  const done = a.filter(r => ['Ready for Deployment','Deployed'].includes(r.status)).length;
  const pct = Math.round(done / a.length * 100);
  return `<div class="card"><div class="card-h">${esc(s)}</div>
    <div class="bar"><i style="width:${pct}%"></i></div>
    <div class="card-s">${done} of ${a.length} ready</div></div>`;
}).join('');

// Sprint Planning renders between the working sections and Completed (2026-10-13), so each
// section is built on its own and the page template places them.
const AFTER_PLAN = new Set(['completed']);
const sectionOf = s => {
  const rows = s.rows.slice().sort((a,b) =>
    (a.sprint||'zz').localeCompare(b.sprint||'zz') || (parseFloat(a.W)||999) - (parseFloat(b.W)||999));
  const noteCell = r => {
    // A window can sit in Sent to UAT and UAT Mitigation at once; the prefix keeps the two notes apart.
    const mit = s.id === 'uatmit';
    const id = (mit ? 'UAT-' : '') + (r.W ? 'W' + r.W : r.subtask);
    const v = PRIOR[id] || '';
    return `<td class="notecell"><textarea class="note-in" data-id="${esc(id)}" data-key="${esc(mit && r.uatSub ? r.uatSub : r.subtask)}"`
         + ` data-w="${esc(r.W)}" data-name="${esc(r.name)}" data-section="${esc(s.title)}"`
         + ` rows="1" placeholder="note…">${esc(v)}</textarea></td>`;
  };
  const body = rows.length
    ? rows.map(r => `<tr>${s.cols.map(c => `<td${NUM.has(c)?' class="num"':''}>${cell(r,c)}</td>`).join('')}${s.noNotes ? '' : noteCell(r)}</tr>`).join('\n')
    : `<tr><td colspan="${s.cols.length + (s.noNotes ? 0 : 1)}" class="empty">No windows in this section.</td></tr>`;
  return `<section id="${s.id}">
  <h2>${esc(s.title)} <span class="count">${rows.length}</span></h2>
  <p class="note">${esc(s.note)}</p>
  <div class="tw"><table>
    <thead><tr>${s.cols.map(c => `<th${NUM.has(c)?' class="num"':''}>${esc(HEAD[c])}</th>`).join('')}${s.noNotes ? '' : '<th class="noteh">Notes</th>'}</tr></thead>
    <tbody>${body}</tbody>
  </table></div>
</section>`;
};
const navOf = s => `<a href="#${s.id}">${esc(s.title)}</a>`;
const BEFORE = SECTIONS.filter(s => !AFTER_PLAN.has(s.id)), AFTER = SECTIONS.filter(s => AFTER_PLAN.has(s.id));
const sectionHTML = BEFORE.map(sectionOf).join('\n');
const afterPlanHTML = AFTER.map(sectionOf).join('\n');

// ---- Sprint Planning: read-only mirror of the worksheet (refresh.js writes planning-rows.json) ----
const PLAN = (() => { try { return require(require('./config.js').local('planning-rows.json')); } catch (e) { return []; } })()
  .slice().sort((a,b) => (a.sprint||'zz').localeCompare(b.sprint||'zz') || (parseFloat(a.W)||999) - (parseFloat(b.W)||999));
const PLAN_COLS = [['sprint','Sprint #'],['subtask','Subtask'],['status','Subtask Status'],['w','W#'],['menu','Menu Group'],['name','Window / Subscreen Name'],
  ['obj','Object Name'],['grouping','Grouping'],['dev','Dev'],['bsa','BSA'],['loe','Dev Lead LOE (d)']];
const PLAN_PILL = {Active:'pill ok', Ready:'pill soon', Planning:'tag tag-none'};
const blankP = '<span class="dim">—</span>';
function planCell(r, c) {
  switch (c) {
    case 'sprint':  return r.sprint ? `<span class="tag tag-user">${esc(r.sprint)}</span>` : blankP;
    case 'subtask': return r.subtask ? `<a href="${JB}${esc(r.subtask)}" target="_blank" rel="noopener">${esc(r.subtask)}</a>` : blankP;
    case 'status':  return r.status ? `<span class="${PLAN_PILL[r.status] || 'tag tag-none'}">${esc(r.status)}</span>` : blankP;
    case 'w':       return `<span class="mono">${esc(r.W)}</span>`;
    case 'name':    return `<span class="name">${esc(r.name)}</span>`;
    case 'obj':     return `<span class="mono dim">${esc(r.obj)}</span>`;
    default:        return esc(r[c]) || blankP;
  }
}
// Active rows (a developer is already on them) are hidden by default; the button shows them again.
const PLAN_ACTIVE = PLAN.filter(r => r.status === 'Active').length;
const planHTML = `<section id="planning">
  <h2>Sprint Planning <span class="count">${PLAN.length}</span>
    <a class="pbtn sm" href="${require('./config.js').SP_BASE}Vision%20NG%20-%20Sprint%20Planning.xlsx?web=1" target="_blank" rel="noopener">Open Sprint Planning in Excel</a>
    ${PLAN_ACTIVE ? `<button type="button" class="pbtn sm" id="planActive" onclick="var s=document.getElementById('planning'),on=s.classList.toggle('show-active');this.textContent=(on?'Hide':'Show')+' Active (${PLAN_ACTIVE})'">Show Active (${PLAN_ACTIVE})</button>` : ''}</h2>
  <p class="note">Read-only view of the Sprint Planning worksheet. Sprint #, Dev, BSA and LOE are entered in the worksheet, not here.</p>
  <div class="tw"><table>
    <thead><tr>${PLAN_COLS.map(([c,h]) => `<th${c==='loe'?' class="num"':''}>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${PLAN.length
      ? PLAN.map(r => `<tr${r.status === 'Active' ? ' class="plan-active"' : ''}>${PLAN_COLS.map(([c]) => `<td${c==='loe'?' class="num"':''}>${planCell(r,c)}</td>`).join('')}</tr>`).join('\n')
      : `<tr><td colspan="${PLAN_COLS.length}" class="empty">Nothing in Sprint Planning.</td></tr>`}</tbody>
  </table></div>
</section>`;


const html =`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vision NG Project Dashboard</title>
<style>
:root{
  --bg:#f6f7f9; --panel:#fff; --ink:#15181d; --dim:#6b7280; --line:#e3e6ea;
  --accent:#1f3864; --ok:#137333; --warn:#b3261e; --soon:#8a6100;
  --user:#1f3864; --int:#6d28d9; --patch:#9a3412; --none:#6b7280;
}
@media (prefers-color-scheme:dark){ :root:not([data-theme="light"]){
  --bg:#0f1115; --panel:#171a20; --ink:#e7e9ee; --dim:#9aa3b2; --line:#272c35;
  --accent:#9db8e8; --ok:#5dd47f; --warn:#ff8b80; --soon:#e5b567;
  --user:#9db8e8; --int:#c4b5fd; --patch:#fdba74; --none:#9aa3b2;
}}
:root[data-theme="dark"]{
  --bg:#0f1115; --panel:#171a20; --ink:#e7e9ee; --dim:#9aa3b2; --line:#272c35;
  --accent:#9db8e8; --ok:#5dd47f; --warn:#ff8b80; --soon:#e5b567;
  --user:#9db8e8; --int:#c4b5fd; --patch:#fdba74; --none:#9aa3b2;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
  font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
.wrap{max-width:1500px;margin:0 auto;padding:28px 16px 64px}
header{display:flex;flex-wrap:wrap;gap:12px;align-items:baseline;justify-content:space-between;margin-bottom:6px}
h1{font-size:24px;margin:0;letter-spacing:-.2px}
.ref{color:var(--dim);font-size:12.5px}
.sub{color:var(--dim);font-size:13px;margin:0 0 20px}
.cards{display:flex;flex-wrap:wrap;gap:12px;margin:0 0 26px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px 14px;min-width:150px;flex:1 1 150px}
.card-h{font-weight:700;font-size:13px;letter-spacing:.3px}
.card-s{color:var(--dim);font-size:12px;margin-top:6px}
.bar{height:6px;background:var(--line);border-radius:99px;overflow:hidden;margin-top:9px}
.bar i{display:block;height:100%;background:var(--accent)}
nav{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 26px}
nav a{background:var(--panel);border:1px solid var(--line);border-radius:99px;padding:6px 13px;
  text-decoration:none;color:var(--ink);font-size:13px}
nav a:hover{border-color:var(--accent)}
.pagenav{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 10px}
.pbtn{background:var(--accent);color:var(--panel);border-radius:7px;padding:6px 14px;text-decoration:none;font-size:13px;font-weight:600}
.pbtn:hover{opacity:.85}
.pbtn.sm{padding:3px 10px;font-size:12px;margin-left:6px}
button.pbtn{border:0;cursor:pointer;font-family:inherit}
#planning:not(.show-active) tr.plan-active{display:none}
section{margin:0 0 34px}
h2{font-size:16.5px;margin:0 0 3px;display:flex;align-items:center;gap:9px}
.count{background:var(--accent);color:var(--panel);border-radius:99px;font-size:11.5px;
  padding:1px 9px;font-weight:700}
.note{color:var(--dim);font-size:12.5px;margin:0 0 11px}
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
.tag-user{color:var(--user)} .tag-int{color:var(--int)} .tag-patch{color:var(--patch)}
.tag-none{color:var(--none);font-weight:400;font-style:italic}
.pill{display:inline-block;padding:0 7px;border-radius:99px;font-size:11px;font-weight:700;
  border:1px solid currentColor;margin-left:5px}
.pill.ok{color:var(--ok)} .pill.late{color:var(--warn)} .pill.soon{color:var(--soon)}
.nowrap{white-space:nowrap}
.mv{font-size:12px;font-weight:700;margin-left:4px;cursor:help}
.mv.up{color:var(--ok)} .mv.dn{color:var(--warn)} .mv.zero{opacity:.35}
.st{font-weight:600}
.st-in-qa-bsa{color:var(--soon)} .st-in-qa-dev{color:var(--soon)}
.st-in-uat{color:var(--accent)} .st-ready-for-deployment{color:var(--ok)}
.st-on-hold,.st-backlog{color:var(--dim)}
.empty{color:var(--dim);text-align:center;padding:20px}
.framehint{display:none;margin:12px 0 0;border:1px solid var(--warn);border-radius:9px;padding:11px 14px;font-size:13px}
.framehint.on{display:block}
.fhrow{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:9px}
.framehint input{flex:1 1 320px;min-width:0;background:var(--bg);color:var(--ink);
  border:1px solid var(--line);border-radius:6px;padding:6px 8px;
  font:11.5px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.framehint .msg{font-size:12.5px;color:var(--dim)}
.manual{display:none;margin:14px 0 0;border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.manual.on{display:block}
.manual h3{margin:0 0 4px;font-size:14px}
.manual p{margin:0 0 9px;font-size:12.5px;color:var(--dim)}
.manual textarea{width:100%;height:150px;box-sizing:border-box;background:var(--bg);color:var(--ink);
  border:1px solid var(--line);border-radius:7px;padding:9px;resize:vertical;
  font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.manual .row{margin-top:9px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.manual .msg{font-size:12.5px;color:var(--dim)}
.manual .dl{font-size:12.5px;color:var(--accent)}
footer{color:var(--dim);font-size:12px;border-top:1px solid var(--line);padding-top:14px;margin-top:34px}
.stale{margin-top:8px;padding:8px 12px;border-radius:6px;font-size:13px;font-weight:600;background:#5c2018;color:#ffd9d2;border:1px solid #8c3227}
.stale.warn{background:#5c4a18;color:#ffeccc;border-color:#8c7127}
@media print{body{background:#fff}nav,.cards,.pagenav,.pbtn{display:none}.tw{border:0}th{position:static}}
</style></head>
<body><div class="wrap">
<header>
  <h1>Vision NG Project Dashboard</h1>
  <div class="ref" id="reftime" data-gen="${new Date().toISOString()}">Last refreshed ${esc(PT.format(new Date()))} PT</div>
  <div id="stale" class="stale" hidden></div>
</header>
<div class="pagenav"><a class="pbtn" href="Vision%20NG%20Project%20Management.html">&#8962; Home</a><a class="pbtn" href="Vision%20NG%20Metric%20Analysis.html">Metric Analysis</a></div>
<p class="sub">${active.length} active windows &middot; sourced from Jira VISAR-6166 / VISAR-7396, the Pipeline Plan and the QA defect logs.</p>

<div class="cards">${sprintCards}</div>

<nav>${BEFORE.map(navOf).join('')}<a href="#planning">Sprint Planning</a>${AFTER.map(navOf).join('')}</nav>

${sectionHTML}

${planHTML}

${afterPlanHTML}

<div class="savebar">
  <button id="btnSave">Save notes</button>
  <button id="btnClear" class="ghost">Clear all notes</button>
  <span id="dirty" class="dirty"></span>
  <span id="mode" class="savemode">checking save capability&hellip;</span>
</div>

<div class="framehint" id="framehint">
  <b>Saving is blocked here.</b> SharePoint's preview frame will not let this page write a file &mdash;
  no download, no save dialog. <a id="poplink" target="_blank" rel="noopener">Open the dashboard in its
  own tab</a> and save from there; you will get a location picker. Your notes are kept in this browser,
  so they will still be here when you come back.
  <span class="fhrow">
    <input id="popurl" readonly spellcheck="false">
    <button id="popcopy">Copy address</button>
    <span class="msg" id="popmsg"></span>
  </span>
</div>

<div class="manual" id="manual">
  <h3>Take your notes</h3>
  <p>Save this as <b id="mname"></b> in the <b>NG Meeting Decisions</b> folder, then run a refresh.</p>
  <textarea id="mtext" spellcheck="false" readonly></textarea>
  <div class="row">
    <button id="mcopy">Copy to clipboard</button>
    <a id="mdl" class="dl" download>Download the file</a>
    <span class="msg" id="mmsg"></span>
  </div>
</div>

<script>
(function(){
  var KEY = 'ng-notes-v1';
  var nodes = function(){ return Array.prototype.slice.call(document.querySelectorAll('.note-in')); };
  var dirty = false;
  var elDirty = document.getElementById('dirty');
  var elMode  = document.getElementById('mode');

  // ---- how do we get the notes off this page? ----
  // SharePoint renders this file inside a sandboxed frame, where a programmatic download is
  // discarded WITHOUT throwing. The old code clicked a blob link and announced success either way,
  // so notes vanished silently. Nothing below claims a save it cannot prove: either the file
  // picker confirms a write, or the JSON goes on screen for the user to take by hand.
  var framed  = (function(){ try { return window.self !== window.top; } catch(e) { return true; } })();
  var canPick = typeof window.showSaveFilePicker === 'function' && !framed;
  elMode.innerHTML = canPick
    ? 'Save mode: <b>direct</b> &mdash; you will be asked where to put the file. Choose <b>NG Meeting Decisions</b>.'
    : 'Save mode: <b>copy</b> &mdash; this page cannot write files from here, so Save hands you the text.';

  // ---- SharePoint's preview frame blocks every route to a file ----
  // showSaveFilePicker throws SecurityError cross-origin, a synthetic download click is discarded,
  // and a blob: URL minted in here carries an opaque origin so the browser refuses to open it at
  // all ("this link can't be opened"). None of that is fixable from inside; the only cure is to
  // leave the frame, so say so and hand over the address.
  var elHint = document.getElementById('framehint');
  if (framed) {
    var SELF = ${JSON.stringify(SELFURL)};
    document.getElementById('poplink').href = SELF;
    document.getElementById('popurl').value = SELF;
    elHint.className = 'framehint on';
    document.getElementById('popcopy').addEventListener('click', function(){
      var u = document.getElementById('popurl');
      u.focus(); u.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch(e) {}
      document.getElementById('popmsg').textContent = ok
        ? 'Address copied - paste it into a new tab.'
        : 'Selected - press Ctrl+C, then paste into a new tab.';
    });
  }

  function autosize(t){ t.style.height='auto'; t.style.height=Math.min(t.scrollHeight,160)+'px'; }
  function markDirty(){ dirty = true; elDirty.textContent = '\\u25CF unsaved'; }

  // ---- best-effort local persistence; never relied upon ----
  function stash(){
    try {
      var o = {};
      nodes().forEach(function(t){ if (t.value.trim()) o[t.dataset.id] = t.value; });
      localStorage.setItem(KEY, JSON.stringify(o));
    } catch(e) {}
  }
  function restore(){
    try {
      var o = JSON.parse(localStorage.getItem(KEY) || '{}');
      nodes().forEach(function(t){ if (!t.value && o[t.dataset.id]) t.value = o[t.dataset.id]; });
    } catch(e) {}
  }

  function payload(){
    var out = [];
    nodes().forEach(function(t){
      var v = t.value.trim();
      if (!v) return;
      out.push({ id:t.dataset.id, w:t.dataset.w, subtask:t.dataset.key,
                 window:t.dataset.name, section:t.dataset.section, note:v });
    });
    return { generated:new Date().toISOString(), dashboardDate:${JSON.stringify(new Date().toISOString().slice(0,10))}, notes:out };
  }

  function fname(){
    var d = new Date(), p = function(n){ return String(n).padStart(2,'0'); };
    return 'ng-decisions-' + d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + '.json';
  }

  var elManual = document.getElementById('manual');
  var elText   = document.getElementById('mtext');
  var elName   = document.getElementById('mname');
  var elMsg    = document.getElementById('mmsg');
  var elDl     = document.getElementById('mdl');

  document.getElementById('btnSave').addEventListener('click', async function(){
    var data = payload();
    if (!data.notes.length) { elMode.innerHTML = '<b>Nothing to save</b> &mdash; no notes entered.'; return; }
    var text = JSON.stringify(data, null, 2);
    var name = fname();

    if (canPick) {
      try {
        var h = await window.showSaveFilePicker({ suggestedName:name,
          types:[{description:'NG decisions', accept:{'application/json':['.json']}}] });
        var w = await h.createWritable(); await w.write(text); await w.close();
        dirty = false; elDirty.textContent = '';
        elManual.className = 'manual';
        elMode.innerHTML = 'Saved <b>' + data.notes.length + '</b> note(s) directly. Save mode: <b>direct</b>.';
        stash(); return;
      } catch(err) {
        if (err && err.name === 'AbortError') return;           // user cancelled
      }
    }

    // Everything else: put the text in front of the user. A download link is offered too, but the
    // user clicks it -- a click we synthesise ourselves is the exact thing the frame throws away.
    // dirty stays set on purpose: nothing has left the page yet.
    elText.value = text;
    elName.textContent = name;
    elMsg.textContent = '';
    // Only offer the download where it can actually run. Inside the frame the blob: URL is born
    // with an opaque origin and the browser refuses it, which is worse than not offering it.
    if (framed) {
      elDl.style.display = 'none';
    } else {
      elDl.style.display = '';
      elDl.href = URL.createObjectURL(new Blob([text], {type:'application/json'}));
      elDl.download = name;
    }
    elManual.className = 'manual on';
    elText.focus(); elText.select();
    elMode.innerHTML = '<b>' + data.notes.length + '</b> note(s) ready below &mdash; nothing is saved until you copy or download them.';
    stash();
  });

  document.getElementById('mcopy').addEventListener('click', function(){
    elText.focus(); elText.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch(e) {}
    if (ok) { elMsg.textContent = 'Copied. Paste it into a new .json file in NG Meeting Decisions.'; return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(elText.value).then(function(){
        elMsg.textContent = 'Copied. Paste it into a new .json file in NG Meeting Decisions.';
      }, function(){
        elMsg.textContent = 'Copy was blocked. The text is selected - press Ctrl+C.';
      });
      return;
    }
    elMsg.textContent = 'Copy was blocked. The text is selected - press Ctrl+C.';
  });

  document.getElementById('btnClear').addEventListener('click', function(){
    if (!confirm('Clear every note on this page?')) return;
    nodes().forEach(function(t){ t.value=''; autosize(t); });
    try { localStorage.removeItem(KEY); } catch(e) {}
    dirty = false; elDirty.textContent = '';
  });

  nodes().forEach(function(t){
    autosize(t);
    t.addEventListener('input', function(){ autosize(t); markDirty(); stash(); });
  });
  restore();
  nodes().forEach(autosize);

  window.addEventListener('beforeunload', function(e){
    if (!dirty) return;
    e.preventDefault(); e.returnValue = '';
  });
})();
</script>

<footer>
  Generated from <b>Vision NG - Master Tracking.xlsx</b>. Status, dates and QA cycle are derived from Jira
  subtask history; defect counts from the QA Defect Logs folder.
  <b>UAT Start</b> and <b>Signed Off</b> come from the UAT Release and Sign-Off dates in the UAT Defect Log.
  <b>UAT fix pending</b> counts open QA-log defects that came from UAT; in UAT Mitigation, the green &#9650; is how many
  UAT defects were added since UAT Start and the red &#9660; how many of those have since been closed.
  <b>UAT Mitigation</b> lists every window with an open UAT subtask, or with UAT defects at Fix In-Progress and none yet.
  Windows sharing a bundled subtask repeat that subtask's dates and defect totals &mdash; do not sum the defect columns.
</footer>
</div><script>
(function(){
  var el = document.getElementById("stale"), rt = document.getElementById("reftime");
  if (!el || !rt) return;
  var gen = new Date(rt.getAttribute("data-gen"));
  if (isNaN(gen)) return;
  var hrs = (Date.now() - gen) / 3600000;
  var WARN = 18, BAD = 30;   // schedule is 4x per weekday; >18h means a run was missed
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

fs.writeFileSync(OUT, html, 'utf8');
console.log('WROTE: ' + OUT);
console.log('size: ' + (html.length/1024).toFixed(1) + ' KB');
SECTIONS.forEach(s => console.log('  ' + s.title.padEnd(42) + s.rows.length + ' rows'));
console.log('  ' + 'Sprint Planning (read-only)'.padEnd(42) + PLAN.length + ' rows');
