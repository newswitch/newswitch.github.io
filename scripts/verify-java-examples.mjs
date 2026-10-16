import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const root = process.cwd();
const base = 'docs/development/java';
const examples = 'examples/java/first-batch';
const documents = [
  ['01-language/01-Java技术栈与程序执行路径.md', 'hello', new Set(['Hello.java'])],
  ['01-language/03-变量类型转换溢出与装箱.md', 'types', new Set(['TypeDemo.java'])],
  ['01-language/04-运算符控制流循环与数组.md', 'flow', new Set(['FlowDemo.java'])],
  ['01-language/05-方法调用栈与参数传递.md', 'calls', new Set(['CallDemo.java'])],
  ['01-language/06-类对象构造方法与封装.md', 'objects', new Set(['TaskDemo.java'])],
  ['01-language/07-继承接口与多态调用.md', 'dispatch', new Set(['DispatchDemo.java'])],
  ['01-language/08-static-final包与访问控制.md', 'visibility', new Set(['src/demo/model/TaskCounter.java', 'src/demo/app/Main.java'])],
  ['05-build-testing/01-Maven工程编译运行依赖与测试.md', 'maven-task-cli', new Set(['pom.xml', 'src/main/java/demo/tasks/TaskQuota.java', 'src/main/java/demo/tasks/App.java', 'src/test/java/demo/tasks/TaskQuotaTest.java'])],
];

const expected = new Map();
for (const [document, directory, titles] of documents) {
  const markdown = fs.readFileSync(path.join(root, base, document), 'utf8').replaceAll('\r\n', '\n');
  const found = new Set();
  for (const match of markdown.matchAll(/^```(?:java|xml) title="([^"]+)"\n([\s\S]*?)^```/gm)) {
    if (!titles.has(match[1])) continue;
    if (found.has(match[1])) throw new Error(`Duplicate source block: ${document}: ${match[1]}`);
    found.add(match[1]);
    expected.set(`${examples}/${directory}/${match[1]}`, match[2].trimEnd() + '\n');
  }
  if (found.size !== titles.size) throw new Error(`Incomplete source blocks in ${document}`);
}

if (process.argv.includes('--emit-patch')) {
  let patch = '*** Begin Patch\n';
  for (const [file, content] of expected) {
    if (fs.existsSync(path.join(root, file))) throw new Error(`Refusing to replace existing example: ${file}`);
    patch += `*** Add File: ${path.join(root, file).replaceAll('\\', '/')}\n`;
    patch += content.trimEnd().split('\n').map((line) => `+${line}`).join('\n') + '\n';
  }
  process.stdout.write(patch + '*** End Patch\n');
  process.exit(0);
}

for (const [file, content] of expected) {
  const actual = fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');
  if (actual !== content) throw new Error(`Article and example differ: ${file}`);
}
console.log(`Article/source consistency: ${expected.size} files passed.`);
if (process.argv.includes('--check-sources')) process.exit(0);

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const javaHome = option('--java-home') ?? process.env.JAVA_HOME;
if (!javaHome) throw new Error('Supply --java-home with a JDK 25 directory.');
const binary = (name) => path.join(javaHome, 'bin', `${name}${process.platform === 'win32' ? '.exe' : ''}`);
function run(command, args, extra = {}) {
  const result = spawnSync(command, args, {encoding: 'utf8', timeout: 600000, ...extra});
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${result.error ?? ''}\n${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  }
  return (result.stdout ?? '').replaceAll('\r\n', '\n').trim();
}
const version = run(binary('javac'), ['-version']);
if (!/^javac 25(?:[.\s]|$)/u.test(version)) throw new Error(`Expected JDK 25, got ${version}`);
console.log(version);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'java-article-check-'));
const cases = [
  ['hello', 'Hello', ['Hello.java'], ['Infra'], 'Hello, Infra'],
  ['types', 'TypeDemo', ['TypeDemo.java'], [], 'wrong=-1702967296\ncorrect=2592000000\nnarrow=-126\nfraction=2\nfloating=0.30000000000000004\nshared=9\nunboxing=null'],
  ['flow', 'FlowDemo', ['FlowDemo.java'], [], 'selected=2\ntotal=30\nstate=BATCH\nempty=true'],
  ['calls', 'CallDemo', ['CallDemo.java'], [], 'number=3\narray=9\noverload=Object\nsum=6'],
  ['objects', 'TaskDemo', ['TaskDemo.java'], [], 'title=backup\nfirstChange=true\nsecondChange=false\notherCompleted=false'],
  ['dispatch', 'DispatchDemo', ['DispatchDemo.java'], [], 'local:backup\ndry-run:backup\noverload=interface\nactual=LocalExecutor'],
  ['visibility', 'demo.app.Main', ['src/demo/model/TaskCounter.java', 'src/demo/app/Main.java'], [], 'created=2\nfirst=1\nsecond=0\nfinalElement=2'],
];
for (const [directory, main, files, args, output] of cases) {
  const out = path.join(temporaryRoot, directory);
  fs.mkdirSync(out);
  run(binary('javac'), ['-encoding', 'UTF-8', '--release', '25', '-d', out, ...files.map((file) => path.join(root, examples, directory, file))]);
  const actual = run(binary('java'), ['-cp', out, main, ...args]);
  if (actual !== output) throw new Error(`${main}: unexpected output\n${actual}`);
  console.log(`PASS ${main}: compilation and documented output`);
}
const helloOut = path.join(temporaryRoot, 'hello');
const bytecode = run(binary('javap'), ['-classpath', helloOut, '-verbose', 'Hello']);
if (!bytecode.includes('major version: 69')) throw new Error('Java 25 class version was not 69.');
const jar = path.join(temporaryRoot, 'hello.jar');
run(binary('jar'), ['--create', '--file', jar, '--main-class', 'Hello', '-C', helloOut, '.']);
if (run(binary('java'), ['-jar', jar, 'Infra']) !== 'Hello, Infra') throw new Error('JAR output mismatch.');
if (run(binary('java'), [path.join(root, examples, 'hello/Hello.java'), 'Infra']) !== 'Hello, Infra') throw new Error('Source-file mode mismatch.');
console.log('PASS bytecode version, source-file mode and executable JAR');

