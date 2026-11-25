import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { responseText, validateReview, serviceError } from '../openai.mjs';

const sendJson=(res, data, code=200)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data))};
const withServer=(handler)=>new Promise(resolve=>{const srv=http.createServer(handler);srv.listen(0,'127.0.0.1',()=>resolve(srv))});
const address=srv=>`http://127.0.0.1:${srv.address().port}`;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const parseBody=async req=>{let body='';for await (const x of req)body+=x;return JSON.parse(body)};
const exampleJobs={found:3,items:[
 {id:'v101',name:'Junior Python developer',employer:{name:'Sample Ltd'},alternate_url:'https://hh.kz/vacancy/111',published_at:'2026-11-18T00:00:00+0500',snippet:{requirement:'Python, SQL, Git'},salary:{from:300000,to:450000,currency:'KZT',gross:false}},
 {id:'v102',name:'Data Analyst',employer:{name:'Test employer'},alternate_url:'https://hh.kz/vacancy/112',published_at:'2026-11-18T00:00:00+0500',snippet:{requirement:'Excel, SQL, Power BI'},salary:null},
 {id:'v103',name:'Junior Excel Analyst',employer:{name:'Example'},alternate_url:'https://hh.kz/vacancy/113',published_at:'2026-11-18T00:00:00+0500',snippet:{requirement:'Excel and SQL'},salary:null}
]};
const post=(url, obj)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});

test('Responses parsing and errors are safe',()=>{
 assert.equal(responseText({output:[{content:[{type:'output_text',text:'Сәлем!'}]}]}),'Сәлем!');
 assert.equal(serviceError(401,{}),'AI_KEY_INVALID');
 assert.equal(serviceError(429,{error:{code:'insufficient_quota'}}),'AI_NO_CREDITS');
 assert.equal(validateReview('not json'),null);
 assert.equal(validateReview(JSON.stringify({strengths:['A'],improvements:['B'],exampleRewrite:'C',clarifyingQuestions:[],limitations:'D'})).strengths[0],'A');
});

test('end-to-end local mock verifies chat, CV review, explicit consent, market data and errors',async()=>{
 const calls=[];const hhCalls=[];
 const upstream=await withServer(async(req,res)=>{
  if(req.url.startsWith('/vacancies')){hhCalls.push({url:req.url,agent:req.headers['hh-user-agent']});return sendJson(res,exampleJobs)}
  if(req.url.startsWith('/responses')){
   const body=await parseBody(req);calls.push(body);
   if(body.text?.format?.name==='careerbrand_cv_review')return sendJson(res,{output:[{content:[{type:'output_text',text:JSON.stringify({
      strengths:['Нақты технологиялар көрсетілген'],improvements:['Жоба нәтижесін дәлелде'],exampleRewrite:'SQL арқылы оқу деректерін талдадым (нәтиже санын нақтылау керек).',clarifyingQuestions:['Қандай деректермен жұмыс істедің?'],limitations:'Тек енгізілген түйіндеме негізінде.'
   })}]}]});
   return sendJson(res,{output:[{content:[{type:'output_text',text:'Сәлем! Түйіндемеңе нақты жобалар қосуды ұсынамын.'}]}]});
  }
  return sendJson(res,{error:{code:'not_found'}},404);
 });
 const apiPort=37000+Math.floor(Math.random()*2000);
 const child=spawn(process.execPath,[new URL('../server.mjs',import.meta.url).pathname],{
  env:{...process.env,NODE_ENV:'test',PORT:String(apiPort),OPENAI_API_KEY:'test-placeholder-no-real-key',
   HH_CONTACT_EMAIL:'career-test@example.edu',TEST_OPENAI_ENDPOINT:address(upstream)+'/responses',TEST_HH_ENDPOINT:address(upstream)+'/vacancies'},stdio:'ignore'});
 const root=`http://127.0.0.1:${apiPort}`;
 try{
  let ready=false;
  for(let i=0;i<40;i++){await pause(80);try{const r=await fetch(root+'/api/health');if(r.ok){ready=true;break}}catch{}}
  assert.ok(ready,'app server should start');
  const health=await(await fetch(root+'/api/health')).json();
  assert.equal(health.aiConfigured,true);
  assert.equal(health.version,'11.0.0');assert.equal(health.jobsConfigured,true);
  const chat=await post(root+'/api/chat',{lang:'kk',messages:[{role:'user',content:'Маған CV туралы кеңес бер'}]});
  assert.equal(chat.status,200);assert.match((await chat.json()).reply,/Сәлем/);
  assert.ok(!calls[0].instructions.includes('Маған CV туралы кеңес бер'),'user text must not be put in system instructions');
  assert.equal(calls[0].store,false);
  const withoutConsent=await post(root+'/api/cv-review',{lang:'kk',consent:false,profile:{skills:'Python'}});
  assert.equal(withoutConsent.status,403);
  assert.equal((await withoutConsent.json()).code,'CONSENT_REQUIRED');
  const withConsent=await post(root+'/api/cv-review',{lang:'kk',consent:true,targetRole:'Backend developer',profile:{skills:'Python',experience:'Оқу жобасы'}});
  assert.equal(withConsent.status,200);
  const review=await withConsent.json();
  assert.match(review.review.improvements[0],/Жоба нәтижесін/);
  assert.equal(review.lang,'kk');
  assert.ok(!calls[1].instructions.includes('Оқу жобасы'),'profile must not be placed in system instructions');
  assert.equal(calls[1].text.format.name,'careerbrand_cv_review');
  const jobs=await(await fetch(root+'/api/jobs?query=Data%20Analyst&area=160')).json();
  assert.equal(jobs.sampleSize,3);assert.ok(hhCalls.some(x=>x.url.includes('host=hh.kz')));assert.ok(hhCalls.some(x=>String(x.agent).includes('career-test@example.edu')));
  assert.equal(jobs.vacancies[0].employer,'Sample Ltd');
  assert.equal(jobs.vacancies[0].salary.from,300000);
  const agentReq=await post(root+'/api/agent',{lang:'kk',area:'160',query:'Data Analyst',profile:{skills:'Python'},useAI:true});
  assert.equal(agentReq.status,200);
  const agent=await agentReq.json();
  assert.equal(agent.aiStatus,'completed');
  assert.equal(agent.analysis.sampleSize,3);
  assert.equal(agent.analysis.matchedSkills.find(x=>x.name==='SQL').count,3);
  assert.ok(agent.analysis.possibleGaps.find(x=>x.name==='SQL'));
  assert.match(agent.aiNarrative,/Сәлем/); // synthetic language-model response from test mock
  assert.equal(calls.at(-1).store,false);
  const diagnostics=await (await fetch(root+'/api/check-services')).json();
  assert.equal(diagnostics.jobsStatus,'connected');
  assert.equal(diagnostics.aiStatus,'configured_unverified');
  assert.ok(diagnostics.checkedAt);
 } finally {child.kill(); await new Promise(resolve=>upstream.close(resolve));}
});

