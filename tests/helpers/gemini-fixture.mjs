import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';

export const demoCode = 'synthetic-browser-demo-access';
export const emptyDraft = {
  fullName:'', jobTitle:'', email:'', phone:'', location:'', professionalSummary:'',
  education:'', skills:'', experience:'', projects:'', achievements:'', languages:''
};

export async function mockGemini(handler) {
  const requests = [];
  const mock = createServer(async (req, res) => {
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      requests.push(body);
      const {status = 200, text} = await handler(body, requests.length);
      res.writeHead(status, {'Content-Type':'application/json'});
      res.end(JSON.stringify(status === 200
        ? {candidates:[{content:{parts:[{text}]}}]}
        : {error:{message:'synthetic upstream failure'}}));
    } catch {
      res.writeHead(500).end();
    }
  });
  mock.listen(0, '127.0.0.1');
  await once(mock, 'listening');
  const app = spawn(process.execPath, ['server.mjs'], {
    env:{
      ...process.env, NODE_ENV:'test', HOST:'127.0.0.1', PORT:'0',
      AI_PROVIDER:'gemini', GEMINI_API_KEY:'synthetic-not-a-key', GEMINI_MODEL:'fixture-model',
      GEMINI_503_RETRIES:'1', AI_DAILY_CALL_LIMIT:'100', DEMO_ACCESS_CODE:demoCode,
      OPENAI_API_KEY:'', HH_CONTACT_EMAIL:'',
      TEST_GEMINI_ENDPOINT:`http://127.0.0.1:${mock.address().port}`
    },
    stdio:['ignore','pipe','ignore']
  });
  const stop = async () => {
    if (app.exitCode === null && app.signalCode === null) {
      const exit = once(app, 'exit');
      app.kill();
      await exit;
    }
    mock.closeAllConnections();
    await new Promise(resolve => mock.close(resolve));
  };
  try {
    let startup = '';
    const base = await Promise.race([
      (async () => {
        for await (const chunk of app.stdout) {
          startup += chunk;
          const address = /http:\/\/127\.0\.0\.1:\d+/.exec(startup)?.[0];
          if (address) return address;
        }
        throw Error('CareerBrand server exited before startup');
      })(),
      delay(8000, undefined, {ref:false}).then(() => { throw Error('CareerBrand startup timed out'); })
    ]);
    return {base, requests, stop};
  } catch (error) {
    await stop();
    throw error;
  }
}
