/**
 * Safe deployment smoke tests. Never invokes billable AI or third-party jobs APIs.
 * Usage:
 *   npm run smoke                      -> start and test a temporary local server
 *   node scripts/smoke.mjs https://example.onrender.com -> test hosted site
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv[2]?.trim();
let child;
const logs = [];
let base;
const tests = [];
function assert(condition, message){ if(!condition)throw Error(message); }
async function reservePort(){
  return await new Promise((resolve,reject)=>{
    const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{
      const {port}=s.address();s.close(()=>resolve(port));
    });
  });
}
function urlFor(resource){return new URL(resource,base).toString()}
async function fetchWithTimeout(resource, opts={}){
  const c=new AbortController();const timer=setTimeout(()=>c.abort(),10000);
  try{return await fetch(urlFor(resource),{...opts,signal:c.signal,redirect:'manual'});}finally{clearTimeout(timer)}
}
async function check(name,run){
  try{await run();tests.push({name,ok:true});process.stdout.write('✓ '+name+'\n')}
  catch(e){tests.push({name,ok:false});process.stderr.write('✗ '+name+': '+e.message+'\n')}
}
async function waitReady(maxMs){
  const until=Date.now()+maxMs;
  while(Date.now()<until){
    try{const res=await fetchWithTimeout('/api/health');if(res.ok)return}
    catch{}
    if(child?.exitCode!==null && child?.exitCode!==undefined)break;
    await delay(800);
  }
  throw new Error(`Server not ready. ${logs.slice(-3).join(' ').slice(-250)}`)
}
try{
  if(arg){
    const target=new URL(arg);
    const local=['127.0.0.1','localhost','[::1]'].includes(target.hostname);
    assert(target.protocol==='https:' || (local && target.protocol==='http:'), 'A remote site must use HTTPS.');
    assert(target.username===''&&target.password===''&&target.search==='', 'Use a clean site URL without credentials or query.');
    base=target.origin;
    console.log('Read-only remote check:',base,'(no AI calls)');
    await waitReady(110000); // free Render cold-start can take ~1 minute
  }else{
    const port=await reservePort();
    base=`http://127.0.0.1:${port}`;
    const env={...process.env,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'production'};
    // Explicit no-pay test: never call external integrations or use their keys.
    for(const k of ['OPENAI_API_KEY','GEMINI_API_KEY','AI_PROVIDER','HH_CONTACT_EMAIL','DEMO_ACCESS_CODE','TEST_OPENAI_ENDPOINT','TEST_GEMINI_ENDPOINT','TEST_HH_ENDPOINT'])delete env[k];
    child=spawn(process.execPath,['server.mjs'],{cwd:root,env,stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',d=>logs.push(d.toString()));
    child.stderr.on('data',d=>logs.push(d.toString()));
    await waitReady(12000);
    console.log('Started local server:',base,'(no credentials and no external requests)');
  }
  await check('Server health reports status, source, and version',async()=>{
    const r=await fetchWithTimeout('/api/health');assert(r.status===200,'health HTTP '+r.status);
    const d=await r.json();assert(d.ok===true,'health.ok is not true');
    assert(typeof d.version==='string'&&d.version.startsWith('11.'),'unexpected version');
    assert(typeof d.aiConfigured==='boolean','missing AI configuration status');
    assert(typeof d.jobsConfigured==='boolean','missing jobs configuration status');
  });
  for(const route of ['/','/brand','/cv','/portfolio','/video','/market','/assistant','/research','/media']){
    await check(`Page ${route}`,async()=>{
      const r=await fetchWithTimeout(route);assert(r.status===200,'HTTP '+r.status);
      assert((r.headers.get('content-type')||'').includes('text/html'),'not HTML');
      const body=await r.text();assert(body.includes('CareerBrand AI')||body.includes('CareerBrand'),'unexpected page');
    });
  }
  for(const [resource,mime] of [['/app.js','javascript'],['/styles-v7.css','text/css'],['/styles.css','text/css'],['/favicon.svg','image/svg+xml'],['/assets/concept-1.webp','image/webp'],['/assets/career-ambient.mp3','audio/mpeg'],['/assets/careerbrand-intro.mp4','video/mp4']]){
    await check(`Static ${resource}`,async()=>{
      const r=await fetchWithTimeout(resource);assert(r.status===200,'HTTP '+r.status);
      assert((r.headers.get('content-type')||'').includes(mime),'wrong type: '+r.headers.get('content-type'));
      const ab=await r.arrayBuffer();assert(ab.byteLength>0,'empty asset');
    });
  }
  await check('Video range playback returns partial content',async()=>{
    const r=await fetchWithTimeout('/assets/careerbrand-intro.mp4',{headers:{Range:'bytes=0-99'}});
    assert(r.status===206,'expected 206, got '+r.status);
    assert((r.headers.get('content-range')||'').startsWith('bytes 0-99/'),'wrong content-range');
    assert((await r.arrayBuffer()).byteLength===100,'wrong range length');
  });
  await check('Unknown path returns 404',async()=>{
    const r=await fetchWithTimeout('/no-such-page-ever');assert(r.status===404,'HTTP '+r.status);
  });
  // Intentional: no POST /api/chat, no POST /api/probe-ai, no paid requests.
  const passed=tests.filter(x=>x.ok).length;
  console.log(`\n${passed}/${tests.length} safe site checks passed. External paid AI and HH APIs were NOT tested.`);
  if(passed!==tests.length)process.exitCode=1;
}catch(e){console.error('Smoke test cannot complete:',e.message);process.exitCode=1}
finally{
  if(child){child.kill('SIGTERM');await delay(120)}
}
