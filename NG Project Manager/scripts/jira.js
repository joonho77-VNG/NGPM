const SITE=process.env.ATLASSIAN_SITE_URL, EMAIL=process.env.ATLASSIAN_USER_EMAIL, TOK=process.env.ATLASSIAN_API_TOKEN;
const AUTH='Basic '+Buffer.from(`${EMAIL}:${TOK}`).toString('base64');
async function jget(path, params={}) {
  const u=new URL(SITE+path); for(const[k,v] of Object.entries(params)) u.searchParams.set(k,v);
  const r=await fetch(u,{headers:{Authorization:AUTH,Accept:'application/json'}});
  if(!r.ok) throw new Error(path+' -> '+r.status+' '+(await r.text()).slice(0,300));
  return r.json();
}
// --- writes.  Everything above is read-only; these two are the only mutating calls. ---
async function jsend(method, path, body) {
  const r = await fetch(new URL(SITE + path), {
    method,
    headers: {Authorization: AUTH, Accept: 'application/json', 'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(method + ' ' + path + ' -> ' + r.status + ' ' + txt.slice(0, 400));
  return txt ? JSON.parse(txt) : null;
}
const jpost = (path, body) => jsend('POST', path, body);
const jput  = (path, body) => jsend('PUT',  path, body);

async function jql(q, fields='summary,status,assignee,issuetype,created,resolutiondate', expand='') {
  let out=[], token=null;
  do { const p={jql:q,maxResults:100,fields}; if(expand)p.expand=expand; if(token)p.nextPageToken=token;
    const j=await jget('/rest/api/3/search/jql',p); out.push(...(j.issues||[])); token=j.nextPageToken;
  } while(token);
  return out;
}
module.exports={jget,jql,jpost,jput,AUTH,SITE};
if(require.main===module){(async()=>{
 for(const p of ['VISAR-6166','VISAR-7396','VISAR-7398']){
   const rows=await jql(`parent=${p}`);
   console.log(`${p}: ${rows.length} subtasks`);
   const st={}; rows.forEach(r=>st[r.fields.status.name]=(st[r.fields.status.name]||0)+1);
   console.log('   statuses:',JSON.stringify(st));
   if(rows.length) console.log('   sample:',rows.slice(0,3).map(r=>`${r.key} | ${r.fields.summary}`).join('\n           '));
 }
})().catch(e=>{console.error('ERR',e.message);process.exit(1)})}
