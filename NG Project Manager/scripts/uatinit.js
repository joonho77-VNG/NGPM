#!/usr/bin/env node
// Turns UAT defects into Jira work: one UAT fix subtask per dev subtask, assigned to its developer.
//
//   node uatinit.js                  DRY RUN - show what would be created / commented; writes nothing
//   node uatinit.js --apply          do it
//   node uatinit.js --only "Priors"  limit to one UAT Defect Log window (matched on its title)
//   node uatinit.js --observe        dry run that also records which linked defects are still
//                                    open, so a defect reopened later is recognised (refresh uses this)
//
// Dry run is the default, like assign.js, because one run can touch several windows.
// What to do is decided by uatplan.js - the same code the dashboard uses for "needs subtask".
//
// Create:  summary  UAT - <Sprint #> - <Window Name> - <object_name>
//          parent   the dev subtask's parent (VISAR-6166)     type  Subtask-Vision Team
//          assignee Dev          Project Team  [Dev, BSA]
//          description: UAT Defect Log + QA defect log links, the defects, the standard hours log.
// Comment: new defects on a window that already has an open UAT subtask are listed on it instead.
//
// Every Jira write is followed at once by a ledger write (NG Dashboard State/uat-subtasks.json),
// and the open-subtask check is re-run against live Jira just before a create, so a run that dies
// half way, or two people running it together, cannot produce a second subtask.
const fs = require('fs');
const { jget, jql, jpost, jput } = require('./jira.js');
const C = require('./config.js');
const U = require('./uat.js');
const P = require('./uatplan.js');
const A = require('./adf.js');
const { kindOf, objOf, isOpen } = require('./kinds.js');
const roster = require(require('./config.js').shared('roster.json'));

const PROJECT = '10115', ISSUETYPE = '10315', TEAM = 'customfield_10375';
const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply'), OBSERVE = ARGS.includes('--observe');
if (APPLY) C.lock('uatinit --apply');
const opt = n => { const i = ARGS.indexOf(n); return i >= 0 ? ARGS[i + 1] : null; };
const ONLY = opt('--only');
const TODAY = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Los_Angeles'}).format(new Date());
const UATLOG_URL = C.SP_BASE + encodeURIComponent('Vision NG - UAT Defect Log.xlsx');
const log = s => console.log(s);

const brief = r => ({key:r.key, sum:r.fields.summary, obj:objOf(r.fields.summary), status:r.fields.status.name,
  assignee:r.fields.assignee ? r.fields.assignee.displayName : '', created:r.fields.created.slice(0,10)});
// Live, not from gathered.json: the decision to create must not rest on a stale pull.
const liveUAT = async () => (await jql('(parent=VISAR-6166 OR parent=VISAR-7396) AND summary ~ "UAT"',
  'summary,status,assignee,created')).filter(r => kindOf(r.fields.summary) === 'uat').map(brief);

const short = (s, n) => { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n).replace(/\s+\S*$/, '') + '...' : s; };
const defectLine = d => `UAT #${d.id}${d.severity ? ` (${d.severity})` : ''} - ${short(d.desc, 160)}`;

function description(it) {
  const h = it.head;
  const ws = it.rows.map(r => `W#${r.W}`).join(', ');
  return A.doc([
    A.para(`UAT fix for ${it.devKey} - ${h.name} (${ws}). Move to In QA when the fix is ready; the BSA's QA copy follows automatically.`),
    A.para(),
    A.para('UAT Defect Log'), A.link(UATLOG_URL),
    A.para('Defect Sheet'), A.link(C.DEFECT_URL + encodeURIComponent(h.dlFile)),
    A.para(),
    A.para(`UAT defects needing a fix (${it.section.title}):`),
    A.bullets(it.fresh.map(defectLine)),
    A.para(),
    ...A.hoursLog(),
  ]);
}

