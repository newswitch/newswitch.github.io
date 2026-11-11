import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const index = process.argv.indexOf('--python');
const python = process.argv[index + 1];
assert(index >= 0 && python, 'Supply --python pointing to the locked build environment');
const base = path.resolve('.python-article-checks');
fs.mkdirSync(base, {recursive: true});
const scratch = fs.mkdtempSync(path.join(base, 'package-'));
const env = {...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1',
  TEMP: scratch, TMP: scratch, TMPDIR: scratch, PIP_DISABLE_PIP_VERSION_CHECK: '1'};
delete env.PYTHONPATH;
delete env.PYTHONHOME;
function run(executable, argv, cwd = scratch) {
  const result = spawnSync(executable, argv, {
    cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024});
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.replaceAll('\r\n', '\n');
}
try {
  const project = path.join(scratch, 'project');
  fs.cpSync(path.resolve('examples/python/package-lab'), project, {
    recursive: true, filter: source => !/(?:build|dist|\.egg-info|__pycache__)(?:[\\/]|$)/u.test(source)});
  run(python, ['-m', 'build', '--no-isolation', project]);
  const dist = path.join(project, 'dist');
  const wheel = fs.readdirSync(dist).find(name => name.endsWith('.whl'));
  assert(wheel);
  assert(fs.readdirSync(dist).some(name => name.endsWith('.tar.gz')));
  const venv = path.join(scratch, 'clean');
  run(python, ['-m', 'venv', venv]);
  const executable = path.join(venv, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  run(executable, ['-m', 'pip', 'install', '--no-index', '--no-deps', path.join(dist, wheel)]);
  assert.equal(run(executable, ['-I', '-c', 'from lesson_jobs.cli import main; main()']),
    'lesson-jobs ready\n');
  const entry = path.join(venv, process.platform === 'win32' ? 'Scripts/lesson-jobs.exe' : 'bin/lesson-jobs');
  assert.equal(run(entry, []), 'lesson-jobs ready\n');
  console.log('PASS: isolated sdist/wheel build, clean offline install and installed console entry');
} finally {
  assert(path.resolve(scratch).startsWith(base + path.sep));
  fs.rmSync(scratch, {recursive: true, force: true});
}
