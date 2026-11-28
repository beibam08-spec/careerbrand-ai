import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { analyzeVacancies } from '../market-analysis.mjs';

const sample=[
  { id:'1',name:'Junior Python Developer',employer:{name:'Mock Employer A'},alternate_url:'https://hh.kz/vacancy/1',snippet:{requirement:'<b>Python</b>, SQL and Git'}, published_at:'2026-11-28T12:00:00+0500',salary:{from:200000,to:300000,currency:'KZT',gross:false} },
  { id:'2',name:'Data Analyst',employer:{name:'Mock Employer B'},alternate_url:'https://hh.kz/vacancy/2',snippet:{requirement:'Excel, SQL, Power BI'},published_at:'2026-11-28T12:00:00+0500',salary:null },
  { id:'3',name:'JavaScript Engineer',employer:{name:'Mock Employer C'},alternate_url:'https://malicious.invalid/offer',snippet:{requirement:'JavaScript, React'},published_at:'2026-11-28T12:00:00+0500',salary:null}
];
async function serve(handler){const s=http.createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));return {server:s,url:`http://127.0.0.1:${s.address().port}`};}
async function launch(env){
  const probe=await serve((_req,res)=>res.end());
  const port=Number(new URL(probe.url).port);
  await new Promise(r=>probe.server.close(r));
  const url=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,[new URL('../server.mjs',import.meta.url).pathname],{env:{...process.env,PORT:String(port),...env},stdio:['ignore','pipe','pipe']});
  let out='';child.stdout.on('data',d=>out+=String(d));child.stderr.on('data',d=>out+=String(d));
  for(let i=0;i<70;i++){
    try{const r=await fetch(url+'/api/health');if(r.ok)return {child,url};}catch{}
    await new Promise(r=>setTimeout(r,60));
  }
  child.kill();throw new Error(`server did not start: ${out}`);
}

test('skill analysis is evidence-based and preserves source links',()=>{
  const r=analyzeVacancies([
    {title:'Python Developer',requirements:'SQL and Python',link:'https://hh.kz/vacancy/1'},
    {title:'Analyst',requirements:'SQL, Excel',link:'https://hh.kz/vacancy/2'},
    {title:'Unknown',requirements:'Go and Kubernetes',link:'https://not-really-hh.invalid/3'}
  ],'Python, Excel');
  assert.equal(r.sampleSize,3);
  assert.equal(r.skills.find(s=>s.name==='SQL').count,2);
  assert.equal(r.skills.find(s=>s.name==='Python').hasSkill,true);
  assert.equal(r.missing[0].name,'SQL');
  assert.equal(r.skills.find(s=>s.name==='SQL').evidence[0].link,'https://hh.kz/vacancy/1');
  assert.doesNotMatch(JSON.stringify(r),/hire probability|chance of success/i);
});

test('jobs endpoint validates location, limits output, and agent does not pretend to be AI without key',async()=>{
  const mock=await serve((req,res)=>{
    assert.equal(new URL(req.url,'http://test').pathname,'/vacancies');
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({found:3,items:sample}));
  });
  const p=await launch({HH_API_BASE:mock.url,OPENAI_API_KEY:''});
  try{
    const rr=await fetch(`${p.url}/api/jobs?query=Python&area=160`);assert.equal(rr.status,200);
    const jobs=await rr.json();assert.equal(jobs.found,3);assert.equal(jobs.sampleSize,3);
    assert.equal(jobs.vacancies[0].requirements,'Python, SQL and Git');
    assert.equal(jobs.vacancies[2].link,null,'unexpected domain should not be surfaced');
    const ar=await fetch(`${p.url}/api/agent`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'Python',area:'160',lang:'kk',profile:{skills:'Python'}})});
    assert.equal(ar.status,200);
    const agent=await ar.json();assert.equal(agent.mode,'rules');assert.equal(agent.summary,null);
    assert.equal(agent.analysis.skills.find(x=>x.name==='Python').hasSkill,true);
    assert.equal(agent.analysis.skills.find(x=>x.name==='SQL').hasSkill,false);
    assert.equal(agent.analysis.sampleSize,3);
  }finally{p.child.kill();await new Promise(r=>mock.server.close(r));}
});

test('configured model replies in all three languages and agent includes grounded AI summary',async()=>{
  let calls=[];
  const upstream=await serve(async(req,res)=>{
    const path=new URL(req.url,'http://test').pathname;
    if(path==='/vacancies'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({found:3,items:sample}));}
    if(path==='/v1/responses'){
      let chunks=[];for await(const c of req)chunks.push(c);
      const payload=JSON.parse(Buffer.concat(chunks).toString());calls.push(payload);
      res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({output:[{content:[{type:'output_text',text:'Бұл тек 3 бос орыннан алынған шағын іріктеме. [1]'}]}]}));
    }
    res.writeHead(404);res.end();
  });
  const p=await launch({HH_API_BASE:upstream.url,OPENAI_API_BASE:upstream.url,OPENAI_API_KEY:'mock-test-only'});
  try{
    for(const lang of ['kk','ru','en']){
      const response=await fetch(`${p.url}/api/chat`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lang,profile:{role:'Student'},messages:[{role:'user',content:'Help with my CV'}]})});
      assert.equal(response.status,200);assert.equal((await response.json()).lang,lang);
    }
    const response=await fetch(`${p.url}/api/agent`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:'Python',area:'160',lang:'kk',profile:{skills:'Python',role:'Student'}})});
    assert.equal(response.status,200);const agent=await response.json();
    assert.equal(agent.mode,'ai');assert.match(agent.summary,/3 бос орыннан/);
    assert.equal(agent.market.source,'HeadHunter');
    assert.equal(calls.length,4);assert.ok(calls.every(c=>c.store===false));
    assert.match(calls[3].instructions,/limited|SMALL/i);
    assert.match(calls[3].instructions,/Қазақ тілінде/);
  }finally{p.child.kill();await new Promise(r=>upstream.server.close(r));}
});
