// Every path the NG dashboard automation touches. Change them here, nowhere else.
const os = require('os');
const path = require('path');

// ROOT is found, not hardcoded, so the pipeline runs for any team member who has the
// SharePoint library synced. Order: NG_ROOT env var -> probe under the home directory.
// The probe anchors on the suffix, so it does not matter whether someone named their
// shortcut "Vision - Vision NG - Grouping" or plain "Vision NG - Grouping".
function findRoot() {
  if (process.env.NG_ROOT) return process.env.NG_ROOT.split(path.sep).join("/");
  const home = os.homedir();
  const fs = require("fs");
  for (const od of fs.readdirSync(home).filter(d => /^OneDrive/i.test(d))) {
    const dir = path.join(home, od);
    let kids = []; try { kids = fs.readdirSync(dir); } catch (e) { continue; }
    const hit = kids.find(k => /Vision NG - Grouping$/i.test(k));
    if (hit) return path.join(dir, hit).split(path.sep).join("/");
  }
  throw new Error(
    ['Could not find the Vision NG - Grouping folder under ' + home + '.',
     'Add the SharePoint library as a OneDrive shortcut (Always keep on this device),',
     'or set NG_ROOT to its full path.'].join('\n'));
}
const ROOT = findRoot();
const fs = require('fs');

// The code lives in the library (one copy for everyone); these live per PC under ~/.ng-pm.
const HOME = path.join(os.homedir(), '.ng-pm');
const WORK = path.join(HOME, 'work');          // regenerated every run: Jira pull, rows, caches
const STATEDIR = `${ROOT}/NG Dashboard State`; // shared: must be one copy for every runner
fs.mkdirSync(WORK, { recursive: true });

// node_modules is installed per PC in ~/.ng-pm (never synced), so resolve packages from there.
const req = require('module').createRequire(path.join(HOME, 'package.json'));

// One runner at a time. OneDrive has no locking, so two PCs writing Master Tracking or the
// shared state files at once would produce conflict copies. A lock older than 30 min is
// treated as abandoned. Your own lock (a crashed earlier run) never blocks you.
function lock(task) {
  if (process.env.NG_LOCK_HELD) return;         // a child of a run that already holds it
  const f = path.join(STATEDIR, 'run.lock');
  const me = `${os.userInfo().username}@${os.hostname()}`;
  try {
    const L = JSON.parse(fs.readFileSync(f, 'utf8'));
    const mins = (Date.now() - Date.parse(L.started)) / 60000;
    if (L.who !== me && mins < 30) {
      console.error(`LOCKED: ${L.who} started "${L.task}" ${Math.round(mins)} min ago. ` +
        `Wait for it to finish (or delete "${f}" if you are sure it died).`);
      process.exit(4);
    }
  } catch (e) { /* no lock, or unreadable - take it */ }
  fs.writeFileSync(f, JSON.stringify({ who: me, task, started: new Date().toISOString() }));
  process.on('exit', () => {
    try { if (JSON.parse(fs.readFileSync(f, 'utf8')).who === me) fs.unlinkSync(f); } catch (e) {}
  });
}

const sha = file => require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');

module.exports = {
  req, lock, sha, WORK,
  local:  f => path.join(WORK, f),
  shared: f => path.join(STATEDIR, f),
  ROOT,
  PIPELINE:  `${ROOT}/Vision NG - Pipeline Plan.xlsx`,
  METRICS:   `${ROOT}/Vision NG Metrics.xlsx`,
  TEMPDASH:  `${ROOT}/TEMP NG Project Dashboard.xlsx`,
  MASTER:    `${ROOT}/Vision NG - Master Tracking.xlsx`,
  DASHBOARD: `${ROOT}/Vision NG Project Dashboard.html`,
  ANALYSIS:  `${ROOT}/Vision NG Metric Analysis.html`,
  PDC:       `${ROOT}/Vision NG PDC Dashboard.html`,
  DEFECTS:  `${ROOT}/QA Defect Logs`,
  DECISIONS: `${ROOT}/NG Meeting Decisions`,   // exported dashboard notes land here

  // Durable activity feed. SHARED, not per-user: activity.js only re-scans Jira 14 days
  // back, so a second machine with its own empty log would rebuild a truncated feed and
  // overwrite months of history for everyone. One file, in the library, for every runner.
  // Also shared: roster.json, manual-overrides.json, last-write.json (+ .meta), run.lock.
  STATEDIR,
  ACTIVITY_LOG: `${STATEDIR}/activity-log.json`,

  // Working state + rollback copies, deliberately OUTSIDE OneDrive so they
  // never sync-conflict and node_modules never churns the tenant.
  HOME,
  BASELINE: path.join(HOME, 'baseline'),
  STATE:    WORK,

  LANDING:   `${ROOT}/Vision NG Project Management.html`,

  JIRA_BROWSE: 'https://ocsuperiorcourt.atlassian.net/browse/',
  SP_BASE:     'https://occourts.sharepoint.com/sites/Vision_ILJ/General%20Documentation/'
             + 'Knowledge%20Sharing%20Documents/Vision%20Team%20Knowledge/Vision%20NG%20-%20Grouping/',
  // The library folder itself, for anyone who has not synced it yet.
  SP_FOLDER:   'https://occourts.sharepoint.com/sites/Vision_ILJ/General%20Documentation/Forms/AllItems.aspx?id='
             + encodeURIComponent('/sites/Vision_ILJ/General Documentation/Knowledge Sharing Documents'
                                + '/Vision Team Knowledge/Vision NG - Grouping'),
  // Name of the synced shortcut folder. The landing page looks for this in its own URL to tell
  // whether it is running from the library or from a stray copy someone downloaded.
  SYNC_FOLDER: 'Vision NG - Grouping',

  DEFECT_URL:  'https://occourts.sharepoint.com/sites/Vision_ILJ/General%20Documentation/'
             + 'Knowledge%20Sharing%20Documents/Vision%20Team%20Knowledge/'
             + 'Vision%20NG%20-%20Grouping/QA%20Defect%20Logs/',
};
