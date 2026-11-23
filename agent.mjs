/**
 * CareerBrand AI — source-grounded analysis of an actual vacancy sample.
 * This module is fully deterministic: it never calls a language model and it
 * does NOT claim to infer labor-market trends from one search page.
 */
export const SKILL_LEXICON = Object.freeze([
  { name: 'Python', aliases: ['python', 'питон'] },
  { name: 'SQL', aliases: ['sql', 't-sql', 'pl/sql'] },
  { name: 'Excel', aliases: ['excel', 'эксель', 'эксел', 'электронные таблицы'] },
  { name: 'Power BI', aliases: ['power bi', 'powerbi'] },
  { name: 'Tableau', aliases: ['tableau'] },
  { name: 'Git', aliases: ['git', 'github', 'gitlab'] },
  { name: 'JavaScript', aliases: ['javascript', 'java script', 'js'] },
  { name: 'TypeScript', aliases: ['typescript', 'ts'] },
  { name: 'React', aliases: ['react', 'react.js', 'reactjs'] },
  { name: 'Figma', aliases: ['figma', 'фигма'] },
  { name: 'PostgreSQL', aliases: ['postgresql', 'postgres'] },
  { name: 'Django', aliases: ['django'] },
  { name: 'FastAPI', aliases: ['fastapi', 'fast api'] },
  { name: 'Docker', aliases: ['docker'] },
  { name: 'Java', aliases: ['java'] },
  { name: 'PHP', aliases: ['php'] },
  { name: '1C', aliases: ['1c', '1с', '1с:предприятие', '1c:enterprise'] },
  { name: 'Photoshop', aliases: ['photoshop'] },
  { name: 'HTML', aliases: ['html', 'html5'] },
  { name: 'CSS', aliases: ['css', 'css3'] },
  { name: 'REST API', aliases: ['rest api', 'restful', 'rest-api'] },
  { name: 'Machine Learning', aliases: ['machine learning', 'машинное обучение', 'машиналық оқыту'] },
  { name: 'Data analysis', aliases: ['data analysis', 'data analytics', 'анализ данных', 'талдау деректері', 'деректерді талдау'] }
]);

