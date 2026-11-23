import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});s.on('error',reject);});}
test('v7 visual assets are served as first-party files, with a no-cost default theme',async()=>{
 const html=await readFile(path.join(dir,'index.html'),'utf8');
 const js=await readFile(path.join(dir,'app.js'),'utf8');
 assert.match(html,/styles-v7\.css/);
 assert.match(js,/I\.kk\.menuHelp='10\.0/);
 assert.match(js,/function readTheme\(\)/);
 assert.match(js,/const dashboardLabel/);
 assert.match(js,/dashMockNote/);
 const port=await freePort();
 const child=spawn(process.execPath,['server.mjs'],{cwd:dir,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',OPENAI_API_KEY:'',HH_CONTACT_EMAIL:''},stdio:'ignore'});
 try{
  let response;
  for(let n=0;n<70;n++){
   try{response=await fetch(`http://127.0.0.1:${port}/styles-v7.css`);break}catch{await new Promise(r=>setTimeout(r,40));}
  }
  assert.ok(response,'CSS asset must be fetchable');
  assert.equal(response.status,200,'CSS must not silently 404 in actual server');
  const css=await response.text();
  assert.match(css,/\.command-hero/);
  assert.match(css,/html\[data-theme="light"\]/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
 }finally{child.kill('SIGTERM')}
});
