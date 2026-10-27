const ExcelJS=require('./config.js').req('exceljs'); const fs=require('fs'); const path=require('path');
const pipe=require(require('./config.js').local('pipeline.json')); const G=require(require('./config.js').local('gathered.json'));
const { dashStatus } = require('./status.js');
const { ROOT } = require('./config.js');
const DL=`${ROOT}/QA Defect Logs`;
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');

// ---------- crosswalk ----------
const pByW={}, pByObj={};
pipe.forEach(p=>{pByW[p.B]=p; if(p.E)pByObj[p.E.toLowerCase().trim()]=p;});
const xwalk={};                       // W# -> {key, method, conf}
const conflicts=[];
// Manual crosswalk: windows that intentionally share a bundled subtask.
const MANUAL={
  '25.1':'VISAR-7012',                                                  // shares Priors
  '53':'VISAR-6315','53.3':'VISAR-6315',                                // Minutes bundle
};
// Windows reset to "never started" by user decision.
// 2026-09-22: W#52, 53.1, 53.2 were never worked on and never planned into a sprint.
// Returned to the not-started pool for future sprint planning; they leave the VISAR-6315
// bundle, which keeps W#53 and W#53.3. Their OVERRIDE two-week pins were removed at the
// same time - OVERRIDE is applied after RESET, so the timer would otherwise survive.
const RESET=new Set(['34','159','52','53.1','53.2']);
// Manual overrides: pinned values that WIN over anything derived from Jira.
// The refresh skill must never overwrite a field listed here.
const OVERRIDE = {
  // Minutes bundle - two-week countdown agreed to start 2026-09-18, not the Jira exit date.
  // 2026-09-22 meeting: moved SG1 -> SG2. Both rows carry the pin, which is the whole VISAR-6315
  // bundle, so the shared subtask cannot end up split across two sprints. The countdown is driven
  // by Track + twoWk, not by Sprint #, so the 2026-10-02 target is deliberately unchanged.
  '53':   {twoWk:'2026-09-18', sprint:'SG2'},
  '53.3': {twoWk:'2026-09-18', sprint:'SG2'},
  // Priors bundle (VISAR-7012)
  '25':   {twoWk:'2026-09-08'},
  '25.1': {twoWk:'2026-09-08'},
  // Exhibit List bundle (VISAR-7188)
  '55':   {twoWk:'2026-09-08'},
  '55.1': {twoWk:'2026-09-08'},
};
// Canceled windows that never reached the Pipeline sheet - metadata supplied from Jira + dashboard.
const EXTRA={
  '11':{name:'Calendar Transfer Notices', obj:'w_ct_m_cal_transfer_notice', menu:'3 - CALENDARING',
        grouping:'Medium',   loeDev:12, loeQA:6.5, loeTotal:18.5, usage:10},
  '12':{name:'Court Closure Transfer',    obj:'w_ct_m_cal_close_transfer',  menu:'3 - CALENDARING',
        grouping:'Low High', loeDev:'',  loeQA:'',  loeTotal:'',   usage:''},
};
G.metrics.filter(m=>m.key&&m.W).forEach(m=>{ xwalk[m.W]={key:m.key,method:'Metrics hyperlink',conf:'High'}; });
Object.values(G.derived).forEach(d=>{
  if(!d.obj) return; const p=pByObj[d.obj]; if(!p) return;
  const w=p.B;
  if(xwalk[w] && xwalk[w].key!==d.key){ conflicts.push({W:w,existing:xwalk[w].key,candidate:d.key,obj:d.obj,sum:d.summary}); return; }
  if(!xwalk[w]) xwalk[w]={key:d.key,method:'Object name match',conf:'Medium'};
});
Object.entries(MANUAL).forEach(([w,k])=>{ xwalk[w]={key:k,method:'Manual - bundled subtask',conf:'High'}; });
xwalk['11']={key:'VISAR-7424',method:'Manual - canceled window',conf:'High'};
xwalk['12']={key:'VISAR-7425',method:'Manual - canceled window',conf:'High'};
RESET.forEach(w=>{ delete xwalk[w]; });
// ---------- defect logs ----------
// Parsed once per refresh by defects.js and cached on (mtime,size).  activity.js reads the
// same cache, so the 35 workbooks are opened once between the two consumers, not twice.
const dlFiles=fs.readdirSync(DL).filter(f=>/\.xlsx$/i.test(f)&&!/Template/i.test(f));
const dlByName={}; dlFiles.forEach(f=>{dlByName[norm(f.replace(/^QA Defect Log - /i,'').replace(/\.xlsx$/i,''))]=f;});
// ---------- rows ----------
(async()=>{
 const D=require('./defects.js');
 const DSCAN=await D.scan(dlFiles, D.TODAY, process.argv.includes('--fresh'));
 console.log(`  defect logs: ${DSCAN.stats.parsed} parsed / ${DSCAN.stats.cached} cached / ${DSCAN.stats.skipped} untouched today`);
 const metByW={}; G.metrics.forEach(m=>{if(m.W)metByW[m.W]=m;});
 const wset=new Set([...pipe.map(p=>p.B), ...G.metrics.filter(m=>m.W).map(m=>m.W), ...Object.keys(EXTRA)]);
 const rows=[];
 for(const w of wset){
   const p=pByW[w]||null, m=metByW[w]||null;
   const x=xwalk[w]||null; const d=x?G.derived[x.key]:null;
   const e = EXTRA[w] || null;
   const internal = p && p.H==='X';
   const obj = p?p.E : (e?e.obj : (d?d.obj:''));
   const name = p?p.D : (e?e.name : (m?m.name:''));
   // defect log
   let dl=dlByName[norm(name)]||null;
   if(!dl){ const hit=Object.keys(dlByName).find(k=>k&&norm(name)&&(k.includes(norm(name))||norm(name).includes(k))); if(hit)dl=dlByName[hit]; }
   const dc = dl ? DSCAN.counts[dl] : null;
   // status
   let jira = d?d.jira:'';
   const status = d ? dashStatus(jira, {everQA:d.qaEntries>0, started:!!d.started}) : 'Not Started';
   // Track = what process the window follows.  Sprint # = what it deploys with. Two separate axes.
   const track = (d&&d.isPatch) ? 'Patch' : (internal ? 'Internal' : 'User');
   // Only Track=User runs the two-week UAT countdown.
   const twoWk = (d && track==='User') ? d.twoWk : '';
   let target=''; if(twoWk){const dt=new Date(twoWk+'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate()+14); target=dt.toISOString().slice(0,10);}
   // Sprint # from the Jira title when present; otherwise the dashboard overlay / Planning sets it.
   let sprint=''; if(track==='Patch') sprint='Patch'; else if(d&&d.sg) sprint=`SG${Number(d.sg)}`;
   // QA cycle : metrics authoritative for pre-process rows (<=40), else jira
   const preProcess = m && m.row<=40;
   const qaCycle = preProcess && m.cyc ? Number(m.cyc) : (d?d.qaEntries:'');
   rows.push({
     W:w, sprint, track, groupLabel:'', mainAR: d?(d.isPatch?'VISAR-7396':'VISAR-6166'):'', subtask:x?x.key:'',
     related:(obj&&G.qaByObj[obj]?G.qaByObj[obj].join(', '):''),
     menu: p?p.C:(e?e.menu:''), name, obj, grouping: p?p.F:(e?e.grouping:(m?m.grp:'')),
     status, jira, qaCycle,
     dev: m?m.dev:'', bsa: m?m.bsa:'',
     started:d?d.started:'', toQA:d?d.toQA:'', twoWk, target, toUAT:d?d.toUAT:'',
     // Completed windows (2026-10-13): Jira's Deployment Date field is the deploy date and beats Metrics.
     uatStart: m&&m.uat?m.uat:'', signedOff:'',
     deployed: (status==='Deployed'&&d.deployDate) ? d.deployDate : (m&&m.depdt?m.depdt:''), build: m?m.build:'',
     loeDev: p?p.M:(e?e.loeDev:''), loeQA: p?p.N:(e?e.loeQA:''), loeTotal: p?p.O:(e?e.loeTotal:''), usage: p?p.P:(e?e.usage:''),
     hDev:'', hQA:'', hMit:'', hUAT:'', hTotal:'',          // filled from the Jira hours logs below
     openD:dc?dc.open:'', totD:dc?dc.total:'', uatOpen:dc?(dc.uatOpen||0):'', uatRows:dc?(dc.uatRows||[]):[], dlFile:dl||'',
     noUAT: internal?'X':'', legacy:p?p.G:'', metricsStatus:m?m.status:'',
     source: e?'Jira (canceled)' : (p&&m?'Pipeline + Metrics' : p?'Pipeline' : 'Metrics only'),
     matchMethod:x?x.method:'', matchConf:x?x.conf:(d?'':'Unmatched'), metricsRow:m?m.row:''
   });
 }
 // ---------- hours (Jira hours-log tables; the Metrics sheet is no longer a source) ----------
 // A window's hours = every log on its dev subtask, its UAT subtask(s) and their QA copies,
 // bucketed by the column it was entered in. hours.js holds the rules, including the one that
 // stops a QA copy's inherited rows being counted twice.
 {
   const HRS = require('./hours.js');
   const objToDev = {};
   rows.filter(r => r.subtask).forEach(r => {
     if (r.obj) objToDev[r.obj.toLowerCase()] = r.subtask;
     const d = G.derived[r.subtask]; if (d && d.obj && !objToDev[d.obj]) objToDev[d.obj] = r.subtask;
   });
   const groups = {};
   Object.entries(G.hours || {}).forEach(([key, h]) => {
     const dev = h.kind === 'dev' ? key : objToDev[h.obj];
     if (dev) (groups[dev] = groups[dev] || []).push({ key, ...h });
   });
   let n = 0, skipped = 0;
   rows.filter(r => r.subtask && groups[r.subtask]).forEach(r => {
     const t = HRS.combine(groups[r.subtask]);
     skipped += t.skipped;
     if (!t.entries) return;
     Object.assign(r, { hDev: t.dev, hQA: t.qa, hMit: t.mit, hUAT: t.uat, hTotal: t.total }); n++;
   });
   console.log(`  hours from Jira logs: ${n} window row(s) with entries, ${skipped} inherited QA-copy row(s) skipped`);
 }
 // ---------- manual overrides (pinned; recompute anything that depends on them) ----------
 let ovCount = 0;
 rows.forEach(r => {
   const o = OVERRIDE[r.W]; if (!o) return;
   Object.entries(o).forEach(([k,v]) => {
     if (r[k] !== v) ovCount++;
     r[k] = v;
     r.overridden = (r.overridden ? r.overridden + ', ' : '') + k;
   });
   if (o.twoWk) {                                   // Target Date is derived from 2 Week Start
     const d = new Date(o.twoWk + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 14);
     r.target = d.toISOString().slice(0,10);
   }
 });
 console.log('  manual overrides applied: ' + ovCount + ' field(s) across ' + Object.keys(OVERRIDE).length + ' window(s)');

 // decimals sharing a subtask: lowest W# keeps hours, others inherit the parent's defect log
 const bySub={}; rows.forEach(r=>{if(r.subtask)(bySub[r.subtask]=bySub[r.subtask]||[]).push(r);});
 let zeroed=0, inherited=0;
 Object.values(bySub).filter(a=>a.length>1).forEach(a=>{
   // Head = the row that actually carries the data, NOT simply the lowest W#.
   // A deactivated/stub row can have a lower W# than the real window (e.g. W#52 vs W#53).
   const hrs=r=>Number(r.hTotal)||0;
   a.sort((x,y)=> hrs(y)-hrs(x) || parseFloat(x.W)-parseFloat(y.W));
   const head=a[0];
   // Hours: identical values across the group = the same total duplicated -> keep one.
   // Differing values = a per-window split of one subtask's effort -> roll up onto the head.
   ['hDev','hQA','hMit','hUAT','hTotal'].forEach(f=>{
     const vals=a.map(r=>r[f]).filter(v=>v!=='' && v!==null);
     if(!vals.length) return;
     const nums=vals.map(Number);
     const identical=nums.every(v=>v===nums[0]);
     head[f]= identical ? nums[0] : nums.reduce((s,v)=>s+v,0);
     a.slice(1).forEach(r=>{ if(r[f]!==''){ r[f]=0; zeroed++; } });
   });
   a.slice(1).forEach(r=>{
     if(!r.dlFile && head.dlFile){ r.dlFile=head.dlFile; r.openD=head.openD; r.totD=head.totD; r.uatOpen=head.uatOpen; r.uatRows=head.uatRows; inherited++; }
     if(!r.dev && head.dev) r.dev=head.dev;          // one subtask = one assignee
     if(!r.bsa && head.bsa) r.bsa=head.bsa;
     r.sharedSub=true;
   });
 });
 console.log('  defect logs inherited by shared-subtask decimals: '+inherited);
 // ---------- UAT Defect Log header rows ----------
 // Each window's orange row carries "UAT Release" (= actual UAT Start) and "Sign-Off Date".
 // These beat Metrics and the dashboard overlay; a hand edit in Master Tracking still wins
 // (manual-overrides.json is applied later). Deployment Date is deliberately NOT used.
 const U = require('./uat.js');
 let secs = null;
 try {
   secs = await U.read();
   const chg = [];
   secs.forEach(s => {
     const f = U.qaFileFor(s, dlFiles); if (!f) return;
     // Not Started rows can share a log through the loose name match (W#17.2 -> Bail Schedule)
     rows.filter(r => r.dlFile === f && r.status !== 'Not Started').forEach(r => {
       [['uatStart', s.release], ['signedOff', s.signOff]].forEach(([k, v]) => {
         if (!v || r[k] === v) return;
         chg.push(`W#${r.W} ${k} ${r[k]||'(blank)'} -> ${v}`); r[k] = v;
       });
     });
   });
   console.log(`  UAT log dates: ${secs.length} window(s) read, ${chg.length} value(s) set`);
   chg.forEach(c => console.log('     ' + c));
 } catch (e) { console.log('  UAT Defect Log not read: ' + (e.code || e.message)); }
 // ---------- dashboard overlay (human-owned values) ----------
 const OV = await require('./overlay.js').read();
 const applied = {sprint:[],track:[],dev:[],bsa:[],uatStart:[],signedOff:[]};
 rows.forEach(r => { const o = OV[r.W]; if(!o) return;
   r.onDash = 'Y';
   if(!r.sprint && o.sprint){ r.sprint = o.sprint; applied.sprint.push(r.W); }
   if(o.track === 'Internal' && r.track === 'User'){ r.track = 'Internal'; applied.track.push(r.W); }
   if(!r.dev && o.dev){ r.dev = o.dev; applied.dev.push(r.W); }
   if(!r.bsa && o.bsa){ r.bsa = o.bsa; applied.bsa.push(r.W); }
   // DEV LEAD LOE applies from SG2 onward, and only once a window is actually assigned.
   // Unassigned windows get it when the planning skill hands them to a developer.
   if(!r.loeToQA && o.loe && r.dev && /^SG(\d+)$/.test(r.sprint) && Number(RegExp.$1) >= 2){
     r.loeToQA = o.loe; (applied.loe = applied.loe || []).push(r.W);
   }
   if(!r.uatStart && o.uatStart){ r.uatStart = o.uatStart; applied.uatStart.push(r.W); }
   if(!r.signedOff && o.signedOff){ r.signedOff = o.signedOff; applied.signedOff.push(r.W); }
 });
 console.log('');
 console.log('DASHBOARD OVERLAY applied:');
 Object.entries(applied).forEach(([k,v]) => console.log('   ' + k.padEnd(10) + String(v.length).padStart(3) + ' cells  [' + v.join(', ') + ']'));
 console.log('   rows present on dashboard: ' + rows.filter(r=>r.onDash).length);

 // ---------- Sprint Planning worksheet ----------
 // Windows sitting in planning have no Jira subtask yet, so they would otherwise read
 // "Not Started" and be invisible. Surface them, and carry the Lead Developer's entries.
 try {
   const PF = path.join(require('./config.js').ROOT, 'Vision NG - Sprint Planning.xlsx');
   if (fs.existsSync(PF)) {
     const { V } = require('./vx.js');
     const pwb = new ExcelJS.Workbook(); await pwb.xlsx.readFile(PF);
     const pws = pwb.getWorksheet('Sprint Planning');
     let seen = 0; const underway = [];
     if (pws) for (let r = 2; r <= pws.rowCount; r++) {
       const g = pws.getRow(r);
       const w = V(g.getCell(3)); if (!w) continue;
       const row = rows.find(x => x.W === w); if (!row) continue;
       // The Lead Developer's entries fill blanks on every planned row, underway or not
       // (a subtask created by hand has no SG in its title and may lack Project Team).
       const filled = [];
       if (!row.sprint  && V(g.getCell(1)))  { row.sprint  = V(g.getCell(1));  filled.push('sprint'); }
       if (!row.dev     && V(g.getCell(8)))  { row.dev     = V(g.getCell(8));  filled.push('dev'); }
       if (!row.bsa     && V(g.getCell(9)))  { row.bsa     = V(g.getCell(9));  filled.push('bsa'); }
       if (!row.loeToQA && V(g.getCell(10))) { row.loeToQA = V(g.getCell(10)); filled.push('loe'); }
       // A subtask may already exist but be unassigned (created, never planned). Planning
       // still governs status until work actually starts.
       if (row.status !== 'Not Started') {
         if (filled.length) underway.push(`W#${w} ${filled.join('/')}`);
         continue;
       }
       row.status = 'In Sprint Planning';
       row.inPlanning = 'Y';
       seen++;
     }
     console.log('  in Sprint Planning: ' + seen + ' window(s)');
     if (underway.length) console.log('  planning filled on underway rows: ' + underway.join(', '));
   }
 } catch (e) { console.log('  Sprint Planning sheet not read: ' + (e.code || e.message)); }

 // One subtask cannot belong to two sprints - propagate Sprint # across a bundle.
 // Runs after the overlay, since that is what assigns Sprint # for most rows.
 let spread = 0;
 Object.values(bySub).filter(a => a.length > 1).forEach(a => {
   const src = a.find(r => r.sprint);
   if (!src) return;
   a.filter(r => !r.sprint).forEach(r => { r.sprint = src.sprint; spread++; });
 });
 console.log('   sprint propagated across bundled subtasks: ' + spread);

 // ---------- hand edits detected by preserve.js (win over derivation) ----------
 try {
   const MF = require('./config.js').shared('manual-overrides.json');
   if (fs.existsSync(MF)) {
     const man = JSON.parse(fs.readFileSync(MF, 'utf8'));
     let n = 0;
     rows.forEach(r => {
       const o = man[r.W] || man[r.subtask]; if (!o) return;
       Object.entries(o).forEach(([f, v]) => {
         r[f] = v; n++;
         r.overridden = (r.overridden ? r.overridden + ', ' : '') + f;
       });
       if (o.twoWk) {                                  // Target Date follows 2 Week Start
         const d = new Date(o.twoWk + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 14);
         if (!o.target) r.target = d.toISOString().slice(0, 10);
       }
     });
     if (n) console.log('  hand edits reapplied: ' + n + ' field(s)');
   }
 } catch (e) { console.log('  manual-overrides.json not applied: ' + (e.code || e.message)); }

 // ---------- Group Label (computed display string) + rule validation ----------
 rows.forEach(r => {
   // Completed with no sprint (2026-10-13): delivered before sprint grouping began, not "unplanned".
   if (r.status === 'Deployed' && !r.sprint) r.sprint = 'Pre-Sprint';
   // Pre-Sprint windows left the Pipeline Plan before LOE was recorded there. Their LOE comes from
   // the Metrics workbook's Complexity LOE Tracking sheet: the window's own line, else its grouping.
   if (r.sprint === 'Pre-Sprint' && r.loeTotal === '' && G.complexity) {
     const cx = G.complexity, nm = norm(r.name);
     const hit = cx.windows.find(c => norm(c.name) === nm);
     const g = cx.table[norm(r.grouping).replace(/[0-9]/g, '')];
     const v = hit || (g && { dev: g.dev, qa: g.qa, tot: g.dev + g.qa });
     if (v) { r.loeDev = v.dev; r.loeQA = v.qa; r.loeTotal = v.tot; r.loeSrc = hit ? 'Complexity sheet' : 'Complexity grouping'; }
   }
   const sg = /^SG\d+$/.test(r.sprint);
   // Blank Sprint # means "not yet planned" and must stay visibly distinct from a
   // planned-independent internal window (Sprint # = Internal).
   r.groupLabel = !r.sprint ? ''
     : r.sprint==='Pre-Sprint' ? 'Pre-Sprint'
     : r.track==='Patch' ? 'Patch'
     : r.track==='Internal' ? (sg ? r.sprint+' Internal' : 'Internal')
     : r.sprint;
   // Track=Internal/Patch never carries a UAT countdown.
   if(r.track!=='User' && !String(r.overridden||'').includes('twoWk')){ r.twoWk=''; r.target=''; }
 });
 const viol=[];
 rows.forEach(r=>{
   if(r.track==='User' && /^(Internal|Patch)$/.test(r.sprint)) viol.push(`W#${r.W} Track=User but Sprint #=${r.sprint}`);
   if(r.track!=='User' && r.target) viol.push(`W#${r.W} Track=${r.track} but has a Target Date`);
   if(r.track==='Patch' && r.mainAR && r.mainAR!=='VISAR-7396') viol.push(`W#${r.W} Track=Patch but Main AR=${r.mainAR}`);
 });
 console.log('');
 console.log('RULE VALIDATION: ' + (viol.length ? viol.length+' violation(s)' : 'clean'));
 viol.forEach(v=>console.log('   ! '+v));
 // sprint readiness gate
 const bySprint={};
 // Canceled windows stay in the sprint for the record but never block its build.
 rows.filter(r=>/^SG\d+$/.test(r.sprint) && r.status!=='Canceled')
     .forEach(r=>(bySprint[r.sprint]=bySprint[r.sprint]||[]).push(r));
 console.log('');
 console.log('SPRINT READINESS (all rows must be Ready for Deployment / Deployed):');
 Object.keys(bySprint).sort().forEach(s=>{
   const a=bySprint[s], done=a.filter(r=>r.status==='Ready for Deployment'||r.status==='Deployed');
   const block=a.filter(r=>!(r.status==='Ready for Deployment'||r.status==='Deployed'));
   console.log(`   ${s}: ${done.length}/${a.length} ready` + (block.length?`  blocked by ${block.map(r=>'W#'+r.W).join(', ')}`:'  -> DEPLOYABLE'));
 });

 // ---------- reset to "never started" (user decision) ----------
 const CLEAR=['sprint','mainAR','subtask','related','status','jira','qaCycle','dev','bsa','started','toQA',
   'twoWk','target','toUAT','uatStart','signedOff','deployed','build','hDev','hQA','hMit','hUAT','hTotal',
   'openD','totD','dlFile','legacy','metricsStatus','onDash','matchMethod'];
 rows.filter(r=>RESET.has(r.W)).forEach(r=>{
   CLEAR.forEach(k=>r[k]='');
   r.status='Not Started'; r.matchConf='Unmatched';
   console.log('  RESET to never-started: W#'+r.W+' '+r.name);
 });

 // ---------- UAT fix subtasks ----------
 // uatSub is the open UAT subtask, else the most recent closed one. uatNeed is what uatinit.js
 // would do right now ('create' / 'comment' / ''), decided by the same uatplan.js it uses.
 {
   const P = require('./uatplan.js');
   const { isOpen } = require('./kinds.js');
   const subs = P.uatByDev(rows, G.uatList);
   rows.filter(r => r.subtask && subs[r.subtask]).forEach(r => {
     const a = subs[r.subtask], cur = a.find(u => isOpen(u.status)) || a[a.length - 1];
     Object.assign(r, { uatSub: cur.key, uatSubStatus: cur.status, uatSubOpen: isOpen(cur.status),
                        uatSubAssignee: cur.assignee, uatSubs: a.map(u => u.key).join(', ') });
     // The In QA automation's copy of the current UAT subtask. A second UAT subtask on the same
     // window gets the same title, and so does its copy, so a title match alone can pick the old
     // copy. Only copies created after this UAT subtask count (higher key), open first, then newest.
     const K = require('./kinds.js');
     const num = k => Number(String(k).split('-')[1]) || 0;
     const strip = s => String(s).replace(/^\s*QA\s*-\s*/i, '').trim().toLowerCase();
     const hit = (G.uatQaList || [])
       .filter(q => num(q.key) > num(cur.key)
                 && (q.obj === cur.obj || strip(q.sum) === String(cur.sum).trim().toLowerCase()))
       .sort((x, y) => (K.isOpen(y.status) - K.isOpen(x.status)) || num(y.key) - num(x.key))[0];
     if (hit) Object.assign(r, { uatQaSub: hit.key, uatQaStatus: hit.status, uatQaOpen: K.isOpen(hit.status) });
   });
   if (secs) {
     const pl = P.plan({ sections: secs, rows, uatList: G.uatList, dlFiles, qaFileFor: U.qaFileFor });
     pl.items.forEach(it => rows.filter(r => r.subtask === it.devKey).forEach(r => {
       r.uatNeed = it.action; r.uatPending = it.pending.length; r.uatLogSection = it.section.title;
     }));
     const need = pl.items.filter(i => i.action);
     console.log(`  UAT subtasks: ${Object.keys(subs).length} dev subtask(s) have one, ${need.length} need action`
       + (need.length ? ` [${need.map(i => `${i.section.title}: ${i.action}`).join(', ')}]` : ''));
   }
 }

 // ---------- UAT defect movement since UAT Start (dashboard up/down arrows) ----------
 // Runs last so UAT Start is final (UAT log, overlay and hand edits all applied).
 //   uatAdded  = UAT-origin defects logged on/after UAT Start
 //   uatClosed = those of them no longer open (Resolved / No Action)
 rows.forEach(r => {
   const since = (r.uatRows||[]).filter(u => r.uatStart && (!u.date || u.date >= r.uatStart));
   r.uatAdded = r.uatStart ? since.length : '';
   r.uatClosed = r.uatStart ? since.filter(u => !u.open).length : '';
   delete r.uatRows;
 });

 // ---------- effort for the Metric Analysis page (2026-10-13) ----------
 // e* = Metrics sheet hours + Jira hours (the h* columns, hand edits included). Pre-sprint and SG1
 // work was logged in the Metrics sheet, later work in Jira, and some windows have both.
 //   Development = Stage 1+2+3   QA = Total QA Hours   Mitigation = Stage 4   UAT = Stage 5
 // Windows sharing a subtask that repeat identical Metrics hours (W#125 / 125.1) count once.
 {
   const n = v => (v === '' || v == null || isNaN(Number(v))) ? null : Number(v);
   const add = a => { const b = a.filter(x => x != null); return b.length ? Math.round(b.reduce((s, x) => s + x, 0) * 100) / 100 : ''; };
   const mAll = {}; G.metrics.filter(m => m.W && m.stage).forEach(m => (mAll[m.W] = mAll[m.W] || []).push(m));
   const seen = {};
   rows.forEach(r => {
     const ms = mAll[r.W] || [];
     let m = { dev: add(ms.flatMap(x => x.stage.slice(0, 3).map(n))), qa: add(ms.map(x => n(x.qaHrs))),
               mit: add(ms.map(x => n(x.stage[3]))), uat: add(ms.map(x => n(x.stage[4]))) };
     const any = Object.values(m).some(v => v !== '');
     const sig = r.subtask + '|' + Object.values(m).join('|');
     if (any && r.subtask && seen[sig]) m = { dev: '', qa: '', mit: '', uat: '' }; else if (any) seen[sig] = r.W;
     // A decimal sharing a subtask carries 0 Jira hours (they sit on the head row): that is "none", not zero.
     const h = v => { const x = n(v); return (r.sharedSub && !x) ? null : x; };
     Object.assign(r, { mDev: m.dev, mQA: m.qa, mMit: m.mit, mUAT: m.uat,
       eDev: add([n(m.dev), h(r.hDev)]), eQA: add([n(m.qa), h(r.hQA)]), eMit: add([n(m.mit), h(r.hMit)]), eUAT: add([n(m.uat), h(r.hUAT)]) });
     r.eTotal = add([r.eDev, r.eQA, r.eMit, r.eUAT].map(n));
   });
   console.log('  effort (Metrics + Jira): ' + rows.filter(r => r.eTotal !== '').length + ' window row(s) with hours');
 }

 rows.sort((a,b)=>parseFloat(a.W)-parseFloat(b.W));
 fs.writeFileSync(require('./config.js').local('rows.json'),JSON.stringify({rows,conflicts,xwalk},null,1));
 console.log(`Master rows: ${rows.length}`);
 console.log(`  mapped to Jira: ${rows.filter(r=>r.subtask).length}`);
 console.log(`  with defect log: ${rows.filter(r=>r.dlFile).length}`);
 console.log(`  decimals zeroed for shared subtask: ${zeroed}`);
 console.log(`  crosswalk conflicts: ${conflicts.length}`);
 conflicts.forEach(c=>console.log(`     W#${c.W} ${c.existing} vs ${c.candidate} (${c.obj})`));
 const st={}; rows.forEach(r=>st[r.status]=(st[r.status]||0)+1);
 console.log('  status distribution:',JSON.stringify(st));
})().catch(e=>{console.error('ERR',e.stack); process.exit(1);});
