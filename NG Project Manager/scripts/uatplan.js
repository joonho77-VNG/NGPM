// Decides, per dev subtask, what the UAT Defect Log asks of Jira. Pure: reads, never writes.
// build.js calls it to show "needs subtask" on the dashboard; uatinit.js calls it to act.
// Sharing one function is what keeps the dashboard and the Jira writes from disagreeing.
//
// Rules (agreed 2026-09-23):
//   - A UAT defect needs a developer when its Status is Fix In-Progress / Returned to CTS
//     (uat.js PUSH - the same trigger that copies it into the QA log).
//   - One UAT subtask per DEV subtask, so a bundle (Priors = W#25 + W#25.1) gets one, not two.
//   - New defect, no open UAT subtask  -> create one (whatever state the dev subtask is in).
//   - New defect, an open one exists   -> no new subtask; comment the defect onto the open one.
//   - "New" = not yet linked to any UAT subtask, or linked once, seen cleared, and now back to a
//     fix status (a reopened defect). A defect still at Fix In-Progress whose linked subtask was
//     closed is reported as stale, not recreated: the subtask was closed on purpose, the log lags.
const fs = require('fs');
const path = require('path');
const C = require('./config.js');
const { isOpen } = require('./kinds.js');

const LEDGER = path.join(C.STATEDIR, 'uat-subtasks.json');
const readLedger = () => fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, 'utf8')) : {};
const lkey = (sec, id) => `${sec.key}#${id}`;

// UAT subtasks (and their QA copies) belonging to each dev subtask, matched on object name.
function uatByDev(rows, list) {
  const byObj = {};
  rows.filter(r => r.subtask && r.obj).forEach(r => { byObj[r.obj.toLowerCase()] = r.subtask; });
  const out = {};
  (list || []).forEach(u => { const k = u.obj && byObj[u.obj]; if (k) (out[k] = out[k] || []).push(u); });
  Object.values(out).forEach(a => a.sort((x, y) => x.key.localeCompare(y.key, undefined, { numeric: true })));
  return out;
}

// sections: uat.js read(); rows: build rows; uatList: gathered.json uatList; dlFiles: QA log names
function plan({ sections, rows, uatList, dlFiles, ledger, qaFileFor }) {
  ledger = ledger || readLedger();
  const subs = uatByDev(rows, uatList);
  const out = [], problems = [];
  for (const s of sections) {
    const pending = s.defects.filter(d => d.push);
    const f = qaFileFor(s, dlFiles);
    const mine = f ? rows.filter(r => r.dlFile === f && r.subtask && r.status !== 'Not Started') : [];
    const keys = [...new Set(mine.map(r => r.subtask))];
    if (!pending.length && !keys.length) continue;
    if (keys.length > 1) { problems.push(`${s.title}: its QA log is shared by ${keys.join(', ')} - cannot tell which dev subtask owns the UAT fix`); continue; }
    if (!keys.length) { if (pending.length) problems.push(`${s.title}: ${pending.length} defect(s) need a fix but no started dev subtask uses ${f || 'a matching QA log'}`); continue; }

    const devKey = keys[0];
    const head = mine.find(r => !r.sharedSub) || mine[0];
    const all = subs[devKey] || [];
    const open = all.filter(u => isOpen(u.status));
    const byKey = Object.fromEntries(all.map(u => [u.key, u]));
    const fresh = [], covered = [], stale = [];
    for (const d of pending) {
      const e = ledger[lkey(s, d.id)];
      if (!e || e.state === 'clear') { fresh.push(d); continue; }
      const u = byKey[e.uatKey];
      if (u && !isOpen(u.status)) stale.push({ d, uatKey: e.uatKey, status: u.status });
      else covered.push({ d, uatKey: e.uatKey });
    }
    if (open.length > 1) problems.push(`${s.title}: ${open.length} open UAT subtasks on ${devKey} (${open.map(u => u.key).join(', ')}) - close all but one`);
    const target = open[0] || null;
    out.push({
      section: s, devKey, head, rows: mine, subs: all, open: target,
      latest: target || all[all.length - 1] || null,
      pending, fresh, covered, stale,
      action: !fresh.length ? '' : target ? 'comment' : 'create',
    });
  }
  return { items: out, problems, ledger };
}

// Linked defects: remember whether each is still asking for a fix, so a later return to a fix
// status is recognised as a reopen. Returns the number of entries that changed.
function observe(items, ledger) {
  let n = 0;
  for (const it of items) for (const d of it.section.defects) {
    const e = ledger[lkey(it.section, d.id)]; if (!e) continue;
    const st = d.push ? 'push' : 'clear';
    if (e.state !== st) { e.state = st; e.seen = new Date().toISOString().slice(0, 10); n++; }
  }
  return n;
}

module.exports = { plan, observe, readLedger, uatByDev, lkey, LEDGER };
