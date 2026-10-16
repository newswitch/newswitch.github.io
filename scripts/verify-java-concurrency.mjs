import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = process.cwd();
const base = 'docs/development/java/03-concurrency';
const examples = 'examples/java/third-batch/concurrency';
const documents = [
  ['01-Thread生命周期中断与退出.md', 'threads', 'ThreadDemo'],
  ['02-JMM-volatile与安全发布.md', 'publication', 'PublicationDemo'],
  ['03-synchronized-Monitor与条件等待.md', 'monitors', 'MonitorDemo'],
  ['04-Lock-Condition-AQS与同步器.md', 'locks', 'LockDemo'],
  ['05-CAS原子类与并发容器.md', 'atomics', 'AtomicDemo'],
  ['06-线程池队列拒绝与关闭.md', 'pools', 'PoolDemo'],
  ['07-Future-CompletableFuture与超时取消.md', 'futures', 'FutureDemo'],
  ['08-ThreadLocal-ScopedValue与上下文.md', 'context', 'ContextDemo'],
  ['09-虚拟线程载体线程与资源上限.md', 'virtual', 'VirtualDemo'],
];
const cases = documents.map(([document, directory, main]) => {
  const markdown = fs.readFileSync(path.join(root, base, document), 'utf8').replaceAll('\r\n', '\n');
  const sources = [...markdown.matchAll(/^```java title="([^"]+)"\n([\s\S]*?)^```/gm)];
  const outputs = [...markdown.matchAll(/^```text title="expected-output"\n([\s\S]*?)^```/gm)];
  if (sources.length !== 1 || sources[0][1] !== `${main}.java` || outputs.length !== 1) throw new Error(`Incomplete example: ${document}`);
  return {main, directory, file: `${examples}/${directory}/${main}.java`,
    source: sources[0][2].trimEnd() + '\n', output: outputs[0][1].trimEnd()};
});
if (process.argv.includes('--emit-patch')) {
  let patch = '*** Begin Patch\n';
  for (const item of cases) {
    if (fs.existsSync(path.join(root, item.file))) throw new Error(`Refusing to replace: ${item.file}`);
    patch += `*** Add File: ${path.join(root, item.file).replaceAll('\\', '/')}\n`;
    patch += item.source.trimEnd().split('\n').map((line) => `+${line}`).join('\n') + '\n';
  }
  process.stdout.write(patch + '*** End Patch\n');
  process.exit(0);
}
for (const item of cases) {
  if (fs.readFileSync(path.join(root, item.file), 'utf8').replaceAll('\r\n', '\n') !== item.source) throw new Error(`Article/source mismatch: ${item.file}`);
}
console.log(`Article/source consistency: ${cases.length} programs passed.`);
if (process.argv.includes('--check-sources')) process.exit(0);
function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
const javaHome = option('--java-home') ?? process.env.JAVA_HOME;
if (!javaHome) throw new Error('Supply --java-home with JDK 25.');
const repeat = Number(option('--repeat') ?? 5);
if (!Number.isInteger(repeat) || repeat < 1 || repeat > 100) throw new Error('--repeat must be from 1 to 100.');
const binary = (name) => path.join(javaHome, 'bin', `${name}${process.platform === 'win32' ? '.exe' : ''}`);
function run(command, args) {
  const result = spawnSync(command, args, {encoding: 'utf8', timeout: 30000});
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  return result.stdout.replaceAll('\r\n', '\n').trim();
}
const version = run(binary('javac'), ['-version']);
if (!/^javac 25(?:[.\s]|$)/u.test(version)) throw new Error(`Expected JDK 25, got ${version}`);
console.log(version);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'java-concurrency-check-'));
const classpaths = [];
for (const item of cases) {
  const out = path.join(temporaryRoot, item.directory);
  fs.mkdirSync(out);
  classpaths.push(out);
  run(binary('javac'), ['-encoding', 'UTF-8', '--release', '25', '-d', out, path.join(root, item.file)]);
  for (let i = 0; i < repeat; i++) {
    const output = run(binary('java'), ['-Dfile.encoding=UTF-8', '-cp', out, item.main]);
    if (output !== item.output) throw new Error(`${item.main} run ${i + 1}: output mismatch\n${output}`);
  }
  console.log(`PASS ${item.main}: compilation and ${repeat} documented-output runs`);
}
const classpath = [...classpaths, temporaryRoot].join(path.delimiter);
run(binary('javac'), ['-encoding', 'UTF-8', '--release', '25', '-cp', classpath, '-d', temporaryRoot,
  path.join(root, examples, 'checks/ConcurrencyChecks.java')]);
for (let i = 0; i < repeat; i++) {
  if (run(binary('java'), ['-cp', classpath, 'ConcurrencyChecks']) !== 'coordination checks passed') throw new Error('Coordination checks failed.');
}
console.log(`PASS monitor handoff and pre-opened condition checks: ${repeat} runs`);
if (path.dirname(temporaryRoot) !== path.resolve(os.tmpdir()) || !path.basename(temporaryRoot).startsWith('java-concurrency-check-')) throw new Error('Unexpected cleanup path.');
fs.rmSync(temporaryRoot, {recursive: true});
console.log('All concurrency article checks passed. Repeated tests do not replace JMM reasoning.');
