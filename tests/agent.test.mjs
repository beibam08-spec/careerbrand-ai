import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeVacancies, ruleReport, SKILL_LEXICON } from '../agent.mjs';

// Fixture data is synthetic; it is never displayed as real labor-market data.
const fixture = [
  { id:'a1', title:'Junior Python developer', requirements:'Python, SQL, Git. We use Python daily.', salary:{from:250000,to:400000,currency:'KZT'} },
  { id:'a2', title:'Data Analyst', requirements:'Excel, SQL, Power BI, PostgreSQL', salary:null },
  { id:'a3', title:'UX/UI', requirements:'Figma, Git, HTML and CSS', salary:null },
];
test('agent parses vacancies and counts each skill at most once per vacancy',()=>{
  const a=analyzeVacancies(fixture,{skills:'Python, Excel'});
  assert.equal(a.sampleSize,3);
  assert.equal(a.matchedSkills.find(x=>x.name==='Python').count,1);
  assert.equal(a.matchedSkills.find(x=>x.name==='SQL').count,2);
  assert.equal(a.matchedSkills.find(x=>x.name==='PostgreSQL').count,1);
  assert.equal(a.jobsWithPublishedSalary,1);
  assert.deepEqual(a.overlaps.map(x=>x.name).sort(),['Excel','Python']);
  assert.ok(a.possibleGaps.some(x=>x.name==='SQL'));
});
test('word boundaries distinguish Java from JavaScript',()=>{
  const a=analyzeVacancies([{title:'JavaScript Developer',requirements:'JavaScript, TypeScript and PHP'}]);
  assert.equal(a.matchedSkills.some(x=>x.name==='Java'),false);
  const b=analyzeVacancies([{title:'Java Developer',requirements:'Java and PostgreSQL'}]);
  assert.equal(b.matchedSkills.some(x=>x.name==='Java'),true);
});
test('absent data produces honest reports in all three languages',()=>{
  for(const lang of ['kk','ru','en']) {
    const a=analyzeVacancies([],{});
    const report=ruleReport(a,lang);
    assert.equal(report.type,'rule_based');
    assert.equal(report.findings.length,1);
    assert.ok(report.limitation.length>15);
    assert.equal(a.jobsWithPublishedSalary,0);
  }
});
test('no fake totals or skill frequencies are returned',()=>{
  const a=analyzeVacancies([{title:'Intern',requirements:'Teamwork',salary:null}],{skills:''});
  assert.equal(a.matchedSkills.length,0);
  assert.equal(a.possibleGaps.length,0);
  assert.equal(a.sampleSize,1);
  assert.ok(SKILL_LEXICON.length>=20);
});
