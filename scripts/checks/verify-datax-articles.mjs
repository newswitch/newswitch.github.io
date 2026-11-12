import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {compile} from '@mdx-js/mdx';
import yaml from 'js-yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const relative = 'docs/data-systems/integration/datax';
const examples = 'examples/datax/sync-lab';
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');
const option = name => {const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1];};
const python = option('--python') ?? (process.platform === 'win32' ? 'python' : 'python3');
const lock = JSON.parse(read(`${examples}/source-lock.json`));
assert.match(lock.commit, /^[a-f0-9]{40}$/);
const files = fs.readdirSync(path.join(root, relative)).filter(file => /\.md$/.test(file)).sort();
assert.equal(files.length, 14);
let diagrams = 0, answers = 0, jsonBlocks = 0, yamlBlocks = 0;
for (const [index, file] of files.entries()) {
  const source = read(`${relative}/${file}`);
  const front = source.match(/^---\n([\s\S]*?)\n---\n/);
  assert(front, file);
  const metadata = yaml.load(front[1]);
  const body = source.slice(front[0].length);
  assert.equal(metadata.sidebar_position, index, file);
  assert(metadata.sidebar_label.startsWith(`${String(index).padStart(2,'0')}. `), file);
  assert.equal(body.match(/^# (.+)$/m)?.[1], metadata.title, file);
  assert.equal((body.match(/^# /gm) ?? []).length, 1, file);
  assert(metadata.description?.trim() && metadata.tags?.includes('DataX'), file);
  assert(!/待补充|占位图|\bTODO\b|面试|岗位职责|一眼找到|网站与本地/u.test(body), file);
  const exercises = body.split(/^## \d+\. 练习与答案\n/m)[1];
  assert(exercises, file);
  assert.equal((exercises.match(/^\*\*问题[一二三四]：/gm) ?? []).length, 4, file);
  assert.equal((exercises.match(/^答案：/gm) ?? []).length, 4, file);
  answers += 4;
  assert(source.includes(lock.commit), `Pin upstream references: ${file}`);
  diagrams += (source.match(/^```mermaid/gm) ?? []).length;
  for (const block of source.matchAll(/^```json\n([\s\S]*?)\n```/gm)) {
    const parsed = JSON.parse(block[1]);
    jsonBlocks++;
    if (file.startsWith('04-') && parsed.job?.content) {
      assert.deepEqual(parsed, JSON.parse(read(`${examples}/jobs/smoke.json`)), 'Article and smoke job must match');
    }
    if (file.startsWith('10-')) {
      assert.equal(parsed.job.setting.speed.byte / parsed.core.transport.channel.speed.byte, 4);
    }
  }
  for (const block of source.matchAll(/^```yaml\n([\s\S]*?)\n```/gm)) {
    const resource = yaml.load(block[1]);
    assert.equal(resource.kind, 'Job');
    assert.equal(resource.spec.backoffLimit, 0);
    assert.equal(resource.spec.template.spec.automountServiceAccountToken, false);
    assert.equal(resource.spec.template.spec.securityContext.seccompProfile.type, 'RuntimeDefault');
    yamlBlocks++;
  }
  await compile(body, {format:'mdx'});
}
assert.equal(diagrams, 3);
assert.equal(answers, 56);
assert.equal(yamlBlocks, 1);
const category = JSON.parse(read(`${relative}/_category_.json`));
assert.equal(category.collapsed, true);
assert.equal(category.link.id, 'data-systems/integration/datax/DataX学习路线');
const jobs = fs.readdirSync(path.join(root, examples, 'jobs')).filter(file => file.endsWith('.json'));
assert.equal(jobs.length, 4);
for (const file of jobs) {
  const config = JSON.parse(read(`${examples}/jobs/${file}`));
  assert.equal(config.job.content.length, 1);
  assert.equal(config.job.setting.errorLimit.record, 0);
  assert.equal(config.job.setting.speed.channel, 1);
  const [{reader, writer}] = config.job.content;
  assert(reader.name && writer.name);
  assert(!writer.parameter.preSql && !writer.parameter.postSql, 'No hidden destructive/publish SQL');
  if (reader.name === 'mysqlreader') {
    assert(Array.isArray(reader.parameter.connection[0].jdbcUrl));
    assert.equal(config.common.column.timeZone, 'UTC');
  }
  if (writer.name === 'mysqlwriter') {
    assert.equal(typeof writer.parameter.connection[0].jdbcUrl, 'string');
    assert.equal(writer.parameter.writeMode, 'insert');
    assert.equal(writer.parameter.batchSize, 500);
    assert.deepEqual(reader.parameter.column, writer.parameter.column);
  }
  if (writer.name === 'txtfilewriter') assert.equal(writer.parameter.writeMode, 'nonConflict');
}
assert.equal(100 * 1024 / 80, 1280);
// Use an ASCII workspace-owned temp root: some Windows sandboxes expose a
// non-roundtripping user TEMP path to native Python. Tests only clean their own
// TemporaryDirectory children, never this workspace or shared user folders.
const temporary = path.join(root, '.cache-loader', 'datax-review', 'tmp');
fs.mkdirSync(temporary, {recursive:true});
const environment = {...process.env, TEMP:temporary, TMP:temporary, TMPDIR:temporary, PYTHONDONTWRITEBYTECODE:'1'};
const run = args => {
  const result = spawnSync(python, ['-B', ...args], {cwd:root, env:environment, encoding:'utf8', timeout:60000, maxBuffer:1024 * 1024});
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
  return result;
};
const summary = JSON.parse(run([`${examples}/sync_contract.py`, 'summarize', `${examples}/fixtures/orders.csv`]).stdout);
assert.deepEqual([summary.rows_total, summary.keys_total, summary.amount_total, summary.amount_nulls], [4,4,'30.30',1]);
assert.equal(summary.fingerprint, '40532c28ba59e4cd3f0cbb046d9e6a4223dddae33aadb3cc9e52338ae81ac8ae');
const tests = run(['-m','unittest','discover','-s',examples,'-p','test_*.py','-v']);
process.stdout.write(tests.stdout + tests.stderr);
console.log(`PASS ${files.length} pages, ${answers} answered exercises, ${diagrams} diagrams, ${jsonBlocks} JSON blocks, ${yamlBlocks} Kubernetes template and ${jobs.length} job configurations.`);
console.log('Only local contract/rendering tests run. DataX JVM, JDBC/TLS, databases, HDFS, object storage and Kubernetes are not launched.');
