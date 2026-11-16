// Finite teaching fixtures and article contracts only, not database emulation.
// Does not start Redis/MySQL, build an index or execute SQL/network requests.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {compile} from '@mdx-js/mdx';

const specifications = [
  {file: 'docs/data-systems/cache/redis/01-client-data/04-Bitmap-HyperLogLog-Geo-JSON-Search与Vector.md', section: '5. 验收题', answers: 10},
  {file: 'docs/data-systems/databases/mysql/03-innodb-transactions/03-BufferPool脏页刷盘ChangeBuffer与Doublewrite.md', section: '12. 验收题', answers: 11},
];
const parser = unified().use(remarkParse);
const plain = node => node.value ?? node.children?.map(plain).join('') ?? '';
const anchors = source => [...source.matchAll(/\{\/\*\s*#([^*]+)\*\/\}/g)].map(match => match[1].trim());
const headings = nodes => nodes.filter(node => node.type === 'heading' && node.depth <= 2).map(plain);
const stripFrontmatter = source => source.replace(/^---\n[\s\S]*?\n---\n/, '');
const articles = [];
let answers = 0;

for (const specification of specifications) {
  const source = fs.readFileSync(specification.file, 'utf8').replaceAll('\r\n', '\n');
  const body = stripFrontmatter(source);
  const nodes = parser.parse(body).children;
  await compile(body);
  const baseline = execFileSync('git', ['show', `3ead75e:${specification.file}`], {encoding: 'utf8'}).replaceAll('\r\n', '\n');
  assert.deepEqual(headings(nodes), headings(parser.parse(stripFrontmatter(baseline)).children), 'Changed original H1/H2 outline');
  for (const anchor of anchors(baseline)) assert(anchors(source).includes(anchor), `Lost anchor ${anchor}`);
  for (const field of ['title', 'sidebar_label', 'sidebar_position']) {
    const pattern = new RegExp(`^${field}:.*$`, 'm');
    assert.equal(source.match(pattern)?.[0], baseline.match(pattern)?.[0]);
  }
  const start = nodes.findIndex(node => node.type === 'heading' && node.depth === 2 && plain(node).startsWith(specification.section));
  assert(start >= 0, 'Missing exercise section');
  let end = nodes.findIndex((node, index) => index > start && node.type === 'heading' && node.depth <= 2);
  if (end < 0) end = nodes.length;
  const section = nodes.slice(start + 1, end);
  const questions = section.flatMap((node, index) => node.type === 'heading' && node.depth === 3 ? [index] : []);
  assert.equal(questions.length, specification.answers);
  for (const [index, position] of questions.entries()) {
    const response = section.slice(position + 1, questions[index + 1] ?? section.length);
    assert(response.some(node => node.type === 'paragraph' && plain(node).startsWith('答案：') && plain(node).length > 3));
  }
  answers += questions.length;
  articles.push({source, nodes});
}

const redis = articles[0];
const textBlocks = redis.nodes.filter(node => node.type === 'code' && node.lang === 'text');
const tokenize = value => [...value.matchAll(/'[^']*'|"[^"\n]*"|\S+/g)].map(match => {
  const token = match[0];
  return /^['"]/.test(token) ? token.slice(1, -1) : token;
});
function render(value) {
  if (value === null) return '(nil)';
  if (typeof value === 'number') return `(integer) ${value}`;
  if (typeof value === 'string') return JSON.stringify(value);
  if (!value.length) return '(empty array)';
  return value.map((child, index) => {
    const prefix = `${index + 1}) `;
    return render(child).split('\n').map((line, row) => `${row ? ' '.repeat(prefix.length) : prefix}${line}`).join('\n');
  }).join('\n');
}
const records = textBlocks.flatMap(block => {
  const matches = [...block.value.matchAll(/^127\.0\.0\.1:16379> (.+)$/gm)];
  return matches.map((match, index) => ({
    command: match[1],
    output: block.value.slice(match.index + match[0].length, matches[index + 1]?.index ?? block.value.length).trim(),
  }));
});
assert.equal(records.length, 19);
const strings = new Map();
const documents = new Map();
const places = new Map();
let counter = 0;
const radians = degrees => degrees * Math.PI / 180;
function distance(a, b) {
  const latitude = Math.sin(radians(b[1] - a[1]) / 2) ** 2;
  const longitude = Math.cos(radians(a[1])) * Math.cos(radians(b[1])) * Math.sin(radians(b[0] - a[0]) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(latitude + longitude));
}

for (const record of records) {
  const tokens = tokenize(record.command);
  const [command, key] = tokens;
  let reply;
  if (command === 'SETBIT') {
    const offset = Number(tokens[2]);
    const size = Math.floor(offset / 8) + 1;
    let buffer = strings.get(key) ?? Buffer.alloc(0);
    if (buffer.length < size) buffer = Buffer.concat([buffer, Buffer.alloc(size - buffer.length)]);
    const mask = 1 << (7 - offset % 8);
    reply = (buffer[Math.floor(offset / 8)] & mask) ? 1 : 0;
    buffer[Math.floor(offset / 8)] |= mask;
    strings.set(key, buffer);
  } else if (command === 'STRLEN') {
    reply = strings.get(key).length;
  } else if (command === 'BITCOUNT') {
    reply = [...strings.get(key)].reduce((sum, value) => sum + value.toString(2).replaceAll('0', '').length, 0);
  } else if (command === 'BITFIELD') {
    let mode = 'WRAP';
    let operation = 2;
    if (tokens[operation] === 'OVERFLOW') {
      mode = tokens[operation + 1];
      operation += 2;
    }
    const action = tokens[operation];
    assert.equal(tokens[operation + 1], 'u8');
    assert.equal(tokens[operation + 2], '0');
    if (action === 'GET') reply = [counter];
    else {
      const requested = action === 'SET' ? Number(tokens[operation + 3]) : counter + Number(tokens[operation + 3]);
      let value = requested;
      if (mode === 'FAIL' && (value < 0 || value > 255)) reply = [null];
      else {
        if (mode === 'SAT') value = Math.min(255, Math.max(0, value));
        else value = ((value % 256) + 256) % 256;
        reply = [action === 'SET' ? counter : value];
        counter = value;
      }
    }
  } else if (command === 'GEOADD') {
    for (let index = 2; index < tokens.length; index += 3) places.set(tokens[index + 2], [Number(tokens[index]), Number(tokens[index + 1])]);
    reply = places.size;
  } else if (command === 'GEOSEARCH') {
    assert.deepEqual(tokens.slice(2), ['FROMMEMBER', 'Palermo', 'BYRADIUS', '200', 'km', 'ASC', 'COUNT', '2']);
    const center = places.get('Palermo');
    reply = [...places].map(([name, coordinates]) => ({name, distance: distance(center, coordinates)}))
      .filter(place => place.distance <= 200).sort((a, b) => a.distance - b.distance).slice(0, 2).map(place => place.name);
  } else if (command === 'JSON.SET') {
    assert.equal(tokens[2], '$');
    documents.set(key, JSON.parse(tokens[3]));
    assert.equal(record.output, 'OK');
    continue;
  } else if (command === 'JSON.GET') {
    const value = documents.get(key).price;
    reply = JSON.stringify(tokens[2].startsWith('$') ? [value] : value);
  } else if (command === 'FT.SEARCH') {
    // Only the displayed predicate, not a parser for general Query Engine syntax.
    assert.equal(tokens[2], '@title:coffee @price:[0 50]');
    assert(tokens.includes('NOCONTENT'));
    const found = [...documents].filter(([, item]) => item.title.split(' ').includes('coffee') && item.price >= 0 && item.price <= 50).map(([id]) => id);
    reply = [found.length, ...found];
  } else assert.fail(`Unexpected transcript command ${command}`);
  assert.equal(record.output, render(reply), record.command);
}
assert.equal(strings.get('lab:active')[0], 0x81);
assert.equal(strings.get('lab:sparse').length, 125001);
assert.equal(counter, 255);
assert.equal(2 ** 14 * 6 / 8, 12288);

// The exact union is a reference value, not a claim that HLL is always exact.
const hllCommands = redis.nodes.filter(node => node.type === 'code' && node.lang === 'bash')
  .flatMap(node => node.value.split('\n').flatMap(line => line.match(/^redis-cli\s+-p\s+16379\s+((?:PFADD|PFCOUNT)\b.*)$/)?.[1] ?? []));
assert.equal(hllCommands.length, 3);
const hllInputs = new Map();
for (const command of hllCommands) {
  const [operation, key, ...values] = tokenize(command);
  if (operation === 'PFADD') hllInputs.set(key, new Set(values));
  else {
    const union = new Set([key, ...values].flatMap(name => [...hllInputs.get(name)]));
    assert.equal(union.size, 3);
  }
}

// Check index attribute-token counts, paths, dimensions and exact math baseline.
const flat = textBlocks.find(block => block.value.startsWith('FT.CREATE lab:idx '));
assert(flat);
const flatTokens = tokenize(flat.value);
const vector = flatTokens.indexOf('VECTOR');
assert.equal(flatTokens.length - vector - 3, Number(flatTokens[vector + 2]));
assert.equal(flatTokens[vector + 1], 'FLAT');
const dimension = Number(flatTokens[flatTokens.indexOf('DIM') + 1]);
assert.equal(dimension, 4);
const hnsw = textBlocks.find(block => block.value.startsWith('$.embedding AS embedding VECTOR HNSW '));
assert(hnsw);
const hnswTokens = tokenize(hnsw.value);
assert.equal(hnswTokens.length - hnswTokens.indexOf('VECTOR') - 3, Number(hnswTokens[hnswTokens.indexOf('HNSW') + 1]));
for (const document of documents.values()) assert.equal(document.embedding.length, dimension);
const cosine = vector => 1 - vector[0] / Math.hypot(...vector);
const sorted = [...documents].map(([id, item]) => ({id, category: item.category, distance: cosine(item.embedding)})).sort((a, b) => a.distance - b.distance);
assert.deepEqual(sorted.map(item => item.id), ['lab:item:1', 'lab:item:3', 'lab:item:2']);
assert.deepEqual(sorted.filter(item => item.category === 'drink').map(item => item.id), ['lab:item:1', 'lab:item:2']);
assert(Math.abs(sorted[1].distance - 0.0298575) < 1e-7);
assert.equal(3 ** 2 + 4 ** 2, 25);
const truth = new Set(['A', 'B', 'C']);
assert.equal(['A', 'C', 'D'].filter(id => truth.has(id)).length / 3, 2 / 3);
assert.equal((1000000 * 768 * 4 / 2 ** 30).toFixed(2), '2.86');
const indexInfo = textBlocks.find(block => block.value.startsWith('num_docs:'));
assert.equal(Number(indexInfo.value.match(/num_docs:(\d+)/)[1]), documents.size);

// Parse Python without importing redis-py or evaluating the network example.
const pythonCode = redis.nodes.find(node => node.type === 'code' && node.lang === 'python').value;
const pythonOption = process.argv.indexOf('--python');
const python = pythonOption >= 0 ? process.argv[pythonOption + 1] : (process.platform === 'win32' ? 'python' : 'python3');
assert(python, '--python requires an executable path');
const pythonCheck = [
  'import ast, struct, sys',
  'tree = ast.parse(sys.stdin.read())',
  'calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call)]',
  'pack = next(n for n in calls if isinstance(n.func, ast.Attribute) and n.func.attr == "pack")',
  'args = [ast.literal_eval(a) for a in pack.args]',
  'assert len(struct.pack(*args)) == 16',
  'query = next(n for n in calls if isinstance(n.func, ast.Attribute) and n.func.attr == "execute_command")',
  'values = [n.value for n in query.args if isinstance(n, ast.Constant)]',
  'assert values[0:2] == ["FT.SEARCH", "lab:idx"]',
  'assert values[values.index("PARAMS") + 1] == 2',
  'print("PASS Python AST and FLOAT32 blob length; no example evaluation")',
].join('\n');
process.stdout.write(execFileSync(python, ['-c', pythonCheck], {input: pythonCode, encoding: 'utf8'}));

const mysql = articles[1];
const pageOutput = mysql.nodes.find(node => node.type === 'code' && node.value.startsWith('Innodb_buffer_pool_pages_total'));
const fields = Object.fromEntries(pageOutput.value.split('\n').map(line => line.trim().split(/\s+/)));
const page = field => Number(fields[`Innodb_buffer_pool_pages_${field}`]);
assert.equal(page('free') + page('data') + page('misc'), page('total'));
assert(page('dirty') <= page('data'));
assert.equal(page('total') * 16384 / 2 ** 30, 8);
assert.equal(page('dirty') * 16384 / 2 ** 30, 1);
assert.equal(page('dirty') / page('total') * 100, 12.5);
const samples = [...mysql.source.matchAll(/^\| `(Innodb_buffer_pool_\w+)` \| (\d+) \| (\d+) \|$/gm)];
assert.equal(samples.length, 4);
const deltas = Object.fromEntries(samples.map(([, name, start, end]) => [name, Number(end) - Number(start)]));
assert.equal(((1 - deltas.Innodb_buffer_pool_reads / deltas.Innodb_buffer_pool_read_requests) * 100).toFixed(2), '99.99');
assert.equal((deltas.Innodb_buffer_pool_reads / 60).toFixed(2), '16.67');
assert.equal(deltas.Innodb_buffer_pool_pages_flushed / 60, 400);
assert.equal(deltas.Innodb_buffer_pool_pages_flushed / 60 * 16384 / 2 ** 20, 6.25);
assert.equal(deltas.Innodb_buffer_pool_wait_free, 30);
const log = mysql.nodes.find(node => node.type === 'code' && node.value.startsWith('Log sequence number'));
const position = label => Number(log.value.match(new RegExp(`${label}\\s+(\\d+)`))[1]);
assert.equal(position('Log sequence number') - position('Last checkpoint at'), 800000000);
assert.equal(((position('Log sequence number') - position('Last checkpoint at')) / 2 ** 20).toFixed(2), '762.94');
assert.equal(position('Log sequence number') - position('Log flushed up to'), 1000000);
assert.equal(10 + 1 + 2 + 3, 16);
for (const code of mysql.nodes.filter(node => node.type === 'code' && node.lang === 'sql')) {
  assert(!/\b(?:SET\s+GLOBAL|FLUSH\s+STATUS|UPDATE|DELETE)\b/i.test(code.value));
}

console.log(`PASS ${articles.length} MDX pages, ${answers} explicit answers, original outline, anchors and metadata.`);
console.log(`PASS ${records.length} teaching replies, index/schema fixtures, vector math, page accounting and interval/LSN arithmetic.`);
console.log('No database service, Redis index build, SQL execution, live ANN benchmark or recovery test was performed.');
