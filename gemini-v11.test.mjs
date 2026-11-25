import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { buildGeminiRequest, geminiText, geminiError } from '../gemini.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function serve(fn){return await new Promise(ok=>{const s=http.createServer(fn);s.listen(0,'127.0.0.1',()=>ok(s))})}
const addr=s=>`http://127.0.0.1:${s.address().port}`;
const json=(r,v,code=200)=>{r.writeHead(code,{'Content-Type':'application/json'});r.end(JSON.stringify(v))};
async function post(url,obj,code){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-careerbrand-access':code},body:JSON.stringify(obj)})}
async function app(env){const httpServer=await serve((_,res)=>res.end('port-holder'));const port=httpServer.address().port;await new Promise(ok=>httpServer.close(ok));const ps=spawn(process.execPath,[new URL('../server.mjs',import.meta.url).pathname],{env:{...process.env,NODE_ENV:'test',PORT:String(port),HOST:'127.0.0.1',...env},stdio:'ignore'});const base=`http://127.0.0.1:${port}`;let up=false;for(let i=0;i<80;i++){await sleep(50);try{if((await fetch(base+'/api/health')).ok){up=true;break}}catch{}}assert.ok(up,'test server should start');return {base,ps}}

test('Gemini request preserves separate system instructions, chat turns and CV JSON schema',()=>{
 const req=buildGeminiRequest({instructions:'Тек қазақша жауап бер',input:[{role:'user',content:'Сәлем'},{role:'assistant',content:'Сәлеметсіз бе!'},{role:'user',content:'CV қалай?'}],outputFormat:{schema:{type:'object',properties:{strengths:{type:'array',items:{type:'string'}}},required:['strengths']}}});
 assert.equal(req.systemInstruction.parts[0].text,'Тек қазақша жауап бер');
 assert.deepEqual(req.contents.map(x=>x.role),['user','model','user']);
 assert.equal(req.generationConfig.responseMimeType,'application/json');
 assert.equal(req.generationConfig.responseSchema.properties.strengths.items.type,'STRING');
 assert.equal(geminiText({candidates:[{content:{parts:[{text:'Қазақша жауап'}]}}]}),'Қазақша жауап');
 assert.equal(geminiError(429,{}),'AI_RATE_LIMIT');
 assert.equal(geminiError(403,{}),'AI_KEY_INVALID');
});

test('Gemini API is server-side, protected and can review CV, chat, probe and analyze synthetic vacancies',async()=>{
 const requests=[];
 const mock=await serve(async(req,res)=>{
  assert.equal(req.headers['x-goog-api-key'],'mock-gemini-key-not-real');
  let raw='';for await(const chunk of req)raw+=chunk;
  const body=JSON.parse(raw);requests.push(body);
  const schema=body.generationConfig?.responseMimeType==='application/json';
  const answer=schema?JSON.stringify({strengths:['Дағды анық жазылған'],improvements:['Жобаны нақтыла'],exampleRewrite:'Python арқылы оқу жобасын жасадым.',clarifyingQuestions:['Қандай жоба?'],limitations:'Дәлел тек енгізілген деректерге негізделген.'}):'Сәлем! Түйіндемең үшін оқу жобаңызды нақтылап жаз.';
  json(res,{candidates:[{content:{parts:[{text:answer}]}}]});
 });
 const secret='local-test-demo-code-24chars';
 const {base,ps}=await app({AI_PROVIDER:'gemini',GEMINI_API_KEY:'mock-gemini-key-not-real',GEMINI_MODEL:'gemini-3.5-flash-lite',DEMO_ACCESS_CODE:secret,TEST_GEMINI_ENDPOINT:addr(mock)+'/v1beta/models/fake:generateContent'});
 try{
  const health=await(await fetch(base+'/api/health')).json();
  assert.equal(health.aiProvider,'gemini');assert.equal(health.version,'11.0.0');assert.equal(health.aiConfigured,true);
  assert.equal(health.aiModel,'gemini-3.5-flash-lite');
  const denied=await post(base+'/api/chat',{messages:[{role:'user',content:'Сәлем'}]},'incorrect-secret');
  assert.equal(denied.status,401);assert.equal(requests.length,0);
  const chat=await post(base+'/api/chat',{lang:'kk',messages:[{role:'user',content:'CV туралы кеңес бер'}]},secret);
  assert.equal(chat.status,200);assert.match((await chat.json()).reply,/Сәлем/);
  assert.match(requests[0].systemInstruction.parts[0].text,/Қазақ тілінде/);
  assert.ok(!JSON.stringify(await(await fetch(base+'/api/health')).json()).includes('mock-gemini-key'));
  const withoutConsent=await post(base+'/api/cv-review',{lang:'kk',consent:false,profile:{skills:'Python'}},secret);
  assert.equal(withoutConsent.status,403);
  const review=await post(base+'/api/cv-review',{lang:'kk',consent:true,profile:{skills:'Python',education:'Оқу'}},secret);
  assert.equal(review.status,200);assert.match((await review.json()).review.improvements[0],/Жоба/);
  assert.equal(requests[1].generationConfig.responseMimeType,'application/json');
  const dataset=await post(base+'/api/analyze-dataset',{lang:'kk',synthetic:true,source:'SYNTHETIC',query:'data',useAI:true,aiConsent:true,vacancies:[{title:'Analyst student sample A',requirements:'SQL Excel Python практикалық талдау'},{title:'Analyst student sample B',requirements:'Power BI SQL Excel деректер талдауы'}]},secret);
  assert.equal(dataset.status,200);
  const agent=await dataset.json();assert.equal(agent.aiStatus,'completed');assert.match(agent.aiNarrative,/Сәлем/);
  const probe=await post(base+'/api/probe-ai',{},secret);assert.equal(probe.status,200);
  assert.equal((await probe.json()).provider,'gemini');
  assert.equal(requests.length,4);
 }finally{ps.kill();await new Promise(ok=>mock.close(ok))}
});

test('Gemini free-tier errors are reported, not replaced with fabricated AI responses',async()=>{
 const mock=await serve((req,res)=>json(res,{error:{code:429,message:'RESOURCE_EXHAUSTED'}},429));
 const {base,ps}=await app({AI_PROVIDER:'gemini',GEMINI_API_KEY:'fake-for-mock',TEST_GEMINI_ENDPOINT:addr(mock)+'/x'});
 try{
  const r=await post(base+'/api/chat',{lang:'kk',messages:[{role:'user',content:'Сәлем'}]});
  assert.equal(r.status,429);assert.equal((await r.json()).code,'AI_RATE_LIMIT');
 }finally{ps.kill();await new Promise(ok=>mock.close(ok))}
});
