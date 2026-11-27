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

const localizedEvidence = [
  {
    lang:'kk',
    confirmed:'1-курс студентімін. Жобам: ауа райы кестесін талдау.',
    denies:'Excel білмеймін. Data Analyst болғым келмейді. Мен Google-да жұмыс істемедім.',
    contrast:'Excel білмеймін, бірақ Python білемін.',
    example:'Мысалы: Excel білемін.\nGoogle-да жұмыс істедім.\nData Analyst болғым келеді.',
    quoted:'Мысалы, «Excel білемін. Google-да жұмыс істедім».',
    conditional:'Егер Excel білсем, Google-да жұмыс істер едім.',
    question:'Excel маған керек пе?',
    goals:['Data Analyst болғым келеді.', 'Менің мақсатым — UX Designer.'],
    withdrawal:'Бұл дұрыс емес.'
  },
  {
    lang:'ru',
    confirmed:'Учусь на первом курсе. Проект: анализ таблицы погоды.',
    denies:'Не знаю Excel. Не хочу стать Data Analyst. Я не работал в Google.',
    contrast:'Не знаю Excel, но знаю Python.',
    example:'Например: знаю Excel.\nРаботал в Google.\nХочу стать Data Analyst.',
    quoted:'Например, «знаю Excel. Работал в Google».',
    conditional:'Если бы я знал Excel, работал бы в Google.',
    question:'Стоит ли мне изучать Excel?',
    goals:['Хочу стать Data Analyst.', 'Моя цель — UX Designer.'],
    withdrawal:'Это неправда.'
  },
  {
    lang:'en',
    confirmed:'I am a first-year student. My project is analyzing a weather table.',
    denies:'I don’t know Excel. I do not want to be a Data Analyst. I never worked at Google.',
    contrast:'I do not know Excel, but I know Python.',
    example:'Sample CV: I know Excel.\nI worked at Google.\nI want to be a Data Analyst.',
    quoted:'For example, “I know Excel. I worked at Google.”',
    conditional:'If I knew Excel, I would work at Google.',
    question:'Should I learn Excel?',
    goals:['I want to be a Data Analyst.', 'My career goal is UX Designer.'],
    withdrawal:'Correction: that was wrong.'
  }
];

for (const sample of localizedEvidence) {
  const [education, projects] = sample.confirmed.split('. ');
  const verify = (values, ...messages) => validateCVDraft(
    JSON.stringify({...emptyDraft, education, projects, ...values}),
    [sample.confirmed, ...messages],
    sample.lang
  );

  test(`${sample.lang}: denials cannot become skills, career goals, or employment`, () => {
    const {draft, needsClarification} = verify({
      skills:'Excel', jobTitle:'Data Analyst', experience:'Google', professionalSummary:'Excel'
    }, sample.denies);
    assert.equal(needsClarification, true);
    for (const field of ['skills','jobTitle','experience']) {
      assert.equal(draft[field], '', field);
    }
    assert.doesNotMatch(draft.professionalSummary, /Excel|Google|Data Analyst/);
    assert.ok(draft.professionalSummary.includes(education));
    assert.equal(draft.education, education);
    assert.equal(draft.projects, projects);
    assert.equal(verify({skills:'Python'}, sample.contrast).draft.skills, 'Python');
  });

  test(`${sample.lang}: examples, questions, and conditions are not evidence`, () => {
    const {draft, needsClarification} = verify({
      skills:'Excel', jobTitle:'Data Analyst', experience:'Google'
    }, sample.example);
    assert.equal(needsClarification, true);
    assert.equal(draft.skills, '');
    assert.equal(draft.jobTitle, '');
    assert.equal(draft.experience, '');
    assert.equal(verify({experience:'Google'}, sample.quoted).draft.experience, '');
    assert.equal(verify({skills:'Excel', experience:'Google'}, sample.conditional).draft.experience, '');
    assert.equal(verify({skills:'Excel'}, sample.question).draft.skills, '');
  });

  test(`${sample.lang}: later contradictions suppress matching claims and summary text`, () => {
    const {draft, needsClarification} = verify({
      skills:'Excel, Python', jobTitle:'Data Analyst', experience:'Google'
    }, 'Excel, Python. Data Analyst. Google.', sample.denies.toUpperCase());
    assert.equal(needsClarification, true);
    assert.equal(draft.skills, '');
    assert.equal(draft.jobTitle, '');
    assert.equal(draft.experience, '');

    const {draft: conflictingGoals} = verify({
      jobTitle:'Data Analyst', professionalSummary:sample.goals[0]
    }, ...sample.goals);
    assert.equal(conflictingGoals.jobTitle, '');
    assert.doesNotMatch(conflictingGoals.professionalSummary, /Data Analyst|UX Designer/);

    assert.equal(verify({jobTitle:'Data Analyst'}, sample.goals[0], sample.withdrawal).draft.jobTitle, '');
    assert.equal(verify({jobTitle:'Data Analyst'}, sample.goals[0], sample.goals[0]).draft.jobTitle, 'Data Analyst');
  });
}

test('CV draft endpoint requests clarification when proposed facts were denied', async t => {
  const fixture = await mockGemini(() => ({
    text:JSON.stringify({...emptyDraft, jobTitle:'Data Analyst', skills:'Excel'})
  }));
  t.after(fixture.stop);
  const response = await post(fixture.base, '/api/cv-draft', {
    consent:true, lang:'kk', messages:[localizedEvidence[0].denies]
  });
  assert.equal(response.status, 422);
  assert.deepEqual(await response.json(), {code:'CV_DRAFT_CLARIFICATION'});
});

