// Activity log: Jira subtask events + defect-log deltas, rewritten in dashboard vocabulary.
//
// Events are collected from a rolling Jira window and MERGED into activity-log.json, so the
// log keeps growing even if a refresh is skipped for days. Each event carries a stable id, so
// re-collecting the same window never duplicates.

const ExcelJS = require('./config.js').req('exceljs');
const path = require('path');
const fs = require('fs');
const { jql } = require('./jira.js');   // changelogs now come via changelog.js
const C = require('./config.js');
const R = require(require('./config.js').local('rows.json'));
const G = require(require('./config.js').local('gathered.json'));

// Shared across everyone who runs the refresh - see config.js. The first run on a machine
// seeds it from the old per-user file if the shared one does not exist yet.
const LOG = C.ACTIVITY_LOG;
(function seed() {
  try {
    fs.mkdirSync(C.STATEDIR, {recursive: true});
    if (fs.existsSync(LOG)) return;
    const legacy = path.join(__dirname, 'activity-log.json');
    if (fs.existsSync(legacy)) fs.copyFileSync(legacy, LOG);
  } catch (e) {}
})();
const KEEP = 300;                       // entries retained on disk
const WINDOW_DAYS = 14;                 // how far back each collection looks
const EXCLUDE = new Set(['VISAR-7358','VISAR-7127','VISAR-6749','VISAR-6663','VISAR-6205','VISAR-7414']);

const PTDATE = d => new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles'}).format(new Date(d));
const PTTIME = d => new Intl.DateTimeFormat('en-US', {timeZone:'America/Los_Angeles', hour:'numeric', minute:'2-digit'}).format(new Date(d));
const TODAY = PTDATE(new Date());

const DEVLIKE = new Set(['Subtask In-Progress','In Unit Test','In Progress w/Users','In Progress w/Vision','Subtask Created']);
const cycleOf = t => { const m = String(t).match(/QA\s*(?:-\s*)?(?:Cycle|Cycles)?\s*(\d+)/i); return m ? Number(m[1]) : null; };

const rowsByKey = {};
R.rows.filter(r => r.subtask).forEach(r => (rowsByKey[r.subtask] = rowsByKey[r.subtask] || []).push(r));
const qaMeta = {}; [...G.qaList, ...(G.uatList || []), ...(G.uatQaList || [])].forEach(q => qaMeta[q.key] = q);
const { kindOf } = require('./kinds.js');
const rowsByObj = {};
R.rows.filter(r => r.obj).forEach(r => (rowsByObj[r.obj.toLowerCase()] = rowsByObj[r.obj.toLowerCase()] || []).push(r));
const patchMeta = {};
Object.values(G.derived).filter(d => d.isPatch)
  .forEach(d => patchMeta[d.key] = {W:'', name:d.summary.replace(/^NG PATCH - /,'')});

function windowFor(key) {
  if (patchMeta[key]) return patchMeta[key];
  let set = rowsByKey[key];
  if (!set && qaMeta[key] && qaMeta[key].obj) set = rowsByObj[qaMeta[key].obj];
  if (!set || !set.length) return null;
  const head = set.find(r => !r.sharedSub) || set[0];
  return {W: head.W, name: head.name};
}

// Within a single day, X->Y immediately followed by Y->X is a mis-click, not activity.
function dropBounceBacks(list) {
  const out = list.slice();
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < out.length - 1; i++) {
      if (out[i].to === out[i+1].from && out[i].from === out[i+1].to &&
          PTDATE(out[i].ts) === PTDATE(out[i+1].ts)) { out.splice(i, 2); changed = true; break; }
    }
  }
  return out;
}

