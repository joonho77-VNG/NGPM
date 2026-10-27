---
name: refresh-ng-dashboard
description: Refresh the Vision NG Master Tracking workbook and regenerate the project dashboard HTML from Jira, the Pipeline Plan and the QA defect logs; also processes meeting notes entered on the dashboard into action items. Use when the user says "refresh NG dashboard", "refresh the dashboard", "refresh master tracking", "update the NG tracker", "process decisions", "process the meeting notes", or asks for current Vision NG project status, sprint readiness, or today's window activity.
---

# Refresh NG Dashboard

Rebuilds these artifacts from live sources:

- `Vision NG - Master Tracking.xlsx` — the system of record, 220 window rows
- `Vision NG Project Dashboard.html` — self-contained, opened by the team from OneDrive
- `Vision NG Metric Analysis.html`, `Vision NG Project Management.html` (landing page)
- `Vision NG PDC Dashboard.html` — built last by `pdc.js` (since 2026-10-27). If it fails, the refresh still succeeds and the report shows `PDC : not written` plus a `Note`. Relay that note.

All live in `…\OneDrive - Superior Court of California County of Orange\Vision - Vision NG - Grouping\`.

## Run it

```bash
node scripts/refresh.js
```

That is the whole operation. It re-pulls Jira every time, so it can never build from a stale snapshot.

A normal refresh takes about 7 seconds. Two caches do the work:

- `~/.ng-pm/work/changelog-cache.json` (per PC) — issue changelogs, keyed on the Jira `updated` stamp. Jira cannot alter a
  changelog without bumping `updated`, so an unchanged stamp means the cached history is still good.
  Completed subtasks are fetched once and never again; a reopened one re-fetches on its own.
- `~/.ng-pm/work/defect-cache.json` (per PC) — QA defect-log counts, keyed on each workbook's `(mtime, size)`. A log not
  written today cannot hold a row dated today, so today's churn is known to be zero without opening it.

Both are derived state and safe to delete; the next run rebuilds them (~10s). Neither can go stale
without the underlying source changing first, so `--fresh` is a diagnostic, not routine hygiene.

Flags:

| Flag | Use |
|---|---|
| `--dry-run` | Recompute and report; write nothing. Use when the user wants to preview. |
| `--no-jira` | Reuse the last Jira pull. Layout/formatting work only — never for a real refresh. |
| `--fresh` | Ignore the changelog and defect-log caches and re-read every source. Rarely needed — the caches are keyed on change stamps and invalidate themselves. Use it to rule the cache out when a number looks wrong. |

## More than one person runs this

The code and shared state live in the library, so any team member can refresh. Two guards keep
them from colliding. Neither one is an error to work around; relay the message and wait.

| Output | Meaning | What to do |
|---|---|---|
| `LOCKED: <who> started "<task>" n min ago` (exit 4) | Someone else is refreshing or writing to Jira right now | Wait, then re-run. Delete `NG Dashboard State/run.lock` only if the user confirms that run died. A lock older than 30 min is ignored automatically. |
| `STALE: Master Tracking on this PC is older…` (exit 3) | Another PC refreshed and OneDrive has not pulled the new workbook down yet | Wait a minute and re-run. **Never bypass it.** Running against the old copy would pin old values as hand edits. |

`initiate.js`, `assign.js --apply`, `setteam.js --apply` and `uatinit.js --apply` take the same lock.

## After it runs

Relay the report block it prints. Lead with anything that needs attention:

1. **Rule validation** — anything other than `clean` means a row violates the Track/Sprint rules. Name the rows.
2. **Crosswalk conflicts** — must be `0`. Non-zero means a window maps to two subtasks; stop and investigate.
3. **Sprint readiness** — say which sprints are blocked and by which windows.
4. **Today's activity** — relay the lines as written; they are already in dashboard vocabulary.
5. **Workbook status** — if it says the file is open or syncing, tell the user to close Excel and offer to re-run. The dashboard still regenerates in that case; only the `.xlsx` is skipped.

Send the user the dashboard file with `SendUserFile` (`display: "render"`) unless they only asked for numbers.

A rollback copy of the workbook is saved to `~/.ng-pm/baseline/` before every write.

## Hand edits are safe

The refresh is a **full rebuild, not an incremental update** — every run re-pulls all of Jira and
rewrites all 220 rows. Hand edits survive anyway, because `preserve.js` runs first: it compares the
workbook against `NG Dashboard State/last-write.json` (a snapshot of exactly what the previous refresh produced) and
treats any difference as a human edit.

| Edited field | What happens |
|---|---|
| `UAT Start`, `Signed Off`, `Deployed`, `Build #` | carried forward silently — derivation never produces these |
| `Status`, dates, `QA Cycle`, `Sprint #`, `Dev`, `BSA`, all four hours columns | **pinned** in `NG Dashboard State/manual-overrides.json`, listed in the `Overridden` column, and reported at every refresh |

