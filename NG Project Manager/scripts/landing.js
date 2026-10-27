// Vision NG Project Management page - the single link the team bookmarks.
// Regenerated on every refresh, because the planning summary goes stale otherwise.

const fs = require('fs');
const path = require('path');
const ExcelJS = require('./config.js').req('exceljs');
const C = require('./config.js');
const { V } = require('./vx.js');

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const PT = new Intl.DateTimeFormat('en-US', {timeZone:'America/Los_Angeles', dateStyle:'medium', timeStyle:'short'});

const FIELDS = [['sprint','Sprint #'], ['dev','Dev'], ['bsa','BSA'], ['loe','DEV LEAD LOE']];

async function planningSummary() {
  const f = path.join(C.ROOT, 'Vision NG - Sprint Planning.xlsx');
  if (!fs.existsSync(f)) return null;
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(f);
  const ws = wb.getWorksheet('Sprint Planning'); if (!ws) return null;
  const rows = [];
  // Subtask Status sits among the team's own columns after DEV LEAD LOE, so it is found by header.
  let sc = 0; ws.getRow(1).eachCell((c, i) => { if (String(V(c)).trim().toLowerCase() === 'subtask status') sc = i; });
  for (let r = 2; r <= ws.rowCount; r++) {
    const g = ws.getRow(r);
    const o = {sprint:V(g.getCell(1)), subtask:V(g.getCell(2)), W:V(g.getCell(3)),
               menu:V(g.getCell(4)), name:V(g.getCell(5)), obj:V(g.getCell(6)),
               grouping:V(g.getCell(7)), dev:V(g.getCell(8)),
               bsa:V(g.getCell(9)), loe:V(g.getCell(10)), status:sc ? V(g.getCell(sc)) : ''};
    if (o.W) rows.push(o);
  }
  const groups = {};
  rows.forEach(r => {
    const k = r.menu || '(no menu group)';
    groups[k] = groups[k] || {total:0, missing:{sprint:0,dev:0,bsa:0,loe:0}, ready:0, ws:[]};
    const g = groups[k];
    g.total++; g.ws.push(r.W);
    let complete = true;
    FIELDS.forEach(([k2]) => { if (!r[k2]) { g.missing[k2]++; complete = false; } });
    if (complete) g.ready++;
  });
  const complete = r => FIELDS.every(([k]) => r[k]);
  return {
    rows, groups,
    total: rows.length,
    ready: rows.filter(complete),
    toCreate: rows.filter(r => complete(r) && !r.subtask),
    toAssign: rows.filter(r => complete(r) && r.subtask),
  };
}

function card({href, sp, icon, title, blurb, badge, badgeKind, body, disabled, kind}) {
  let open;
  if (disabled) {
    open = `<span class="btn off">Under construction</span>`;
  } else if (kind === 'xlsx') {
    // A plain link to an .xlsx makes the browser download a copy, so always go through ?web=1.
    // The ms-excel:ofe| desktop handoff used to lead here; it silently did nothing for the team
    // (no registered handler / blocked from the SharePoint frame), so it is gone.
    open = `<a class="btn" href="${esc(sp)}?web=1" target="_blank" rel="noopener">Open in Excel Online</a>`;
  } else {
    // href is relative: it resolves only inside the synced library, where the Dashboard is a
    // sibling file. data-abs carries the SharePoint URL so a stray copy can repair itself.
    open = `<a class="btn" href="${esc(href)}"${sp ? ` data-abs="${esc(sp)}"` : ''}>Open</a>`
         + (sp ? ` <a class="btn ghost" href="${esc(sp)}" target="_blank" rel="noopener">SharePoint</a>` : '');
  }
  return `<section class="card${disabled ? ' dim' : ''}">
  <div class="chead">
    <span class="ico">${icon}</span>
    <div class="ctitle"><h2>${esc(title)}</h2><p>${esc(blurb)}</p></div>
    ${badge ? `<span class="badge ${badgeKind||''}">${esc(badge)}</span>` : ''}
  </div>
  ${body || ''}
  <div class="cfoot">${open}</div>
  ${arguments[0].after || ''}
</section>`;
}

