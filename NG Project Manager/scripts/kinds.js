// What kind of subtask a Jira summary names. One definition, shared by gather.js, activity.js
// and uatinit.js, so the three can never disagree about what counts as a QA copy.
//
//   dev     SG2 - Calendar Transfer - w_ct_m_cal_transfer
//   qa      QA - SG2 - Calendar Transfer - w_...      (the In QA automation's copy; BSAs may
//           QA 1 - ... / QA Cycle 2 - ...              still hand-number older ones)
//   uat     UAT - SG2 - Priors - w_ct_m_case_priors   (created by uatinit.js)
//   uatqa   QA - UAT - SG2 - Priors - w_...            (the automation's copy of a UAT subtask)
//
// Every one of them carries the window's object name, which is how it finds its window.
const QA  = /^\s*QA\s*(-|\s)*\s*(Cycle|Cycles)?\s*[\d,\s]*\s*-/i;
const UAT = /^\s*UAT\s*\d*\s*-/i;

const isQA  = s => QA.test(s);
const isUAT = s => UAT.test(s);
// A QA copy whose remainder, once the QA prefix is stripped, is itself a UAT subtask title.
const isUATQA = s => isQA(s) && UAT.test(String(s).replace(QA, ''));
const kindOf = s => isUATQA(s) ? 'uatqa' : isQA(s) ? 'qa' : isUAT(s) ? 'uat' : 'dev';
const objOf = s => { const m = String(s).match(/(w_[a-z0-9_]+)/i); return m ? m[1].toLowerCase() : null; };

// A UAT subtask is finished once it is Completed or Canceled; anything else is still open.
const CLOSED = new Set(['Subtask Completed', 'Canceled']);
const isOpen = status => !CLOSED.has(status);

module.exports = { isQA, isUAT, isUATQA, kindOf, objOf, isOpen, CLOSED };
