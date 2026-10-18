import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

const root = process.cwd();
const base = 'docs/development/spring/02-aop-transactions';
const examples = 'examples/spring/transactions-lab';
const manifest = [
  ['01-JDK动态代理CGLIB与调用边界.md', 'proxy.ProxyDemo'],
  ['02-切点通知拦截链与顺序.md', 'chain.AdviceChainDemo'],
  ['03-事务管理器连接与提交回滚.md', 'basics.TransactionDemo'],
  ['04-REQUIRED-REQUIRES_NEW与NESTED.md', 'propagation.PropagationDemo'],
  ['05-隔离级别数据库锁与并发控制.md', 'isolation.IsolationDemo'],
  ['06-自调用异常与线程事务边界.md', 'boundaries.BoundaryDemo'],
  ['07-编程式事务事务事件与提交后动作.md', 'completion.CompletionDemo'],
];
const sources = new Map();
const cases = manifest.map(([document, name]) => {
  const markdown = fs.readFileSync(path.join(root, base, document), 'utf8').replaceAll('\r\n', '\n');
  for (const match of markdown.matchAll(/^```(?:java|xml) title="([^"]+)"\n([\s\S]*?)^```/gm)) {
    const file = path.posix.join(examples, match[1]);
    if (!file.startsWith(examples + '/') || match[1].includes('..') || sources.has(file)) throw new Error(`Unexpected source: ${file}`);
    sources.set(file, match[2].trimEnd() + '\n');
  }
  const outputs = [...markdown.matchAll(/^```text title="expected-output"\n([\s\S]*?)^```/gm)];
  const main = `demo.tx.${name}`;
  if (!sources.has(`${examples}/src/main/java/${main.replaceAll('.', '/')}.java`) || outputs.length !== 1)
    throw new Error(`Incomplete example: ${document}`);
  return {main, output: outputs[0][1].trimEnd()};
});
if (sources.size !== 10) throw new Error(`Expected ten source files, got ${sources.size}`);
if (process.argv.includes('--emit-patch')) {
  let patch = '*** Begin Patch\n';
  for (const [file, source] of sources) {
    if (fs.existsSync(path.join(root, file))) throw new Error(`Refusing to overwrite: ${file}`);
    patch += `*** Add File: ${path.join(root, file).replaceAll('\\', '/')}\n`;
    patch += source.trimEnd().split('\n').map(line => `+${line}`).join('\n') + '\n';
  }
  process.stdout.write(patch + '*** End Patch\n');
  process.exit(0);
}
for (const [file, source] of sources) {
  if (fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n') !== source)
    throw new Error(`Article/source mismatch: ${file}`);
}
console.log(`Article/source consistency: ${sources.size} files passed.`);
if (process.argv.includes('--check-sources')) process.exit(0);
function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
const javaHome = option('--java-home') ?? process.env.JAVA_HOME;
const mavenHome = option('--maven-home');
if (!javaHome || !mavenHome) throw new Error('Supply --java-home (JDK 25) and --maven-home (Maven 3.9.14).');
const binary = name => path.join(javaHome, 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
const parent = path.resolve(root, '.java-article-checks');
fs.mkdirSync(parent, {recursive: true});
const work = fs.mkdtempSync(path.join(parent, 'spring-transactions-check-'));
const project = path.join(work, 'transactions-lab');
fs.cpSync(path.join(root, examples), project, {recursive: true, filter: file => !['target', 'out'].includes(path.basename(file))});
const repository = option('--maven-repo') ?? path.join(parent, 'spring-m2');
function run(command, args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd: project, env: {...process.env, JAVA_HOME: javaHome}, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '', stderr = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0 || timedOut) reject(new Error(`${command} exited ${code}${timedOut ? ' (timeout)' : ''}\n${stdout}\n${stderr}`));
      else resolve({stdout: stdout.replaceAll('\r\n', '\n').trim(), stderr: stderr.replaceAll('\r\n', '\n').trim()});
    });
  });
}
let success = false;
try {
  const version = await run(binary('javac'), ['-version']);
  if (!/^javac 25(?:[.\s]|$)/u.test(version.stdout)) throw new Error(`Expected JDK 25: ${version.stdout}`);
  console.log(version.stdout);
  const boot = path.join(mavenHome, 'boot');
  const classworlds = fs.readdirSync(boot).find(file => /^plexus-classworlds-.*\.jar$/u.test(file));
  if (!classworlds) throw new Error('Maven launcher missing.');
  console.log('RUN Maven and JDBC/transaction semantics tests');
  const built = await run(binary('java'), [
    `-Dmaven.home=${mavenHome}`, `-Dmaven.multiModuleProjectDirectory=${project}`,
    `-Dclassworlds.conf=${path.join(mavenHome, 'bin/m2.conf')}`, '-Dstyle.color=never',
    '-classpath', path.join(boot, classworlds), 'org.codehaus.plexus.classworlds.launcher.Launcher',
    '-B', '-ntp', `-Dmaven.repo.local=${repository}`, '-f', path.join(project, 'pom.xml'),
    'clean', 'verify', 'dependency:copy-dependencies', '-DincludeScope=runtime',
  ], 240000);
  for (const line of built.stdout.split('\n')) if (/Tests run:|BUILD SUCCESS/u.test(line)) console.log(line);
  const report = fs.readFileSync(path.join(project, 'target/surefire-reports/TEST-demo.tx.TransactionSemanticsTest.xml'), 'utf8');
  const suite = report.match(/<testsuite\b[^>]*>/u)?.[0];
  if (!suite) throw new Error('JUnit report missing.');
  const attributes = Object.fromEntries([...suite.matchAll(/([\w]+)="([^"]*)"/gu)].map(match => [match[1], match[2]]));
  if (Number(attributes.tests) !== 40 || ['errors', 'failures', 'skipped'].some(key => Number(attributes[key]) !== 0))
    throw new Error(`Unexpected test summary: ${suite}`);
  const jars = fs.readdirSync(path.join(project, 'target/dependency'));
  const spring = jars.filter(file => /^spring-.*\.jar$/u.test(file));
  if (!spring.includes('spring-jdbc-7.0.9.jar') || spring.some(file => !file.endsWith('-7.0.9.jar'))
      || !jars.includes('h2-2.4.240.jar') || !jars.includes('aspectjweaver-1.9.25.jar'))
    throw new Error(`Runtime version mismatch: ${jars.join(', ')}`);
  const classpath = [path.join(project, 'target/classes'), path.join(project, 'target/dependency/*')].join(path.delimiter);
  for (const item of cases) {
    for (let repetition = 0; repetition < 3; repetition++) {
      const result = await run(binary('java'), ['-Dfile.encoding=UTF-8', '-cp', classpath, item.main]);
      if (result.stdout !== item.output) throw new Error(`Output mismatch: ${item.main}\n${result.stdout}\n${result.stderr}`);
    }
    console.log(`PASS ${item.main}: three fresh JVM runs match documented output`);
  }
  console.log('PASS Spring 7.0.9, H2 2.4.240 and AspectJ 1.9.25 runtime alignment');
  success = true;
} finally {
  if (success) {
    if (path.dirname(work) !== parent || !path.basename(work).startsWith('spring-transactions-check-')) throw new Error('Unexpected cleanup path.');
    fs.rmSync(work, {recursive: true});
  } else console.error(`Failure artifacts retained for inspection: ${work}`);
}
console.log('All AOP/transaction checks passed; owned executors and in-memory databases closed.');
