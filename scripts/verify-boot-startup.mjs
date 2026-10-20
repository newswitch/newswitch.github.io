import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';

const root = process.cwd();
const base = 'docs/development/spring-boot/01-startup-configuration';
const examples = 'examples/spring-boot/startup-lab';
const manifest = [
  ['01-第一个SpringBoot应用与工程结构.md', 'first.FirstApplication', ['--lab.once=true']],
  ['02-从main到端口监听的启动生命周期.md', 'lifecycle.LifecycleDemo', []],
  ['03-Starter-BOM依赖树与可执行JAR.md', 'dependencies.DependencyDemo', []],
  ['04-自动配置条件与评估报告.md', 'conditions.AutoConfigDemo', []],
  ['05-配置优先级属性绑定校验与多环境.md', 'properties.PropertyDemo', []],
  ['06-自定义Starter扩展点与测试.md', 'starter.StarterDemo', []],
];
const sources = new Map();
const cases = manifest.map(([document, name, args]) => {
  const markdown = fs.readFileSync(path.join(root, base, document), 'utf8').replaceAll('\r\n', '\n');
  for (const match of markdown.matchAll(/^```(?:java|xml|properties|text) title="([^"]+)"\n([\s\S]*?)^```/gm)) {
    if (match[1] === 'expected-output') continue;
    const file = path.posix.join(examples, match[1]);
    if (!file.startsWith(examples + '/') || match[1].includes('..') || sources.has(file)) throw new Error(`Unexpected source: ${file}`);
    sources.set(file, match[2].trimEnd() + '\n');
  }
  const outputs = [...markdown.matchAll(/^```text title="expected-output"\n([\s\S]*?)^```/gm)];
  const main = `demo.boot.${name}`;
  if (!sources.has(`${examples}/demo-app/src/main/java/${main.replaceAll('.', '/')}.java`) || outputs.length !== 1)
    throw new Error(`Incomplete example: ${document}`);
  return {main, args, output: outputs[0][1].trimEnd()};
});
if (sources.size !== 18) throw new Error(`Expected 18 article files, got ${sources.size}`);
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
const work = fs.mkdtempSync(path.join(parent, 'boot-startup-check-'));
const project = path.join(work, 'startup-lab');
fs.cpSync(path.join(root, examples), project, {recursive: true, filter: file => !['target', 'out'].includes(path.basename(file))});
const repository = option('--maven-repo') ?? path.join(parent, 'boot-startup-m2');
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
  console.log('RUN three-module build, HTTP/lifecycle/configuration and auto-configuration tests');
  const built = await run(binary('java'), [
    `-Dmaven.home=${mavenHome}`, `-Dmaven.multiModuleProjectDirectory=${project}`,
    `-Dclassworlds.conf=${path.join(mavenHome, 'bin/m2.conf')}`, '-Dstyle.color=never',
    '-classpath', path.join(boot, classworlds), 'org.codehaus.plexus.classworlds.launcher.Launcher',
    '-B', '-ntp', `-Dmaven.repo.local=${repository}`, '-f', path.join(project, 'pom.xml'),
    'clean', 'install', 'dependency:copy-dependencies', '-DincludeScope=runtime',
  ], 240000);
  for (const line of built.stdout.split('\n')) if (/Tests run:|BUILD SUCCESS/u.test(line)) console.log(line);
  let total = 0;
  for (const module of ['greeting-autoconfigure', 'demo-app']) {
    const reports = path.join(project, module, 'target/surefire-reports');
    for (const file of fs.readdirSync(reports).filter(name => name.startsWith('TEST-') && name.endsWith('.xml'))) {
      const xml = fs.readFileSync(path.join(reports, file), 'utf8');
      if (/<(?:failure|error|skipped)\b/u.test(xml)) throw new Error(`Unsuccessful test case: ${file}`);
      total += [...xml.matchAll(/<testcase\b/gu)].length;
    }
  }
  if (total !== 36) throw new Error(`Expected 36 tests, got ${total}`);
  const jars = fs.readdirSync(path.join(project, 'demo-app/target/dependency'));
  if (!jars.includes('spring-boot-4.1.1.jar') || !jars.includes('spring-context-7.0.9.jar')
      || jars.filter(file => /^spring-boot-.*\.jar$/u.test(file)).some(file => !file.endsWith('-4.1.1.jar')))
    throw new Error(`Runtime version mismatch: ${jars.join(', ')}`);
  const library = path.join(project, 'greeting-autoconfigure/target/greeting-autoconfigure-1.0.0.jar');
  const entries = (await run(binary('jar'), ['tf', library])).stdout.split('\n');
  for (const entry of ['io/newswitch/greeting/GreetingService.class', 'META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports', 'META-INF/spring-configuration-metadata.json'])
    if (!entries.includes(entry)) throw new Error(`Library entry missing: ${entry}`);
  if (entries.some(entry => entry.startsWith('BOOT-INF/'))) throw new Error('Library was incorrectly repackaged.');
  const executable = path.join(project, 'demo-app/target/boot-startup-demo-1.0.0.jar');
  const executableEntries = (await run(binary('jar'), ['tf', executable])).stdout.split('\n');
  for (const entry of ['BOOT-INF/classes/demo/boot/first/FirstApplication.class', 'BOOT-INF/lib/greeting-autoconfigure-1.0.0.jar'])
    if (!executableEntries.includes(entry)) throw new Error(`Executable entry missing: ${entry}`);
  const classpath = [path.join(project, 'demo-app/target/classes'), path.join(project, 'demo-app/target/dependency/*')].join(path.delimiter);
  for (const item of cases) {
    for (let repetition = 0; repetition < 3; repetition++) {
      const result = await run(binary('java'), ['-Dfile.encoding=UTF-8', '-cp', classpath, item.main, ...item.args]);
      if (result.stdout !== item.output) throw new Error(`Output mismatch: ${item.main}\n${result.stdout}\n${result.stderr}`);
    }
    console.log(`PASS ${item.main}: three fresh JVM runs match documented output`);
  }
  const launched = await run(binary('java'), ['-Dfile.encoding=UTF-8', '-jar', executable, '--lab.once=true']);
  if (launched.stdout !== cases[0].output) throw new Error(`Executable JAR output mismatch: ${launched.stdout}`);
  console.log('PASS real executable JAR HTTP request, normal library layout, discovery resource and generated property metadata');
  success = true;
} finally {
  if (success) {
    if (path.dirname(work) !== parent || !path.basename(work).startsWith('boot-startup-check-')) throw new Error('Unexpected cleanup path.');
    fs.rmSync(work, {recursive: true});
  } else console.error(`Failure artifacts retained for inspection: ${work}`);
}
console.log('All 36 tests, 18 main runs and executable JAR check passed; owned servers and contexts closed.');
