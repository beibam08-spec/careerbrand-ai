import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import vm from 'node:vm';

const here = new URL('../', import.meta.url);
const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const dictSource = source.slice(0, source.indexOf('const APP_KEY'));
const I = vm.runInNewContext(dictSource + '\nI;', {});

test('three translations have identical dictionary keys', () => {
  const kk = Object.keys(I.kk).sort();
  assert.ok(kk.length > 120);
  for (const lang of ['ru', 'en']) assert.deepEqual(Object.keys(I[lang]).sort(), kk, `${lang} key mismatch`);
  assert.equal(I.kk.overview, 'Басты бет');
});

test('all site files exist and contain no third-party runtime dependencies', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.dependencies, undefined);
  for (const filename of ['index.html', 'styles.css', 'app.js', 'server.mjs']) {
    const content = await readFile(new URL('../' + filename, import.meta.url), 'utf8');
    assert.ok(content.length > 100);
  }
});

test('server serves app and safely reports missing AI key', async () => {
  const port = 34971;
  const child = spawn(process.execPath, [new URL('../server.mjs', import.meta.url).pathname], { env: { ...process.env, PORT: String(port), OPENAI_API_KEY: '' }, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 35; i++) {
      await new Promise(r => setTimeout(r, 100));
      try { const ping = await fetch(`http://127.0.0.1:${port}/api/health`); if (ping.ok) { ready = true; break; } } catch {}
    }
    assert.ok(ready, 'server should start');
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert.equal(health.aiConfigured, false);
    const index = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /lang="kk"/);
    const css = await fetch(`http://127.0.0.1:${port}/styles.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);
    const chat = await fetch(`http://127.0.0.1:${port}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang: 'kk', messages: [{ role: 'user', content: 'Сәлем' }] }) });
    assert.equal(chat.status, 503);
    assert.equal((await chat.json()).code, 'AI_NOT_CONFIGURED');
    const badJob = await fetch(`http://127.0.0.1:${port}/api/jobs?query=a&area=160`);
    assert.equal(badJob.status, 400);
    const unknown = await fetch(`http://127.0.0.1:${port}/.env`);
    assert.equal(unknown.status, 404);
  } finally { child.kill(); }
});

test('client renders every page in all three languages without a DOM runtime error', async () => {
  const app = { innerHTML: '', addEventListener(){} };
  const content = { innerHTML: '' };
  const document = { documentElement: {lang:'kk'}, getElementById(id) {return id==='app'?app:id==='content'?content:null}, querySelector(){return null} };
  const localStorage = {getItem:()=>null,setItem:()=>{}};
  const ctx = vm.createContext({document,localStorage,console,fetch:async()=>({json:async()=>({aiConfigured:false})}),setTimeout,clearTimeout,Intl,URL,encodeURIComponent,confirm:()=>true,window:{print(){}}});
  vm.runInContext(source,ctx);
  for(const lang of ['kk','ru','en']){
    for(const p of ['overview','brand','resume','portfolio','video','market','assistant']) {
      vm.runInContext(`S.lang='${lang}';S.page='${p}';shell();`,ctx);
      assert.ok(content.innerHTML.length > 300,`${lang}/${p} must render`);
      assert.ok(!content.innerHTML.includes('undefined'),`${lang}/${p} should not have undefined content`);
    }
  }
});
