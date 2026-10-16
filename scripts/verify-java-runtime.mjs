import fs from 'node:fs';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';

const root = process.cwd();
const examples = 'examples/java/fourth-batch';
const manifest = [
  ['04-jvm/01-字节码Class文件与方法执行.md', 'BytecodeDemo'],
  ['04-jvm/02-类加载链接初始化与ClassLoader.md', 'InitializationDemo'],
  ['04-jvm/03-运行时内存堆外与进程RSS.md', 'BufferMemoryDemo'],
  ['04-jvm/04-对象分配引用GCRoots与安全点.md', 'ReferenceDemo'],
  ['04-jvm/05-G1-Region标记复制与暂停.md', 'GcWorkload'],
  ['04-jvm/07-解释器JIT内联与反优化.md', 'JitDemo'],
  ['04-jvm/08-JVM容器资源CPU与内存预算.md', 'CpuBudgetDemo'],
  ['04-jvm/09-CDS-AppCDS与AOT缓存.md', 'StartupDemo'],
  ['06-diagnostics/01-JDK诊断工具Attach与证据采集.md', 'DiagnosticTarget'],
  ['06-diagnostics/02-JFR事件采样与性能画像.md', 'RecordingDemo'],
  ['06-diagnostics/03-线程锁CPU与卡顿定位.md', 'LockEvidenceDemo'],
];
const cases = manifest.map(([document, main]) => {
  const markdown = fs.readFileSync(path.join(root, 'docs/development/java', document), 'utf8').replaceAll('\r\n', '\n');
  const blocks = [...markdown.matchAll(/^```java title="([^"]+)"\n([\s\S]*?)^```/gm)];
  const outputs = [...markdown.matchAll(/^```text title="expected-output"\n([\s\S]*?)^```/gm)];
  if (blocks.length !== 1 || blocks[0][1] !== `${main}.java`) throw new Error(`Missing source: ${document}`);
  if (main !== 'DiagnosticTarget' && outputs.length !== 1) throw new Error(`Missing output: ${document}`);
  return {main, source: blocks[0][2].trimEnd() + '\n', output: outputs[0]?.[1].trimEnd(), file: `${examples}/${main}.java`};
});
if (process.argv.includes('--emit-patch')) {
  let patch = '*** Begin Patch\n';
  for (const item of cases) {
    if (fs.existsSync(path.join(root, item.file))) throw new Error(`Refusing to overwrite ${item.file}`);
    patch += `*** Add File: ${path.join(root, item.file).replaceAll('\\', '/')}\n`;
    patch += item.source.trimEnd().split('\n').map(line => `+${line}`).join('\n') + '\n';
  }
  process.stdout.write(patch + '*** End Patch\n');
  process.exit(0);
}
for (const item of cases) {
  if (fs.readFileSync(path.join(root, item.file), 'utf8').replaceAll('\r\n', '\n') !== item.source)
    throw new Error(`Article/source mismatch: ${item.file}`);
}
console.log(`Article/source consistency: ${cases.length} programs passed.`);
if (process.argv.includes('--check-sources')) process.exit(0);
const index = process.argv.indexOf('--java-home');
const javaHome = index < 0 ? process.env.JAVA_HOME : process.argv[index + 1];
if (!javaHome) throw new Error('Supply --java-home with JDK 25.');
const binary = name => path.join(javaHome, 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
const parent = path.resolve(root, '.java-article-checks');
fs.mkdirSync(parent, {recursive: true});
const work = fs.mkdtempSync(path.join(parent, 'java-runtime-check-'));
function run(name, args, options = {}) {
  const result = spawnSync(binary(name), args, {cwd: work, encoding: 'utf8', timeout: 45000, maxBuffer: 12 * 1024 * 1024, ...options});
  if (result.error || result.status !== 0)
    throw new Error(`${name} ${args.join(' ')} failed: ${result.error ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  return ((result.stdout ?? '') + (result.stderr ?? '')).replaceAll('\r\n', '\n').trim();
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function expected(main, args = []) {
  const item = cases.find(value => value.main === main);
  const output = run('java', [...args, '-cp', path.join(work, main), main,
    ...(main === 'RecordingDemo' ? [path.join(work, 'tasks.jfr')] : [])]);
  assert(output === item.output, `${main} output mismatch:\n${output}`);
  console.log(`PASS ${main}: documented output`);
}
let target;
let targetOutput = '';
let targetError = '';
let targetExited;
try {
  const version = run('javac', ['-version']);
  assert(/^javac 25(?:[.\s]|$)/u.test(version), `Expected JDK 25, got ${version}`);
  console.log(version);
  for (const item of cases) {
    const out = path.join(work, item.main);
    fs.mkdirSync(out);
    run('javac', ['-encoding', 'UTF-8', '-g', '--release', '25', '-d', out, path.join(root, item.file)]);
  }
  for (const main of ['BytecodeDemo', 'InitializationDemo', 'ReferenceDemo', 'JitDemo', 'StartupDemo']) expected(main);
  expected('BufferMemoryDemo', ['-Xmx64m', '-XX:MaxDirectMemorySize=16m']);
  expected('CpuBudgetDemo', ['-XX:ActiveProcessorCount=2']);
  for (let i = 0; i < 5; i++) expected('LockEvidenceDemo');
  expected('RecordingDemo', [`-XX:FlightRecorderOptions=repository=${work}`]);
  const bytecode = run('javap', ['-classpath', path.join(work, 'BytecodeDemo'), '-v', '-p', 'BytecodeDemo']);
  for (const token of ['major version: 69', 'descriptor: (II)I', 'imul', 'istore_2', 'ireturn'])
    assert(bytecode.includes(token), `Missing bytecode evidence: ${token}`);
  const interpreted = run('java', ['-Xint', '-cp', path.join(work, 'JitDemo'), 'JitDemo']);
  assert(interpreted === cases.find(item => item.main === 'JitDemo').output, 'Interpreter result differs.');
  const compiled = run('java', ['-XX:+PrintCompilation', '-cp', path.join(work, 'JitDemo'), 'JitDemo']);
  assert(compiled.includes('JitDemo::'), 'No JIT compilation evidence.');
  console.log('PASS bytecode version/instructions and interpreter/JIT result');
  for (const [collector, heap] of [['G1', '64m'], ['Z', '128m']]) {
    const file = `${collector}.log`;
    expected('GcWorkload', [`-Xms${heap}`, `-Xmx${heap}`, `-XX:+Use${collector}GC`,
      `-Xlog:gc*,safepoint:file=${file}:uptime,level,tags`]);
    const log = fs.readFileSync(path.join(work, file), 'utf8');
    assert(log.includes(collector === 'G1' ? 'Using G1' : 'Using The Z Garbage Collector'), `Wrong collector: ${collector}`);
    if (collector === 'G1') assert(log.includes('Pause Young') && log.includes('Safepoint'), 'Missing G1 pause/safepoint.');
    console.log(`PASS ${collector} bounded workload and collector log`);
  }
  const jar = path.join(work, 'startup.jar');
  run('jar', ['--create', '--file', jar, '--main-class', 'StartupDemo', '-C', path.join(work, 'StartupDemo'), '.']);
  run('java', ['-XX:ArchiveClassesAtExit=startup.jsa', '-jar', jar]);
  const shared = run('java', ['-Xshare:on', '-XX:SharedArchiveFile=startup.jsa', '-Xlog:class+load=info', '-jar', jar]);
  assert(/StartupDemo source: shared objects file/u.test(shared), 'Application class did not use CDS.');
  run('java', ['-XX:AOTCacheOutput=startup.aot', '-jar', jar]);
  const aot = run('java', ['-XX:AOTMode=on', '-XX:AOTCache=startup.aot', '-Xlog:aot=info', '-jar', jar]);
  assert(aot.includes('tasks=load,validate,serve') && fs.statSync(path.join(work, 'startup.aot')).size > 0, 'AOT cache run failed.');
  run('java', ['-XX:AOTMode=record', '-XX:AOTConfiguration=training.aotconfig', '-jar', jar]);
  run('java', ['-XX:AOTMode=create', '-XX:AOTConfiguration=training.aotconfig', '-XX:AOTCache=training.aot', '-jar', jar]);
  const trained = run('java', ['-XX:AOTMode=on', '-XX:AOTCache=training.aot', '-jar', jar]);
  assert(trained.endsWith('tasks=load,validate,serve'), 'Three-stage AOT result differs.');
  console.log('PASS AppCDS application class and both JDK 25 AOT cache workflows');
  const summary = run('jfr', ['summary', path.join(work, 'tasks.jfr')]);
  const events = run('jfr', ['print', '--events', 'learning.Task', path.join(work, 'tasks.jfr')]);
  assert(/learning\.Task\s+2\s/u.test(summary), 'JFR custom event count differs.');
  assert(events.includes('number = 1') && events.includes('number = 2'), 'JFR payload differs.');
  console.log('PASS JFR API roundtrip and offline CLI summary/print');

  target = spawn(binary('java'), ['-Xms32m', '-Xmx64m', '-XX:NativeMemoryTracking=summary',
    `-XX:FlightRecorderOptions=repository=${work}`,
    '-cp', path.join(work, 'DiagnosticTarget'), 'DiagnosticTarget'], {cwd: work, stdio: ['pipe', 'pipe', 'pipe']});
  target.stdout.setEncoding('utf8');
  target.stderr.setEncoding('utf8');
  target.stdout.on('data', chunk => { targetOutput += chunk; });
  target.stderr.on('data', chunk => { targetError += chunk; });
  target.stdin.on('error', () => {});
  targetExited = new Promise((resolve, reject) => {
    target.once('error', reject);
    target.once('close', code => resolve(code));
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Target not ready: ${targetOutput}\n${targetError}`)), 10000);
    function onData() {
      if (/READY pid=\d+/u.test(targetOutput)) { clearTimeout(timer); target.stdout.off('data', onData); resolve(); }
    }
    target.stdout.on('data', onData);
    onData();
  });
  const pid = String(target.pid);
  assert(targetOutput.includes(`READY pid=${pid}`), 'Target PID mismatch.');
  for (const [command, token] of [
    ['VM.version', '25.0.4'], ['VM.command_line', 'DiagnosticTarget'], ['VM.flags', 'MaxHeapSize'],
    ['GC.heap_info', 'heap'], ['Thread.print', 'runtime-worker'], ['VM.classloaders', 'ClassLoader'],
    ['VM.classloader_stats', 'ClassLoader'], ['Compiler.codecache', 'CodeHeap'],
  ]) {
    const args = command === 'Thread.print' ? ['Thread.print', '-l'] : [command];
    const output = run('jcmd', [pid, ...args]);
    assert(command === 'VM.version' ? /25(?:[.\s]|$)/u.test(output) : output.includes(token), `Missing ${command} evidence:\n${output}`);
  }
  const baseline = run('jcmd', [pid, 'VM.native_memory', 'baseline']);
  assert(baseline.includes('Baseline taken'), 'NMT baseline missing.');
  const native = run('jcmd', [pid, 'VM.native_memory', 'summary.diff', 'scale=KB']);
  assert(native.includes('Native Memory Tracking') && native.includes('Java Heap'), 'NMT diff unavailable.');
  run('jcmd', [pid, 'JFR.start', 'name=runtime', 'settings=profile', 'maxsize=32m']);
  await new Promise(resolve => setTimeout(resolve, 1200));
  const recording = path.join(work, 'runtime.jfr');
  run('jcmd', [pid, 'JFR.dump', 'name=runtime', `filename=${recording}`]);
  run('jcmd', [pid, 'JFR.stop', 'name=runtime']);
  assert(run('jfr', ['summary', recording]).includes('jdk.'), 'Attached JFR missing standard events.');
  const json = path.join(work, 'threads.json');
  run('jcmd', [pid, 'Thread.dump_to_file', '-format=json', json]);
  assert(fs.readFileSync(json, 'utf8').includes('runtime-worker'), 'Thread JSON missing worker.');
  assert(run('jstat', ['-gcutil', pid, '100', '2']).includes('FGC'), 'jstat header missing.');
  target.stdin.end('\n');
  const code = await Promise.race([targetExited, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('Target did not stop after input.')), 10000);
    timer.unref();
  })]);
  assert(code === 0 && targetOutput.includes('STOPPED'), `Target shutdown failed: ${code}\n${targetOutput}\n${targetError}`);
  console.log('PASS live Attach: identity, flags, heap, loaders, threads/JSON, code cache, NMT, JFR and jstat');
  console.log('PASS owned diagnostic JVM exited; no persistent service or network listener remains.');
} finally {
  if (target && target.exitCode === null) {
    target.stdin.end('\n');
    await Promise.race([targetExited.catch(() => {}), new Promise(resolve => setTimeout(resolve, 2500))]);
    if (target.exitCode === null) {
      target.kill();
      await targetExited.catch(() => {});
    }
  }
  if (path.dirname(work) !== parent || !path.basename(work).startsWith('java-runtime-check-'))
    throw new Error('Unexpected temporary cleanup path.');
  fs.rmSync(work, {recursive: true, force: true});
}
console.log('All Java runtime article checks passed. Linux cgroups, native profiler and Arthas were not exercised.');
