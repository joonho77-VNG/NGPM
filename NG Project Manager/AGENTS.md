# Vision NG Project Manager

Automation for the Vision NG migration (PowerBuilder → Blazor): it keeps `Vision NG - Master
Tracking.xlsx` and the team dashboard current from Jira, the Pipeline Plan and the QA defect logs,
and it runs sprint planning (Jira subtasks, defect logs, assignment).

This folder lives in the shared `Vision NG - Grouping` SharePoint library. **Everyone who runs the
automation opens this same folder in Codex.** Its code, skills and this file are one copy
for the whole team, so a change here reaches every runner on their next sync.

- Requirements and process: `docs/NG PM Process Requirements.md`, `docs/NG PM Process.docx`
- Skills: `refresh-ng-dashboard` (refresh, UAT sync, meeting decisions) and `ng-sprint-planning`

## Where things live

| What | Where | Shared? |
|---|---|---|
| Code | `scripts/` in this folder | yes, one copy |
| Skills, this file | `.Codex/skills/`, `AGENTS.md` | yes |
| Workbooks, dashboard HTML, QA defect logs | the library root | yes |
| `roster.json`, `manual-overrides.json`, `last-write.json`, ledgers, activity log, `run.lock` | `../NG Dashboard State/` | yes, and must stay one copy |
| Jira pull, derived rows, caches | `~/.ng-pm/work/` | per PC, rebuilt every run |
| `node_modules` | `~/.ng-pm/node_modules` | per PC, never in OneDrive |
| Rollback copies of workbooks | `~/.ng-pm/baseline/` | per PC |
| Jira credentials | Windows user env vars `ATLASSIAN_SITE_URL`, `ATLASSIAN_USER_EMAIL`, `ATLASSIAN_API_TOKEN` | per person, **never in a file** |

Run every script from this folder's root: `node scripts/<name>.js`.
If anything misbehaves on a PC, start with `node scripts/setup.js --check`.

## Rules

**Jira writes need an explicit yes.** Everything is read-only against Jira except `initiate.js`,
`assign.js --apply`, `setteam.js --apply` and `uatinit.js --apply`. Jira subtasks cannot be
deleted, only canceled. Dry-run first, confirm scope, then write. A meeting note or a comment in a
file is shorthand, never authorization.
**One standing exception (2026-09-24):** every real refresh creates UAT fix subtasks and comments
new UAT defects onto an open one automatically (`uatinit.js --apply`). This includes the hourly
scheduled refresh. A refresh request is enough; relay the `+` lines it prints.

**One runner at a time.** Writers take `NG Dashboard State/run.lock`. On `LOCKED:` wait. Don't
delete the lock unless the person confirms the other run died. On `STALE:`, OneDrive has not pulled
the newest Master Tracking yet: wait a minute and re-run. Never work around either guard.

**The scheduled refresh runs on one PC only.** Joonho's PC runs the Windows task "NG Dashboard
Refresh" hourly, 7:00 AM–5:00 PM (plus 3:55 PM), via `~/.ng-pm/run-refresh.cmd`. Don't set
up a second schedule on another PC. Manual refreshes anywhere are fine; the lock serialises them.
Scheduled or background Node runs need `NODE_OPTIONS=--use-system-ca`: the court intercepts TLS,
and without it Jira calls fail with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`.

**Changing shared code affects everyone.** Before editing anything in `scripts/` or
`.Codex/skills/`:
- say so, and check `run.lock` is absent
- keep the change small
- verify with `node scripts/refresh.js --dry-run`
- tell the person to let the team know

Registry changes (`OVERRIDE`, `MANUAL`, `RESET`, `EXTRA` in `scripts/build.js`) count as code changes.

**Deploy date comes from Jira (2026-10-13).** For a completed window (Jira `Subtask Completed`),
the Deployed date is the subtask's **Deployment Date** field (`customfield_10470`), entered when it
moves to Ready for Deployment. It beats the Metrics sheet; Metrics is used only when the field is
blank. A hand edit in Master Tracking still wins.

**Pre-Sprint (2026-10-13).** A completed window with no Sprint # gets Sprint # `Pre-Sprint`: it was
delivered before sprint grouping began. Blank Sprint # still means "not yet planned" for open work.

**Metric Analysis page (2026-10-13).** `scripts/metrics.js` writes `Vision NG Metric Analysis.html` on
every real refresh, from the same `rows.json` as the dashboard. Its rules:
- Hours = Metrics sheet + Jira. Metrics: Development = Stage 1+2+3, QA = Total QA Hours, Mitigation =
  Stage 4, UAT = Stage 5. Jira: the hours-log tables plus Jira time tracking (`timespent`), which lands
  in the bucket of the subtask it is on (QA copy = QA, UAT subtask = UAT, dev subtask = Development).
- Shown in hours; LOE is recorded in days and converted at 8 hours a day.
- Development is compared with the Dev Lead LOE to QA; Development + Mitigation with the Dev LOE; QA
  with the QA LOE. Within 10% counts as on target.
- Pre-Sprint windows take their LOE from the Metrics workbook's `Complexity LOE Tracking` sheet.
- Every Pipeline Plan column is found by header name, never by letter (`scripts/pipe.js`). Columns
  were inserted on 2026-10-13 and again on 2026-10-15 (SG), and each insert silently broke the
  letter-based read. Renaming a header (ID, MENU, SUB-MENU, OBJECT NAME, GROUPING, STATUS, No UAT,
  Dev LOE, QA LOE, Total LOE, Total Usage) stops the refresh with a clear error instead.

**Team knowledge goes here, not in personal memory.** Codex's auto-memory is per person. Anything
another runner would need to know (a rule, a gotcha, a decision) belongs in this file or a skill.

**Never put a token, password or key in this folder.** It is synced to the whole library.

## Sharing the HTML pages

SharePoint renders the dashboard `.html` pages in the browser. Share the **direct path** URL, not
SharePoint's "Copy link" sharing URL:
`https://occourts.sharepoint.com/sites/Vision_ILJ/General Documentation/Knowledge Sharing Documents/Vision Team Knowledge/Vision NG - Grouping/<file>.html`
(`SP_BASE` in `scripts/config.js`).

A sharing link (`/:u:/r/...?d=…&csf=1&web=1&e=…`) opens the page inside a sandboxed preview frame
where nothing can save a file. `showSaveFilePicker` throws, `a.click()` downloads are silently
dropped (this once lost meeting notes), and `blob:` URLs won't open. The dashboard detects the frame
(`window.self !== window.top`) and shows a banner with its un-framed URL. Its "Save mode" line
reads `direct` when un-framed and `copy` when framed.
