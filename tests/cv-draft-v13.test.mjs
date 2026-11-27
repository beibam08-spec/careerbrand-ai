import test from 'node:test';
import assert from 'node:assert/strict';
import {geminiError} from '../gemini.mjs';
import {validateCVDraft} from '../cv-draft.mjs';
import {demoCode, emptyDraft, mockGemini} from './helpers/gemini-fixture.mjs';

const dialects = [
  {lang:'kk', role:'Деректер талдаушысы', turn:'Деректер талдаушысы болғым келеді. Excel білемін.', label:'Кәсіби мақсат'},
  {lang:'ru', role:'Аналитик данных', turn:'Моя цель — Аналитик данных. Знаю Excel.', label:'Карьерная цель'},
  {lang:'en', role:'Data Analyst', turn:'I want to become a Data Analyst. I know Excel.', label:'Career goal'}
];

const post = (base, path, body, access = demoCode) => fetch(base + path, {
  method:'POST', headers:{'Content-Type':'application/json','X-CareerBrand-Access':access}, body:JSON.stringify(body)
});

for (const {lang, role, turn, label} of dialects) {
  test(`Gemini adviser and grounded CV draft in ${lang}`, async t => {
    const fixture = await mockGemini(body => ({
      text: body.generationConfig.responseSchema
        ? JSON.stringify({...emptyDraft, jobTitle:role, skills:'Excel', experience:'Senior analyst at ExampleCorp'})
        : '**CV** — 1. ? 2. ?'
    }));
    t.after(fixture.stop);
    const chat = await post(fixture.base, '/api/chat', {
      lang, messages:[{role:'user', content:turn}], profile:{name:'PRIVATE_UNSHARED'}
    });
    assert.equal(chat.status, 200);
    assert.match((await chat.json()).reply, /\*\*CV\*\*/);
    assert.match(fixture.requests[0].systemInstruction.parts[0].text, /two or three targeted questions/);
    assert.doesNotMatch(JSON.stringify(fixture.requests[0]), /PRIVATE_UNSHARED/);

    const response = await post(fixture.base, '/api/cv-draft', {lang, consent:true, messages:[turn]});
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.lang, lang);
    assert.equal(result.draft.jobTitle, role);
    assert.equal(result.draft.skills, 'Excel');
    assert.equal(result.draft.experience, '');
    assert.equal(result.draft.email, '');
    assert.match(result.draft.professionalSummary, new RegExp(label));
    const upstream = fixture.requests[1];
    assert.equal(upstream.generationConfig.responseMimeType, 'application/json');
    assert.deepEqual(upstream.generationConfig.responseSchema.required, Object.keys(emptyDraft));
    assert.deepEqual(upstream.contents, [{role:'user',parts:[{text:turn}]}]);
  });
}

test('CV draft protects authorization, consent, input and provider data', async t => {
  let text = '{invalid JSON';
  const fixture = await mockGemini(() => ({text}));
  t.after(fixture.stop);
  const request = {consent:true, messages:['I know Excel and I want to work with data']};
  assert.equal((await post(fixture.base, '/api/cv-draft', request, 'wrong')).status, 401);
  assert.equal((await post(fixture.base, '/api/cv-draft', {...request,consent:false})).status, 403);
  assert.equal((await post(fixture.base, '/api/cv-draft', {...request,messages:[]})).status, 422);
  assert.equal((await post(fixture.base, '/api/cv-draft', {...request,messages:['x'.repeat(4100)]})).status, 400);
  assert.equal(fixture.requests.length, 0);

  const malformed = await post(fixture.base, '/api/cv-draft', request);
  assert.equal(malformed.status, 502);
  assert.deepEqual(await malformed.json(), {code:'CV_DRAFT_INVALID'});
  text = JSON.stringify({...emptyDraft,skills:'Excel'});
  const incomplete = await post(fixture.base, '/api/cv-draft', request);
  assert.equal(incomplete.status, 422);
  assert.deepEqual(await incomplete.json(), {code:'CV_DRAFT_INSUFFICIENT'});
  assert.deepEqual(validateCVDraft(JSON.stringify({...emptyDraft,phone:'0'.repeat(61)}),[],'kk'), {code:'CV_DRAFT_INVALID'});
});

test('a quoted fragment cannot reverse an explicit denial of employment', () => {
  const candidate = JSON.stringify({...emptyDraft, jobTitle:'Data Analyst', skills:'Excel', experience:'worked at DemoCorp'});
  const {draft} = validateCVDraft(candidate, [
    'My goal is Data Analyst. I know Excel. I never worked at DemoCorp.'
  ], 'en');
  assert.equal(draft.experience,'');
});

test('Gemini distinguishes provider errors and retries overload only within its budget', async t => {
  const statuses = [[400,'AI_PROVIDER_BAD_REQUEST'],[401,'AI_KEY_INVALID'],[403,'AI_PROVIDER_FORBIDDEN'],
    [404,'AI_MODEL_UNAVAILABLE'],[429,'AI_RATE_LIMIT'],[500,'AI_UPSTREAM'],[503,'AI_BUSY']];
  for (const [status, code] of statuses) assert.equal(geminiError(status, {}), code);
  let status = 503;
  const fixture = await mockGemini(() => ({status}));
  t.after(fixture.stop);
  const payload = {messages:[{role:'user',content:'Excel туралы кеңес'}]};
  const unavailable = await post(fixture.base, '/api/chat', payload);
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {code:'AI_BUSY'});
  assert.equal(fixture.requests.length, 2);
  status = 429;
  const limited = await post(fixture.base, '/api/chat', payload);
  assert.equal(limited.status, 429);
  assert.deepEqual(await limited.json(), {code:'AI_RATE_LIMIT'});
  assert.equal(fixture.requests.length, 3);
});
