const ExcelJS = require('./config.js').req('exceljs');
const R = require(require('./config.js').local('rows.json'));
const G = require(require('./config.js').local('gathered.json'));
const { dashStatus } = require('./status.js');
const OUT = require("./config.js").MASTER;
const JB = 'https://ocsuperiorcourt.atlassian.net/browse/';
const DLURL = 'https://occourts.sharepoint.com/sites/Vision_ILJ/General%20Documentation/Knowledge%20Sharing%20Documents/Vision%20Team%20Knowledge/Vision%20NG%20-%20Grouping/QA%20Defect%20Logs/';
// 7424/7425 now live in Master Tracking as Canceled rows (W#11/W#12).
const EXCLUDE = ['VISAR-7358','VISAR-7127','VISAR-6749','VISAR-6663','VISAR-6205','VISAR-7414'];

const COLS = [['Sprint #','sprint',11],['Track','track',9],['Group Label','groupLabel',14],['Main AR','mainAR',12],['Subtask','subtask',12],['Related QA Subtasks','related',30],['UAT Subtask','uatSub',12],
 ['W#','W',7],['Menu Group','menu',14],['Window Name','name',30],['Object Name','obj',30],['Grouping','grouping',12],
 ['Status','status',17],['Jira Status','jira',17],['QA Cycle','qaCycle',9],['Dev','dev',6],['BSA','bsa',6],
 ['Date Started','started',12],['To QA','toQA',11],['2 Week Start','twoWk',12],['Target Date','target',12],['To UAT','toUAT',11],
 ['UAT Start','uatStart',11],['Signed Off','signedOff',11],['Deployed','deployed',11],['Build #','build',12],
 ['LOE to QA','loeToQA',10],['Development','hDev',12],['QA Test','hQA',9],['Mitigation','hMit',10],['UAT','hUAT',7],['Total Hours','hTotal',10],
 ['Open Defects','openD',12],['Total Defects','totD',12],['Defect Log','dlFile',28],
 ['On Dashboard','onDash',13],['In Planning','inPlanning',12],['No UAT (Internal)','noUAT',16],['Dev LOE (d)','loeDev',11],['QA LOE (d)','loeQA',11],['Total LOE (d)','loeTotal',12],['Total Usage','usage',11],
 ['Legacy Status','legacy',18],['Metrics Status','metricsStatus',20],['Source','source',16],['Match Method','matchMethod',18],['Match Confidence','matchConf',15],['Overridden','overridden',18]];

const HDR = {fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FF1F3864'}},font:{bold:true,color:{argb:'FFFFFFFF'},size:10},
  alignment:{vertical:'middle',horizontal:'center',wrapText:true}};

function sheet(wb,name,cols){
  const ws = wb.addWorksheet(name,{views:[{state:'frozen',ySplit:1}]});
  ws.columns = cols.map(c=>({header:c[0],key:c[1],width:c[2]}));
  ws.getRow(1).eachCell(c=>Object.assign(c,HDR));
  ws.getRow(1).height = 30;
  return ws;
}

