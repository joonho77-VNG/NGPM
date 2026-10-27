// Reads the TEMP dashboard's five active sections and returns per-W# values.
const ExcelJS=require('./config.js').req('exceljs'); const {V}=require('./vx.js');
const { ROOT } = require('./config.js');
const SECTIONS=[
 ['Next Sprint',     36, 57,{sprint:'A',sub:'B',w:'C',dev:'H',bsa:'I',loe:'J'}],
 ['In Flight',       68, 81,{sprint:'A',sub:'B',w:'C',dev:'H',bsa:'I'}],
 ['Committed',       86, 89,{sprint:'A',sub:'B',w:'C',dev:'H',bsa:'I'}],
 ['Sent to UAT',     94, 99,{sprint:'A',sub:'B',w:'C',toUAT:'D',uatStart:'F',signedOff:'G'}],
 ['To Be Deployed', 105,109,{sprint:'A',sub:'B',w:'C',dev:'H',bsa:'I'}],
];
const NOTSPRINT=/^(exclude|hold|`)$/i;
// "SG1 Internal" -> {sprint:'SG1', track:'Internal'}.  Sprint # and Track are separate axes.
function parseLabel(s){
  s=String(s||'').trim(); if(!s||NOTSPRINT.test(s)) return null;
  let m=s.match(/^SG\s*(\d+)\s+Internal$/i);      if(m) return {sprint:'SG'+Number(m[1]), track:'Internal'};
  m=s.match(/^SG\s*(\d+)$/i);                     if(m) return {sprint:'SG'+Number(m[1])};
  if(/^internal$/i.test(s))                       return {sprint:'Internal', track:'Internal'};
  if(/^patch$/i.test(s))                          return {sprint:'Patch', track:'Patch'};
  if(/^tbd$/i.test(s))                            return {sprint:'TBD'};
  return null;
}
async function read(){
 const wb=new ExcelJS.Workbook(); await wb.xlsx.readFile(`${ROOT}/TEMP NG Project Dashboard.xlsx`);
 const ws=wb.worksheets[0]; const out={};
 for(const [title,r0,r1,map] of SECTIONS){
  for(let r=r0;r<=r1;r++){
   const g=ws.getRow(r); const d={}; Object.entries(map).forEach(([k,c])=>d[k]=V(g.getCell(c)));
   let w=d.w; if(r===95) w='25.1';                    // dashboard mislabels Print-Copies Spec as 25
   if(!w) continue;
   const o=out[w]=out[w]||{sections:[]};
   o.sections.push(title);
   const lab=parseLabel(d.sprint);
   if(lab){ if(!o.sprint) o.sprint=lab.sprint; if(lab.track && !o.track) o.track=lab.track; }
   if(d.sprint && /^hold$/i.test(d.sprint)) o.hold=true;
   if(d.loe && !o.loe) o.loe=d.loe;                  // DEV LEAD LOE, days to first QA
   if(d.dev && !o.dev) o.dev=d.dev;
   if(d.bsa && !o.bsa) o.bsa=d.bsa;
   if(d.uatStart && !o.uatStart) o.uatStart=d.uatStart;
   if(d.signedOff && !o.signedOff) o.signedOff=d.signedOff;
  }
 }
 return out;
}
module.exports={read};
