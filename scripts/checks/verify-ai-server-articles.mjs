import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const articlePaths = [
  'docs/gpu/servers/00-AI服务器产品体系与整机学习路线.md',
  'docs/gpu/pcie-numa/04-GPU服务器硬件拓扑与NUMA.md',
  'docs/gpu/servers/nvidia-dgx/01-DGX-H100-H200整机架构与数据路径.md',
  'docs/gpu/servers/nvidia-dgx/02-DGX-B200-B300整机架构与代际变化.md',
  'docs/gpu/servers/huawei-atlas/01-Atlas-800I-A2与Ascend-910B软硬件架构.md',
  'docs/gpu/servers/huawei-atlas/02-Atlas-800I-A3整机架构与产品形态.md',
];

const articles = articlePaths.map(file => {
  const source = fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');
  const front = yaml.load(source.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '');
  assert(front?.title && front.description && front.sidebar_label, `Missing metadata: ${file}`);
  assert.equal(source.match(/^# (.+)$/m)?.[1], front.title, `H1 mismatch: ${file}`);
  assert.equal((source.match(/^# /gm) ?? []).length, 1, `Multiple H1s: ${file}`);
  const prefix = Number(path.basename(file).match(/^(\d+)-/)[1]);
  assert.equal(front.sidebar_position, prefix, `Sidebar order: ${file}`);
  assert(front.sidebar_label.startsWith(`${String(prefix).padStart(2, '0')}. `), `Sidebar label: ${file}`);
  const exercises = source.split(/^## \d+\. 练习与答案\s*$/m)[1]?.split(/^## /m)[0];
  assert(exercises, `Missing answered exercises: ${file}`);
  assert.equal((exercises.match(/^\*\*问题[一二三四]：/gm) ?? []).length, 4, `Expected four questions: ${file}`);
  assert.equal((exercises.match(/^答案：/gm) ?? []).length, 4, `Expected four answers: ${file}`);
  for (const question of exercises.split(/^\*\*问题[一二三四]：/m).slice(1)) {
    assert(/^答案：.+/m.test(question), `Unanswered question: ${file}`);
  }
  assert(!/\bTODO\b|待补充|占位图/u.test(source), `Draft placeholder: ${file}`);
  assert.equal((source.match(/^```/gm) ?? []).length % 2, 0, `Unclosed code fence: ${file}`);
  console.log(`PASS metadata and four answered exercises: ${file}`);
  return source;
});

const servers = path.join(root, 'docs/gpu/servers');
for (const directory of ['', 'nvidia-dgx', 'huawei-atlas']) {
  const category = JSON.parse(fs.readFileSync(path.join(servers, directory, '_category_.json'), 'utf8'));
  assert.equal(category.collapsed, true, `Expanded category: ${directory}`);
}
const serverCategory = JSON.parse(fs.readFileSync(path.join(servers, '_category_.json'), 'utf8'));
assert.deepEqual(serverCategory.link, {type:'doc', id:'gpu/servers/AI服务器产品体系与整机学习路线'});
const positions = fs.readdirSync(path.join(root, 'docs/gpu'), {withFileTypes:true})
  .filter(entry => entry.isDirectory())
  .map(entry => path.join(root, 'docs/gpu', entry.name, '_category_.json'))
  .filter(file => fs.existsSync(file))
  .map(file => JSON.parse(fs.readFileSync(file, 'utf8')).position);
assert.equal(new Set(positions).size, positions.length, 'Duplicate top-level GPU category positions');

const oldFilename = '05-Atlas-800I-A2与Ascend-910B软硬件架构';
assert(!fs.existsSync(path.join(root, 'docs/ai-systems/inference/vllm-ascend', oldFilename + '.md')), 'Old A2 article still exists');
function checkMigration(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes:true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) checkMigration(file);
    else if (/\.mdx?$/.test(entry.name)) {
      assert(!fs.readFileSync(file, 'utf8').includes(oldFilename), `Obsolete A2 reference: ${file}`);
    }
  }
}
checkMigration(path.join(root, 'docs'));

// Check scope and arithmetic, not a minimum article length or an assumed deployment result.
assert(articles[0].includes('640 GB') && articles[0].includes('90 GB'));
assert(articles[1].includes('50 ÷ 4 = 12.5 GB/s'));
assert(articles[2].includes('640 GB') && articles[2].includes('1,128 GB'));
assert(articles[3].includes('2.1 TB') && articles[3].includes('8 × 288 GB = 2.3 TB total'));
assert(articles[3].includes('第三代 NVSwitch') && articles[3].includes('第四代 NVSwitch'));
assert(articles[4].includes('4U') && articles[4].includes('八模组'));
assert(articles[5].includes('10U') && articles[5].includes('384 NPU') && articles[5].includes('56 ÷ 8 = 7'));
console.log('PASS 6 articles, 24 answered questions, category consistency, A2 migration and numerical scope checks.');
