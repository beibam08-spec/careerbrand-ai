/**
 * Evidence-based, deterministic analysis of a limited job-search result set.
 * This is NOT a trained AI model and never claims to describe the whole job market.
 */
export const KNOWN_SKILLS = [
  'Python', 'SQL', 'Excel', 'Power BI', 'Tableau', 'Git', 'JavaScript',
  'TypeScript', 'React', 'Figma', 'PostgreSQL', 'Django', 'FastAPI',
  'Docker', 'Java', 'PHP', '1C', 'Photoshop', 'HTML', 'CSS',
  'Google Analytics', 'PowerPoint', 'Canva', 'Notion', 'Linux'
];

const escapeRegExp = v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const skillRegex = skill => new RegExp(`(^|[^a-zа-яё0-9])${escapeRegExp(skill)}(?=$|[^a-zа-яё0-9])`, 'iu');
const normalize = s => String(s || '').toLowerCase().replace(/\s+/g,' ').trim();

export function analyzeVacancies(vacancies = [], profileSkills = '') {
  const jobs = Array.isArray(vacancies) ? vacancies.slice(0, 30) : [];
  const userSkills = String(profileSkills).split(/[,;\n]/).map(normalize).filter(Boolean);
  const skills = KNOWN_SKILLS.map(name => {
    const re = skillRegex(name);
    const evidence = jobs.filter(job => re.test(`${job.title || ''} ${job.requirements || ''}`));
    return {
      name, count: evidence.length,
      hasSkill: userSkills.includes(normalize(name)),
      evidence: evidence.slice(0, 3).map(v => ({
        title: String(v.title || '').slice(0, 120),
        link: /^https:\/\/(?:[^/]+\.)?hh\.(?:ru|kz)(?:\/|$)/i.test(v.link || '') ? v.link : null
      }))
    };
  }).filter(v => v.count > 0).sort((a,b) => b.count - a.count || a.name.localeCompare(b.name));
  return {
    sampleSize: jobs.length,
    skills,
    matched: skills.filter(v => v.hasSkill),
    missing: skills.filter(v => !v.hasSkill),
    methodology: 'Counts detect explicit keyword mentions in titles and API snippets, not full job descriptions.',
    limitation: 'One search-page sample only; these figures cannot be extrapolated to the full labor market.'
  };
}
