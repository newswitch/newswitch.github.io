import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

const root = process.cwd();
const base = 'docs/development/spring/01-container';
const examples = 'examples/spring/container-lab';
const manifest = [
  ['01-从手动装配到IoC与依赖注入.md', 'ioc.IocDemo'],
  ['02-配置类组件扫描与依赖选择.md', 'selection.DependencyDemo'],
  ['03-BeanDefinition-BeanFactory与ApplicationContext.md', 'definitions.DefinitionDemo'],
  ['04-Bean生命周期Scope与线程安全.md', 'lifecycle.LifecycleScopeDemo'],
  ['05-定义后置处理实例后置处理与FactoryBean.md', 'extensions.ExtensionDemo'],
  ['06-Environment-PropertySource-Profile与条件配置.md', 'environment.EnvironmentDemo'],
  ['07-事件SmartLifecycle与资源关闭.md', 'events.EventsDemo'],
];
const sources = new Map();
const cases = manifest.map(([document, name]) => {
  const markdown = fs.readFileSync(path.join(root, base, document), 'utf8').replaceAll('\r\n', '\n');
  const blocks = [...markdown.matchAll(/^```(?:java|xml|properties) title="([^"]+)"\n([\s\S]*?)^```/gm)];
  for (const match of blocks) {
    const file = path.posix.join(examples, match[1]);
    if (!file.startsWith(examples + '/') || match[1].includes('..') || sources.has(file)) throw new Error(`Unexpected source: ${file}`);
    sources.set(file, match[2].trimEnd() + '\n');
  }
  const outputs = [...markdown.matchAll(/^```text title="expected-output"\n([\s\S]*?)^```/gm)];
  const main = `demo.container.${name}`;
  const javaFile = `${examples}/src/main/java/${main.replaceAll('.', '/')}.java`;
  if (!sources.has(javaFile) || outputs.length !== 1) throw new Error(`Incomplete example: ${document}`);
  return {main, output: outputs[0][1].trimEnd()};
});
if (sources.size !== 9) throw new Error(`Expected nine article source files, got ${sources.size}`);
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
const work = fs.mkdtempSync(path.join(parent, 'spring-container-check-'));
const project = path.join(work, 'container-lab');
fs.cpSync(path.join(root, examples), project, {recursive: true, filter: file => !['target', 'out'].includes(path.basename(file))});
const repository = option('--maven-repo') ?? path.join(parent, 'spring-m2');
function run(command, args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd: project, env: {...process.env, JAVA_HOME: javaHome}, stdio: ['ignore', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
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
  const mavenArgs = [
    `-Dmaven.home=${mavenHome}`, `-Dmaven.multiModuleProjectDirectory=${project}`,
    `-Dclassworlds.conf=${path.join(mavenHome, 'bin/m2.conf')}`, '-Dstyle.color=never',
    '-classpath', path.join(boot, classworlds), 'org.codehaus.plexus.classworlds.launcher.Launcher',
    '-B', '-ntp', `-Dmaven.repo.local=${repository}`, '-f', path.join(project, 'pom.xml'),
    'clean', 'verify', 'dependency:copy-dependencies', '-DincludeScope=runtime',
  ];
  console.log('RUN Maven compilation, container semantics tests and runtime dependencies');
  const built = await run(binary('java'), mavenArgs, 240000);
  for (const line of built.stdout.split('\n')) {
    if (/Tests run:|BUILD SUCCESS/u.test(line)) console.log(line);
  }
  const report = fs.readFileSync(path.join(project, 'target/surefire-reports/TEST-demo.container.ContainerSemanticsTest.xml'), 'utf8');
  const suite = report.match(/<testsuite\b[^>]*>/u)?.[0];
  if (!suite) throw new Error('JUnit report missing.');
  const attributes = Object.fromEntries([...suite.matchAll(/([\w]+)="([^"]*)"/gu)].map(match => [match[1], match[2]]));
  if (Number(attributes.tests) !== 29 || ['errors', 'failures', 'skipped'].some(key => Number(attributes[key]) !== 0))
    throw new Error(`Unexpected test summary: ${suite}`);
  const jars = fs.readdirSync(path.join(project, 'target/dependency'));
  const spring = jars.filter(file => /^spring-.*\.jar$/u.test(file));
  if (!spring.includes('spring-context-7.0.9.jar') || spring.some(file => !file.endsWith('-7.0.9.jar')))
    throw new Error(`Spring version mismatch: ${spring.join(', ')}`);
  const classpath = [path.join(project, 'target/classes'), path.join(project, 'target/dependency/*')].join(path.delimiter);
  for (const item of cases) {
    for (let repetition = 0; repetition < 3; repetition++) {
      const result = await run(binary('java'), ['-Dfile.encoding=UTF-8', '-cp', classpath, item.main]);
      if (result.stdout !== item.output) throw new Error(`Output mismatch: ${item.main}\n${result.stdout}\n${result.stderr}`);
    }
    console.log(`PASS ${item.main}: three fresh JVM runs match documented output`);
  }
  console.log(`PASS all Spring modules aligned to 7.0.9: ${spring.length} runtime modules`);
  success = true;
} finally {
  if (success) {
    if (path.dirname(work) !== parent || !path.basename(work).startsWith('spring-container-check-'))
      throw new Error('Unexpected cleanup path.');
    fs.rmSync(work, {recursive: true});
  } else {
    console.error(`Failure artifacts retained for inspection: ${work}`);
  }
}
console.log('All Spring container checks passed; no application server or background worker was started.');
