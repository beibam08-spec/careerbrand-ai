import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const src = new URL('../', import.meta.url);
const read = async(name)=>(await readFile(new URL(name,src),'utf8'));

test('Render Blueprint explicitly chooses free Node web tier',async()=>{
 const blueprint=await read('render.yaml');
 assert.match(blueprint,/^\s*- type: web\s*$/m);
 assert.match(blueprint,/^\s+runtime: node\s*$/m);
 assert.match(blueprint,/^\s+plan: free\s*$/m,'Without plan: free Render may default to paid compute');
 assert.match(blueprint,/^\s+healthCheckPath: \/api\/health\s*$/m);
 assert.match(blueprint,/^\s+startCommand: node server\.mjs\s*$/m);
 assert.doesNotMatch(blueprint,/\bplan:\s*(?:starter|standard|0\.5c-512mb)\b/);
 assert.doesNotMatch(blueprint,/sk-(?:proj-)?[A-Za-z0-9_-]{10,}/);
 assert.doesNotMatch(blueprint,/^\s+- key: OPENAI_API_KEY\s*$/m,'No AI key prompt in the zero-cost first deploy');
});

test('GitHub Actions checks site without requiring provider credentials',async()=>{
 const yaml=await read('.github/workflows/verify.yml');
 assert.match(yaml,/npm test/);assert.match(yaml,/npm run smoke/);
 assert.doesNotMatch(yaml,/OPENAI_API_KEY\s*:/);
});

test('Git-ready package excludes local secrets and documents optional providers',async()=>{
 const ignore=await read('.gitignore');
 assert.match(ignore,/\.env/);assert.match(ignore,/node_modules/);
 const example=await read('.env.example');assert.match(example,/OPENAI_API_KEY/);
 assert.match(example,/does not automatically load/);
 const pkg=JSON.parse(await read('package.json'));
 assert.equal(pkg.version,'13.0.0');assert.ok(pkg.scripts.smoke);
});
