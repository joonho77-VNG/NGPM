---
name: ng-sprint-planning
description: Plan and initiate Vision NG sprints - add windows to the Sprint Planning worksheet, create their Jira subtasks and QA defect logs, and assign Dev/BSA once the Lead Developer has filled them in. Use when the user says "add W# 102, 103 to planning", "put windows 5 to 5.9 into sprint planning", "create the subtasks for SG3", "initiate SG3", "assign SG3", "assign these windows", "show sprint planning", "what's in planning", "execute the planning", or "remove W# 104 from planning".
---

# Sprint Planning

Takes a window from "we should do this next" to "a developer has it in Jira".

**File:** `…\Vision NG - Grouping\Vision NG - Sprint Planning.xlsx`, sheet `Sprint Planning`.
**Scripts:** `scripts/` in this project folder. Run every command from the project root.

## The four stages

| # | Stage | Who | Command |
|---|---|---|---|
| 1 | Put windows in the worksheet | user, or asks you | `node scripts/planning.js add 5-5.9` |
| 2 | Set **Sprint #** on each row | **user, by hand** | — |
| 3 | Create subtask + defect log | you, on request | `node scripts/initiate.js <W#>` |
| 4 | Assign Dev / BSA | you, once stage 3's columns are filled | `node scripts/assign.js --apply` |

Stages 2 and 4's inputs are human judgment — Sprint #, Dev, BSA and DEV LEAD LOE are **never
inferred**. Both scripts refuse a row that is missing them and say which.

The user may also fill the whole worksheet out and ask for it to be executed end to end. That is
stage 3 for every row that has a Sprint #, then stage 4 for every row that also has Dev/BSA/LOE.
Run the stages in order and report each; do not collapse them into one silent pass.

After any stage, run the dashboard refresh so the master picks it up.

## Columns

| Column | Filled by |
|---|---|
| Sprint # | **user, by hand** |
| Subtask | stage 3, written back automatically |
| W#, Menu Group, Window / Subscreen Name, Object Name, Grouping | auto, from the master |
| Dev, BSA | **Lead Developer / Lead BSA, by hand** |
| DEV LEAD LOE | **Lead Developer, by hand** — days to first QA |
| Subtask Status | auto, every refresh (`planning.js status`) — see below |

The team keeps its own columns after DEV LEAD LOE (Orig LOE, a hand-kept Status, notes). Scripts
read columns A–J by position, so **never insert a column before K**. Subtask Status is found by its
header and was added past the last used column. It never overwrites a value it did not write; it
reports one with `!` instead.

**Subtask Status (2026-10-26):** `Active` = the Jira subtask has left Subtask Created (On-Hold,
Backlog and Canceled don't count). `Ready` = Subtask, Dev and DEV LEAD LOE all filled, not yet
started. `Planning` = any of those three missing. The worksheet is saved only when a value changes,
and is skipped while it is open.

## Stage 1 — `planning.js`

| Command | Effect |
|---|---|
| `add 102,103,110` | append windows; accepts ranges (`102-111`) and decimals (`105.1`) |
| `list` | show the worksheet, what still needs manual entry, and what is ready to assign |
| `remove 104` | pull a window back out (refuses if it already has a subtask) |

`add` rejects a window that is unknown, already present, already has a subtask, or is canceled.
**Report every rejection** — never silently drop one.

## Stage 3 — `initiate.js` — the first write to Jira

```bash
node scripts/initiate.js 102
```

One window per run, by design: it doubles as the failure boundary. Add `--dry-run` to see the exact
plan first — **always dry-run a window the user has not initiated before.**

Four steps, each independently checked:

1. copy `QA Defect Log - Template.xlsx` → `QA Defect Log - <Window Name>.xlsx`
2. create the subtask — parent `VISAR-6166`, type `Subtask-Vision Team` (10315), **unassigned**,
   summary `<Sprint #> - <Window Name> - <object_name>`
3. set the description — "Defect Sheet" + link, the hours-log instructions, and a 7-column ×
   16-row table (`Hours` spanning 6 columns, plus `Note`; 14 blank entry rows)
4. write the new key into the worksheet's `Subtask` column

**It is idempotent.** An existing defect log is never overwritten; an existing subtask is never
duplicated (found via the worksheet, or by exact-summary search if the write-back never happened);
a description already present is left alone. A run that dies half way can simply be run again.

If the worksheet is open in Excel, the Jira work still completes and the script prints the key
rather than failing after the write. Put that key in the sheet, or re-run once Excel is closed.

Defect-sheet links use the **direct library path** (`config.js` → `DEFECT_URL` + filename), not
SharePoint's `?d=<guid>` Copy-link form — that GUID only exists after the file syncs.

## Stage 4 — `assign.js`

```bash
node scripts/assign.js                 # dry run over every ready row
node scripts/assign.js --apply         # assign them
node scripts/assign.js 102 --apply     # just one
```

Dry run is the default — the opposite of `initiate.js`, because this one acts on many rows at once.

Sets, from the convention already in flight:

- **assignee** = Dev
- **Project Team** (`customfield_10375`) = [Dev, BSA]

It never overwrites an assignee or a Project Team that is already set, and it does **not** transition
status — a developer starting work does that. **DEV LEAD LOE is deliberately not written to Jira**;
it lives in the worksheet and the master only. Initials resolve through `NG Dashboard State/roster.json`; an unknown
one is reported, not guessed.

## How planning shows in the master

Any worksheet row whose window is still `Not Started` gets `Status` = **In Sprint Planning**,
`In Planning` = `Y`, and its Sprint #, Dev, BSA and LOE carried across where the master has none.

A subtask alone does **not** end this. A created-but-unassigned subtask derives to `Not Started`,
so it stays "In Sprint Planning" — which is correct: it is still waiting on a developer. The row
stops driving status once work actually starts, but its Sprint #, Dev, BSA and LOE still fill
**blanks** on that row (since 2026-10-21), e.g. a subtask created by hand with no SG in its title.

## The one thing not to break

**The Lead Developer edits this worksheet.** It is rewritten from its own data on every
`add`/`remove`, so *values* survive — but hand-added formatting, comments or extra columns will not.
Never regenerate it from scratch, and never write to it while they have it open; the scripts refuse
with a clear message when the file is locked.

## Writes

`initiate.js` and `assign.js` are the only scripts in this project that write to Jira, along with
`setteam.js` (Project Team backfill on existing subtasks, `--apply` to write) and `uatinit.js`
(UAT fix subtasks and comments; every real dashboard refresh runs it with `--apply` automatically,
see the refresh-ng-dashboard skill). Everything else in the refresh is read-only. `initiate.js` and `uatinit.js` build their
hours table from `adf.js`, which is the layout `hours.js` reads back - change it there, not inline.

**Jira subtasks cannot be deleted, only canceled.** Confirm scope with the user before a batch, and
prefer `--dry-run` / the default dry run when anything about the request is ambiguous. A note in a
meeting file is the user's shorthand, never authorization to write.
