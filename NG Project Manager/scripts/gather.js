const {jget,jql}=require('./jira.js'); const ExcelJS=require('./config.js').req('exceljs'); const fs=require('fs');
const { ROOT } = require('./config.js');
const {V}=require("./vx.js");
const {kindOf,objOf}=require('./kinds.js');
const HRS=require('./hours.js');

// --fresh ignores the changelog cache and re-pulls every subtask.
const FRESH=process.argv.includes('--fresh');
const CL=require('./changelog.js');

// Jira mistakes the refresh must not read as real history. Both count as code changes.
// BOUNCE: status changes to ignore on a subtask, as [from, to] timestamp ranges (Jira local time, compared as text).
// DUPLICATE: subtasks created twice by mistake; dropped from the pull entirely.
const BOUNCE={
  // 2026-10-26: W#73 left In QA for 15 s and went straight back. Read literally, that is a finished
  // QA round: it started the two-week timer and counted QA Cycle 2. It also created VISAR-7555.
  'VISAR-7544':[['2026-10-21T16:10:15','2026-10-21T16:10:33']],
};
const DUPLICATE=new Set(['VISAR-7555']);   // second QA copy of W#73 (VISAR-7554 is the real one)

(async()=>{
 // ---- Metrics ----
 const mwb=new ExcelJS.Workbook(); await mwb.xlsx.readFile(`${ROOT}/Vision NG Metrics.xlsx`);
 const mws=mwb.worksheets[0]; const metrics=[];
 for(let r=2;r<=mws.rowCount;r++){const g=mws.getRow(r);
   const cell=g.getCell('D'); let key=V(cell).match(/VISAR-\d+/);
   if(!key&&cell.value&&cell.value.hyperlink) key=String(cell.value.hyperlink).match(/VISAR-\d+/);
   const o={row:r,W:V(g.getCell('C')),key:key?key[0]:'',sprint:V(g.getCell('B')),dev:V(g.getCell('E')),bsa:V(g.getCell('F')),
     name:V(g.getCell('G')),grp:V(g.getCell('H')),status:V(g.getCell('I')),devHrs:V(g.getCell('P')),qaHrs:V(g.getCell('Q')),
     cyc:V(g.getCell('U')),uat:V(g.getCell('Z')),rfd:V(g.getCell('AA')),build:V(g.getCell('AB')),depdt:V(g.getCell('AC')),notes:V(g.getCell('AD')),
     stage:['K','L','M','N','O'].map(c=>V(g.getCell(c)))};   // Stage 1-5 hours, for the Metric Analysis page
   if(o.W||o.name) metrics.push(o);}
 console.log('Metrics rows:',metrics.length,'| with key:',metrics.filter(m=>m.key).length);

 // ---- Complexity LOE (same workbook) ----
 // Per-window LOE in hours (cols B-F) for the windows delivered before sprint grouping, and the
 // grouping table in days (cols X-Z). Both are returned in DAYS, like the Pipeline Plan's LOE.
 const complexity={windows:[],table:{}};
 const cws=mwb.getWorksheet('Complexity LOE Tracking');
 if(cws) for(let r=3;r<=cws.rowCount;r++){const g=cws.getRow(r); const nm=V(g.getCell('B')), f=Number(V(g.getCell('F')));
   if(nm&&f) complexity.windows.push({name:nm,grp:V(g.getCell('C')),dev:Number(V(g.getCell('D')))/8,qa:Number(V(g.getCell('E')))/8,tot:f/8});
   const cat=V(g.getCell('X')), y=Number(V(g.getCell('Y'))), z=Number(V(g.getCell('Z')));
   if(cat&&y&&z&&!/^category$/i.test(cat)&&!V(g.getCell('V'))) complexity.table[cat.toLowerCase().replace(/[^a-z]/g,'')]={dev:y,qa:z};}
 console.log('Complexity LOE:',complexity.windows.length,'window(s),',Object.keys(complexity.table).length,'grouping(s)');

 // ---- Jira ----
 // The two parent searches are independent, so run them together.
 // `updated` is pulled purely to drive the changelog cache below; `description` carries the hours log.
 // DEPLOY = the Jira "Deployment Date" field, entered when a subtask moves to Ready for Deployment.
 const DEPLOY='customfield_10470';
 // timespent = Jira's own time tracking. A few BSAs logged QA hours there instead of in the
 // hours-log table (found 2026-10-13), so it is carried as a second source; see hours.js.
 const F='summary,status,assignee,updated,created,description,timespent,'+DEPLOY;
 const [all,patch]=await Promise.all([jql('parent=VISAR-6166',F), jql('parent=VISAR-7396',F)]);
 const raw=all.filter(r=>!DUPLICATE.has(r.key));
 const kind=r=>kindOf(r.fields.summary);
 const dev=raw.filter(r=>kind(r)==='dev'), qa=raw.filter(r=>kind(r)==='qa');
 const uat=raw.filter(r=>kind(r)==='uat'), uatqa=raw.filter(r=>kind(r)==='uatqa');
 console.log(`Jira: ${dev.length} dev / ${qa.length} QA-dup / ${uat.length} UAT / ${uatqa.length} UAT-QA / ${patch.length} patch`);

 // Changelogs come from changelog.js, which caches on the issue updated stamp and fetches in parallel.
 // activity.js reads the same cache, so each issue is pulled at most once per refresh.
 const targets=[...dev,...patch];
 const CLR=await CL.load(targets.map(r=>({key:r.key,updated:r.fields.updated})),{fresh:FRESH});
 console.log(`Changelogs: ${CLR.fetched} fetched / ${CLR.cached} cached`);

 const derived={};
 for(const r of targets){
   const h=CLR.data[r.key];
   const st=(h?h.hist:[]).flatMap(x=>x.items.filter(i=>i.field==='status')
     .map(i=>({ts:x.created,f:i.fromString,t:i.toString}))).sort((a,b)=>a.ts.localeCompare(b.ts))
     .filter(s=>!(BOUNCE[r.key]||[]).some(([a,b])=>s.ts>=a&&s.ts<=b));
   const f=p=>{const h=st.find(p);return h?h.ts.slice(0,10):''};
   derived[r.key]={key:r.key,summary:r.fields.summary,jira:r.fields.status.name,
     assignee:r.fields.assignee?r.fields.assignee.displayName:'',obj:objOf(r.fields.summary),
     started:f(s=>s.t==='Subtask In-Progress'), toQA:f(s=>s.t==='In QA'),
     qaEntries:st.filter(s=>s.t==='In QA').length,
     twoWk:f(s=>s.f==='In QA'&&s.t!=='In QA'),
     toUAT:f(s=>s.t==='In UAT'), rfd:f(s=>s.t==='Ready for Deployment'),
     done:f(s=>s.t==='Subtask Completed'), deployDate:r.fields[DEPLOY]||'', sg:(r.fields.summary.match(/SG\s*(\d+)/i)||[])[1]||'',
     isPatch:patch.some(p=>p.key===r.key), transitions:st.length};
 }
 // QA dups grouped by object + by explicit cycle count in title
 const qaByObj={}; qa.forEach(r=>{const o=objOf(r.fields.summary); if(o)(qaByObj[o]=qaByObj[o]||[]).push(r.key);
   });
 // UAT fix subtasks and their QA copies. Kept apart from the dev subtask: never a crosswalk
 // candidate and never a QA cycle of the window. build.js ties them back by object name.
 const brief=r=>({key:r.key,sum:r.fields.summary,obj:objOf(r.fields.summary),status:r.fields.status.name,
   assignee:r.fields.assignee?r.fields.assignee.displayName:'',created:r.fields.created.slice(0,10)});

 // Hours-log table from every description, QA copies included (hours.js explains why).
 const hours={}, hoursBad=[];
 [...raw,...patch].forEach(r=>{
   const h=HRS.parse(r.fields.description);
   if(h.bad.length) hoursBad.push(`${r.key} ${h.bad.join(', ')}`);
   hours[r.key]={kind:kind(r),obj:objOf(r.fields.summary),created:r.fields.created.slice(0,10),table:h.table,rows:h.rows,
     wl:Math.round((r.fields.timespent||0)/36)/100};
 });
 console.log(`Hours logs: ${Object.values(hours).filter(h=>h.table).length} tables, `
   +`${Object.values(hours).filter(h=>h.rows.length).length} with entries, ${hoursBad.length} with unreadable values`);
 hoursBad.forEach(b=>console.log('   ! hours not a number: '+b));

 fs.writeFileSync(require('./config.js').local('gathered.json'),JSON.stringify({metrics,complexity,derived,qaByObj,
   qaList:qa.map(r=>({key:r.key,sum:r.fields.summary,obj:objOf(r.fields.summary),status:r.fields.status.name})),
   uatList:uat.map(brief), uatQaList:uatqa.map(brief), hours, hoursBad},null,1));
 console.log('QA dup object groups:',Object.keys(qaByObj).length);
 console.log('WROTE gathered.json');
})().catch(e=>{console.error('ERR',e.stack); process.exit(1);});