const skillRegressions = [
  {
    lang:'kk',
    assertion:'Python білемін.',
    question:'Python үйренуім керек пе?',
    zero:'Excel бойынша тәжірибем жоқ.',
    mention:'Excel туралы мақала оқыдым.',
    additive:'Мен Excel ғана емес, Python-ды да білемін.',
    denial:'Python білмеймін.',
    unrelated:'Python туралы кітап жазбадым.',
    career:'Мен Acme-де жұмыс істедім. Мен Tech Cup жеңіп алдым.',
    careerDenial:'Мен Acme-де жұмыс істемедім. Мен Tech Cup жеңіп алмадым.',
    careerQuestion:'Acme-де жұмыс істеуге бола ма? Tech Cup алсам ше?'
  },
  {
    lang:'ru',
    assertion:'Знаю Python.',
    question:'Стоит ли мне изучать Python?',
    zero:'У меня ноль опыта работы с Excel.',
    mention:'Прочитал статью про Excel.',
    additive:'Я знаю не только Excel, но и Python.',
    denial:'Я не знаю Python.',
    unrelated:'Я не написал книгу о Python.',
    career:'Я работал в Acme. Я выиграл Tech Cup.',
    careerDenial:'Я не работал в Acme. Я не выиграл Tech Cup.',
    careerQuestion:'Стоит ли мне работать в Acme? Что если я выиграю Tech Cup?'
  },
  {
    lang:'en',
    assertion:'I know Python.',
    question:'Should I learn Python?',
    zero:'I have zero experience with Excel.',
    mention:'I read an article about Excel.',
    additive:'I know not only Excel but also Python.',
    denial:'I don’t know Python.',
    unrelated:'I did not write a book about Python.',
    career:'I worked at Acme. I won the Tech Cup.',
    careerDenial:'I never worked for Acme. I didn’t win the Tech Cup.',
    careerQuestion:'Should I work at Acme? What if I win the Tech Cup?'
  }
];

for (const sample of skillRegressions) {
  const verify = (values, ...messages) => validateCVDraft(
    JSON.stringify({...emptyDraft, education:'First-year student', projects:'Weather dashboard', ...values}),
    ['First-year student. Weather dashboard.', ...messages],
    sample.lang
  );

  test(`${sample.lang}: skills need affirmative evidence and exclude zero experience`, () => {
    const result = verify({skills:'Python, Excel', professionalSummary:'Excel'}, sample.assertion, sample.zero);
    assert.equal(result.draft.skills, 'Python');
    assert.equal(result.needsClarification, true);
    assert.doesNotMatch(result.draft.professionalSummary, /Excel/);
    assert.equal(verify({skills:'Excel'}, sample.mention).draft.skills, '');
    assert.equal(verify({skills:'Excel'}, sample.zero).draft.skills, '');
  });

  test(`${sample.lang}: questions and unrelated denials preserve skills, direct contradiction does not`, () => {
    const candidate = {skills:'Python'};
    assert.equal(verify(candidate, sample.question).draft.skills, '');
    assert.equal(verify(candidate, sample.assertion, sample.question).draft.skills, 'Python');
    assert.equal(verify(candidate, sample.assertion, sample.unrelated).draft.skills, 'Python');
    const conflict = verify(candidate, sample.assertion, sample.denial);
    assert.equal(conflict.draft.skills, '');
    assert.equal(conflict.needsClarification, true);
  });

  test(`${sample.lang}: additive conjunction confirms both skills and keeps independent claims`, () => {
    assert.equal(verify({skills:'Excel, Python'}, sample.additive).draft.skills, 'Excel, Python');
    assert.equal(verify({skills:'Excel, Python'}, sample.additive, sample.denial).draft.skills, 'Excel');
    assert.equal(verify({skills:'PythonScript'}, sample.assertion).draft.skills, '');
  });

  test(`${sample.lang}: career fields require self-reports and reject actual contradictions`, () => {
    const candidate = {experience:'Acme', achievements:'Tech Cup'};
    for (const messages of [
      ['A news article about Acme and Tech Cup.'],
      [sample.careerQuestion],
      [sample.career, sample.careerDenial]
    ]) {
      const {draft} = verify(candidate, ...messages);
      assert.equal(draft.experience, '');
      assert.equal(draft.achievements, '');
    }
    const {draft} = verify(candidate, sample.career, sample.careerQuestion);
    assert.equal(draft.experience, 'Acme');
    assert.equal(draft.achievements, 'Tech Cup');
  });
}

test('CV endpoint retains affirmative evidence when the requested output and conversation languages differ', async t => {
  const fixture = await mockGemini(() => ({
    text:JSON.stringify({...emptyDraft, education:'First-year student', skills:'Python, Excel'})
  }));
  t.after(fixture.stop);
  const response = await post(fixture.base, '/api/cv-draft', {
    consent:true, lang:'kk', messages:[
      'First-year student. I know Python. Should I learn Python? I have zero experience with Excel.'
    ]
  });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.draft.skills, 'Python');
  assert.equal(result.needsClarification, true);
  assert.match(result.draft.professionalSummary, /Дағдылары: Python/);
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
