const ExcelJS=require('./config.js').req('exceljs');
const {V}=require("./vx.js");
(async()=>{
 const wb=new ExcelJS.Workbook(); await wb.xlsx.readFile(require("./config.js").PIPELINE);
 const ws=wb.worksheets.find(w=>w.name.trim()==='Pipeline with LOE');
 // Every column is found by its header, never by letter: people insert columns into this sheet
 // (ETA to UAT + COMMENTS on 2026-10-13, SG on 2026-10-15) and each insert shifted the letters.
 // The output keys keep the ORIGINAL letters so nothing downstream changes:
 //   A Priority #  B ID  C Menu  D Sub-menu (window name)  E Object name  F Grouping  G Status
 //   H No UAT  M Dev LOE  N QA LOE  O Total LOE  P Total Usage
 const HD={}; ws.getRow(1).eachCell((c,i)=>{HD[V(c).replace(/\s+/g,' ').trim().toLowerCase()]=i;});
 const at=h=>{ const k=Object.keys(HD).find(x=>x===h||(h.endsWith('*')&&x.startsWith(h.slice(0,-1))));
   if(!k) throw new Error('Pipeline sheet has no "'+h+'" column'); return HD[k]; };
 const COL={A:at('priority #'),B:at('id'),C:at('menu'),D:at('sub-menu'),E:at('object name'),F:at('grouping'),G:at('status'),
   H:at('no uat*'),M:at('dev loe'),N:at('qa loe'),O:at('total loe'),P:at('total usage')};
 let rows=[];
 for(let r=2;r<=ws.rowCount;r++){const g=ws.getRow(r);
  const o={r}; Object.entries(COL).forEach(([k,c])=>{o[k]=V(g.getCell(c));});
  if(o.B||o.D||o.E) rows.push(o);}
 console.log('DATA ROWS:',rows.length);
 console.log('\n--- first 12 ---');
 rows.slice(0,12).forEach(o=>console.log(`r${o.r} B=${o.B} | C=${o.C} | D=${o.D} | E=${o.E} | F=${o.F} | H=[${o.H}] | M=${o.M} N=${o.N} O=${o.O} P=${o.P}`));
 console.log('\n--- last 5 ---');
 rows.slice(-5).forEach(o=>console.log(`r${o.r} B=${o.B} | D=${o.D} | E=${o.E} | H=[${o.H}]`));
 const dec=rows.filter(o=>o.B.includes('.'));
 console.log('\nDECIMAL IDs:',dec.length, dec.slice(0,15).map(o=>o.B).join(', '));
 const noUat=rows.filter(o=>o.H!=='');
 console.log('\nH (No UAT) non-empty:',noUat.length,'distinct values:',JSON.stringify([...new Set(noUat.map(o=>o.H))]));
 console.log('\nBLANK B (ID):',rows.filter(o=>!o.B).length);
 console.log('DUP B:',JSON.stringify(Object.entries(rows.reduce((a,o)=>{if(o.B)a[o.B]=(a[o.B]||0)+1;return a},{})).filter(([k,v])=>v>1)));
 console.log('\nGROUPING (F) values:',JSON.stringify([...new Set(rows.map(o=>o.F))].slice(0,15)));
 console.log('STATUS (G) values:',JSON.stringify([...new Set(rows.map(o=>o.G))].slice(0,15)));
 console.log('\nMissing M/N/O:',rows.filter(o=>!o.M||!o.N||!o.O).length,' Missing P:',rows.filter(o=>!o.P).length);
 require('fs').writeFileSync(require('./config.js').local('pipeline.json'),JSON.stringify(rows,null,1));
})().catch(e=>{console.error('ERR',e.message); process.exit(1);});