(async () => {
  const R = require(require('./config.js').local('rows.json'));
  const G = require(require('./config.js').local('gathered.json'));
  const dlFiles = fs.readdirSync(C.DEFECTS).filter(f => /\.xlsx$/i.test(f) && !/^~\$/.test(f) && !/Template/i.test(f));
  const sections = (await U.read()).filter(s => !ONLY || s.key.includes(U.norm(ONLY)) || U.norm(ONLY).includes(s.key));
  if (ONLY && !sections.length) { console.error(`no UAT Defect Log window matches "${ONLY}"`); process.exit(1); }

  const ledger = P.readLedger();
  const saveLedger = () => { fs.mkdirSync(C.STATEDIR, {recursive:true}); fs.writeFileSync(P.LEDGER, JSON.stringify(ledger, null, 1)); };
  const uatList = await liveUAT();
  const { items, problems } = P.plan({ sections, rows: R.rows, uatList, dlFiles, ledger, qaFileFor: U.qaFileFor });

  const done = [], held = [], flags = [];
  for (const it of items.filter(i => i.action)) {
    const h = it.head, ids = it.fresh.map(d => '#' + d.id).join(', ');

    if (it.action === 'comment') {
      const u = it.open;
      done.push(`${APPLY ? 'commented' : 'would comment'} on ${u.key} (${u.status}) - new UAT ${ids} for ${h.name}`);
      if (/^In (QA|UAT)$/.test(u.status))
        flags.push(`${u.key} is ${u.status} but new UAT defect(s) ${ids} arrived - decide whether it goes back to the developer`);
      if (!APPLY) continue;
      await jpost(`/rest/api/3/issue/${u.key}/comment`, { body: A.doc([
        A.para(`New UAT defect(s) logged for ${h.name} in the UAT Defect Log:`),
        A.bullets(it.fresh.map(defectLine)), A.link(UATLOG_URL)]) });
      it.fresh.forEach(d => ledger[P.lkey(it.section, d.id)] = { devKey: it.devKey, uatKey: u.key, linked: TODAY, state: 'push', by: 'comment' });
      saveLedger();
      continue;
    }

    // ---- create ----
    const dev = roster[h.dev], bsa = roster[h.bsa];
    const obj = h.obj || (G.derived[it.devKey] || {}).obj;
    const why = !h.dev ? 'no Dev on the window' : !dev ? `Dev "${h.dev}" is not in roster.json`
              : !h.bsa ? 'no BSA on the window' : !bsa ? `BSA "${h.bsa}" is not in roster.json`
              : !obj ? 'no object name - the subtask could not be matched back to its window'
              : !h.dlFile ? 'no QA defect log' : null;
    if (why) { held.push(`${h.name} (${it.devKey}) - UAT ${ids}: ${why}`); continue; }

    const sprint = /^SG\d+$/.test(h.sprint) ? h.sprint : '';
    const summary = ['UAT', sprint, h.name, obj].filter(Boolean).join(' - ');
    const parent = h.mainAR || 'VISAR-6166';
    const plan = `"${summary}" under ${parent} for ${it.devKey} - UAT ${ids} - assign ${dev.displayName}, team ${dev.displayName} + ${bsa.displayName}`;
    if (!APPLY) { done.push(`would create ${plan}`); continue; }

    // Last look at live Jira: someone may have created one since this run started.
    const again = (await liveUAT()).find(u => u.obj === obj.toLowerCase() && isOpen(u.status));
    if (again) { held.push(`${h.name}: ${again.key} appeared while this ran - not duplicated; re-run to comment the defects onto it`); continue; }

    const r = await jpost('/rest/api/3/issue', { fields: {
      project:{id:PROJECT}, parent:{key:parent}, issuetype:{id:ISSUETYPE}, summary,
      description: description(it), assignee:{accountId:dev.accountId} } });
    it.fresh.forEach(d => ledger[P.lkey(it.section, d.id)] = { devKey: it.devKey, uatKey: r.key, linked: TODAY, state: 'push', by: 'create' });
    saveLedger();
    // Project Team is set by a separate update, as assign.js does: on create, Jira silently
    // replaces it with its default (Jorge only - seen on VISAR-7457/7458). Then read it back.
    await jput(`/rest/api/3/issue/${r.key}`, { fields: { [TEAM]: [{accountId:dev.accountId}, {accountId:bsa.accountId}] } });
    const team = ((await jget(`/rest/api/3/issue/${r.key}`, {fields:TEAM})).fields[TEAM] || []).map(u => u.accountId);
    if (!team.includes(dev.accountId) || !team.includes(bsa.accountId)) flags.push(`${r.key} Project Team did not take - set it by hand`);
    done.push(`created ${r.key} ${plan}`);
  }

  // Record which linked defects are still asking for a fix (see uatplan.js "reopened").
  let seen = 0;
  if (APPLY || OBSERVE) { seen = P.observe(items, ledger); if (seen) saveLedger(); }

  // ---- report (refresh.js greps these lines) ----
  const nCreate = items.filter(i => i.action === 'create').length, nComment = items.filter(i => i.action === 'comment').length;
  const stale = items.flatMap(i => i.stale.map(s => `${i.section.title} UAT #${s.d.id} is still ${s.d.status} but ${s.uatKey} is ${s.status} - update the log, or reopen/replace the subtask`));
  log(`UAT SUBTASKS: ${APPLY ? `${done.filter(d => /^created/.test(d)).length} created, ${done.filter(d => /^commented/.test(d)).length} commented`
                            : `${nCreate} to create, ${nComment} to comment (dry run)`}, ${held.length} held, ${stale.length} stale, ${problems.length} problem(s)`);
  done.forEach(d => log(`   + ${d}`));
  flags.forEach(f => log(`   ^ ${f}`));
  held.forEach(h => log(`   ! held ${h}`));
  stale.forEach(s => log(`   ~ ${s}`));
  problems.forEach(p => log(`   ? ${p}`));
  if (!APPLY && (nCreate || nComment)) log('   (dry run - re-run with --apply to perform these)');
})().catch(e => { console.error('UAT SUBTASKS FAILED: ' + (e.message || e)); process.exit(1); });
