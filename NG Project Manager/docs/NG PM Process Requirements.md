# Vision NG Project Management Automation Requirements

## 1. Purpose

Provide a repeatable project-management process for the Vision NG migration and automate the collection, reconciliation, and publication of status and metric data. The system shall track every migrated window from prioritization through deployment and publish a shared project dashboard.

The project migrates Orange County Superior Court's legacy PowerBuilder case-management application to a Blazor application using Syncfusion components. The process is transitioning from pilot work to sprint-based delivery.

## 2. Goals and Scope

### Goals

- Maintain a single Master Tracking Sheet for each in-scope window/subtask.
- Create and organize Jira work items by sprint, internal work, and post-deployment patches.
- Reconcile Jira history, Jira notes, time logs, and SharePoint defect logs into the Master Tracking Sheet.
- Publish a current, self-contained HTML dashboard for team visibility.
- Preserve an auditable history of tracking-sheet changes and require approval before refresh changes are applied.

### Out of Scope

- Automating business prioritization, sprint composition, estimates, or staff assignments.
- Deploying a web application or requesting infrastructure changes.
- Replacing Jira, SharePoint, or the existing defect-log template.

## 3. Roles

| Role | Initials | Person |
| --- | --- | --- |
| Lead BSA | CC | Joonho Chris Chang |
| Lead Developer | JL | Jorge Lichtenstein |
| BSA | DC | David Chang |
| BSA | CL | Cung Le |
| BSA | BY | Brooke Yale |
| Developer | JC | JinLiang Tony Chen |
| Developer | CN | Chris Nguyen |
| Developer | MC | Menekou Coulibaly |
| Developer | SM | Santiago Morales |
| Developer | KH | Kyeng Kenny Hwang |
| Developer | SS | Sameer Sarangi |
| Developer | NV | Nathan Vuong |
| Project Delivery Coordinator | MU | Melanie Uyehara |

The automation shall use initials in worksheets and time logs, and the corresponding full name when assigning Jira users.

## 4. Delivery Lifecycle

| Stage | Business purpose | Entry condition | Exit condition |
| --- | --- | --- | --- |
| Priority Planning | Rank the 200+ legacy windows by business priority. | User selects windows and priority order. | User moves selected priorities to Sprint Planning. |
| Sprint Planning | Group windows into sprints, assign staff, and estimate LOE. | Prioritized windows are selected. | Required planning fields are complete and the user initiates a sprint. |
| In Development | Complete analysis, design, implementation, unit testing, peer review, and first QA cycle. | Jira subtask begins work. | First QA round completes; normally starts the UAT countdown. |
| Committed to UAT Date | Track the two-week commitment before UAT. | First QA completion triggers the countdown. | Jira subtask enters UAT, or an approved exception returns it to development. |
| Sent to UAT | Coordinate UAT through sign-off. | Jira subtask enters UAT. | A build is scheduled for signed-off work. |
| To Be Deployed | Group signed-off sprint work for a scheduled build. | Build date and build number are supplied. | Deployment completes and deployed date is recorded. |

## 5. Jira Organization Rules

- Each user-facing sprint shall have its own Main AR. Each sprint window shall be a Jira subtask under that Main AR.
- Existing Main AR `VISAR-6166` is the legacy single-parent arrangement and shall not be used for newly planned sprints.
- Internal configuration and maintenance work shall be subtasks of `VISAR-7398` and use sprint value `Internal`.
- Post-deployment patch work shall be subtasks of `VISAR-7396` and use sprint value `Patch`.
- Internal and Patch work shall not enter the two-week UAT countdown or UAT workflow. After successful BSA QA, it shall move from `In QA` to `Ready for Deployment`.

## 6. Authoritative Data Sources

| Data | Source | Automation use |
| --- | --- | --- |
| Window ID, menu group, window name, object name, grouping | Vision NG Grouping inventory workbook in SharePoint | Populate planning and tracking records. |
| Main AR, subtask fields, assignees, status, status history, internal notes, description | Jira Cloud VISAR project | Create work, determine lifecycle dates and dashboard status, read time-log table and UAT notes. |
| Defect status and defect totals | SharePoint QA Defect Logs folder | Calculate defect counts for each window. |
| Deployment date and build number | User input when a build is scheduled | Populate Master Tracking and deployment dashboard data. |
| Master Tracking, Priority Planning, Sprint Planning, change history | Defined workbook location (TBD) | Persist workflow data and audit trail. |

