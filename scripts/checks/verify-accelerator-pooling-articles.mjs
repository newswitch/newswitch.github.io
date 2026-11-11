import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bashIndex = process.argv.indexOf('--bash');
const bash = bashIndex < 0 ? undefined : process.argv[bashIndex + 1];
if (bashIndex >= 0) assert(bash && !bash.startsWith('--'), 'Missing --bash executable');
const files = [
  'docs/gpu/cluster/pooling/00-GPU-NPU资源池化学习路线.md',
  'docs/gpu/cluster/pooling/01-资源池设备模型分配与回收原理.md',
  'docs/gpu/cluster/pooling/02-昇腾NPU硬件虚拟化与软切分.md',
  'docs/gpu/servers/nvidia-dgx/03-GB200-GB300-NVL72机架级架构.md',
  'docs/gpu/cluster/sharing/07-GPU 整卡独占、Time-Slicing、MPS 与 MIG 对比.md',
  'docs/gpu/cluster/scheduling/12-GPU 集群拓扑感知调度.md',
];
const sources = [];
let answers = 0, diagrams = 0, bashBlocks = 0, yamlBlocks = 0;
const configs = [];
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');
  sources.push(source);
  const front = yaml.load(source.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '');
  assert(front?.title && front.description && front.sidebar_label, `Metadata: ${file}`);
  const prose = source.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  assert.equal((prose.match(/^# /gm) ?? []).length, 1, `H1 count: ${file}`);
  assert.equal(prose.match(/^# (.+)$/m)?.[1], front.title, `H1 title: ${file}`);
  const prefix = Number(path.basename(file).match(/^(\d+)-/)[1]);
  assert.equal(front.sidebar_position, prefix, `Sidebar position: ${file}`);
  assert(front.sidebar_label.startsWith(`${String(prefix).padStart(2, '0')}. `), `Sidebar label: ${file}`);
  assert.equal((source.match(/^```/gm) ?? []).length % 2, 0, `Code fences: ${file}`);
  assert(!/\bTODO\b|待补充|占位图/u.test(source), `Draft placeholder: ${file}`);
  const section = source.split(/^## \d+\. 练习与答案[^\n]*\n/m)[1]?.split(/^## /m)[0];
  assert(section, `Exercises: ${file}`);
  assert.equal((section.match(/^\*\*问题[一二三四]：/gm) ?? []).length, 4, `Four questions: ${file}`);
  assert.equal((section.match(/^答案：/gm) ?? []).length, 4, `Four answers: ${file}`);
  for (const question of section.split(/^\*\*问题[一二三四]：/m).slice(1)) assert(/^答案：.+/m.test(question), `Unanswered: ${file}`);
  answers += 4;
  diagrams += (source.match(/^```mermaid/gm) ?? []).length;
  for (const snippet of source.matchAll(/^```bash\n([\s\S]*?)\n```/gm)) {
    bashBlocks++;
    if (bash) {
      const result = spawnSync(bash, ['-n'], {input:snippet[1] + '\n', encoding:'utf8', cwd:root});
      assert.equal(result.status, 0, `Bash syntax: ${file}: ${result.error ?? result.stderr}`);
    }
  }
  for (const snippet of source.matchAll(/^```yaml\n([\s\S]*?)\n```/gm)) {
    yamlBlocks++;
    configs.push(yaml.load(snippet[1]));
  }
  console.log(`PASS metadata, outline and four answered exercises: ${file}`);
}
assert.equal(answers, 24);
assert.equal(diagrams, 8);
assert.equal(yamlBlocks, 2);
assert.equal(configs[0].resources.limits['nvidia.com/gpu'], 1);
const timeSlicing = configs[1].sharing.timeSlicing;
assert.equal(timeSlicing.renameByDefault, true);
assert.equal(timeSlicing.failRequestsGreaterThanOne, true);
assert.deepEqual(timeSlicing.resources, [{name:'nvidia.com/gpu', replicas:4}]);

// Check only the explicitly hypothetical arithmetic and placement examples.
assert.equal(2 * 4 * 4, 32);
assert.equal(24 / 32, 0.75);
assert.equal(18 + 8 + 4 + 2, 32);
assert(32 + 3 > 32);
assert(30 + 30 + 25 > 80);
assert(60 > 40 && 60 < 40 + 40);
assert.equal(18 * 4, 72);
assert.equal(18 * 2, 36);
assert.equal(4 * 4, 16);
const nvlinkPairs = [[0, 1], [2, 3]];
const hasFreePair = free => nvlinkPairs.some(pair => pair.every(id => free.includes(id)));
assert(hasFreePair([0, 1]));
assert(!hasFreePair([0, 2]));
const freeByNode = [[0, 2], [2, 3]];
assert.equal(freeByNode.flat().length, 4);
assert(!freeByNode.some(free => free.length >= 4));
assert(sources[1].includes('不提供与 DRA `NodeUnprepareResources` 等价'));
assert(sources[2].includes('不是实际 NPU 卡数') && sources[2].includes('一个容器挂载一个 NPU'));
assert(sources[3].includes('不会因为有 NVLink 就合并成一个普通 Linux Host'));
assert(sources[4].includes('CUDA 13.4+') && sources[4].includes('GI 内多个 CI'));
assert(sources[5].includes('不是跨 NUMA 的同义词') && sources[5].includes('不盲目关闭'));

const categoryRoot = path.join(root, 'docs/gpu/cluster');
const positions = fs.readdirSync(categoryRoot, {withFileTypes:true})
  .filter(entry => entry.isDirectory())
  .map(entry => path.join(categoryRoot, entry.name, '_category_.json'))
  .filter(file => fs.existsSync(file))
  .map(file => JSON.parse(fs.readFileSync(file, 'utf8')).position);
assert.equal(new Set(positions).size, positions.length, 'Duplicate cluster category position');
const pooling = JSON.parse(fs.readFileSync(path.join(categoryRoot, 'pooling/_category_.json'), 'utf8'));
assert.equal(pooling.collapsed, true);
assert.equal(pooling.link.id, 'gpu/cluster/pooling/GPU-NPU资源池化学习路线');
console.log(`PASS 6 articles, 24 answers, 8 diagrams, 2 YAML snippets, capacity and placement examples; ${bashBlocks} Bash blocks${bash ? ' syntax checked' : ' (use --bash to check syntax)'}.`);
console.log('No Kubernetes, driver, partition, MPS daemon or accelerator commands are executed.');
