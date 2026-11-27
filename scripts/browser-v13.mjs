import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {demoCode, emptyDraft, mockGemini} from '../tests/helpers/gemini-fixture.mjs';

async function until(check, message) {
  const deadline = Date.now() + 8000;
  do {
    const result = await check();
    if (result) return result;
    await delay(40);
  } while (Date.now() < deadline);
  throw Error(message);
}

function devTools(socket) {
  const pending = new Map();
  let serial = 0;
  socket.addEventListener('message', ({data}) => {
    const {id, error, result} = JSON.parse(data);
    const callback = pending.get(id);
    if (!callback) return;
    pending.delete(id);
    if (error) callback.reject(Error(error.message));
    else callback.resolve(result);
  });
  socket.addEventListener('close', () => {
    for (const callback of pending.values()) callback.reject(Error('Chromium disconnected'));
    pending.clear();
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    pending.set(id, {resolve,reject});
    socket.send(JSON.stringify({id,method,params}));
  });
}

const synthetic = '1-курс студентімін. Деректер талдаушысы болғым келеді. Excel, Python білемін. Жобам: сату кестесін талдау.';
const reply = '**Кәсіби түйіндеме**\n1. Қай мамандықта оқисың?\n2. Жоба нәтижесі қандай?\n[Resource](https://example.com/guide)\n[Blocked](javascript:alert(1))\n```\n<unsafe>\n```\n<img src=x onerror="window.__injected=true">';
let failing = true;
const fixture = await mockGemini(({generationConfig, contents}) => {
  if (generationConfig.responseSchema) return {text:JSON.stringify({
    ...emptyDraft, jobTitle:'Деректер талдаушысы', education:'1-курс студентімін',
    skills:'Excel, Python', projects:'сату кестесін талдау', experience:'Invented Corp'
  })};
  if (failing && contents.at(-1).parts[0].text.includes('Тексеру 503')) return {status:503};
  return {text:reply};
});

