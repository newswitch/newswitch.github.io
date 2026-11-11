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
  'docs/storage/oceanstor/00-OceanStor-AI存储学习路线.md',
  'docs/storage/oceanstor/01-OceanStor-A800架构与AI数据路径.md',
  'docs/storage/oceanstor/02-OceanStor-A600架构与AI数据路径.md',
  'docs/storage/oceanstor/03-OceanStor-AI存储协议客户端与数据路径.md',
  'docs/storage/ai-workloads/01-AI工作负载的存储IO模型.md',
  'docs/storage/ai-workloads/02-GPUDirect-Storage原理与实践.md',
];
const sources = [];
let answers = 0, bashBlocks = 0, diagrams = 0;
for (const [index, file] of files.entries()) {
  const source = fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');
  sources.push(source);
  const front = yaml.load(source.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '');
  assert(front?.title && front.sidebar_label && front.description, `Metadata: ${file}`);
  const prose = source.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  assert.equal((prose.match(/^# /gm) ?? []).length, 1, `H1 count: ${file}`);
  assert.equal(prose.match(/^# (.+)$/m)?.[1], front.title, `H1 title: ${file}`);
  const prefix = Number(path.basename(file).match(/^(\d+)-/)[1]);
  assert.equal(front.sidebar_position, prefix, `Sidebar position: ${file}`);
  assert(front.sidebar_label.startsWith(`${String(prefix).padStart(2, '0')}. `), `Sidebar label: ${file}`);
  assert(!/\bTODO\b|待补充|占位图/u.test(source), `Draft placeholder: ${file}`);
  assert.equal((source.match(/^```/gm) ?? []).length % 2, 0, `Code fences: ${file}`);
  if (index < 4) {
    const exercise = source.split(/^## \d+\. 练习与答案[^\n]*\n/m)[1]?.split(/^## /m)[0];
    assert(exercise, `Exercise section: ${file}`);
    assert.equal((exercise.match(/^\*\*问题[一二三四]：/gm) ?? []).length, 4, `Question count: ${file}`);
    assert.equal((exercise.match(/^答案：/gm) ?? []).length, 4, `Answer count: ${file}`);
    for (const item of exercise.split(/^\*\*问题[一二三四]：/m).slice(1)) assert(/^答案：.+/m.test(item), `Unanswered: ${file}`);
    answers += 4;
  } else {
    const exercise = source.split(/^## \d+\. 课后练习[^\n]*\n/m)[1]?.split(/^## /m)[0];
    assert(exercise, `Existing exercise section: ${file}`);
    const [questions, solutions] = exercise.split(/^### \d+\.\d+ 参考答案[^\n]*\n/m);
    assert(solutions, `Existing answer section: ${file}`);
    const ids = text => [...text.matchAll(/^(\d+)\. .+$/gm)].map(match => Number(match[1]));
    assert.deepEqual(ids(questions), [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(ids(solutions), ids(questions));
    answers += 7;
  }
  diagrams += (source.match(/^```mermaid/gm) ?? []).length;
  for (const snippet of source.matchAll(/^```bash\n([\s\S]*?)\n```/gm)) {
    bashBlocks++;
    if (bash) {
      const checked = spawnSync(bash, ['-n'], {input:snippet[1] + '\n', encoding:'utf8', cwd:root});
      assert.equal(checked.status, 0, `Bash syntax ${file}: ${checked.error ?? checked.stderr}`);
    }
  }
  console.log(`PASS metadata, outline and answered exercises: ${file}`);
}
assert.equal(answers, 30);
assert.equal(diagrams, 9);
const near = (actual, expected) => assert(Math.abs(actual - expected) < 1e-9);
near(64 * 15.36, 983.04);
near(64 * 15.36 * 0.75 * 0.8, 589.824);
near(100 / 8, 12.5);
near(120 - (5 + 25 + 10), 80);
near(20 - (5 + 25 + 10), -20);
near(20 * 100 * (1 - 0.75), 500);
near(500 / 50, 10);
near(8 * 256 * 0.5, 1024);
near(50 / 40, 1.25);
assert(sources[1].includes('983.04') && sources[1].includes('589.824'));
assert(sources[2].includes('160 GB/s') && sources[2].includes('220 GB/s'));
assert(sources[3].includes('192.0.2.40:/models') && sources[3].includes('proto=tcp'));
assert(sources[4].includes('--readonly') && sources[4].includes('--allow_file_create=0') && sources[4].includes('--fallocate=none'));
assert(sources[4].includes('500 GB ÷ 50 s = 10 GB/s'));
assert(sources[5].includes('CUDA 12.8') && sources[5].includes('13.4') && sources[5].includes('v1.20'));
assert(sources[5].includes('/etc/cuobj.json') && sources[5].includes('CUOBJ_ENV_PATH_JSON') && sources[5].includes('CUFILE_ENV_PATH_JSON'));
const category = JSON.parse(fs.readFileSync(path.join(root, 'docs/storage/oceanstor/_category_.json'), 'utf8'));
assert.equal(category.collapsed, true);
assert.equal(category.link.id, 'storage/oceanstor/OceanStor-AI存储学习路线');
const positions = fs.readdirSync(path.join(root, 'docs/storage'), {withFileTypes:true})
  .filter(entry => entry.isDirectory())
  .map(entry => path.join(root, 'docs/storage', entry.name, '_category_.json'))
  .filter(file => fs.existsSync(file))
  .map(file => JSON.parse(fs.readFileSync(file, 'utf8')).position);
assert.equal(new Set(positions).size, positions.length, 'Duplicate storage category position');
console.log(`PASS 6 articles, 30 answered questions, 9 diagrams, category order and numerical scope; ${bashBlocks} Bash blocks${bash ? ' syntax checked' : ' (use --bash to check syntax)'}.`);
console.log('No storage mounting, fio/gdsio load, GPU computation or driver change is performed.');
