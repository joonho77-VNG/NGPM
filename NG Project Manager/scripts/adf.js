// Jira description building blocks (Atlassian Document Format), shared by initiate.js and
// uatinit.js so every subtask carries the same hours-log table that hours.js reads back.
const text = t => ({type:'text', text:t});
const para = t => t ? {type:'paragraph', content:[text(t)]} : {type:'paragraph'};
const cell = t => ({type:'tableCell', attrs:{}, content:[{type:'paragraph', content: t ? [text(t)] : []}]});
const link = url => ({type:'paragraph', content:[{type:'inlineCard', attrs:{url}}]});

// Instructions + the 7-column x 16-row table: "Hours" spanning 6 columns plus "Note", the
// column headers, then 14 blank entry rows.
function hoursLog() {
  const blank = () => ({type:'tableRow', content: Array.from({length:7}, () => cell(''))});
  return [
    para('Hours Log Sheet: Enter today’s date, initials and enter the hours you worked under each column for that date.'),
    para('If you forget to log your hours on a certain date, it’s okay, just add that hours to the date when you log another day. The amount of hours are what\'s being tracked, not the dates hours are spent on. '),
    para(),
    {type:'table', attrs:{isNumberColumnEnabled:false, layout:'center'}, content:[
      {type:'tableRow', content:[
        {type:'tableCell', attrs:{colspan:6}, content:[{type:'paragraph', content:[text('Hours')]}]},
        cell('Note')]},
      {type:'tableRow', content:['Date','Initials','Development','QA','Defect Mitigation','UAT',''].map(cell)},
      ...Array.from({length:14}, blank),
    ]},
  ];
}

const bullets = items => ({type:'bulletList', content: items.map(t => ({type:'listItem', content:[para(t)]}))});
const doc = content => ({type:'doc', version:1, content});

module.exports = { text, para, cell, link, hoursLog, bullets, doc };