## 7. Master Tracking Sheet

The Master Tracking Sheet is the system of record for dashboard rows. The automation shall create one row per Jira subtask/window and maintain the following fields.

| Field | Requirement |
| --- | --- |
| Sprint # | `SG##` for user-facing sprint work; `Internal` or `Patch` for exceptions. |
| Main AR / Subtask | Jira issue keys for the parent and window subtask. |
| W#, Menu Group, Window Name, Object Name, Grouping | Copied from the inventory master. |
| Status | Derived dashboard status defined in Section 8. |
| QA Cycle | Count of transitions into Jira `In QA`. |
| Dev / BSA | Assigned team members. |
| Date Started | First transition into `Subtask in Progress`. |
| To QA | First transition into `In QA`. |
| 2 Week Start | First qualifying transition from `In QA` to `In Progress`. |
| Target Date | Two Week Start plus 14 calendar days, adjusted by approved extensions. |
| To UAT | Transition date into `In UAT`. |
| UAT Start / Signed Off | Dates parsed from PDC internal notes using an agreed format. |
| Deployed / Build # | Values provided when deployment is scheduled or completed. |
| LOE to QA | Planning estimate supplied by Lead Developer. |
| Development / QA Test / Mitigation / UAT | Totals from the subtask description's hour-log table. |
| Open Defects | Defect-log rows with status `New`, `Return to Dev`, or `Retest in Progress`. |
| Total Defects | Count of all defect-log rows. |
| Defect Log URL | Link to the associated SharePoint defect log. |

## 8. Dashboard Status Rules

| Dashboard status | Derivation |
| --- | --- |
| On Hold | Jira status is `On Hold`. |
| Backlog | Jira status is `Backlog`. |
| In Development | Jira is `Subtask in Progress` and has never entered `In QA`. |
| In QA - BSA | Jira status is `In QA`. |
| In QA - Dev | Jira moved from `In QA` to `In Progress`. |
| In UAT | Jira status is `In UAT`. |
| Ready for Deployment | Jira status is `Ready for Deployment`. |

## 9. Functional Requirements

### FR-1: Add Priority Planning Windows

1. On a user request identifying one or more window IDs or a range, retrieve matching window data from the inventory master.
2. Add each matching window to Priority Planning with `Priority`, `W#`, `Menu Group`, `Window Name`, `Object Name`, and `Grouping`.
3. Assign the next available priority number in the order requested.
4. Reject unknown, duplicate, or malformed window IDs and report them without changing the list.

### FR-2: Move Windows to Sprint Planning

1. On a user request identifying priority numbers or a priority range, copy the corresponding records to Sprint Planning.
2. Sprint Planning shall contain `Sprint #`, `Main AR`, `Subtask`, `W#`, `Menu Group`, `Window Name`, `Object Name`, `Grouping`, `Dev`, `BSA`, and `LOE to QA`.
3. Leave `Sprint #`, `Main AR`, `Subtask`, `Dev`, `BSA`, and `LOE to QA` blank until provided during planning.
4. Mark the source Priority Planning rows as moved and visually grey them out.

### FR-3: Initiate a User-Facing Sprint

1. On a user request to initiate sprint `SG##`, validate that each selected Sprint Planning row has values for Sprint #, W#, inventory attributes, Dev, BSA, and LOE to QA, and that Main AR and Subtask are blank.
2. If validation fails, report every failing row and field; do not create Jira or SharePoint artifacts.
3. Create one Main AR with title `SG## - Sprint ## Master`, department `Vision Internal Only`, supervisor/manager `Sendhivel Anandhajothi`, global approval `No Global Impact`, assignee `Joonho Chang`, and a description listing W#, Window Name, and Object Name for all sprint windows.
4. Create one subtask per window with title `SG## - [Window Name] - [Object Name]`.
5. Assign the designated developer, and add the designated developer and BSA to the Jira Project Team field.
6. Copy the approved hours-log table to the subtask description and add the associated defect-log link.
7. Create a defect-log workbook from the approved template named `Defect Log_SG##_[Window Name]` in the approved SharePoint defect-log folder.
8. Write the resulting Main AR and subtask keys to Sprint Planning and Master Tracking, then grey out the initiated Sprint Planning rows.
9. The operation shall be idempotent: a retry must identify prior Jira issues and defect logs rather than creating duplicates.

### FR-4: Assign Internal or Patch Work