Always relay the preserve step's output. A pinned derived field now beats Jira, which is usually
what the user wants but must never be invisible. To hand a field back to Jira, delete its entry from
`manual-overrides.json` and refresh.

Blanking a cell is ignored — derivation refills it. That prevents an accidental delete from
silently pinning an empty value.

## UAT defect sync (the one write to the defect logs)

Before rows are built, `uatsync.js` copies UAT defects into the window's QA defect log:

- **Source:** `Vision NG - UAT Defect Log.xlsx`. It is one sheet, and each window starts with an orange header row.
- **What is copied:** rows whose Status is `Fix In-Progress` or `Returned to CTS` and whose Description is filled in.
- **How it lands:** Status = `New`, Summary prefixed `[UAT #n]`, `UAT` in QA Cycle if the log has that column. Severity High becomes Bug Type `Major`; Medium and Low become `Minor`.
- **Add-only.** A copied row belongs to QA; the sync never edits or deletes it. The report flags drift with `~` lines (QA resolved but UAT still pending, or the reverse), missing QA logs with `?`, and skipped files with `!`.
- **No duplicates.** `NG Dashboard State/uat-sync.json` is the shared ledger. It stops a second copy, including the rows the team added by hand (`--seed "<window>"` records those).
- **Written through Excel, not ExcelJS.** `uatwrite.ps1` does the write, because ExcelJS drops the logs' cross-sheet Status/Bug Type dropdowns. A log that is open is skipped and retried next refresh. A backup goes to `~/.ng-pm/baseline/` first.
- **Name mismatches:** window names that differ from the QA log names are in `ALIAS` in `uat.js`.

Standalone: `node scripts/uatsync.js --dry-run` or `node scripts/uatsync.js --only "<window>"`. `refresh.js --dry-run` passes `--dry-run` through.

The same header rows supply **UAT Start** (UAT Release) and **Signed Off** (Sign-Off Date) for every row that uses that window's QA log and is not Not Started. The Deployment Date is deliberately ignored. A hand edit in Master Tracking still wins.

Open QA rows tagged `[UAT #…]`, or with QA Cycle = `UAT`, show on the dashboard as a **UAT fix pending (n)** pill in the Open column.

## UAT fix subtasks (`uatinit.js`)

