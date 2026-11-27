import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';
const dir=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const freePort=()=>new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port))})});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function start(env={}){
  const port=await freePort();
  const child=spawn(process.execPath,['server.mjs'],{cwd:dir,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',OPENAI_API_KEY:'',HH_CONTACT_EMAIL:'',...env},stdio:'ignore'});
  const base=`http://127.0.0.1:${port}`;
  for(let i=0;i<50;i++){try{const r=await fetch(base+'/api/health');if(r.ok)return {child,base}}catch{}await sleep(50)}
  child.kill('SIGTERM');throw Error('server did not start');
}
const post=(url,body,headers={})=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});

test('v8 JSON import: synthetic source, privacy, data-derived skill counts and HTML-safe links',async()=>{
  const {child,base}=await start();
  try{
    const sample=JSON.parse(await readFile(path.join(dir,'assets/example-vacancies-SYNTHETIC.json'),'utf8'));
    const response=await post(base+'/api/analyze-dataset',{...sample,lang:'kk',shareSkills:false,profile:{skills:'Python, SQL'},useAI:false});
    assert.equal(response.status,200);
    const data=await response.json();
    assert.equal(data.sampleKind,'synthetic');
    assert.match(data.source,/SYNTHETIC TEST DATA/);
    assert.equal(data.sourceUrl,null);
    assert.equal(data.found,null);
    assert.equal(data.sampleSize,4);
    assert.equal(data.analysis.profileCompared,false,'No profile sharing by default');
    assert.equal(data.aiStatus,'not_configured');
    assert.equal(data.report.type,'rule_based');
    assert.ok(data.analysis.matchedSkills.some(x=>x.name==='Python'&&x.count===3));
    assert.match(data.report.limitation,/іріктемеге/);
    const link=await post(base+'/api/analyze-dataset',{source:'Manual',vacancies:[{title:'Data analyst',requirements:'SQL and Excel required',link:'javascript:alert(1)'},{title:'Developer',requirements:'Python and Git for junior role',link:'https://hh.kz/vacancy/1'}],shareSkills:true,profile:{skills:'SQL'},useAI:false});
    assert.equal(link.status,200);
    const result=await link.json();
    assert.equal(result.sampleKind,'imported');
    assert.equal(result.vacancies[0].link,null,'unsafe scheme dropped');
    assert.equal(result.vacancies[1].link,'https://hh.kz/vacancy/1');
    assert.equal(result.analysis.profileCompared,true);
    assert.ok(result.analysis.overlaps.some(x=>x.name==='SQL'));
  }finally{child.kill('SIGTERM')}
});

test('v8 JSON import rejects malformed datasets and protects restricted access',async()=>{
  const {child,base}=await start({DEMO_ACCESS_CODE:'example-strong-demo-code'});
  const valid={vacancies:[{title:'Analyst',requirements:'Excel and SQL required'},{title:'Developer',requirements:'Python and Git required'}]};
  try{
    const denial=await post(base+'/api/analyze-dataset',valid);
    assert.equal(denial.status,401);
    const headers={'X-CareerBrand-Access':'example-strong-demo-code'};
    const invalid=await post(base+'/api/analyze-dataset',{vacancies:[valid.vacancies[0]]},headers);
    assert.equal(invalid.status,400);
    assert.equal((await invalid.json()).code,'DATASET_INVALID');
    const invalidText=await post(base+'/api/analyze-dataset',{vacancies:[valid.vacancies[0],{title:'Test',requirements:'short'}]},headers);
    assert.equal(invalidText.status,400);
    const noConsent=await post(base+'/api/analyze-dataset',{...valid,useAI:true},headers);
    assert.equal(noConsent.status,400);
    assert.equal((await noConsent.json()).code,'AI_CONSENT_REQUIRED');
    const success=await post(base+'/api/analyze-dataset',valid,headers);
    assert.equal(success.status,200);
    assert.equal((await success.json()).sampleKind,'imported');
  }finally{child.kill('SIGTERM')}
});

test('v8 translated import labels exist and the sample JSON is conspicuously fictional',async()=>{
  const app=await readFile(path.join(dir,'app.js'),'utf8');
  const index=await readFile(path.join(dir,'index.html'),'utf8');
  assert.match(app,/EXTRA_V8/);
  assert.match(app,/data-action="import-dataset"/);
  assert.match(app,/function importDataset/);
  assert.match(index,/lang="kk"/);
  const example=await readFile(path.join(dir,'assets/example-vacancies-SYNTHETIC.json'),'utf8');
  assert.match(example,/"synthetic": true/);
  assert.match(example,/NOT REAL VACANCIES/);
});