1. On a request to assign an internal or patch window with developer and BSA initials, validate the window and roster values.
2. Create the subtask under `VISAR-7398` for Internal work or `VISAR-7396` for Patch work using the standard subtask, team, defect-log, time-log, and Master Tracking requirements.
3. Set Sprint # to `Internal` or `Patch`.
4. Exclude the record from the UAT countdown and UAT dashboard sections.

### FR-5: Refresh Master Tracking

1. For every undeployed subtask, read Jira status history, internal notes, descriptions, and its defect log.
2. Recalculate all derived dates, dashboard status, QA cycle, hour totals, and defect counts.
3. Record before-and-after values, timestamp, source evidence, and run identifier in an immutable change-history document or sheet.
4. Before applying changes, present a field-level change summary and obtain explicit user approval. Continue this approval mode until the user explicitly disables it.
5. After approval, apply only the reviewed changes and report any records that could not be reconciled.

### FR-6: Exceptions and Extensions

1. A QA-cycle exception shall remove the active two-week commitment and return the selected user-facing window to In Development until it next transitions from `In QA` to `In Progress`.
2. An approved extension shall add the user-specified number of days to the existing Target Date and retain the extension reason, approver, and date.

### FR-7: Publish Dashboard

1. On a user request or approved scheduled run, generate a self-contained HTML file titled `Vision NG Project Dashboard`.
2. Display the Pacific time date and time of the last successful refresh.
3. Include an In Development section with Sprint #, linked Subtask, linked W#, Menu Group, Window Name, Status, Grouping, Dev, BSA, Open Defects, Total Defects, and defect-log link.
4. Include a Committed to UAT section with Sprint #, linked Subtask, linked W#, Target Date with `D-##`, Window Name, Status, Grouping, Dev, BSA, Open Defects, Total Defects, and defect-log link.
5. Include a Sent to UAT section with Sprint #, linked Subtask, linked W#, To UAT variance from Target Date, Window Name, Object Name, Dev, BSA, UAT Start, Signed Off, and Build #. Display early/on-time values in green and late values in red.
6. Save the HTML output to an approved OneDrive or SharePoint document-library location and retain a dated prior version or archive.

## 10. Non-Functional Requirements

- Use least-privilege, organization-approved access to Jira and Microsoft 365; do not store API tokens in workbooks, source files, or the generated HTML.
- Use timezone-aware timestamps and calculate dashboard dates in Pacific time.
- Log every automated run, source error, skipped record, retry, and resulting output location.
- Prevent duplicate Main ARs, subtasks, defect logs, and Master Tracking rows on retries.
- Treat user-facing write actions as transactional where possible; otherwise create compensating cleanup or a reconciliation queue.
- Limit dashboard data to information appropriate for all team members who can access its SharePoint page.

## 11. Critical Decisions and Gaps

The following decisions are required before unattended automation can be safely implemented.

| Gap | Risk | Required decision |
| --- | --- | --- |
| Master workbook is not identified. | Automation has no authoritative location, table names, or concurrency model. | Specify the workbook/site/library, worksheet names, Excel table names, ownership, and editing rules. |
| Jira workflow names and transitions are assumed. | Status mapping and date derivation can fail if VISAR uses different names or transition paths. | Export the actual VISAR workflow, fields, transition IDs, and permissions. |
| "First QA complete" is inferred from `In QA` to `In Progress`. | Rework could accidentally start or restart the UAT clock. | Confirm the exact qualifying transition and whether it applies only after QA Cycle 1. |
| UAT start and sign-off rely on free-text internal notes. | Dates cannot be parsed reliably or audited consistently. | Require a structured Jira field, or mandate an exact comment token format such as `UAT Started: YYYY-MM-DD` and `UAT Signed Off: YYYY-MM-DD`. |
| Time log is a manually edited Jira-description table. | Concurrent edits and inconsistent formats can overwrite data or produce incorrect totals. | Prefer Jira worklogs/custom fields; otherwise lock down an exact table format, validation, and edit ownership. |
| Defect log schema and window-to-file lookup are not defined. | Counts may read the wrong workbook or statuses may not map. | Define SharePoint file ID/link in Master Tracking, worksheet/table names, status values, and blank/duplicate-row handling. |
| Build selection rule is incomplete. | Signed-off work may be assigned to the wrong build or omitted. | Define who selects a build's included subtasks, when Build # is set, and whether all sprint items must be signed off. |
| Dashboard section rules conflict with lifecycle wording. | Signed-off and ready-to-deploy windows could appear in the wrong section. | Define inclusion/exclusion rules for every dashboard status and the intended To Be Deployed view. |
| Approval is required for every refresh but the desired cadence is every few hours. | A fully unattended refresh is incompatible with manual approval. | Separate a scheduled read-only preview from a scheduled approved write mode, or designate pre-approved field classes. |
| Inventory-row deep links are requested without a row-addressing convention. | W# links may open the workbook but not the intended row. | Define a stable Excel table/range or a dedicated inventory record URL strategy. |
| Error and retry ownership is unspecified. | Partial Jira/SharePoint creation can orphan artifacts. | Define notification channel, retry policy, cleanup authority, and manual reconciliation procedure. |