UAT defects become Jira work as a **UAT subtask**, one per dev subtask. A bundle like Priors (W#25 + 25.1) gets one, not two.

- **Title:** `UAT - SG# - Window Name - w_object`. The object name is required, because it is how the subtask is matched back to its window. It is created under the dev subtask's parent, assigned to the Dev, with Project Team = [Dev, BSA]. The description has links to the UAT Defect Log and the QA defect log, the defect list, and the standard hours table.
- **Trigger:** a defect at `Fix In-Progress` / `Returned to CTS`. The dev subtask's status does not matter.
- **Rule 6:** a new defect when an open UAT subtask already exists → no new subtask; the defects are posted as a comment on the open one instead. It is also flagged `^` if that subtask is In QA / In UAT.
- **Reopened vs stale:** a defect that was seen cleared and then comes back counts as new. One still at Fix In-Progress after its subtask was closed is reported `~` stale, not recreated.
- **Workflow after creation is manual:** Dev → In QA → the automation's `QA - UAT - …` copy for the BSA → BSA passes it and assigns it to the PDC (In UAT) → PDC closes it or reassigns it to the Dev. UAT cycles are not counted.
- **Ledger:** `NG Dashboard State/uat-subtasks.json` records which defect is on which UAT subtask.

**Every real refresh creates them automatically** (since 2026-09-24, by the user's decision). It runs
`uatinit.js --apply`, which also covers the hourly scheduled refresh. Don't ask before a refresh
because of this. The report prints `UAT SUBTASKS: n created, n commented …` with a `+` line per
subtask created or commented. **Always relay those `+` lines**: they are real Jira writes. When
anything was written, the refresh re-pulls Jira and rebuilds, so the new subtask is already on the
dashboard.

Guards kept inside `uatinit.js`:
- a live-Jira re-check before every create, so no duplicates, even with two runners
- a ledger write right after each create
- `! held` when Dev, BSA, object name or QA log is missing. Relay these; the user fixes the data.
- `?` problems when two open UAT subtasks exist or a QA log is shared

`refresh.js --dry-run` and a bare `node scripts/uatinit.js` still only report. Use `--only "Priors" --apply` to act on one window by hand.

Dashboard: **UAT Mitigation** lists windows with an open UAT subtask, or with defects needing one ("needs subtask"). Its columns include UAT status + assignee, open UAT-origin defects with ▲/▼, and links to both logs. In **Sent to UAT**, the open-defects column is replaced by the UAT subtask key.

## Hours (Jira hours logs)

Since 2026-09-23 the hours come **only** from the Hours Log table in the subtask descriptions. The Metrics sheet is no longer used for hours.

- The column an entry is typed in (Development / QA / Defect Mitigation / UAT) decides the bucket.
- A window adds up its dev subtask, its UAT subtask(s) and their QA copies (BSAs log on the copies).
- A QA copy inherits the dev subtask's rows when it is created. Those are skipped if they are identical to a row on the dev/UAT subtask, or dated before the copy existed (`hours.js`).
- The log is re-read in full every refresh, so an edited entry changes the total.
- Accepted value formats: `3:00`, `1.5`, `2h 30m`, `45m`. Anything else is reported as `hours not a number`. Relay those lines.

## What it will not do

- Its only Jira writes are UAT fix subtasks and the comments above, made automatically. Nothing else in Jira is touched: no status changes, no reassignment. The only defect-log write is the add-only UAT sync.
- It does not invent dates. `UAT Start`, `Signed Off` and `Deployed` come from source files or stay blank.

## Processing meeting decisions

The dashboard has a **Notes** field on every row. The user types notes during a meeting and clicks
**Save notes**. The browser either writes straight to `NG Meeting Decisions\` (if it allows direct
save) or drops the file in `Downloads\`. The page states which mode it used.

When the user says "process decisions" or "process the meeting notes":

```bash
node scripts/decisions.js
```

It finds the newest `ng-decisions-*.json`, **moves it out of Downloads into `NG Meeting Decisions\`**
if that is where it landed, and prints the notes grouped by section. `--list` shows what is available
without moving anything.

Then read each note and turn it into an action. **Split them into two groups and present both before
doing anything:**

| Safe — do these, then re-run the refresh and report | Needs explicit confirmation first |
|---|---|
| Pin a date via `OVERRIDE` (extension, corrected 2 Week Start) | **Any write to Jira** — status changes, reassignment, creating subtasks |
| Record a QA-cycle exception | Creating or copying SharePoint files |
| Change Dev / BSA / Sprint # | Anything that touches the defect logs |
| Add a `MANUAL`, `RESET` or `EXTRA` entry | Deleting or renaming source files |

Everything built so far is **read-only against Jira**. The first write is a real threshold — never
cross it silently, even if the note sounds like an instruction. A note is the user's shorthand, not
an authorization.

After executing, run the refresh, report what changed, and archive the file:

```bash
node scripts/decisions.js --archive
```

Notes survive a refresh: the dashboard re-seeds every Notes field from the newest decisions file, so
regenerating does not wipe them. Archiving is what clears them.

## Making a correction stick

Derived fields are recomputed every run, so a hand edit will be overwritten. To pin a value, add it to `OVERRIDE` at the top of `scripts/build.js` (shared code - the change applies to every runner):

```js
const OVERRIDE = {
  '53': {twoWk:'2026-09-18'},   // pins 2 Week Start; Target Date recalculates from it
};
```

Pinned fields are listed per row in the workbook's `Overridden` column. Other registries in the same file:

| Registry | Purpose |
|---|---|
| `MANUAL` | Windows that deliberately share one bundled subtask (e.g. the Minutes group on VISAR-6315) |
| `RESET` | Windows forced back to "never started" |
| `EXTRA` | Canceled windows absent from the Pipeline sheet |

**Precedence — the registries are applied in this order, and the order matters:**

1. `MANUAL` sets the window→subtask crosswalk.
2. `RESET` then *deletes* that mapping, so the row derives as "never started".
3. `OVERRIDE` is applied **last of the three**, to every row, whether or not it still has a subtask.

So `RESET` alone does not fully retire a window: any `OVERRIDE` entry it still has keeps being
pinned, and a pinned `twoWk` will recompute a Target Date and leave the row sitting in Committed
Delivery Windows with its timer running. **When you reset a window, remove its `OVERRIDE` entry in
the same edit.** The dashboard overlay runs after all three and only fills blanks (`if(!r.sprint)`),
so it cannot resurrect a value any registry has already set.

## Key rules the output depends on

- **Sprint # vs Track are separate axes.** Sprint # is what a window *deploys with*; Track (`User`/`Internal`/`Patch`) is what *process* it follows. An internal window in SG1 shows as `SG1 Internal`.
- **Only `Track = User` runs the two-week countdown.** Internal and Patch go In QA → Ready for Deployment and skip UAT.
- **A window maps to one dev subtask.** `QA Cycle N` subtasks are auto-duplicates and appear in `Related QA Subtasks`, never as their own row.
- **Do not sum the defect columns.** Windows sharing a bundled subtask repeat that subtask's totals.

## Requirements

Set as Windows user environment variables (restart the app after changing):
`ATLASSIAN_SITE_URL`, `ATLASSIAN_USER_EMAIL`, `ATLASSIAN_API_TOKEN`.

The script exits with a clear message if any is missing. Never put the token in a file inside OneDrive.

The `Vision NG - Grouping` SharePoint library must be synced locally with **Always keep on this device** — otherwise the workbooks read as empty placeholders.
