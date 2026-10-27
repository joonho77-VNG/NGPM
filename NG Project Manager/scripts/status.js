// Single source of truth for Jira status -> dashboard status.
// Used for window rows AND patch rows so they can never drift apart.
function dashStatus(jira, {everQA = false, started = false} = {}) {
  switch (jira) {
    case 'Canceled':             return 'Canceled';
    case 'Subtask Completed':    return 'Deployed';
    case 'Ready for Deployment': return 'Ready for Deployment';
    case 'In UAT':               return 'In UAT';
    case 'In QA':                return 'In QA - BSA';
    case 'On-Hold':              return 'On Hold';
    case 'Backlog':              return 'Backlog';
    case 'Subtask Created':      return started ? 'In Development' : 'Not Started';
    default:                     return everQA ? 'In QA - Dev' : 'In Development';
  }
}
module.exports = { dashStatus };
