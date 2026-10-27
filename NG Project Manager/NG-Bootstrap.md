# Vision NG Project Manager — Bootstrap

**For the person:** put this file in any new, empty folder. Open that folder in Claude Code and say:

> Read NG-Bootstrap.md and set me up.

Claude walks you through everything. You'll need about 20 minutes, your Atlassian login, and your
work PC. Claude never asks you for your Jira token, and you don't paste it into the chat.

---

## Instructions for Claude

You are setting up this person's PC to run the Vision NG project automation. Everything important
already lives in a shared SharePoint library. Nothing is copied from another person's PC. Your job
is to connect this PC to the library, have the person put their own Jira credentials in place,
verify it all, and then move them into the real project folder.

Work through the phases in order. Tell the person which phase you're on. Don't skip a check because
something "probably" works. If a phase fails, stop, explain the fix in plain words, and re-check
before moving on.

### Ground rules for this setup

- **Never ask for, accept, read, echo or type the Jira API token.** If the person pastes it in chat
  anyway, don't use it. Tell them to revoke it at id.atlassian.com → Security → API tokens, create
  a new one, and set it with the Phase 3 steps. The token must never reach the chat, a file or a command you run.
- **Don't edit anything in the shared `NG Project Manager` folder** (scripts, skills, CLAUDE.md).
  It is one copy for the whole team. If shared code looks broken, report the exact error and tell
  the person to contact Joonho Chang, the project owner. Setup only changes this PC.
- **No Jira writes during setup.** The only commands you run against Jira are
  `scripts/setup.js` and `scripts/refresh.js --dry-run`. Both are read-only.
- The person installs software themselves. Tell them what to install, then verify it.

### Phase 1 — What the person needs (tell them all of this first)

Give them this checklist up front so they can start the slow parts in parallel:

1. **Access** to the SharePoint site `Vision_ILJ` → library path
   `General Documentation / Knowledge Sharing Documents / Vision Team Knowledge / Vision NG - Grouping`.
2. **Node.js LTS (18 or newer).** If it's not installed, get it from Software Center / Company
   Portal or IT, or from nodejs.org. They install it themselves, then fully quit and reopen Claude.
3. **Desktop Excel.** It's needed only for the UAT → QA defect-log sync. Everything else works without it.
4. **A Jira API token** for their own account, created at
   `https://id.atlassian.com/manage-profile/security/api-tokens` ("Create API token", any label such
   as "NG automation"). They keep it to themselves. Phase 3 says where it goes.

### Phase 2 — Sync the library to this PC

Check whether the library is already synced. Look under the user's home folder for a directory
starting with `OneDrive`, containing a folder whose name ends in `Vision NG - Grouping`, which
contains `NG Project Manager\scripts\setup.js`. Use a read-only listing. If it's found, record the
full path as LIB and skip to "Keep on device".

If it isn't found, have the person:
1. Open the library in the browser (Phase 1, item 1).
2. Click **Add shortcut to My files** in the toolbar. **Don't** use "Sync". The shortcut is what
   the scripts look for.
3. Wait for OneDrive to finish (the cloud icon in the system tray stops spinning), then tell you.

Check again. If it's still missing, ask them for the folder's full path. Later, the setup check
will need `NG_ROOT` set to that path, and the person sets that the same way as the Jira variables.

**Keep on device:** tell the person to right-click the `Vision NG - Grouping` folder in File
Explorer and choose **Always keep on this device**, then wait for the download to finish. Without
this, the scripts read empty placeholder files. Phase 4 verifies it.

### Phase 3 — Jira credentials (the person does this, not you)

The automation reads three Windows **user** environment variables. The person sets them. Give them
these instructions and let them choose either way.

**Option A — the Windows dialog.** Press Start, type `environment`, and choose **Edit environment
variables for your account**. Under *User variables* click **New** three times:

| Variable name | Value |
|---|---|
| `ATLASSIAN_SITE_URL` | `https://ocsuperiorcourt.atlassian.net` (no trailing slash) |
| `ATLASSIAN_USER_EMAIL` | their work email, exactly as they log in to Jira |
| `ATLASSIAN_API_TOKEN` | the token from Phase 1 |