## 12. Feasibility Assessment

### Overall Assessment

The approach is feasible without deploying a web server, provided the implementation is a scheduled Power Automate cloud flow or an approved automation host using Jira Cloud and Microsoft Graph/SharePoint APIs. The workstation, VPN, and Zscaler setup is suitable for interactive development and manual runs but is not a dependable unattended scheduler.

### Feasible Components

| Capability | Feasibility | Notes |
| --- | --- | --- |
| Read/write SharePoint-hosted Excel workbooks and defect logs | Feasible | Use Microsoft Graph or supported Power Automate Excel Online actions; tables must be structured and concurrency managed. |
| Create and query Jira Cloud issues | Feasible, subject to approval | Requires Jira REST API access, a service identity/API token or OAuth app, workflow permissions, and support for custom fields such as Project Team. |
| Create defect-log workbooks from template | Feasible | Use SharePoint/Graph copy actions and persist the resulting file URL/ID immediately. |
| Periodic data refresh | Feasible | Use a recurrence-triggered cloud flow or approved scheduler; it must not rely on an interactive AI coding session. |
| Generate and store static HTML dashboard | Feasible | A flow, script, or desktop automation can create the file in SharePoint/OneDrive. |
| Share the dashboard | Feasible with validation | A link to the HTML file is straightforward. Rendering arbitrary HTML in a modern SharePoint page may be restricted by tenant security policy and should be proved with a small pilot. |

### Environment Constraints

- An AI coding tool can build and run the automation interactively, but it is not itself a reliable scheduled execution service. Scheduled work needs Power Automate, an approved hosted runner, or an unattended Power Automate Desktop machine.
- A local scheduled script depends on the workstation being powered on, unlocked where required, connected to VPN, and allowed through Zscaler. It also creates a personal-account operational dependency.
- Power Automate's Jira integration, premium licensing, custom-field support, rate limits, and authentication model must be verified. A custom connector or HTTP action may be necessary.
- SharePoint Online often blocks active HTML/JavaScript rendering from document libraries and may not allow iframe embedding from OneDrive. The preferred no-server fallback is a SharePoint page populated with native web parts or a dashboard published as a static file through an organization-approved location.
- Existing workbook-heavy design is workable at the present scale, but Excel is not a transactional database. Use Excel tables, a single writer, optimistic concurrency checks, and a durable change journal.

## 13. Recommended Implementation Shape

1. Establish SharePoint locations and convert each worksheet used by automation into a named Excel table.
2. Build a small manual proof of concept that reads one Jira subtask, one defect log, and writes one Master Tracking row using the intended service identities.
3. Implement sprint and exception creation with idempotency keys and a reconciliation log before enabling bulk creation.
4. Standardize Jira comment tokens and the hour-log/defect-log schemas, or replace free-text inputs with structured Jira fields/worklogs.
5. Implement scheduled refresh as a read-only preview plus Teams approval, then commit reviewed changes and publish the dashboard.
6. Pilot the dashboard delivery method in the target SharePoint site before committing to self-contained HTML embedding.

## 14. Acceptance Criteria

- A requested valid window range is added to Priority Planning with inventory data and sequential priority values.
- A valid planned sprint creates exactly one Main AR, one subtask and one defect log per window, with correct assignments and links.
- A rerun after a partial failure does not duplicate Jira issues, defect logs, or Master Tracking rows.
- A refresh accurately derives QA cycles, statuses, dates, hour totals, and defect totals for a test set with known Jira histories and defect logs.
- No Master Tracking data is changed until the user approves the displayed field-level summary.
- The published dashboard displays the three required sections, correct links, Pacific-time refresh timestamp, target countdown, and UAT schedule variance.
- Internal and Patch work is excluded from UAT countdown/UAT sections and follows the Ready for Deployment path after QA.