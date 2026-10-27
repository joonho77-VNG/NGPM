// One changelog fetch per issue per refresh, shared by gather.js and activity.js.
//
// Both consumers used to walk their own serial loop over /issue/{key}?expand=changelog -
// ~50 and ~45 requests at ~280ms each, largely over the same issues. That was ~37s of the
// ~42s refresh. This module fetches in parallel and caches on the issue's `updated` stamp:
// Jira cannot alter a changelog without bumping `updated`, so an unchanged stamp means the
// cached history is still accurate. Completed subtasks are fetched once and never again,
// while a reopened one re-fetches on its own - which a status filter would not do.
//
// Only status and assignee entries are kept; nothing else is read from a changelog.
const { jget } = require('./jira.js');
const fs = require('fs');
const path = require('path');

const CACHE = require('./config.js').local('changelog-cache.json');
const CONC = 8;                    // measured: 9x over serial; 12 gains little and is ruder
const KEEP = new Set(['status','assignee']);

// Run fn over items, at most n in flight. Results keep input order.
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({length: Math.min(n, items.length)}, async () => {
    for (;;) { const k = i++; if (k >= items.length) return; out[k] = await fn(items[k]); }
  }));
  return out;
}

// issues: [{key, updated}] straight off a search result.
// -> {data:{key:{updated,created,summary,hist:[{created,author,items:[{field,fromString,toString}]}]}},
//     fetched, cached}
async function load(issues, {fresh = false} = {}) {
  let cache = {};
  if (!fresh) { try { cache = JSON.parse(fs.readFileSync(CACHE,'utf8')); } catch (e) {} }

  const stale = issues.filter(i => !cache[i.key] || cache[i.key].updated !== i.updated);
  const got = await pool(stale, CONC, async i => {
    const r = await jget(`/rest/api/3/issue/${i.key}`, {expand:'changelog', fields:'summary,created'});
    return {
      updated: i.updated,
      created: r.fields.created,
      summary: r.fields.summary,
      hist: r.changelog.histories
        .map(h => ({created: h.created,
                    author: h.author ? h.author.displayName : 'Someone',
                    items: h.items.filter(x => KEEP.has(x.field))
                                  .map(x => ({field:x.field, fromString:x.fromString, toString:x.toString}))}))
        .filter(h => h.items.length)
        .sort((a,b) => a.created.localeCompare(b.created)),
    };
  });

  const next = {};
  stale.forEach((i,k) => { next[i.key] = got[k]; });
  issues.forEach(i => { if (!next[i.key] && cache[i.key]) next[i.key] = cache[i.key]; });
  // Carry keys this caller did not ask about, so the two consumers never evict each other.
  Object.keys(cache).forEach(k => { if (!next[k]) next[k] = cache[k]; });

  try { fs.writeFileSync(CACHE, JSON.stringify(next)); } catch (e) {}
  return {data: next, fetched: stale.length, cached: issues.length - stale.length};
}

module.exports = {load, pool};
