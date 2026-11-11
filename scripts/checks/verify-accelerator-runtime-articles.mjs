import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import yaml from 'js-yaml';

const root = fileURLToPath(new URL('../../', import.meta.url));
function option(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  assert(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), `Missing value: ${name}`);
  return process.argv[index + 1];
}
const python = option('--python', 'python');
const bash = option('--bash', undefined);
const files = [
  'docs/gpu/driver-runtime/01-NVIDIA驱动CUDA与容器运行时的关系.md',
  'docs/gpu/driver-runtime/03-CUDA兼容性动态链接与PTX装载机制.md',
  'docs/gpu/cuda/02-CUDA软件栈运行库与计算调用链.md',
  'docs/gpu/ascend-npu/04-CANN软件栈组件与计算调用链.md',
  'docs/gpu/ascend-npu/05-CANN安装形态版本证据与环境隔离.md',
  'docs/gpu/driver-runtime/08-昇腾容器运行时设备注入与权限边界.md',
  'docs/gpu/driver-runtime/09-GPU-NPU裸金属容器与虚拟机边界.md',
  'docs/ai-systems/runtime/01-PyTorch后端选择CUDA与torch-npu适配.md',
];
const sources = [];
let bashBlocks = 0;
let diagrams = 0;
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');
  sources.push(source);
  const metadata = yaml.load(source.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '');
  assert(metadata?.title && metadata.sidebar_label && metadata.description, `Missing metadata: ${file}`);
  assert.equal(source.match(/^# (.+)$/m)?.[1], metadata.title, `H1 mismatch: ${file}`);
  const prose = source.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  assert.equal((prose.match(/^# /gm) ?? []).length, 1, `H1 count: ${file}`);
  const prefix = Number(path.basename(file).match(/^(\d+)-/)[1]);
  assert.equal(metadata.sidebar_position, prefix, `Sidebar position: ${file}`);
  assert(metadata.sidebar_label.startsWith(`${String(prefix).padStart(2, '0')}. `), `Sidebar label: ${file}`);
  const exercises = source.split(/^## \d+\. 练习与答案[^\n]*\n/m)[1]?.split(/^## /m)[0];
  assert(exercises, `Missing exercise section: ${file}`);
  assert.equal((exercises.match(/^\*\*问题[一二三四]：/gm) ?? []).length, 4, `Question count: ${file}`);
  assert.equal((exercises.match(/^答案：/gm) ?? []).length, 4, `Answer count: ${file}`);
  for (const item of exercises.split(/^\*\*问题[一二三四]：/m).slice(1)) assert(/^答案：.+/m.test(item), `Missing answer: ${file}`);
  assert(!/\bTODO\b|待补充|占位图/u.test(source), `Draft placeholder: ${file}`);
  assert.equal((source.match(/^```/gm) ?? []).length % 2, 0, `Unclosed fence: ${file}`);
  diagrams += (source.match(/^```mermaid/gm) ?? []).length;
  for (const block of source.matchAll(/^```bash\n([\s\S]*?)\n```/gm)) {
    bashBlocks++;
    if (bash) {
      const checked = spawnSync(bash, ['-n'], {input:block[1] + '\n', encoding:'utf8', cwd:root});
      assert.equal(checked.status, 0, `Bash syntax ${file}: ${checked.error ?? checked.stderr}`);
    }
  }
  console.log(`PASS metadata and four answered questions: ${file}`);
}
assert.equal(diagrams, 4);
const resource = yaml.load([...sources[0].matchAll(/^```yaml\n([\s\S]*?)\n```/gm)][0][1]);
assert.equal(resource.resources.limits['nvidia.com/gpu'], 1);
assert(!sources[0].includes('一路 yes') && !sources[0].includes('cuda10.2'));
assert(sources[1].includes('13.x') && sources[1].includes('580') && sources[1].includes('13.4'));
assert(sources[4].includes('CANN 8.0') && sources[4].includes('CANN 9.1') && sources[4].includes('/usr/local/Ascend/cann/set_env.sh'));
assert(sources[5].includes('ASCEND_RUNTIME_OPTIONS=NODRV') && sources[5].includes('ASCEND_RT_VISIBLE_DEVICES'));
const memory = sources[6].match(/Memory=(\d+) ShmSize=(\d+)/);
assert.equal(Number(memory[1]), 8 * 1024 ** 3);
assert.equal(Number(memory[2]), 1024 ** 3);
const output = JSON.parse([...sources[7].matchAll(/^```json\n([\s\S]*?)\n```/gm)][0][1]);
const left = [[1, 2], [3, 4]], right = [[5, 6], [7, 8]];
const product = left.map(row => right[0].map((_, column) => row.reduce((sum, value, index) => sum + value * right[index][column], 0)));
assert.deepEqual(output, {device:'cuda:0', result:product, status:'passed'});
const probe = fs.readFileSync(path.join(root, 'examples/accelerator-runtime/backend_probe.py'), 'utf8');
const parsed = spawnSync(python, ['-c', 'import ast, sys; ast.parse(sys.stdin.read()); print("PASS Python AST syntax")'], {input:probe, encoding:'utf8', cwd:root});
assert.equal(parsed.status, 0, String(parsed.error ?? parsed.stderr));
process.stdout.write(parsed.stdout);
const tests = spawnSync(python, ['-m', 'unittest', 'discover', '-s', 'examples/accelerator-runtime', '-p', 'test_*.py', '-v'], {encoding:'utf8', cwd:root, env:{...process.env, PYTHONDONTWRITEBYTECODE:'1'}});
assert.equal(tests.status, 0, String(tests.error ?? tests.stderr));
process.stdout.write(tests.stderr);
console.log(`PASS 8 articles, 32 answered questions, 4 diagrams, resource YAML, memory arithmetic, matrix result and ${bashBlocks} Bash blocks${bash ? ' (syntax checked)' : ' (pass --bash to check syntax)'}.`);
console.log('No GPU/NPU computation, driver mutation or container launch is performed by this validator.');