const profile = await mkdtemp(join(tmpdir(),'careerbrand-browser-'));
const browser = spawn(process.env.CHROMIUM_BIN || 'chromium', [
  '--headless', '--disable-dev-shm-usage', '--disable-background-networking', '--no-first-run',
  '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${join(profile,'chrome')}`,
  ...(process.env.CAREERBRAND_BROWSER_NO_SANDBOX==='1' ? ['--no-sandbox'] : []), 'about:blank'
], {stdio:'ignore', env:{...process.env, XDG_CONFIG_HOME:profile}});
browser.on('error', error => { console.error(error.message); });
let socket;
try {
  const port = (await until(
    () => readFile(join(profile,'chrome','DevToolsActivePort'),'utf8').catch(() => ''),
    'Chromium debugging port was not available'
  )).split('\n')[0];
  const [tab] = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => {
    socket.addEventListener('open',resolve,{once:true});
    socket.addEventListener('error',reject,{once:true});
  });
  const command = devTools(socket);
  const evaluate = async expression => {
    const {result, exceptionDetails} = await command('Runtime.evaluate', {expression,returnByValue:true});
    if (exceptionDetails) throw Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  const css = selector => `document.querySelector(${JSON.stringify(selector)})`;
  const click = selector => evaluate(`${css(selector)}.click()`);
  const set = (selector,value,event = 'input') => evaluate(`(() => {
    const element=${css(selector)};
    element.value=${JSON.stringify(value)};
    element.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}));
  })()`);
  const wait = (expression, message) => until(() => evaluate(expression), message);
  const action = name => `[data-action="${name}"]`;

  await command('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await command('Page.navigate',{url:fixture.base+'/assistant'});
  await wait(css('#chat-input'), 'Assistant chat did not render');
  await evaluate(`sessionStorage.setItem('careerbrand-demo-code',${JSON.stringify(demoCode)});
    const state=JSON.parse(localStorage.getItem('careerbrand-v1')||'null');
    if(state) {
      state.profile.name='Сақталған есім';
      state.profile.role='Сақталған мамандық';
      state.profile.experience='Сақталған тәжірибе';
      localStorage.setItem('careerbrand-v1',JSON.stringify(state));
    } else {
      localStorage.setItem('careerbrand-v1',JSON.stringify({lang:'kk',profile:{
        name:'Сақталған есім',role:'Сақталған мамандық',experience:'Сақталған тәжірибе'
      }}));
    }`);
  await command('Page.reload');
  await wait(`${css('#chat-input')} && document.fonts.status==='loaded'`, 'Assistant did not reload');

  await set('#chat-input','Тексеру 503');
  await click('#chat-form button');
  await wait(css('#chat-body [role="status"]'), 'Chat loading indicator did not render');
  assert.equal(await evaluate(`${css('#chat-input')}.disabled`),false);
  await wait(`${css('#chat-body [role="alert"]')}?.textContent.includes('503')`, '503 did not render');
  assert.equal(await evaluate(`${css('#chat-input')}.value`),'Тексеру 503');
  failing=false;
  await click(action('retry-chat'));
  await wait(css('#chat-body strong'), 'Retry did not render Markdown');
  assert.equal(await evaluate(`${css('#chat-input')}.value`),'');
  assert.equal(await evaluate(`Boolean(${css('#chat-body ol')})`),true);
  assert.equal(await evaluate(`${css('#chat-body a')}.href`),'https://example.com/guide');
  assert.equal(await evaluate('document.querySelectorAll("#chat-body a").length'),1);
  assert.equal(await evaluate(`${css('#chat-body pre code')}.textContent`),'<unsafe>');
  assert.equal(await evaluate(`Boolean(${css('#chat-body img')}) || Boolean(window.__injected)`),false);

  await click(action('clear-chat'));
  assert.equal(await evaluate(`Boolean(${css('#chat-body strong')})`),false);
  await set('#chat-input',synthetic);
  await click('#chat-form button');
  await wait(css('#chat-body strong'), 'Student conversation did not complete');
  await click(action('generate-draft'));
  await wait(`${css('.cv-ai-section [role="alert"]')}?.textContent.includes('келісім')`, 'Consent was not enforced in the UI');
  await click('#draft-consent');
  await click(action('generate-draft'));
  await wait(css(action('review-draft')), 'Generated CV preview did not appear');
  assert.match(await evaluate(`${css('.draft-preview')}.textContent`),/сату кестесін талдау/);
  assert.doesNotMatch(await evaluate(`${css('.draft-preview')}.textContent`),/Invented Corp/);
  await click(action('review-draft'));
  assert.match(await evaluate(`${css('.draft-conflict')}.textContent`),/Сақталған мамандық/);
  assert.equal(await evaluate(`${css('[data-draft-replace="role"]')}.checked`),false);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'),true);
  await click(action('cancel-draft'));
  await click(action('review-draft'));
  await click(action('confirm-draft'));
  await wait(css('#cv-paper'), 'CV editor did not open');
  assert.equal(await evaluate(`${css('#field-name')}.value`),'Сақталған есім');
  assert.equal(await evaluate(`${css('#field-role')}.value`),'Сақталған мамандық');
  assert.equal(await evaluate(`${css('#field-experience')}.value`),'Сақталған тәжірибе');
  assert.equal(await evaluate(`${css('#field-cvProjects')}.value`),'сату кестесін талдау');

  await set('#field-role','Junior Data Analyst');
  await set('#cv-lang','en','change');
  await set('#language','ru','change');
  assert.equal(await evaluate('document.documentElement.lang'),'ru');
  assert.equal(await evaluate(`${css('#cv-lang')}.value`),'en');
  await command('Page.reload');
  await wait(css('#cv-paper'), 'CV editor did not reload');
  assert.equal(await evaluate(`${css('#field-role')}.value`),'Junior Data Analyst');
  await evaluate('window.print = () => { window.printInvoked = true; }');
  await click(action('print'));
  assert.equal(await evaluate('window.printInvoked'),true);
  const {data} = await command('Page.printToPDF',{preferCSSPageSize:true});
  const pdf = join(profile,'resume.pdf');
  await writeFile(pdf,Buffer.from(data,'base64'));
  const pdfText = execFileSync('pdftotext',[pdf,'-'],{encoding:'utf8'});
  assert.match(pdfText,/Junior Data Analyst/);
  assert.match(pdfText,/сату кестесін талдау/);
  assert.doesNotMatch(pdfText,/Сохранить/);

  await set('#language','en','change');
  await click('[data-page="assistant"]');
  assert.match(await evaluate(`${css(action('generate-draft'))}.textContent`),/Generate CV draft/);
  await set('#language','ru','change');
  assert.match(await evaluate(`${css(action('generate-draft'))}.textContent`),/Создать черновик/);
  await click(action('toggle-theme'));
  assert.equal(await evaluate('document.documentElement.dataset.theme'),'light');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'),true);

  await click('[data-page="portfolio"]');
  await set('#project-name','Synthetic portfolio project');
  await set('#project-desc','A local browser test');
  await click(action('add-project'));
  assert.match(await evaluate('document.querySelector(".project").textContent'),/Synthetic portfolio project/);
  await click('[data-page="media"]');
  assert.match(await evaluate(`${css('.promo-video source')}.src`),/careerbrand-intro\.mp4$/);

  console.log('Chromium passed: 503, editable chat, retry, safe Markdown, clear, consent, draft, conflict protection, persistent CV edits, PDF text, 390px layout, languages, theme, portfolio and media.');
} finally {
  socket?.close();
  if (browser.pid && browser.exitCode===null && browser.signalCode===null) {
    const exit = once(browser,'exit');
    browser.kill();
    await exit;
  }
  await fixture.stop();
  await rm(profile,{recursive:true,force:true});
}
