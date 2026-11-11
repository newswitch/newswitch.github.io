import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';

const root = fileURLToPath(new URL('../', import.meta.url));
const relative = 'docs/data-systems/search/elasticsearch/05-api-reference';
const directory = path.join(root, relative);
const files = fs.readdirSync(directory).filter(file => file.endsWith('.md')).sort();
assert.equal(files.length, 9);
const bashIndex = process.argv.indexOf('--bash');
const bash = bashIndex < 0 ? undefined : process.argv[bashIndex + 1];
if (bashIndex >= 0) assert(bash && !bash.startsWith('--'), 'Missing Bash executable');
const sources = [], requests = [];
let answers = 0, diagrams = 0, jsonBlocks = 0, bashBlocks = 0;
for (const file of files) {
  const source = fs.readFileSync(path.join(directory, file), 'utf8').replaceAll('\r\n', '\n');
  sources.push(source);
  const front = yaml.load(source.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '');
  const prefix = Number(file.match(/^(\d+)-/)[1]);
  assert(front?.description && front.title && front.tags?.includes('Elasticsearch'), `Metadata: ${file}`);
  assert.equal(front.sidebar_position, prefix);
  assert(front.sidebar_label.startsWith(`${String(prefix).padStart(2, '0')}. `));
  const prose = source.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  assert.equal((prose.match(/^# /gm) ?? []).length, 1);
  assert.equal(prose.match(/^# (.+)$/m)?.[1], front.title);
  assert.equal((source.match(/^```/gm) ?? []).length % 2, 0);
  assert(!/\bTODO\b|待补充|占位图/u.test(source), file);
  const exercise = source.split(/^## \d+\. 练习与答案[^\n]*\n/m)[1]?.split(/^## /m)[0];
  assert(exercise, `Exercises: ${file}`);
  assert.equal((exercise.match(/^\*\*问题[一二三四]：/gm) ?? []).length, 4);
  assert.equal((exercise.match(/^答案：/gm) ?? []).length, 4);
  for (const item of exercise.split(/^\*\*问题[一二三四]：/m).slice(1)) assert(/^答案：.+/m.test(item));
  answers += 4;
  diagrams += (source.match(/^```mermaid/gm) ?? []).length;
  for (const block of source.matchAll(/^```([^\n]+)\n([\s\S]*?)\n```/gm)) {
    const language = block[1], text = block[2];
    if (language === 'json') { JSON.parse(text); jsonBlocks++; }
    if (language === 'bash') {
      bashBlocks++;
      if (bash) {
        const result = spawnSync(bash, ['-n'], {input:text + '\n', encoding:'utf8', cwd:root});
        assert.equal(result.status, 0, `${file}: ${result.error ?? result.stderr}`);
      }
    }
    if (language !== 'http') continue;
    let request;
    const finish = () => {
      if (!request) return;
      const body = request.lines.join('\n').trim();
      if (/\/(?:_bulk|_msearch)(?:\?|$)/u.test(request.url)) {
        request.ndjson = body.split('\n').map(line => JSON.parse(line));
        if (request.url.includes('_msearch')) assert.equal(request.ndjson.length % 2, 0);
        else {
          for (let index = 0; index < request.ndjson.length; index++) {
            const action = Object.keys(request.ndjson[index]);
            assert.equal(action.length, 1, `${file} Bulk action`);
            assert(['index','create','update','delete'].includes(action[0]));
            if (action[0] !== 'delete') assert(request.ndjson[++index], `${file} Bulk source`);
          }
        }
      } else if (body) request.body = JSON.parse(body);
      if (request.method === 'DELETE') {
        assert(/^\/?(?:es_api_lab_[\w-]+(?:\/.*)?|_pit|_index_template\/es_api_lab_[\w-]+|_component_template\/es_api_lab_[\w-]+)$/u.test(request.url.split('?')[0]), `Unsafe deletion example: ${request.url}`);
        assert(!request.url.includes('*'));
      }
      requests.push({...request, file});
    };
    for (const line of text.split('\n')) {
      const match = line.match(/^(GET|POST|PUT|DELETE|HEAD) (\S+)$/u);
      if (match) {
        finish();
        request = {method:match[1], url:match[2], lines:[]};
      } else {
        assert(request || !line.trim(), `Unexpected HTTP text: ${file}`);
        if (request) request.lines.push(line);
      }
    }
    finish();
  }
  console.log(`PASS ${file}: metadata, four answered exercises and request syntax`);
}
assert.equal(answers, 36);
assert.equal(diagrams, 3);
const create = requests.find(request => request.url === 'es_api_lab_products_v1' && request.method === 'PUT');
assert.equal(create.body.mappings.dynamic, 'strict');
assert.equal(create.body.settings.number_of_replicas, 0);
const fixture = requests.find(request => request.url.startsWith('es_api_lab_products_v1/_bulk') && request.file.startsWith('01-'));
assert.equal(fixture.ndjson.length, 12);
const docs = fixture.ndjson.filter((_, index) => index % 2 === 1);
assert.deepEqual(docs.map(doc => doc.doc_id), ['p1','p2','p3','p4','p5','p6']);
for (const [index, doc] of docs.entries()) {
  assert.equal(fixture.ndjson[index * 2].index._id, doc.doc_id);
  for (const field of Object.keys(doc)) assert(create.body.mappings.properties[field], `Unmapped fixture field: ${field}`);
}
const ids = predicate => docs.filter(predicate).map(doc => doc.doc_id);
assert.deepEqual(ids(doc => doc.category === 'gpu'), ['p1','p2','p5']);
assert.deepEqual(ids(doc => ['storage','network'].includes(doc.category)), ['p3','p4','p6']);
assert.deepEqual(ids(doc => doc.price >= 400 && doc.price < 1500), ['p1','p4','p6']);
assert.deepEqual(ids(doc => doc.created_at >= '2026-11-02T00:00:00Z' && doc.created_at < '2026-11-03T00:00:00Z'), ['p2','p3']);
assert.deepEqual(ids(doc => !Object.hasOwn(doc, 'owner')), ['p4']);
assert.deepEqual(ids(doc => doc.name.toLowerCase().includes('gpu') || doc.name.toLowerCase().includes('server')), ['p1','p2','p5']);
assert.deepEqual(ids(doc => doc.name.toLowerCase().includes('gpu') && doc.name.toLowerCase().includes('server')), ['p1','p2']);
assert.deepEqual(ids(doc => doc.category === 'gpu' && doc.status === 'active' && doc.stock > 0 && doc.price <= 1600), ['p1','p5']);
assert.deepEqual(ids(doc => doc.status === 'active' && ['gpu','storage'].includes(doc.category)), ['p1','p3','p5','p6']);
assert.deepEqual(ids(doc => doc.name.startsWith('GPU') && doc.name.endsWith('pro')), ['p2']);
assert.deepEqual(ids(doc => doc.reviews.some(review => review.user === 'alice' && review.score >= 5)), ['p1']);
const sorted = docs.toSorted((a,b) => a.price - b.price || a.doc_id.localeCompare(b.doc_id));
assert.deepEqual(sorted.map(doc => doc.doc_id), ['p3','p6','p4','p1','p5','p2']);
assert.deepEqual(sorted.slice(2,4).map(doc => doc.doc_id), ['p4','p1']);
assert.equal(docs.reduce((sum, doc) => sum + doc.price, 0), 5900);
assert.equal(docs.filter(doc => doc.category === 'gpu').reduce((sum, doc) => sum + doc.price, 0), 4700);
assert.equal(docs.filter(doc => doc.category === 'gpu' && doc.status === 'active').reduce((sum, doc) => sum + doc.price, 0) / 2, 1350);
const dayCounts = {}, dayTotals = {};
for (const doc of docs) {
  const day = doc.created_at.slice(0,10);
  dayCounts[day] = (dayCounts[day] ?? 0) + 1;
  dayTotals[day] = (dayTotals[day] ?? 0) + doc.price;
}
assert.deepEqual(Object.values(dayCounts), [1,2,2,1]);
assert.deepEqual(Object.values(dayTotals), [1200,2300,2000,400]);
let running = 0;
assert.deepEqual(Object.values(dayTotals).map(value => running += value), [1200,3500,5500,5900]);
assert.equal(docs.flatMap(doc => doc.reviews).length, 7);
const groups = [...new Set(docs.map(doc => `${doc.category}/${doc.vendor}`))].sort();
assert.deepEqual(groups, ['gpu/acme','gpu/beta','network/beta','storage/acme','storage/beta']);
const v2 = requests.find(request => request.method === 'PUT' && request.url === 'es_api_lab_products_v2');
for (const [name, definition] of Object.entries(create.body.mappings.properties)) assert.deepEqual(v2.body.mappings.properties[name], definition);
assert.equal(v2.body.mappings.properties.currency.type, 'keyword');
const mutation = requests.filter(request => /_(?:update|delete)_by_query/u.test(request.url) && request.body);
assert.equal(mutation.length, 2);
assert(mutation.every(request => request.url.startsWith('es_api_lab_mutation_v1/')));
assert(mutation.every(request => !request.url.includes('conflicts=proceed')));
const category = JSON.parse(fs.readFileSync(path.join(directory, '_category_.json'), 'utf8'));
assert.equal(category.collapsed, true);
assert.equal(category.position, 5);
const entryId = path.posix.join(relative.slice(5), files[0].slice(0, -3))
  .split('/').map(part => part.replace(/^\d+-/, '')).join('/');
assert.equal(category.link.id, entryId);
const old = fs.readFileSync(path.join(root, 'docs/data-systems/search/elasticsearch/01-search-storage/04-Query-DSL-BM25-Filter-Aggregation与Profile.md'), 'utf8');
const oldAnswers = old.split('### 7.1 参考答案')[1]?.split(/^## /m)[0];
assert.equal((oldAnswers?.match(/^\d+\. /gm) ?? []).length, 6);
assert(old.includes('Fetch 的分析部分'));
console.log(`PASS 9 new articles, 36 answers plus 6 existing answers, 3 diagrams, ${requests.length} HTTP requests, ${jsonBlocks} JSON response snippets and ${bashBlocks} Bash blocks${bash ? ' syntax checked' : ''}.`);
console.log('Fixture arithmetic and memberships are checked locally. No Elasticsearch server is contacted; Lucene scoring, PIT, scripts and distributed behavior are not integration-tested.');
