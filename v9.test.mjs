import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import vm from 'node:vm';
import net from 'node:net';

const root=new URL('../',import.meta.url);
const appSource=await readFile(new URL('app.js',root),'utf8');
const json=JSON.parse(await readFile(new URL('assets/example-vacancies-SYNTHETIC.json',root),'utf8'));
const freePort=()=>new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});

function clientContext(){
 const content={innerHTML:''};const app={innerHTML:'',addEventListener(){}};
 const ctx=vm.createContext({document:{documentElement:{lang:'kk',dataset:{}},getElementById:id=>id==='app'?app:id==='content'?content:null,querySelector:()=>null},
 localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null},location:{protocol:'file:'},
 console,setTimeout,clearTimeout,Intl,URL,encodeURIComponent,confirm:()=>true,window:{print(){}},
 fetch:async()=>({json:async()=>({aiConfigured:false})})});
 vm.runInContext(appSource,ctx);return {ctx,content};
}

test('v9 offline demo has grounded, explicitly synthetic skill counts in Kazakh, Russian and English',()=>{
 const {ctx,content}=clientContext();
 const first=vm.runInContext('localDatasetAnalysis(DEFENSE_SAMPLE, {shareSkills:false})',ctx);
 assert.equal(first.sampleKind,'synthetic');assert.equal(first.sampleSize,4);
 assert.equal(first.found,null);assert.equal(first.sourceUrl,null);
 assert.equal(first.analysis.matchedSkills.find(v=>v.name==='Python').count,3);
 assert.equal(first.analysis.matchedSkills.find(v=>v.name==='SQL').count,2);
 assert.equal(first.analysis.matchedSkills.find(v=>v.name==='Excel').count,3);
 assert.equal(first.analysis.profileCompared,false);
 assert.equal(first.aiNarrative,null);
 for(const lang of ['kk','ru','en']){
   vm.runInContext(`S.lang='${lang}'; S.page='market'; shell();`,ctx);
   assert.ok(content.innerHTML.includes('defense-demo'),lang+' button absent');
   assert.ok(content.innerHTML.includes('import-dataset'),lang+' import absent');
 }
 vm.runInContext(`notify=()=>{}; S.lang='kk'; loadDefenseDemo();`,ctx);
 const result=vm.runInContext('({market:S.market,profile:S.profile,lang:S.lang})',ctx);
 assert.equal(result.market.sampleKind,'synthetic');
 assert.equal(result.market.offlineRules,true);
 assert.ok(result.profile.name.includes('Айдана'));
 assert.ok(content.innerHTML.includes('ОЙДАН ШЫҒАРЫЛҒАН'));
});

test('v9 AI in-process daily safety quota blocks second paid request without contacting provider',async()=>{
 let calls=0;
 const upstream=createServer(async(req,res)=>{
   if(req.url.includes('/responses')){calls++;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({output:[{content:[{type:'output_text',text:'Сәлем!'}]}]}));return}
   res.writeHead(404);res.end();
 });
 await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
 const port=await freePort();
 const child=spawn(process.execPath,['server.mjs'],{cwd:new URL('.',root),env:{...process.env,NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(port),OPENAI_API_KEY:'test-pretend-key',HH_CONTACT_EMAIL:'',AI_DAILY_CALL_LIMIT:'1',TEST_OPENAI_ENDPOINT:`http://127.0.0.1:${upstream.address().port}/responses`},stdio:'ignore'});
 try{
   let up=false;
   for(let i=0;i<50;i++){try{if((await fetch(`http://127.0.0.1:${port}/api/health`)).ok){up=true;break}}catch{}await new Promise(r=>setTimeout(r,60));}
   assert.ok(up);
   const options={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lang:'kk',messages:[{role:'user',content:'Сәлем'}]})};
   const one=await fetch(`http://127.0.0.1:${port}/api/chat`,options);
   assert.equal(one.status,200);
   const two=await fetch(`http://127.0.0.1:${port}/api/chat`,options);
   assert.equal(two.status,429);assert.equal((await two.json()).code,'AI_DEMO_LIMIT');assert.equal(calls,1);
   const health=await(await fetch(`http://127.0.0.1:${port}/api/health`)).json();
   assert.equal(health.aiQuotaRemaining,0);
   assert.match(health.aiQuotaDisclaimer,/not a billing cap/i);
 }finally{child.kill();await new Promise(r=>upstream.close(r));}
});

test('v9 offline preview is a single openable file with same demo code and first-party images',async()=>{
 const preview=await readFile(new URL('PREVIEW-OFFLINE.html',root),'utf8');
 assert.ok(preview.includes('loadDefenseDemo()'));
 assert.ok(preview.includes('localDatasetAnalysis'));
 assert.ok(preview.includes('assets/concept-${n}.webp'));
 assert.ok(!preview.includes('src="/app.js"'));
});
