import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {compile} from '@mdx-js/mdx';

const root = process.cwd();
const args = process.argv.slice(2);
const option = name => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
function walk(dir) {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
}
const allDocs = ['python', 'fastapi'].flatMap(name =>
  walk(path.join(root, 'docs/development', name)).filter(file => file.endsWith('.md')));
const freshDocs = allDocs.filter(file =>
  !file.includes(path.sep + '01-language' + path.sep) && !path.basename(file).startsWith('00-'));
const blocks = [];
for (const file of freshDocs) {
  const text = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  const isFastAPI = file.includes(path.sep + 'fastapi' + path.sep);
  const lab = path.join(root, isFastAPI ? 'examples/fastapi/framework-lab' : 'examples/python/advanced-lab');
  for (const match of text.matchAll(/^```python title="([^"]+\.py)"\n([\s\S]*?)^```/gm)) {
    assert(!match[1].includes('..') && !match[1].startsWith('/') && !match[1].includes('\\'));
    const outName = match[1].replace(/\.py$/u, '.out');
    const output = [...text.matchAll(/^```text title="([^"]+)"\n([\s\S]*?)^```/gm)]
      .find(result => result[1] === outName)?.[2];
    blocks.push({file, lab, relative: match[1], source: match[2], output});
  }
}
assert.equal(new Set(blocks.map(block => path.join(block.lab, block.relative))).size, blocks.length);
if (args.includes('--source-patch')) {
  let patch = '*** Begin Patch\n';
  let count = 0;
  for (const block of blocks) {
    const target = path.join(block.lab, block.relative);
    if (fs.existsSync(target)) {
      assert.equal(fs.readFileSync(target, 'utf8').replaceAll('\r\n', '\n'), block.source);
      continue;
    }
    patch += '*** Add File: ' + target.replaceAll('\\', '/') + '\n';
    patch += block.source.trimEnd().split('\n').map(line => '+' + line).join('\n') + '\n';
    count++;
  }
  assert(count > 0, 'No missing source files');
  console.log(patch + '*** End Patch');
  process.exit(0);
}
if (!args.includes('--partial')) {
  assert.equal(allDocs.length, 62, '36 Python, 24 FastAPI and two routes');
  assert.equal(freshDocs.length, 50, 'Expected all remaining technical articles');
}
for (const file of allDocs) {
  const source = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  assert.equal((source.match(/^# /gm) ?? []).length, 1, file);
  await compile(source.replace(/^---\n[\s\S]*?\n---\n/u, ''));
  if (!path.basename(file).startsWith('00-')) {
    assert.equal([...source.matchAll(/^### \d+\.\d+ .+\n\n答案：/gm)].length, 3, file);
  }
}
for (const block of blocks) {
  assert.equal(fs.readFileSync(path.join(block.lab, block.relative), 'utf8').replaceAll('\r\n', '\n'),
    block.source, 'Article source mismatch: ' + block.relative);
}
for (const name of ['python', 'fastapi']) {
  for (const file of walk('docs/development/' + name).filter(file => file.endsWith('_category_.json'))) {
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).collapsed, true, file);
  }
}
console.log('PASS: ' + allDocs.length + ' MDX pages, answered exercises, ' + blocks.length + ' matching sources');
if (args.includes('--check-build')) {
  const data = JSON.parse(fs.readFileSync('.docusaurus/globalData.json', 'utf8'));
  const built = data['docusaurus-plugin-content-docs'].default.versions.flatMap(v => v.docs)
    .filter(doc => /^development\/(?:python|fastapi)\//u.test(doc.id));
  assert.equal(built.length, allDocs.length);
  for (const doc of built) {
    const html = fs.readFileSync(path.join('build', decodeURIComponent(doc.path), 'index.html'), 'utf8');
    assert(html.includes('<h1'), doc.path);
    if (!doc.id.endsWith('学习路线')) assert(html.includes('练习与答案'), doc.path);
  }
  console.log('PASS: all built Python/FastAPI routes');
}
const python = option('--python');
if (!python) process.exit(0);
const temp = path.join(root, '.python-article-checks/temp');
fs.mkdirSync(temp, {recursive: true});
const env = {...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1',
  TEMP: temp, TMP: temp, TMPDIR: temp, NO_COLOR: '1'};
delete env.PYTHONPATH;
delete env.PYTHONHOME;
function run(argv, cwd) {
  const result = spawnSync(python, argv, {cwd, env, encoding: 'utf8',
    timeout: 90000, maxBuffer: 8 * 1024 * 1024});
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.replaceAll('\r\n', '\n');
}
run(['-m', 'pip', 'check'], root);
let outputs = 0;
for (let round = 0; round < 3; round++) {
  for (const block of blocks.filter(block => block.output !== undefined)) {
    assert.equal(run([block.relative], block.lab), block.output, block.relative);
    outputs++;
    if (round === 0) console.log('PASS OUTPUT ' + block.relative);
  }
}
const pythonLab = path.join(root, 'examples/python/advanced-lab');
if (fs.existsSync(pythonLab)) {
  console.log(run(['-m', 'pytest', '-q', 'test_contract.py'], pythonLab));
}
const fastLab = path.join(root, 'examples/fastapi/framework-lab');
if (fs.existsSync(path.join(fastLab, 'tests'))) {
  console.log(run(['-m', 'pytest', '-q', 'test_api_contract.py', 'tests'], fastLab));
}
console.log('PASS: ' + outputs + ' independently executed expected outputs and test suites');