const KIND = {qa:'QA', timer:'Timer', mit:'Mitigation', uat:'UAT', rfd:'Ready', dep:'Deployed',
  hold:'Hold', dev:'Dev', assign:'Assigned', defect:'Defects'};

function activityFeed(log, limit = 20) {
  const show = log.slice(0, limit);
  if (!show.length) return `<div class="feed"><div class="fi empty">No activity recorded yet.</div></div>`;
  let lastDate = '';
  const items = show.map(e => {
    const head = e.date !== lastDate ? (lastDate = e.date, `<div class="fday">${esc(e.date)}</div>`) : '';
    return head + `<div class="fi">
      <span class="ftime">${esc(e.time || '')}</span>
      <span class="fk fk-${esc(e.kind)}">${esc(KIND[e.kind] || e.kind)}</span>
      <span class="ftext">${e.text}</span>
      ${e.key ? `<a class="flink" href="${C.JIRA_BROWSE}${esc(e.key)}" target="_blank" rel="noopener">${esc(e.key)}</a>` : ''}
    </div>`;
  }).join('');
  return `<div class="feedwrap">
    <div class="fhead">Activity log <span class="fcount">${show.length} of ${log.length}</span></div>
    <div class="feed">${items}</div>
  </div>`;
}

async function build(log = []) {
  const p = await planningSummary();
  const feedHTML = activityFeed(log, 20);

  let planBody = '<p class="empty">No Sprint Planning worksheet yet.</p>';
  let planBadge = 'not started', planKind = 'off';
  if (p) {
    planBadge = p.ready.length === p.total && p.total
      ? `all ${p.total} ready`
      : `${p.ready.length} of ${p.total} ready`;
    planKind = p.ready.length === p.total && p.total ? 'ok' : 'warn';

    const rows = Object.entries(p.groups).sort().map(([menu, g]) => {
      const cells = FIELDS.map(([k, label]) => g.missing[k]
        ? `<td class="need">${g.missing[k]} need ${esc(label)}</td>`
        : `<td class="done">complete</td>`).join('');
      return `<tr><th scope="row">${esc(menu)}</th><td class="num">${g.total}</td>${cells}
        <td class="${g.ready === g.total ? 'done' : 'num'}">${g.ready}/${g.total}</td></tr>`;
    }).join('');

    const next = p.ready.length
      ? `<p class="next"><b>Ready to initiate:</b> `
        + (p.toCreate.length ? `create ${p.toCreate.length} subtask(s) &mdash; ${p.toCreate.map(r=>'W#'+esc(r.W)).join(', ')}. ` : '')
        + (p.toAssign.length ? `assign ${p.toAssign.length} existing &mdash; ${p.toAssign.map(r=>`W#${esc(r.W)} (${esc(r.subtask)})`).join(', ')}.` : '')
        + `</p>`
      : `<p class="next dimtext">Nothing is ready to initiate yet &mdash; the highlighted cells in the worksheet still need the Lead Developer.</p>`;

    planBody = `<div class="tw"><table>
      <thead><tr><th>Menu Group</th><th class="num">Windows</th>
        ${FIELDS.map(([,l]) => `<th>${esc(l)}</th>`).join('')}<th>Ready</th></tr></thead>
      <tbody>${rows}</tbody></table></div>${next}`;
  }

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vision NG Project Management</title>
<style>
:root{--bg:#f6f7f9;--panel:#fff;--ink:#15181d;--dim:#6b7280;--line:#e3e6ea;--accent:#1f3864;
  --ok:#137333;--warn:#8a6100;--off:#9aa3b2}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0f1115;--panel:#171a20;
  --ink:#e7e9ee;--dim:#9aa3b2;--line:#272c35;--accent:#9db8e8;--ok:#5dd47f;--warn:#e5b567;--off:#6b7280}}
:root[data-theme="dark"]{--bg:#0f1115;--panel:#171a20;--ink:#e7e9ee;--dim:#9aa3b2;--line:#272c35;
  --accent:#9db8e8;--ok:#5dd47f;--warn:#e5b567;--off:#6b7280}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
 font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.wrap{max-width:960px;margin:0 auto;padding:40px 16px 64px}
header{margin-bottom:28px}
h1{font-size:27px;margin:0 0 6px;letter-spacing:-.3px}
.sub{color:var(--dim);font-size:13.5px;margin:0}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin:0 0 18px}
.card.dim{opacity:.62}
.chead{display:flex;gap:15px;align-items:flex-start}
.ico{font-size:23px;line-height:1.2;flex:none}
.ctitle{flex:1}
h2{font-size:17.5px;margin:0 0 3px}
.ctitle p{margin:0;color:var(--dim);font-size:13.5px}
.badge{flex:none;font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;
 border:1px solid currentColor;border-radius:99px;padding:2px 10px;white-space:nowrap}
.badge.ok{color:var(--ok)} .badge.warn{color:var(--warn)} .badge.off{color:var(--off)}
.cfoot{margin-top:16px}
.btn{display:inline-block;text-decoration:none;font-size:13.5px;font-weight:600;border-radius:8px;
 padding:8px 17px;background:var(--accent);color:var(--panel);border:1px solid var(--accent)}
.btn.ghost{background:transparent;color:var(--ink);border-color:var(--line);margin-left:7px}
.btn.off{background:transparent;color:var(--off);border:1px dashed var(--off);cursor:default}
.tw{overflow-x:auto;margin-top:16px;border:1px solid var(--line);border-radius:9px}
table{border-collapse:collapse;width:100%;font-size:13px}
th,td{text-align:left;padding:7px 11px;border-bottom:1px solid var(--line);white-space:nowrap}
thead th{background:var(--bg);font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim)}
tbody tr:last-child td,tbody tr:last-child th{border-bottom:0}
tbody th{font-weight:600}
.num{text-align:right}
.need{color:var(--warn)} .done{color:var(--ok)}
.next{margin:14px 0 0;font-size:13.5px}
.dimtext{color:var(--dim)}
.empty{color:var(--dim);font-size:13.5px;margin:14px 0 0}
.feedwrap{margin-top:18px;border-top:1px solid var(--line);padding-top:14px}
.fhead{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--dim);
 font-weight:700;margin-bottom:8px;display:flex;gap:8px;align-items:baseline}
.fcount{font-weight:400;letter-spacing:0;text-transform:none;font-size:12px}
.feed{max-height:420px;overflow-y:auto;border:1px solid var(--line);border-radius:9px}
.fday{background:var(--bg);color:var(--dim);font-size:11px;font-weight:700;letter-spacing:.4px;
 padding:5px 12px;border-bottom:1px solid var(--line);position:sticky;top:0}
.fi{display:flex;gap:10px;align-items:baseline;padding:7px 12px;border-bottom:1px solid var(--line);font-size:13px}
.fi:last-child{border-bottom:0}
.fi.empty{color:var(--dim);justify-content:center;padding:18px}
.ftime{color:var(--dim);font-size:11.5px;min-width:58px;text-align:right;
 font-variant-numeric:tabular-nums;flex:none}
.fk{font-size:10px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;
 border:1px solid currentColor;border-radius:99px;padding:1px 7px;flex:none;min-width:70px;text-align:center}
.fk-qa,.fk-mit{color:var(--warn)} .fk-timer{color:#b3261e} .fk-uat{color:var(--accent)}
.fk-rfd,.fk-dep{color:var(--ok)} .fk-hold{color:var(--off)} .fk-dev,.fk-assign{color:#6d28d9}
.fk-defect{color:#9a3412}
.ftext{flex:1}
.flink{font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;flex:none}
@media(max-width:640px){.fi{flex-wrap:wrap}.ftext{flex:1 1 100%}}
.stray{display:none;border:1px solid var(--warn);border-radius:10px;padding:14px 17px;margin:0 0 20px}
.stray.on{display:block}
.stray h3{margin:0 0 6px;font-size:14px;color:var(--warn)}
.stray p{margin:0;font-size:13.5px}
.stray ol{margin:9px 0 0 18px;padding:0;font-size:13.5px}
.stray li{margin:3px 0}
footer{color:var(--dim);font-size:12px;border-top:1px solid var(--line);padding-top:14px;margin-top:30px}
.stale{margin:0 0 14px;padding:8px 12px;border-radius:6px;font-size:13px;font-weight:600;background:#5c2018;color:#ffd9d2;border:1px solid #8c3227}
.stale.warn{background:#5c4a18;color:#ffeccc;border-color:#8c7127}
</style></head><body><div class="wrap">
<header>
  <h1>Vision NG Project Management</h1>
  <p class="sub">Bookmark this page. Updated ${esc(PT.format(new Date()))} PT.</p>
</header>

<div class="stray" id="stray">
  <h3>This is a stray copy &mdash; it is not the live page</h3>
  <p>You opened this file from outside the project library, so it cannot reach the Dashboard sitting
  next to it. The buttons below have been repointed at SharePoint so they still do something, but the
  page you are reading will never update. To get the live one:</p>
  <ol>
    <li>Open <a href="${esc(C.SP_FOLDER)}" target="_blank" rel="noopener">the ${esc(C.SYNC_FOLDER)} library</a> in SharePoint.</li>
    <li>Click <b>Add shortcut to OneDrive</b> in the toolbar.</li>
    <li>In File Explorer, open <b>OneDrive &rsaquo; ${esc(C.SYNC_FOLDER)} &rsaquo; Vision NG Project Management.html</b> &mdash; bookmark that, not this.</li>
  </ol>
</div>

${card({href:'Vision NG Project Dashboard.html', sp:C.SP_BASE+'Vision%20NG%20Project%20Dashboard.html',
  icon:'&#128202;', title:'Project Dashboard', badge:'live', badgeKind:'ok',
  blurb:'In-flight work, delivery countdowns, UAT and deployment queues.',
  after:feedHTML})}

${card({kind:'xlsx', sp:C.SP_BASE+'Vision%20NG%20-%20Sprint%20Planning.xlsx',
  icon:'&#128203;', title:'Sprint Planning', badge:planBadge, badgeKind:planKind,
  blurb:'Windows staged for the next sprint. Lead Developer assigns Sprint #, Dev, BSA and LOE here.',
  body:planBody})}

${card({href:'Vision NG Metric Analysis.html', sp:C.SP_BASE+'Vision%20NG%20Metric%20Analysis.html',
  icon:'&#128200;', title:'Metric Analysis', badge:'live', badgeKind:'ok',
  blurb:'Effort tracking: hours spent per window against the Dev Lead and Complexity LOEs. More sections to come.'})}

<div id="stale" class="stale" hidden></div>
<footer>
  <span id="reftime" data-gen="${new Date().toISOString()}"></span>
  Open this page from your synced <b>${esc(C.SYNC_FOLDER)}</b> folder so it stays current &mdash;
  <a href="${esc(C.SP_FOLDER)}" target="_blank" rel="noopener">add the shortcut to OneDrive</a>
  if you have not already.<br>
  Generated from <b>Vision NG - Master Tracking.xlsx</b> on every dashboard refresh.
  Spreadsheets open in <b>Excel Online</b> so everyone edits the one shared file.
</footer>
</div>
<script>
// This page is built to live in the synced "Vision NG - Grouping" library, where the Dashboard sits
// right next to it and a relative link is the fastest way in. Opened from anywhere else -- a
// download, a mailed attachment -- that link is dead, so repoint every button at SharePoint via
// data-abs and say plainly that the copy is stale. Only file: URLs can be misplaced this way; a
// served copy resolves its own relative links, so leave those alone.
(function(){
  if (location.protocol !== 'file:') return;
  var FOLDER = ${JSON.stringify(C.SYNC_FOLDER)};
  if (decodeURIComponent(location.pathname).indexOf(FOLDER) !== -1) return;
  var b = document.getElementById('stray');
  if (b) b.className = 'stray on';
  var links = document.querySelectorAll('a[data-abs]');
  for (var i = 0; i < links.length; i++) {
    links[i].href = links[i].getAttribute('data-abs');
    links[i].target = '_blank';
    links[i].rel = 'noopener';
  }
})();
</script>
<script>
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

  fs.writeFileSync(C.LANDING, html, 'utf8');
  console.log('WROTE: ' + C.LANDING);
  if (p) console.log(`  planning: ${p.total} window(s), ${p.ready.length} ready, ${Object.keys(p.groups).length} menu group(s)`);
  return p;
}

module.exports = { build, planningSummary };
if (require.main === module) build(require("./activity.js").read()).catch(e => { console.error('ERR', e.stack); process.exit(1); });