**Option B — their own PowerShell window.** They open Windows PowerShell themselves. **Not through
you**, so the token never enters this conversation. Then they run:

```powershell
[Environment]::SetEnvironmentVariable('ATLASSIAN_SITE_URL', 'https://ocsuperiorcourt.atlassian.net', 'User')
[Environment]::SetEnvironmentVariable('ATLASSIAN_USER_EMAIL', 'their.email@occourts.org', 'User')
$t = Read-Host 'Paste Jira API token' -AsSecureString
[Environment]::SetEnvironmentVariable('ATLASSIAN_API_TOKEN', [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($t)), 'User')
```

Then **fully quit the Claude app**, including from the system tray, and reopen it in this same
folder. Running programs only see new environment variables after a restart. Ask them to say
"continue the NG bootstrap" when they're back.

Never put the token in a file, in the library, or in a command you run.

### Phase 4 — Install and verify

Run from LIB:

```bash
node "<LIB>/NG Project Manager/scripts/setup.js"
```

It is safe to re-run. It:
- checks Node, the library, and "Always keep on this device"
- installs packages into `~/.ng-pm` (per PC, never synced)
- checks Excel
- logs in to Jira with their credentials (read-only)
- checks the shared state files

Relay every `FAIL` and `WARN` line with its fix and help them through it. Then run
`setup.js --check` until it prints **All set**. A `WARN` for Excel is fine if they won't run the
UAT sync.

If the Jira check fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` or another certificate error,
that's the court's TLS inspection. Have the person add a fourth user variable,
`NODE_OPTIONS` = `--use-system-ca`, the same way they did in Phase 3. Then they restart Claude
and you re-run the check.

`npm ci` can fail because of a proxy. If it does, tell them to ask IT for access to
`registry.npmjs.org`. Don't work around proxy settings.

### Phase 5 — First run (read-only)

From `<LIB>/NG Project Manager`:

```bash
node scripts/refresh.js --dry-run
```

It should finish in under a minute and end with a `NG DASHBOARD REFRESH` report showing
`crosswalk conflicts 0`. Summarise the report for them in two or three lines. This proves the whole
pipeline works on this PC without writing anything.

If it prints `LOCKED:` or `STALE:`, a teammate is mid-refresh or OneDrive is still syncing. That
is normal. Wait a minute and re-run.

### Phase 6 — Move into the real project

This bootstrap folder was only for setup. Tell the person:

1. In Claude Code, start a **new session** and pick the folder
   `<LIB>\NG Project Manager` as the project folder. Give them the exact path.
2. Work there from now on. It loads the shared `CLAUDE.md` and two skills:
   - **refresh-ng-dashboard**, e.g. "refresh the NG dashboard", "process the meeting notes"
   - **ng-sprint-planning**, e.g. "add W# 102, 103 to planning", "initiate SG3", "assign SG3"
3. As a first check in the new session, ask "show sprint planning". This is read-only.
4. This bootstrap folder can be deleted.

### Phase 7 — Hand-off summary

End with a short summary for the person:
- **Done:** list what passed in setup.
- **Pending:** anything that still needs them or IT.
- **The hourly scheduled refresh** runs on Joonho's PC. They shouldn't create one of their own.
- **How the team shares this:**
  - The code, skills and state are shared, so edits reach everyone.
  - Only one person can refresh or write to Jira at a time, and the scripts enforce this.
  - Any Jira write asks for their confirmation first.
  - Tell the team before changing the shared scripts.
  - A token or password never goes into the library.
- **Not carried over from the original owner's PC** (tell them plainly):
  - past Claude conversations
  - the owner's claude.ai connectors (Google Drive, GitHub, Gamma), which they connect on their own account if they need them
  - the owner's artifacts and scheduled tasks
  - the optional `sqlcl` database MCP server. It's only needed for the window-usage SQL work. If
    they need it: install Oracle SQLcl, then `claude mcp add sqlcl -- "<path>\sqlcl\bin\sql.exe" -mcp`.