const negativeCases = [
  ['BadLocal', 'class BadLocal { int get() { int value; return value; } }'],
  ['BadFinal', 'class BadFinal { void set() { final int count = 1; count = 2; } }'],
  ['BadImport', 'class BadImport { static void use() { int count = 0; } private int value; static int get() { return value; } }'],
];
for (const [name, source] of negativeCases) {
  const file = path.join(temporaryRoot, `${name}.java`);
  fs.writeFileSync(file, source, 'utf8');
  const result = spawnSync(binary('javac'), ['--release', '25', '-d', temporaryRoot, file], {encoding: 'utf8', timeout: 30000});
  if (result.error || result.status === 0) throw new Error(`Expected compile rejection: ${name}`);
  console.log(`PASS expected compilation failure: ${name}`);
}

const mavenHome = option('--maven-home');
if (mavenHome) {
  const project = path.join(root, examples, 'maven-task-cli');
  const boot = path.join(mavenHome, 'boot');
  const launcher = fs.readdirSync(boot).find((file) => /^plexus-classworlds-.*\.jar$/u.test(file));
  if (!launcher) throw new Error('Maven classworlds launcher not found.');
  const args = [
    `-Dmaven.home=${mavenHome}`,
    `-Dmaven.multiModuleProjectDirectory=${project}`,
    `-Dclassworlds.conf=${path.join(mavenHome, 'bin/m2.conf')}`,
    '-classpath', path.join(boot, launcher),
    'org.codehaus.plexus.classworlds.launcher.Launcher',
    '-B', '-ntp', '-f', path.join(project, 'pom.xml'),
    ...(option('--maven-repo') ? [`-Dmaven.repo.local=${option('--maven-repo')}`] : []),
    'clean', 'verify',
  ];
  const log = run(binary('java'), args, {cwd: project, env: {...process.env, JAVA_HOME: javaHome}});
  if (!log.includes('Tests run: 4, Failures: 0, Errors: 0, Skipped: 0') || !log.includes('BUILD SUCCESS')) throw new Error(`Maven test summary unexpected:\n${log}`);
  const artifact = path.join(project, 'target/task-cli-1.0.0.jar');
  if (run(binary('java'), ['-jar', artifact, '10', '3']) !== 'remaining=7') throw new Error('Task CLI output mismatch.');
  const listing = run(binary('jar'), ['--list', '--file', artifact]);
  if (!listing.includes('demo/tasks/TaskQuota.class') || listing.includes('TaskQuotaTest.class') || listing.includes('org/junit/')) throw new Error('Unexpected application JAR contents.');
  console.log('PASS Maven verify: 4 tests, CLI output and production JAR contents');
}
if (path.dirname(temporaryRoot) !== path.resolve(os.tmpdir()) || !path.basename(temporaryRoot).startsWith('java-article-check-')) throw new Error('Unexpected temporary cleanup path.');
fs.rmSync(temporaryRoot, {recursive: true});
console.log('All requested Java article checks passed.');