function hasAlias(text, alias) {
  const literal = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${literal}(?![\\p{L}\\p{N}])`, 'iu').test(text);
}
const clean = x => typeof x === 'string' ? x.slice(0, 2000) : '';
function skillMatches(text) { return SKILL_LEXICON.filter(s => s.aliases.some(alias => hasAlias(text, alias))).map(s => s.name); }

export function analyzeVacancies(vacancies, profile = {}) {
  const jobs = Array.isArray(vacancies) ? vacancies.slice(0, 50) : [];
  const counts = new Map(SKILL_LEXICON.map(s => [s.name, 0]));
  const mentionsByJob = [];
  for (const job of jobs) {
    const mentions = skillMatches(`${clean(job?.title)} ${clean(job?.requirements)}`);
    mentionsByJob.push({ id: clean(job?.id).slice(0, 100), title: clean(job?.title).slice(0, 150), skills: mentions });
    for (const mention of mentions) counts.set(mention, counts.get(mention) + 1);
  }
  const occurrences = [...counts].filter(([, n]) => n > 0).map(([name, count]) => ({name, count})).sort((a,b) => b.count - a.count || a.name.localeCompare(b.name));
  const profileText = clean(profile?.skills).slice(0, 1500);
  const profileCompared = profileText.trim().length > 0;
  const existing = profileCompared ? skillMatches(profileText) : [];
  const skillGaps = profileCompared ? occurrences.filter(s => !existing.includes(s.name)).slice(0, 6) : [];
  const overlapping = occurrences.filter(s => existing.includes(s.name)).slice(0, 6);
  const statedSalaryCount = jobs.filter(job => job?.salary && (typeof job.salary.from === 'number' || typeof job.salary.to === 'number')).length;
  return {
    sampleSize: jobs.length,
    profileCompared,
    matchedSkills: occurrences,
    profileSkillsRecognized: existing,
    overlaps: overlapping,
    possibleGaps: skillGaps,
    jobsWithPublishedSalary: statedSalaryCount,
    mentionsByJob,
    method: 'Keyword mentions in vacancy titles and short requirement snippets; one count per vacancy and skill. Not proficiency, mandatory skills or demand across the full labor market.'
  };
}

const TRANSLATIONS = {
  kk: {
    noJobs: 'Іздеу нәтижесінде бос орын табылмады; дағдылар туралы қорытынды жасауға негіз жоқ.',
    noTerms: 'Берілген қысқаша мәтіндерде сөздікке кіретін дағдылар табылмады. Бұл талаптар жоқ деген сөз емес.',
    found: (n, total) => `${total} бос орынның қысқаша сипаттамасы қаралды; ${n} түрлі дағды атауы анықталды.`,
    missing: a => `Түйіндемедегі дағдылар тізімінде ${a} көрсетілмеген. Бұл дағды сенде жоқ дегенді білдірмейді — бар болса, нақты дәлелмен қос.`,
    overlap: a => `Түйіндемең мен іріктемедегі дағды атаулары сәйкес келетін тұстар: ${a}.`,
    action1: 'Сілтемелері бар бос орындарды жеке ашып, талаптардың толық мәтінін тексер.',
    action2: 'Дағдыны меңгерсең, оны түйіндемеде нақты жобамен немесе нәтижемен дәлелде.',
    action3: 'Сәйкессіз дағдылардың ішінен біреуін таңдап, оған байланысты шағын практикалық жоба жаса.',
    limits: 'Бұл жалпы нарықтың рейтингі немесе нақты жұмысқа орналасу болжамы емес; есеп тек алынған іріктемеге сүйенеді.'
  },
  ru: {
    noJobs: 'В выборке нет вакансий, поэтому нельзя делать выводы о навыках.',
    noTerms: 'В кратких описаниях не найдены навыки из словаря. Это не означает, что требований нет.',
    found: (n, total) => `Проверены краткие описания ${total} вакансий; обнаружено ${n} названий навыков.`,
    missing: a => `В навыках резюме не указан ${a}. Это не значит, что у тебя нет такого навыка — если владеешь, добавь подтверждённый пример.`,
    overlap: a => `Навыки, упомянутые и в резюме, и в выборке: ${a}.`,
    action1: 'Открой оригинальные вакансии и проверь полные требования.',
    action2: 'Подтверди заявленные навыки конкретным проектом и результатом.',
    action3: 'Выбери один пробел из списка и сделай небольшой практический проект.',
    limits: 'Это не рейтинг всего рынка и не прогноз трудоустройства: выводы касаются только данной выборки.'
  },
  en: {
    noJobs: 'No vacancies were returned, so no skills conclusions are justified.',
    noTerms: 'No tracked skill keywords appeared in the short descriptions; that does not mean no requirements exist.',
    found: (n, total) => `Reviewed short descriptions of ${total} vacancies and found ${n} tracked skill names.`,
    missing: a => `${a} does not appear in your listed resume skills. This does not prove a lack of competence; add evidence if you have it.`,
    overlap: a => `Skills mentioned in both the sample and your resume: ${a}.`,
    action1: 'Open the original listings and review the complete requirements.',
    action2: 'Substantiate each skill you list with a real project or measurable result.',
    action3: 'Choose one possible gap and build a small practical project around it.',
    limits: 'Not a ranking of the whole market or a prediction of employment; findings describe this sample only.'
  }
};
export function ruleReport(analysis, lang='kk') {
  const d = TRANSLATIONS[lang] || TRANSLATIONS.kk;
  const findings = [];
  if (!analysis.sampleSize) findings.push(d.noJobs);
  else if (!analysis.matchedSkills.length) findings.push(d.noTerms);
  else findings.push(d.found(analysis.matchedSkills.length, analysis.sampleSize));
  if (analysis.overlaps.length) findings.push(d.overlap(analysis.overlaps.map(s=>s.name).join(', ')));
  if (analysis.possibleGaps.length) findings.push(d.missing(analysis.possibleGaps.slice(0,3).map(s=>s.name).join(', ')));
  return { type: 'rule_based', findings, nextSteps: [d.action1,d.action2,d.action3], limitation: d.limits };
}