test('shared demo code protects AI and vacancy calls, and real probe is explicitly triggered', async()=>{
 const requestBodies=[];
 const mock=await withServer(async(req,res)=>{
  if(req.url.startsWith('/responses')){requestBodies.push(await parseBody(req));return sendJson(res,{output:[{content:[{type:'output_text',text:'Сәлем!'}]}]});}
  if(req.url.startsWith('/vacancies'))return sendJson(res,exampleJobs);
  return sendJson(res,{error:{code:'not_found'}},404);
 });
 const port=39000+Math.floor(Math.random()*1000);
 const passcode='school-demo-code-2026-sample';
 const child=spawn(process.execPath,[new URL('../server.mjs',import.meta.url).pathname],{
  env:{...process.env,NODE_ENV:'test',PORT:String(port),HOST:'127.0.0.1',
   DEMO_ACCESS_CODE:passcode,OPENAI_API_KEY:'fake-key-in-mocked-test',HH_CONTACT_EMAIL:'test@example.edu',
   TEST_OPENAI_ENDPOINT:address(mock)+'/responses',TEST_HH_ENDPOINT:address(mock)+'/vacancies'},stdio:'ignore'
 });
 const base=`http://127.0.0.1:${port}`;
 try{
  let up=false;for(let i=0;i<40;i++){await pause(80);try{if((await fetch(base+'/api/health')).ok){up=true;break}}catch{}}
  assert.equal(up,true);
  const health=await (await fetch(base+'/api/health')).json();assert.equal(health.accessRequired,true);
  const noCode=await post(base+'/api/chat',{lang:'kk',messages:[{role:'user',content:'CV?'}]});
  assert.equal(noCode.status,401);assert.equal((await noCode.json()).code,'ACCESS_DENIED');
  const noJob=await fetch(base+'/api/jobs?query=Data%20Analyst');assert.equal(noJob.status,401);
  const noDiag=await fetch(base+'/api/check-services');assert.equal(noDiag.status,401);
  const wrong=await fetch(base+'/api/probe-ai',{method:'POST',headers:{'X-CareerBrand-Access':'wrong'}});
  assert.equal(wrong.status,401);assert.equal(requestBodies.length,0,'Unauthorized calls never reach the AI provider');
  const forged=await fetch(base+'/api/probe-ai',{method:'POST',headers:{'X-CareerBrand-Access':passcode,Origin:'https://attacker.example'}});
  assert.equal(forged.status,403);assert.equal((await forged.json()).code,'BAD_ORIGIN');
  const right=await fetch(base+'/api/probe-ai',{method:'POST',headers:{'X-CareerBrand-Access':passcode}});
  assert.equal(right.status,200);const diag=await right.json();assert.equal(diag.status,'connected');
  assert.equal(requestBodies.length,1);assert.ok(!JSON.stringify(requestBodies[0]).includes('fake-key-in-mocked-test'));
  assert.equal(requestBodies[0].store,false);
  assert.ok(requestBodies[0].max_output_tokens<=120);
  const authorized=await fetch(base+'/api/check-services',{headers:{'X-CareerBrand-Access':passcode}});
  assert.equal(authorized.status,200);assert.equal((await authorized.json()).jobsStatus,'connected');
 }finally{child.kill();await new Promise(resolve=>mock.close(resolve));}
});

test('public deployment fails closed with a provider key but no strong demo code', async()=>{
 const child=spawn(process.execPath,[new URL('../server.mjs',import.meta.url).pathname],{
  env:{...process.env,NODE_ENV:'production',HOST:'0.0.0.0',PORT:'39999',OPENAI_API_KEY:'fake-key',HH_CONTACT_EMAIL:'',DEMO_ACCESS_CODE:''},
  stdio:['ignore','ignore','pipe']
 });
 let stderr='';for await(const b of child.stderr)stderr+=b.toString();
 const exitCode=await new Promise(r=>child.on('exit',r));
 assert.equal(exitCode,1);
 assert.match(stderr,/Refusing public AI server/);
});
