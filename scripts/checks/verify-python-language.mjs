import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const root = process.cwd();
const docs = path.join(root, 'docs/development/python/01-language');
const lab = path.join(root, 'examples/python/language-lab');
const options = process.argv.slice(2);
const pyIndex = options.indexOf('--python');
const python = pyIndex >= 0 ? options[pyIndex + 1] : undefined;
const files = fs.readdirSync(docs).filter(name => name.endsWith('.md')).sort();
assert.equal(files.length, 10, 'Expected ten language articles');
const sources = new Map();
const expected = new Map();
for (const name of files) {
  const text = fs.readFileSync(path.join(docs, name), 'utf8').replaceAll('\r\n', '\n');
  const answers = [...text.matchAll(/^### \d+\.\d+ .+\n\n答案：/gm)];
  assert.equal(answers.length, 3, name + ': expected three answered exercises');
  for (const match of text.matchAll(/^```python title="([^"]+\.py)"\n([\s\S]*?)^```/gm)) {
    const relative = match[1];
    assert(!relative.startsWith('/') && !relative.includes('..') && !relative.includes('\\'));
    assert(!sources.has(relative), 'Duplicate source: ' + relative);
    sources.set(relative, match[2]);
  }
  for (const match of text.matchAll(/^```text title="([^"]+)\.out"\n([\s\S]*?)^```/gm)) {
    expected.set(match[1] + '.py', match[2]);
  }
}
assert.equal(sources.size, 12, 'Expected nine scripts and three package files');
assert.equal(expected.size, 9, 'Expected nine deterministic outputs');

if (options.includes('--source-patch')) {
  let patch = '*** Begin Patch\n';
  for (const [relative, source] of sources) {
    const target = path.join(lab, relative);
    assert(!fs.existsSync(target), 'Refusing to overwrite existing example: ' + relative);
    patch += '*** Add File: ' + target.replaceAll('\\', '/') + '\n';
    patch += source.trimEnd().split('\n').map(line => '+' + line).join('\n') + '\n';
  }
  console.log(patch + '*** End Patch');
  process.exit(0);
}

for (const [relative, source] of sources) {
  assert.equal(fs.readFileSync(path.join(lab, relative), 'utf8').replaceAll('\r\n', '\n'),
    source, 'Article/example mismatch: ' + relative);
}
console.log('PASS: 10 articles, 30 answers, 12 matching Python files, 9 expected outputs');
const {compile} = await import('@mdx-js/mdx');
const routeFiles = [
  ...files.map(name => path.join(docs, name)),
  path.join(root, 'docs/development/python/00-Python学习路线.md'),
  path.join(root, 'docs/development/fastapi/00-FastAPI学习路线.md'),
];
for (const file of routeFiles) {
  const text = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  await compile(text.replace(/^---\n[\s\S]*?\n---\n/u, ''));
}
console.log('PASS: 12 MDX documents');
if (options.includes('--check-build')) {
  const data = JSON.parse(fs.readFileSync('.docusaurus/globalData.json', 'utf8'));
  const built = data['docusaurus-plugin-content-docs'].default.versions.flatMap(v => v.docs)
    .filter(doc => /^development\/(?:python|fastapi)\//u.test(doc.id));
  assert.equal(built.length, 62);
  for (const doc of built) {
    const target = path.join(root, 'build', decodeURIComponent(doc.path), 'index.html');
    const html = fs.readFileSync(target, 'utf8');
    assert(html.includes('<h1'), 'Built heading missing: ' + doc.path);
    if (doc.id.includes('/language/')) assert(html.includes('练习与答案'));
  }
  console.log('PASS: 62 built document routes and language article answers');
}
if (!python) process.exit(0);
assert(fs.existsSync(python), 'Python executable does not exist');
const env = {...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1', NO_COLOR: '1'};
delete env.PYTHONHOME;
delete env.PYTHONPATH;
function run(executable, args, cwd = lab, status = 0) {
  const result = spawnSync(executable, args, {
    cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, status, result.stdout + result.stderr);
  return {stdout: result.stdout.replaceAll('\r\n', '\n'), stderr: result.stderr};
}
const version = run(python, ['-c', 'import sys; print(".".join(map(str, sys.version_info[:3])))']).stdout.trim();
assert.match(version, /^3\.14\./, 'Use the documented CPython 3.14 baseline');
assert.equal(run(python, ['-c',
  'import platform,sys; print(platform.python_implementation()); print(sys._is_gil_enabled())'
]).stdout, 'CPython\nTrue\n', 'Expected the standard GIL-enabled CPython build');
console.log('Runtime: CPython ' + version);
const scratchRoot = path.join(root, '.python-article-checks');
fs.mkdirSync(scratchRoot, {recursive: true});
const scratch = fs.mkdtempSync(path.join(scratchRoot, 'language-'));
assert(path.resolve(scratch).startsWith(path.resolve(scratchRoot) + path.sep));
const temp = path.join(scratch, 'temp');
fs.mkdirSync(temp);
env.TMP = temp;
env.TEMP = temp;
env.TMPDIR = temp;
try {
  const venv = path.join(scratch, 'venv');
  run(python, ['-m', 'venv', venv]);
  const venvPython = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const pip = run(venvPython, ['-m', 'pip', '--version']).stdout;
  assert(pip.includes(venv), 'pip must belong to the created environment');
  assert.match(run(venvPython, ['-m', 'pip', 'check']).stdout, /No broken requirements found/);
  for (let round = 1; round <= 3; round++) {
    for (const [relative, output] of expected) {
      const executable = relative === 'environment_demo.py' ? venvPython : python;
      assert.equal(run(executable, [relative]).stdout, output, relative + ': output mismatch');
    }
  }
  assert.equal(run(python, ['execution_demo.py', 'Ada']).stdout,
    'entry: __main__\nHello, Ada!\n');
  assert.equal(run(python, ['-m', 'lesson_pkg', '  API  ']).stdout, 'api\n');
  assert.match(run(python, ['-m', 'lesson_pkg'], lab, 2).stderr, /usage:/);
  assert.match(run(python, ['-m', 'lesson_pkg', '   '], lab, 2).stderr, /name must not be empty/);
  assert.equal(run(python, ['-c', 'import execution_demo; import lesson_pkg.rules; import lesson_pkg.rules']).stdout, '');
  assert.match(run(python, ['lesson_pkg/__main__.py', 'api'], lab, 1).stderr, /relative import/);
  const tests = run(python, ['-m', 'unittest', 'discover', '-s', 'tests', '-v']);
  console.log(tests.stderr.trim());
  console.log('PASS: 27 fresh-process outputs, venv/pip isolation, package CLI and import boundaries');
} finally {
  // Only the exact directory created by mkdtemp above is eligible for removal.
  assert(path.resolve(scratch).startsWith(path.resolve(scratchRoot) + path.sep));
  fs.rmSync(scratch, {recursive: true, force: true});
}