(async () => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NG PM Automation';

  const ws = sheet(wb,'Master Tracking',COLS);
  // A patch has no window, so its hours are just its own subtask's log.
  const HRS = require('./hours.js');
  const patchHours = k => { const h = G.hours && G.hours[k]; const t = h ? HRS.combine([{key:k, ...h}]) : null;
    return t && t.entries ? {hDev:t.dev, hQA:t.qa, hMit:t.mit, hUAT:t.uat, hTotal:t.total} : {}; };
  const patchRows = Object.values(G.derived).filter(d=>d.isPatch).map(d=>({
    W:'', sprint:'Patch', track:'Patch', groupLabel:'Patch', mainAR:'VISAR-7396', subtask:d.key, related:'', menu:'',
    name:d.summary.replace(/^NG PATCH - /,''), obj:'', grouping:'',
    status: dashStatus(d.jira, {everQA:d.qaEntries>0, started:!!d.started}),
    jira:d.jira, qaCycle:d.qaEntries, dev:'', bsa:'', started:d.started, toQA:d.toQA,
    twoWk:'', target:'', toUAT:d.toUAT, uatStart:'', signedOff:'', deployed:'', build:'',
    loeDev:'', loeQA:'', loeTotal:'', usage:'', hDev:'', hQA:'', hMit:'', hUAT:'',
    openD:'', totD:'', dlFile:'', onDash:'Y', noUAT:'', legacy:'', metricsStatus:'',
    source:'VISAR-7396 (Patch)', matchMethod:'Direct', matchConf:'High', overridden:'', ...patchHours(d.key)}));

  const all = [...R.rows, ...patchRows];
  all.forEach(r => {
    const row = ws.addRow(r);
    [['subtask',r.subtask],['mainAR',r.mainAR],['uatSub',r.uatSub]].forEach(pair => {
      const k = pair[0], v = pair[1];
      if (v) { const c = row.getCell(k); c.value = {text:v,hyperlink:JB+v}; c.font={color:{argb:'FF0563C1'},underline:true,size:10}; }
    });
    if (r.dlFile) {
      const c = row.getCell('dlFile');
      c.value = {text:r.dlFile.replace(/^QA Defect Log - /,'').replace(/\.xlsx$/,''), hyperlink:DLURL+encodeURIComponent(r.dlFile)};
      c.font = {color:{argb:'FF0563C1'},underline:true,size:10};
    }
    const fill = a => row.eachCell({includeEmpty:true}, c => c.fill={type:'pattern',pattern:'solid',fgColor:{argb:a}});
    if (r.status==='Not Started') fill('FFF2F2F2');
    else if (r.status==='Canceled') fill('FFFCE4E4');
    else if (r.status==='Deployed') fill('FFE8F4E8');
    row.getCell('status').font = {bold:true,size:10};
    row.height = 15;
  });
  ws.autoFilter = {from:{row:1,column:1},to:{row:1,column:COLS.length}};
  ws.views = [{state:'frozen',xSplit:5,ySplit:1}];

  const cw = sheet(wb,'Crosswalk',[['W#','W',8],['Window Name','name',32],['Object Name','obj',32],['Dev Subtask','key',13],
    ['Jira Title','sum',52],['Match Method','m',20],['Confidence','c',12],['Related QA Subtasks','rel',36]]);
  R.rows.filter(r=>r.subtask).forEach(r => {
    const d = G.derived[r.subtask] || {};
    const row = cw.addRow({W:r.W,name:r.name,obj:r.obj,key:r.subtask,sum:d.summary||'',m:r.matchMethod,c:r.matchConf,rel:r.related});
    const c = row.getCell('key');
    c.value = {text:r.subtask,hyperlink:JB+r.subtask};
    c.font = {color:{argb:'FF0563C1'},underline:true,size:10};
    if (r.matchConf==='Medium') row.getCell('c').fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF2CC'}};
  });
  cw.autoFilter = {from:{row:1,column:1},to:{row:1,column:8}};

  const rc = sheet(wb,'Reconciliation',[['W#','W',8],['Window Name','name',30],['Subtask','key',13],['Issue','issue',42],['Derived','d',22],['Your Record','y',22],['Action','a',30]]);
  let n = 0;
  R.rows.filter(r=>r.subtask).forEach(r => {
    if (r.legacy && r.status && !r.legacy.toLowerCase().includes(r.status.toLowerCase().split(' ')[0])) {
      rc.addRow({W:r.W,name:r.name,key:r.subtask,issue:'Derived status differs from Pipeline col G',d:r.status,y:r.legacy,a:'Confirm correct status'}); n++;
    }
    if (r.toQA && !r.twoWk && r.status!=='Deployed' && r.status!=='Canceled') {
      rc.addRow({W:r.W,name:r.name,key:r.subtask,issue:'Reached QA but no 2 Week Start trigger',d:'(blank)',y:r.toQA,a:'Enter 2 Week Start manually'}); n++;
    }
    if (r.status==='Deployed' && !r.deployed) {
      rc.addRow({W:r.W,name:r.name,key:r.subtask,issue:'Deployed but no Deployed date',d:r.build||'(no build)',y:'',a:'Enter Deployed date'}); n++;
    }
    if (r.toUAT && !r.uatStart) {
      rc.addRow({W:r.W,name:r.name,key:r.subtask,issue:'In/through UAT but no UAT Start date',d:r.toUAT,y:'',a:'Enter UAT Start manually'}); n++;
    }
  });
  rc.autoFilter = {from:{row:1,column:1},to:{row:1,column:7}};

  const ex = sheet(wb,'Excluded Subtasks',[['Subtask','key',13],['Title','sum',60],['Jira Status','st',18],['Reason','why',42]]);
  EXCLUDE.forEach(k => {
    const d = G.derived[k]; if (!d) return;
    const why = /Test Subtask/i.test(d.summary) ? 'Test artifact - not a window'
      : /EXCLUDED/i.test(d.summary) ? 'Marked EXCLUDED in Jira; window not in Pipeline'
      : /\(2 windows\)/.test(d.summary) ? 'Superseded by per-window subtasks'
      : 'Project admin task - not a window';
    ex.addRow({key:d.key,sum:d.summary,st:d.jira,why});
  });

  const fn = sheet(wb,'Field Notes',[['Field','f',24],['Derivation','d',98]]);
  [['Status','Dashboard status derived from the DEV subtask. Subtask Completed = Deployed; In QA = In QA - BSA; work statuses after QA = In QA - Dev; before QA = In Development.'],
   ['(status mapping)','In Unit Test, In Progress w/Users and In Progress w/Vision are all treated as development.'],
   ['Sprint #','What the window DEPLOYS WITH: SG1, SG2, ... for sprint-bound work; Internal for a standalone internal window; Patch; TBD when planned but the group is undecided; blank when not yet planned. This is the deployment grouping key - a build for SG1 is every row where Sprint # = SG1, both tracks.'],
   ['Track','What PROCESS the window follows: User, Internal or Patch. Set from Pipeline col H (X = Internal) and confirmed at Planning. Only Track = User runs the two-week UAT countdown and the UAT workflow.'],
   ['Group Label','Computed display string only - never edit. SG1 + Internal shows as "SG1 Internal"; a standalone internal window shows as "Internal".'],
   ['Subtask','The DEV subtask. QA-cycle duplicates are listed in Related QA Subtasks.'],
   ['QA Cycle','Metrics col U for pre-process windows (Metrics rows 2-40); count of transitions into In QA for all others.'],
   ['Date Started','First transition into Subtask In-Progress.'],
   ['To QA','First transition into In QA.'],
   ['2 Week Start','First transition OUT of In QA to any status. Blank = clock never triggered. Not set for Internal (No UAT) windows.'],
   ['Target Date','2 Week Start + 14 calendar days. Always blank when Track is not User - those windows deploy with their sprint instead of against a date.'],
   ['To UAT','First transition into In UAT.'],
   ['UAT Start','Metrics col Z, plus the dashboard Sent to UAT section (Actual UAT Start date). Blank = UAT not started.'],['Deployed','Metrics col AC (Deploy Date).'],['Signed Off','No source yet - manual entry until the PDC comment workflow starts.'],
   ['UAT Subtask','The UAT fix subtask (UAT - SG# - Window - object), created by uatinit.js when the UAT Defect Log has defects at Fix In-Progress. The open one if any, otherwise the most recent. One per dev subtask.'],
   ['Development / QA Test / Mitigation / UAT','Hours from the Hours Log table in the Jira descriptions, since 2026-09-23 (the Metrics sheet is no longer used). The column an entry is typed in decides the bucket. A window adds up its dev subtask, its UAT subtask(s) and their QA copies; rows a QA copy inherited from the dev subtask are not counted twice. Re-read every refresh, so an edited entry changes the total. Shown once on decimal rows sharing a subtask.'],
   ['Total Hours','Development + QA Test + Mitigation + UAT.'],
   ['Open / Total Defects','DEFECTS sheet of the matched log. Open = New, Return to Dev / Returned to Dev, Retest In Progress.'],
   ['Dev/QA/Total LOE, Total Usage','Pipeline columns Dev LOE, QA LOE, Total LOE, Total Usage (found by header) - original estimates in days and 1-year usage count. Reference only.'],
   ['Legacy Status','Pipeline col G - your previous manual status, kept for cross-check.'],
   ['Overridden','Fields pinned by hand that beat the Jira-derived value. The refresh skill must never overwrite a field named here.'],
   ['Source','Pipeline = present in Pipeline sheet; Metrics only = completed window removed from Pipeline.']
  ].forEach(p => fn.addRow({f:p[0],d:p[1]}));
  fn.getColumn('d').alignment = {wrapText:true,vertical:'top'};

  await wb.xlsx.writeFile(OUT);

  // Snapshot exactly what we just wrote, so the next refresh can tell a hand edit
  // apart from a derived value that legitimately changed.
  const SNAPF = ['sprint','status','qaCycle','dev','bsa','started','toQA','twoWk','target',
                 'toUAT','uatStart','signedOff','deployed','build','loeToQA','hDev','hQA','hMit','hUAT'];
  const snap = {};
  all.forEach(r => {
    const key = r.W || r.subtask; if (!key) return;
    const o = {}; SNAPF.forEach(f => o[f] = String(r[f] ?? ''));
    snap[key] = o;
  });
  const CW = require('./config.js'), fsw = require('fs'), osw = require('os');
  fsw.writeFileSync(CW.shared('last-write.json'), JSON.stringify(snap, null, 1));

  // Fingerprint of the file just written, plus the ones before it. preserve.js uses the history
  // to spot a Master Tracking that OneDrive has not yet updated to another runner's latest write.
  const MF = CW.shared('last-write.meta.json');
  let meta = {}; try { meta = JSON.parse(fsw.readFileSync(MF, 'utf8')); } catch (e) {}
  const history = [meta.hash, ...(meta.history || [])].filter(Boolean).slice(0, 30);
  fsw.writeFileSync(MF, JSON.stringify({ hash: CW.sha(OUT), history,
    who: `${osw.userInfo().username}@${osw.hostname()}`, at: new Date().toISOString() }, null, 1));

  console.log('WROTE: ' + OUT);
  console.log('Master Tracking: ' + all.length + ' rows (' + R.rows.length + ' windows + ' + patchRows.length + ' patch)');
  console.log('Crosswalk: ' + R.rows.filter(r=>r.subtask).length + ' | Reconciliation: ' + n + ' | Excluded: ' + EXCLUDE.length);
})().catch(e => { console.error('ERR', e.stack); process.exit(1); });