async function collect(days = WINDOW_DAYS) {
  const since = PTDATE(new Date(Date.now() - days * 86400000));
  const touched = await jql(`(parent=VISAR-6166 OR parent=VISAR-7396) AND updated >= -${days}d`, 'summary,updated');
  const events = [];

  // Changelogs come from changelog.js, shared with gather.js - which runs first, so by the
  // time we get here these issues are almost always already cached.
  const CLR = await require('./changelog.js').load(
    touched.filter(t => !EXCLUDE.has(t.key)).map(t => ({key: t.key, updated: t.fields.updated})),
    {fresh: process.argv.includes('--fresh')});

  for (const t of touched) {
    if (EXCLUDE.has(t.key)) continue;
    const iss = CLR.data[t.key]; if (!iss) continue;
    const summary = iss.summary;
    const kind = kindOf(summary), isQA = kind === 'qa';
    const win = windowFor(t.key); if (!win) continue;
    const cyc = isQA ? cycleOf(summary) : null;
    const who = h => h.author || 'Someone';
    const w = win.W ? `<b>${win.name}</b> (W#${win.W})` : `<b>${win.name}</b> (Patch)`;
    const push = (ts, text, kind, tag) => {
      if (PTDATE(ts) < since) return;
      events.push({id:`${t.key}|${ts}|${tag}`, ts, date:PTDATE(ts), time:PTTIME(ts),
                   text, kind, key:t.key, W:win.W});
    };

    if (isQA && PTDATE(iss.created) >= since)
      push(iss.created, `<b>QA Cycle ${cyc ?? '?'}</b> opened for ${w}`, 'qa', 'created');

    const hist = iss.hist;   // changelog.js already sorted these
    const st = dropBounceBacks(hist.flatMap(h => h.items.filter(i => i.field === 'status')
      .map(i => ({ts:h.created, by:who(h), from:i.fromString, to:i.toString}))));

    // UAT fix subtask and its QA copy: their own vocabulary, never counted as QA cycles.
    if (kind === 'uat' || kind === 'uatqa') {
      const fix = `the <b>UAT fix</b> for ${w}`;
      if (kind === 'uat' && PTDATE(iss.created) >= since) push(iss.created, `<b>UAT fix</b> subtask opened for ${w}`, 'uat', 'created');
      st.forEach(s => {
        if (kind === 'uatqa') {
          if (s.to === 'Subtask Completed') push(s.ts, `${s.by} completed QA of ${fix}`, 'qa', 'qadone');
          return;
        }
        if (s.to === 'In QA')                  push(s.ts, `${s.by} sent ${fix} to QA`, 'qa', 'toqa' + s.ts);
        else if (s.to === 'In UAT')            push(s.ts, `${fix} passed QA &mdash; back with the PDC`, 'uat', 'uat' + s.ts);
        else if (s.to === 'Subtask Completed') push(s.ts, `${s.by} closed ${fix}`, 'rfd', 'done');
        else if (DEVLIKE.has(s.to) && /^In (QA|UAT)$/.test(s.from))
          push(s.ts, `${s.by} returned ${fix} to the developer`, 'mit', 'mit' + s.ts);
      });
      // Reassignment is the hand-off signal here (BSA -> PDC when QA passes, PDC -> Dev on new bugs).
      if (kind === 'uat') hist.forEach(h => h.items.filter(i => i.field === 'assignee' && i.toString && i.toString !== i.fromString)
        .forEach(i => push(h.created, `${fix} assigned to <b>${i.toString}</b>`, 'assign', 'assign' + h.created)));
      continue;
    }

    // Walk the WHOLE history so cycle numbers and "first time" stay correct,
    // but only emit what falls inside the window.
    let qaSeen = 0, exitSeen = 0, started = false;
    st.forEach(s => {
      if (isQA) {
        if (s.to === 'Subtask In-Progress' && DEVLIKE.has(s.from))
          push(s.ts, `${s.by} started <b>QA Cycle ${cyc ?? '?'}</b> testing on ${w}`, 'qa', 'qastart');
        else if (s.to === 'Subtask Completed')
          push(s.ts, `${s.by} completed <b>QA Cycle ${cyc ?? '?'}</b> for ${w}`, 'qa', 'qadone');
        return;
      }
      if (s.to === 'In QA') {
        qaSeen++;
        push(s.ts, qaSeen === 1
          ? `${s.by} moved ${w} to <b>QA for the first time</b>`
          : `${s.by} moved ${w} back to QA &mdash; <b>QA Cycle ${qaSeen}</b>`, 'qa', 'toqa' + qaSeen);
      } else if (s.from === 'In QA') {
        exitSeen++;
        if (exitSeen === 1 && s.to !== 'In UAT') {
          const row = rowsByKey[t.key] && rowsByKey[t.key][0];
          const tgt = row && row.target ? ` &mdash; target <b>${row.target}</b>` : '';
          push(s.ts, `<b>Two-week countdown started</b> for ${w}${tgt}`, 'timer', 'timer');
        } else if (DEVLIKE.has(s.to)) {
          push(s.ts, `${s.by} returned ${w} to the developer for mitigation`, 'mit', 'mit' + exitSeen);
        }
        if (s.to === 'In UAT') push(s.ts, `${w} <b>sent to UAT</b>`, 'uat', 'uat');
      } else if (s.to === 'In UAT')               push(s.ts, `${s.by} moved ${w} <b>to UAT</b>`, 'uat', 'uat');
      else if (s.to === 'Ready for Deployment')   push(s.ts, `${w} is <b>ready for deployment</b>`, 'rfd', 'rfd');
      else if (s.to === 'Subtask Completed')      push(s.ts, `${w} has been <b>deployed</b>`, 'dep', 'dep');
      else if (s.to === 'On-Hold')                push(s.ts, `${s.by} placed ${w} <b>on hold</b>`, 'hold', 'hold');
      else if (s.to === 'Backlog')                push(s.ts, `${s.by} moved ${w} to <b>backlog</b>`, 'hold', 'backlog');
      else if (s.to === 'Canceled')               push(s.ts, `${s.by} <b>canceled</b> ${w}`, 'hold', 'cancel');
      else if (DEVLIKE.has(s.to) && s.from === 'Subtask Created' && !started) {
        started = true;
        push(s.ts, `${s.by} <b>started development</b> on ${w}`, 'dev', 'devstart');
      }
    });

    // assignee: net change per day, so a correction reads as one event
    const byDay = {};
    hist.forEach(h => h.items.filter(i => i.field === 'assignee')
      .forEach(i => { const d = PTDATE(h.created);
        (byDay[d] = byDay[d] || []).push({ts:h.created, from:i.fromString, to:i.toString}); }));
    Object.entries(byDay).forEach(([d, list]) => {
      const net = {from:list[0].from, to:list[list.length-1].to, ts:list[list.length-1].ts};
      if (!net.to || net.to === net.from) return;
      push(net.ts, isQA
        ? `<i>QA Cycle ${cyc ?? '?'} &ndash; ${win.name}</i> has been assigned to <b>${net.to}</b>`
        : `<b>${win.name}</b>${win.W ? ` (W#${win.W})` : ''} assigned to <b>${net.to}</b>`, 'assign', 'assign' + d);
    });
  }

  // ---- defect deltas (today only; the logs carry dates, not times) ----
  // defects.js does the parsing, cached on (mtime,size) and shared with build.js, which runs
  // first - so by the time we get here the workbooks are almost always already scanned.
  const nm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const files = [...new Set(R.rows.filter(r => r.dlFile).map(r => r.dlFile))];
  const {counts} = await require('./defects.js').scan(files, TODAY, process.argv.includes('--fresh'));
  for (const f of files) {
    const d = counts[f];
    if (!d || (!d.added && !d.resolved)) continue;
    const logName = nm(f.replace(/^QA Defect Log - /,'').replace(/.xlsx$/,''));
    const cands = R.rows.filter(r => r.dlFile === f);
    const owner = cands.find(r => nm(r.name) === logName) || cands.find(r => r.subtask && !r.sharedSub) || cands[0];
    const parts = [];
    if (d.added) parts.push(`<b>${d.added}</b> new defect${d.added>1?'s':''} logged`);
    if (d.resolved) parts.push(`<b>${d.resolved}</b> resolved`);
    // same id all day, so the count updates instead of piling up
    events.push({id:`defect|${f}|${TODAY}`, ts:`${TODAY}T23:59:00.000Z`, date:TODAY, time:'',
      kind:'defect', W:owner?owner.W:'', key:'',
      text:`${parts.join(' and ')} on <b>${owner?owner.name:f}</b>${owner?` (W#${owner.W})`:''}`});
  }

  return events;
}

// Merge freshly collected events into the durable log.
function merge(fresh) {
  let log = [];
  try { log = JSON.parse(fs.readFileSync(LOG, 'utf8')); } catch (e) {}
  const byId = {};
  log.forEach(e => byId[e.id] = e);
  let added = 0, updated = 0;
  fresh.forEach(e => {
    if (!byId[e.id]) { byId[e.id] = e; added++; }
    else if (byId[e.id].text !== e.text) { byId[e.id] = e; updated++; }   // e.g. today's defect count moved
  });
  const out = Object.values(byId).sort((a,b) => String(b.ts).localeCompare(String(a.ts))).slice(0, KEEP);
  fs.writeFileSync(LOG, JSON.stringify(out, null, 1));
  return {log: out, added, updated, total: out.length};
}

const read = () => { try { return JSON.parse(fs.readFileSync(LOG, 'utf8')); } catch (e) { return []; } };

module.exports = { collect, merge, read, TODAY };

if (require.main === module) {
  collect().then(f => {
    const r = merge(f);
    console.log(`collected ${f.length} event(s) from the last ${WINDOW_DAYS} days`);
    console.log(`log: +${r.added} new, ${r.updated} updated, ${r.total} total\n`);
    r.log.slice(0, 20).forEach(e =>
      console.log(`  ${e.date} ${String(e.time).padStart(8)}  [${e.kind.padEnd(6)}] ${e.text.replace(/<[^>]+>/g,'').replace(/&mdash;/g,'-').replace(/&ndash;/g,'-')}`));
  }).catch(e => { console.error('ERR', e.stack); process.exit(1); });
}
