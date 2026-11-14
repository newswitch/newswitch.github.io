import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {compile} from '@mdx-js/mdx';
import yaml from 'js-yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const base = 'docs/data-systems/integration';
const examples = 'examples/data-integration';
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');
const baselines = JSON.parse(read(`${examples}/source-baselines.json`));
assert.equal(baselines.reviewed_on, '2026-11-14');
let pages = 0, answers = 0, diagrams = 0, jsonBlocks = 0, yamlBlocks = 0, jsonlBlocks = 0;
for (const [tool, tag, guide] of [
  ['seatunnel', 'SeaTunnel', 'SeaTunnel学习路线'],
  ['nifi', 'NiFi', 'NiFi学习路线'],
  ['airbyte', 'Airbyte', 'Airbyte学习路线'],
]) {
  const directory = `${base}/${tool}`;
  const files = fs.readdirSync(path.join(root, directory)).filter(file => file.endsWith('.md')).sort();
  assert.equal(files.length, 7, tool);
  const category = JSON.parse(read(`${directory}/_category_.json`));
  assert.equal(category.collapsed, true);
  assert.equal(category.link.id, `data-systems/integration/${tool}/${guide}`);
  for (const [index, file] of files.entries()) {
    const source = read(`${directory}/${file}`);
    const front = source.match(/^---\n([\s\S]*?)\n---\n/);
    assert(front, file);
    const metadata = yaml.load(front[1]);
    const body = source.slice(front[0].length);
    const prose = body.replace(/^```[^\n]*\n[\s\S]*?\n```/gm, '');
    assert.equal(metadata.sidebar_position, index, file);
    assert(metadata.sidebar_label.startsWith(`${String(index).padStart(2, '0')}. `), file);
    assert.equal(prose.match(/^# (.+)$/m)?.[1], metadata.title, file);
    assert.equal((prose.match(/^# /gm) ?? []).length, 1, file);
    assert(metadata.description?.trim() && metadata.tags.includes(tag), file);
    assert(!/待补充|占位图|\bTODO\b|面试|岗位职责|一眼找到|网站与本地/u.test(body), file);
    const exercises = body.split(/^## \d+\. 练习与答案\n/m)[1];
    assert(exercises, file);
    assert.equal((exercises.match(/^\*\*问题[一二三四]：/gm) ?? []).length, 4, file);
    assert.equal((exercises.match(/^答案：/gm) ?? []).length, 4, file);
    assert.match(body, /参考：\[/u, file);
    if (tool === 'seatunnel') assert(body.includes(baselines.seatunnel.version), file);
    if (tool === 'nifi') assert(body.includes(baselines.nifi.version), file);
    if (tool === 'airbyte') assert(body.includes(baselines.reviewed_on), file);
    for (const block of body.matchAll(/^```json\n([\s\S]*?)\n```/gm)) {
      const parsed = JSON.parse(block[1]);
      jsonBlocks++;
      if (tool === 'seatunnel') assert.deepEqual(parsed, JSON.parse(read(`${examples}/seatunnel/smoke.conf`)));
      if (tool === 'nifi') assert.deepEqual(parsed, JSON.parse(read(`${examples}/nifi/orders.json`)));
      if (tool === 'airbyte') assert.equal(parsed.type, 'object');
    }
    for (const block of body.matchAll(/^```yaml\n([\s\S]*?)\n```/gm)) {
      const config = yaml.load(block[1]);
      assert.equal(tool, 'seatunnel');
      assert.equal(config.seatunnel.engine.checkpoint.interval, 60000);
      assert.equal(config.seatunnel.engine.checkpoint.storage['plugin-config']['storage.type'], 'hdfs');
      yamlBlocks++;
    }
    for (const block of body.matchAll(/^```jsonl\n([\s\S]*?)\n```/gm)) {
      assert.equal(block[1].trim(), read(`${examples}/airbyte/source-messages.jsonl`).trim());
      for (const line of block[1].split('\n')) JSON.parse(line);
      jsonlBlocks++;
    }
    if (tool === 'nifi' && file.startsWith('03-')) {
      const sql = body.match(/^```sql\n([\s\S]*?)\n```/m)?.[1];
      assert.equal(sql, JSON.parse(read(`${examples}/nifi/recipe.json`)).query.dynamic_properties.paid);
    }
    diagrams += (body.match(/^```mermaid/gm) ?? []).length;
    await compile(body, {format:'mdx'});
    pages++;
    answers += 4;
  }
}
assert.deepEqual([pages, answers, diagrams, jsonBlocks, yamlBlocks, jsonlBlocks], [21, 84, 6, 3, 1, 1]);
const result = spawnSync(process.execPath, ['--test', `${examples}/test-contracts.mjs`], {cwd:root, encoding:'utf8', timeout:60000});
assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stdout}\n${result.stderr}`);
process.stdout.write(result.stdout);
console.log(`PASS ${pages} pages, ${answers} answered exercises, ${diagrams} diagrams, JSON/YAML/JSONL and fixture consistency.`);
console.log('Offline checks only; SeaTunnel, NiFi, Airbyte, JDBC/TLS, CDC, Docker and Kubernetes runtimes are not started.');
