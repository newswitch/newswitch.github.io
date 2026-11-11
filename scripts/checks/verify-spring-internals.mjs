import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

const root = process.cwd();
const base = 'docs/development/spring/04-internals';
const examples = 'examples/spring/internals-lab';
const manifest = [
  [
    "01-ApplicationContext刷新状态与失败清理.md",
    "refresh.RefreshDemo"
  ],
  [
    "02-Bean创建依赖解析提前引用与循环依赖.md",
    "creation.CreationDemo"
  ],
  [
    "03-配置类解析ImportSelector与定义注册.md",
    "config.ConfigurationDemo"
  ],
  [
    "04-自动代理创建Advisor匹配与调用链.md",
    "proxy.AutoProxyDemo"
  ],
  [
    "05-事务拦截器连接绑定与完成路径.md",
    "transaction.TransactionPathDemo"
  ],
  [
    "06-MVC映射参数转换与响应源码路径.md",
    "mvc.MvcPathDemo"
  ],
  [
    "07-TestContext上下文缓存与测试隔离.md",
    "testing.ContextCacheDemo"
  ]
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
  const main = `demo.internals.${name}`;
  if (!sources.has(`${examples}/src/main/java/${main.replaceAll('.', '/')}.java`) || outputs.length !== 1)
    throw new Error(`Incomplete example: ${document}`);
  return {main, output: outputs[0][1].trimEnd()};
});
if (sources.size !== 8) throw new Error(`Expected eight source files, got ${sources.size}`);
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
const work = fs.mkdtempSync(path.join(parent, 'spring-internals-check-'));
const project = path.join(work, 'internals-lab');
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
  console.log('RUN Maven and Spring source-path semantics tests');
  const built = await run(binary('java'), [
    `-Dmaven.home=${mavenHome}`, `-Dmaven.multiModuleProjectDirectory=${project}`,
    `-Dclassworlds.conf=${path.join(mavenHome, 'bin/m2.conf')}`, '-Dstyle.color=never',
    '-classpath', path.join(boot, classworlds), 'org.codehaus.plexus.classworlds.launcher.Launcher',
    '-B', '-ntp', `-Dmaven.repo.local=${repository}`, '-f', path.join(project, 'pom.xml'),
    'clean', 'verify', 'dependency:copy-dependencies', '-DincludeScope=runtime',
  ], 240000);
  for (const line of built.stdout.split('\n')) if (/Tests run:|BUILD SUCCESS/u.test(line)) console.log(line);
  const reports = path.join(project, 'target/surefire-reports');
  let total = 0;
  for (const file of fs.readdirSync(reports).filter(name => /^TEST-demo\.internals\..*\.xml$/u.test(name))) {
    const xml = fs.readFileSync(path.join(reports, file), 'utf8');
    const suite = xml.match(/<testsuite\b[^>]*>/u)?.[0];
    if (!suite) throw new Error(`JUnit report missing: ${file}`);
    const attributes = Object.fromEntries([...suite.matchAll(/([\w]+)="([^"]*)"/gu)].map(match => [match[1], match[2]]));
    if (['errors', 'failures', 'skipped'].some(key => Number(attributes[key]) !== 0)) throw new Error(`Unexpected test summary: ${suite}`);
    // Surefire can merge nested-class cases into an outer suite whose tests attribute is zero.
    // Count the actual cases and reject failure/skip elements as well as nonzero suite counters.
    if (/<(?:failure|error|skipped)\b/u.test(xml)) throw new Error(`Unsuccessful test case: ${file}`);
    if (xml.includes('Failed to set up a Bean Validation provider')) throw new Error(`Validation provider failed to initialize: ${file}`);
    total += [...xml.matchAll(/<testcase\b/gu)].length;
  }
  if (total !== 42) throw new Error(`Expected 42 boundary tests, got ${total}`);
  const jars = fs.readdirSync(path.join(project, 'target/dependency'));
  const spring = jars.filter(file => /^spring-.*\.jar$/u.test(file));
  if (!spring.includes("spring-context-7.0.9.jar") || !spring.includes("spring-test-7.0.9.jar")
      || spring.some(file => !file.endsWith("-7.0.9.jar")) || !jars.includes("h2-2.4.240.jar")
      || !jars.includes("aspectjweaver-1.9.25.jar") || !jars.includes("jackson-databind-3.0.4.jar"))
    throw new Error(`Runtime version mismatch: ${jars.join(", ")}`);
  const classpath = [path.join(project, 'target/classes'), path.join(project, 'target/dependency/*')].join(path.delimiter);
  for (const item of cases) {
    for (let repetition = 0; repetition < 3; repetition++) {
      const result = await run(binary('java'), ['-Dfile.encoding=UTF-8', '-cp', classpath, item.main]);
      if (result.stdout !== item.output) throw new Error(`Output mismatch: ${item.main}\n${result.stdout}\n${result.stderr}`);
    }
    console.log(`PASS ${item.main}: three fresh JVM runs match documented output`);
  }
  console.log('PASS Spring/H2/AspectJ/Jackson runtime alignment');
  success = true;
} finally {
  if (success) {
    if (path.dirname(work) !== parent || !path.basename(work).startsWith('spring-internals-check-')) throw new Error('Unexpected cleanup path.');
    fs.rmSync(work, {recursive: true});
  } else console.error(`Failure artifacts retained for inspection: ${work}`);
}
console.log('All 42 semantics tests and 21 main runs passed; owned contexts and in-memory pools closed.');
