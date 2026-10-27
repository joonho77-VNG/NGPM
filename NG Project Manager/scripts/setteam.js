#!/usr/bin/env node
// Set Project Team (customfield_10375) = [Dev, BSA] on subtasks that have both but no team.
//
//   node setteam.js            DRY RUN - prints the exact payloads, writes nothing
//   node setteam.js --apply    performs the writes, one at a time, verifying each
//
// Scope: SG2+ sprint subtasks that already have a Dev and BSA in the master.
// Never touches a subtask that already has a Project Team set.

const { jget, SITE, AUTH } = require('./jira.js');
const R = require(require('./config.js').local('rows.json'));
const roster = require(require('./config.js').shared('roster.json'));

const APPLY = process.argv.includes('--apply');
if (APPLY) require('./config.js').lock('setteam');
const FIELD = 'customfield_10375';

async function put(key, body) {
  const r = await fetch(`${SITE}/rest/api/3/issue/${key}`, {
    method: 'PUT',
    headers: {Authorization: AUTH, Accept: 'application/json', 'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${key} -> ${r.status} ${(await r.text()).slice(0, 300)}`);
}

(async () => {
  // candidates: has a subtask, has Dev and BSA, sprint SG2 or later
  const cand = R.rows.filter(r => {
    if (!r.subtask || !r.dev || !r.bsa) return false;
    const m = String(r.sprint || '').match(/^SG(\d+)$/);
    return m && Number(m[1]) >= 2;
  });

  // one subtask can back several window rows - collapse
  const bySub = {};
  cand.forEach(r => { if (!bySub[r.subtask]) bySub[r.subtask] = r; });

  const plan = [];
  for (const [key, r] of Object.entries(bySub)) {
    const iss = await jget(`/rest/api/3/issue/${key}`, {fields: `summary,${FIELD},assignee`});
    const cur = iss.fields[FIELD];
    if (Array.isArray(cur) && cur.length) {
      plan.push({key, skip: `already set (${cur.map(u => u.displayName).join(', ')})`});
      continue;
    }
    const dev = roster[r.dev], bsa = roster[r.bsa];
    if (!dev || !bsa) { plan.push({key, skip: `unknown initials ${r.dev}/${r.bsa}`}); continue; }
    plan.push({key, W: r.W, name: r.name, summary: iss.fields.summary,
      dev: dev.displayName, bsa: bsa.displayName,
      body: {fields: {[FIELD]: [{accountId: dev.accountId}, {accountId: bsa.accountId}]}}});
  }

  const todo = plan.filter(p => p.body);
  console.log(`${APPLY ? 'APPLYING' : 'DRY RUN'} - Project Team on ${todo.length} subtask(s)\n`);
  plan.forEach(p => {
    if (p.skip) { console.log(`  SKIP  ${p.key}  ${p.skip}`); return; }
    console.log(`  SET   ${p.key}  W#${String(p.W).padEnd(6)} ${p.summary.slice(0, 46)}`);
    console.log(`            team -> ${p.dev} (Dev), ${p.bsa} (BSA)`);
    console.log(`            PUT ${FIELD} = ${JSON.stringify(p.body.fields[FIELD])}`);
  });

  if (!APPLY) { console.log('\nNothing written. Re-run with --apply to perform these writes.'); return; }

  console.log('');
  let ok = 0;
  for (const p of todo) {
    try {
      await put(p.key, p.body);
      const v = await jget(`/rest/api/3/issue/${p.key}`, {fields: FIELD});
      const got = (v.fields[FIELD] || []).map(u => u.displayName).join(', ');
      console.log(`  OK    ${p.key}  verified -> ${got}`);
      ok++;
    } catch (e) {
      console.error(`  FAIL  ${e.message}`);
      console.error('  stopping so a retry can resume cleanly.');
      process.exit(1);
    }
  }
  console.log(`\n${ok}/${todo.length} updated.`);
})().catch(e => { console.error('ERR ' + (e.message || e)); process.exit(1); });
