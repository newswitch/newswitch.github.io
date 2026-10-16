import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';

const root = process.cwd();
const base = 'docs/development/java/05-build-testing';
const examples = 'examples/java/third-batch';
const documents = [
  ['01-Maven工程编译运行依赖与测试.md', 'build-lab', new Set(['src/main/java/demo/tasks/TaskQuota.java'])],
  ['02-Maven生命周期插件与集成测试.md', 'build-lab', new Set(['pom.xml', 'src/main/java/demo/tasks/App.java'])],
  ['04-JUnit参数化测试隔离与测试边界.md', 'build-lab', new Set(['src/test/java/demo/tasks/TaskQuotaTest.java', 'src/test/java/demo/tasks/AppIT.java'])],
  ['05-Maven多模块JAR与运行分发.md', 'multi-module', new Set(['pom.xml', 'core/pom.xml', 'core/src/main/java/demo/core/TaskQuota.java', 'cli/pom.xml', 'cli/src/main/java/demo/cli/App.java'])],
  ['06-Gradle-Toolchain与可复现构建.md', 'build-lab', new Set(['settings.gradle.kts', 'build.gradle.kts'])],
];
const sources = new Map();
for (const [document, project, titles] of documents) {
  const markdown = fs.readFileSync(path.join(root, base, document), 'utf8').replaceAll('\r\n', '\n');
  const found = new Set();
  for (const match of markdown.matchAll(/^```(?:java|xml|kotlin) title="([^"]+)"\n([\s\S]*?)^```/gm)) {
    if (!titles.has(match[1])) continue;
    if (found.has(match[1])) throw new Error(`Duplicate source: ${document}: ${match[1]}`);
    found.add(match[1]);
    sources.set(`${examples}/${project}/${match[1]}`, match[2].trimEnd() + '\n');
  }
  if (found.size !== titles.size) throw new Error(`Incomplete sources: ${document}`);
}
if (process.argv.includes('--emit-patch')) {
  let patch = '*** Begin Patch\n';
  for (const [file, source] of sources) {
    if (fs.existsSync(path.join(root, file))) throw new Error(`Refusing to replace ${file}`);
    patch += `*** Add File: ${path.join(root, file).replaceAll('\\', '/')}\n`;
    patch += source.trimEnd().split('\n').map((line) => `+${line}`).join('\n') + '\n';
  }
  process.stdout.write(patch + '*** End Patch\n');
  process.exit(0);
}
for (const [file, source] of sources) {
  if (fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n') !== source) throw new Error(`Article/source mismatch: ${file}`);
}
console.log(`Article/source consistency: ${sources.size} build example files passed.`);
if (process.argv.includes('--check-sources')) process.exit(0);
function option(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
const javaHome = option('--java-home') ?? process.env.JAVA_HOME;
const mavenHome = option('--maven-home');
const gradleHome = option('--gradle-home');
if (!javaHome || !mavenHome || !gradleHome) throw new Error('Supply --java-home (JDK 25), --maven-home (3.9.14), and --gradle-home (9.1.0).');
const binary = (name) => path.join(javaHome, 'bin', `${name}${process.platform === 'win32' ? '.exe' : ''}`);
function run(command, args, options = {}) {
  const {status = 0, cwd = root} = options;
  const result = spawnSync(command, args, {encoding: 'utf8', timeout: 600000,
    maxBuffer: 16 * 1024 * 1024, cwd, env: {...process.env, JAVA_HOME: javaHome}});
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.replaceAll('\r\n', '\n');
  if (result.error || result.status !== status) throw new Error(`${command} exited ${result.status}, expected ${status}: ${result.error ?? ''}\n${output}`);
  return output.trim();
}
if (!/^javac 25(?:[.\s]|$)/u.test(run(binary('javac'), ['-version']))) throw new Error('Expected JDK 25.');
const workParent = path.resolve(option('--work-dir') ?? path.join(root, '.java-article-checks'));
fs.mkdirSync(workParent, {recursive: true});
const temporaryRoot = fs.mkdtempSync(path.join(workParent, 'java-build-check-'));
console.log(`Isolated build workspace: ${temporaryRoot}`);
const mavenRepo = option('--maven-repo') ?? path.join(temporaryRoot, 'm2');
const gradleUserHome = option('--gradle-user-home') ?? path.join(temporaryRoot, 'gradle-user-home');
const projects = ['build-lab', 'multi-module'];
for (const project of projects) {
  fs.cpSync(path.join(root, examples, project), path.join(temporaryRoot, project), {recursive: true,
    filter: (file) => !['target', 'build', '.gradle'].includes(path.basename(file))});
}
const mavenBoot = path.join(mavenHome, 'boot');
const classworlds = fs.readdirSync(mavenBoot).find((file) => /^plexus-classworlds-.*\.jar$/u.test(file));
if (!classworlds) throw new Error('Maven launcher missing.');
function maven(project, goals, status = 0) {
  return run(binary('java'), [
    `-Dmaven.home=${mavenHome}`, `-Dmaven.multiModuleProjectDirectory=${project}`,
    `-Dclassworlds.conf=${path.join(mavenHome, 'bin/m2.conf')}`, '-Dstyle.color=never',
    '-classpath', path.join(mavenBoot, classworlds), 'org.codehaus.plexus.classworlds.launcher.Launcher',
    '-B', '-ntp', `-Dmaven.repo.local=${mavenRepo}`, '-f', path.join(project, 'pom.xml'), ...goals,
  ], {cwd: project, status});
}
function gradle(project, goals) {
  return run(binary('java'), ['-Xmx64m', '-Xms64m',
    `-javaagent:${path.join(gradleHome, 'lib/agents/gradle-instrumentation-agent-9.1.0.jar')}`,
    '-jar', path.join(gradleHome, 'lib/gradle-gradle-cli-main-9.1.0.jar'),
    '--no-daemon', '--max-workers=2', '--console=plain', '-g', gradleUserHome,
    '-Dorg.gradle.jvmargs=-Xmx512m -XX:MaxMetaspaceSize=384m',
    '-Dorg.gradle.java.installations.auto-download=false',
    '-Dorg.gradle.java.installations.auto-detect=false',
    `-Dorg.gradle.java.installations.paths=${javaHome}`, ...goals,
  ], {cwd: project});
}
function report(file, expectedTests, expectedFailures = 0) {
  const xml = fs.readFileSync(file, 'utf8');
  const suite = xml.match(/<testsuite\b[^>]*>/u)?.[0];
  if (!suite) throw new Error(`Test suite missing: ${file}`);
  const attributes = Object.fromEntries([...suite.matchAll(/([\w]+)="([^"]*)"/gu)].map((match) => [match[1], match[2]]));
  if (Number(attributes.tests) !== expectedTests || Number(attributes.failures) !== expectedFailures
      || Number(attributes.errors) !== 0 || Number(attributes.skipped) !== 0) throw new Error(`Unexpected test summary: ${suite}`);
}
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const lab = path.join(temporaryRoot, 'build-lab');
console.log('RUN Maven lifecycle, unit tests and packaged-JAR integration check');
maven(lab, ['clean', 'verify']);
const unitReport = path.join(lab, 'target/surefire-reports/TEST-demo.tasks.TaskQuotaTest.xml');
const itReport = path.join(lab, 'target/failsafe-reports/TEST-demo.tasks.AppIT.xml');
report(unitReport, 11);
report(itReport, 1);
const labJar = path.join(lab, 'target/build-lab-1.0.0.jar');
if (run(binary('java'), ['-jar', labJar, '10', '3']) !== 'remaining=7') throw new Error('Maven CLI output mismatch.');
const listing = run(binary('jar'), ['--list', '--file', labJar]);
if (!listing.includes('demo/tasks/TaskQuota.class') || /TaskQuotaTest\.class|AppIT\.class|org\/junit\//u.test(listing)) throw new Error('Unexpected Maven JAR contents.');
const firstMavenHash = hash(labJar);
console.log('PASS Maven: 11 unit cases, 1 packaged-JAR check and production archive contents');

console.log('RUN intentional integration-test failure');
const failed = maven(lab, ['verify', '-Dapp.expectedOutput=wrong'], 1);
if (!failed.includes('BUILD FAILURE')) throw new Error('Expected Maven failure summary.');
report(itReport, 1, 1);
console.log('PASS failing integration check blocks verify');
maven(lab, ['clean', 'verify']);
report(itReport, 1);
if (hash(labJar) !== firstMavenHash) throw new Error('Maven clean-build archive hashes differed.');
console.log(`PASS Maven repeated clean builds: SHA256 ${firstMavenHash}`);

console.log('RUN dependency tree and effective POM checks');
const tree = maven(lab, ['org.apache.maven.plugins:maven-dependency-plugin:3.8.1:tree', '-Dincludes=org.junit.jupiter']);
for (const name of ['junit-jupiter', 'junit-jupiter-api', 'junit-jupiter-params', 'junit-jupiter-engine']) {
  if (!tree.includes(`org.junit.jupiter:${name}:jar:6.0.3:test`)) throw new Error(`BOM resolution mismatch: ${name}`);
}
const effective = maven(lab, ['org.apache.maven.plugins:maven-help-plugin:3.5.1:effective-pom', '-Dverbose']);
if (!/<artifactId>junit-jupiter<\/artifactId>[\s\S]{0,500}<version>6\.0\.3<\/version>/u.test(effective)) throw new Error('Effective POM did not resolve JUnit version.');
console.log('PASS BOM-managed dependencies and effective model');

console.log('RUN multi-module reactor and relocatable thin-JAR distribution');
const multi = path.join(temporaryRoot, 'multi-module');
maven(multi, ['clean', 'verify']);
const cliJar = path.join(multi, 'cli/target/task-cli-1.0.0.jar');
const cliListing = run(binary('jar'), ['--list', '--file', cliJar]);
if (!cliListing.includes('demo/cli/App.class') || cliListing.includes('demo/core/TaskQuota.class')) throw new Error('Thin JAR layout mismatch.');
const distribution = path.join(temporaryRoot, 'relocated-distribution');
fs.mkdirSync(distribution);
fs.copyFileSync(cliJar, path.join(distribution, 'app.jar'));
fs.cpSync(path.join(multi, 'cli/target/lib'), path.join(distribution, 'lib'), {recursive: true});
if (run(binary('java'), ['-jar', path.join(distribution, 'app.jar'), '10', '3'], {cwd: temporaryRoot}) !== 'remaining=7') throw new Error('Relocated distribution failed.');
const missing = path.join(temporaryRoot, 'missing-dependency');
fs.mkdirSync(missing);
fs.copyFileSync(cliJar, path.join(missing, 'app.jar'));
const missingLog = run(binary('java'), ['-jar', path.join(missing, 'app.jar'), '10', '3'], {status: 1});
if (!missingLog.includes('NoClassDefFoundError') || !missingLog.includes('demo/core/TaskQuota')) throw new Error('Missing dependency did not fail as documented.');
maven(multi, ['-pl', 'cli', '-am', 'clean', 'verify']);
console.log('PASS reactor ordering, -pl/-am, relocated distribution and missing-dependency failure');

console.log('RUN Gradle 9.1.0: shared sources, task graph, tests and application distribution');
const gradleVersion = gradle(lab, ['--version']);
if (!gradleVersion.includes('Gradle 9.1.0')) throw new Error('Expected Gradle 9.1.0.');
gradle(lab, ['clean', 'check', 'installDist']);
report(path.join(lab, 'build/test-results/test/TEST-demo.tasks.TaskQuotaTest.xml'), 11);
report(path.join(lab, 'build/test-results/integrationTest/TEST-demo.tasks.AppIT.xml'), 1);
const gradleJar = path.join(lab, 'build/libs/build-lab-1.0.0.jar');
const firstGradleHash = hash(gradleJar);
if (run(binary('java'), ['-jar', gradleJar, '10', '3']) !== 'remaining=7') throw new Error('Gradle CLI output mismatch.');
const runtimeLib = fs.readdirSync(path.join(lab, 'build/install/build-lab/lib'));
if (runtimeLib.length !== 1 || runtimeLib[0] !== 'build-lab-1.0.0.jar') throw new Error('Test dependencies leaked into runtime distribution.');
if (!gradle(lab, ['run', '--args=10 3']).includes('remaining=7')) throw new Error('Gradle run output mismatch.');
gradle(lab, ['clean', 'check', 'installDist']);
if (hash(gradleJar) !== firstGradleHash) throw new Error('Gradle repeated clean-build archive hashes differed.');
console.log(`PASS Gradle tests, distribution and repeated clean builds: SHA256 ${firstGradleHash}`);
gradle(lab, ['dependencies', '--write-locks']);
if (!fs.existsSync(path.join(lab, 'gradle.lockfile'))) throw new Error('Gradle lockfile not generated.');
gradle(lab, ['wrapper', '--gradle-version', '9.1.0', '--distribution-type', 'bin',
  '--gradle-distribution-sha256-sum', 'a17ddd85a26b6a7f5ddb71ff8b05fc5104c0202c6e64782429790c933686c806',
  '--no-validate-url']);
const wrapper = fs.readFileSync(path.join(lab, 'gradle/wrapper/gradle-wrapper.properties'), 'utf8');
if (!wrapper.includes('gradle-9.1.0-bin.zip') || !wrapper.includes('a17ddd85a26b6a7f5ddb71ff8b05fc5104c0202c6e64782429790c933686c806')) throw new Error('Wrapper pinning mismatch.');
console.log('PASS dependency locking and checksum-pinned Wrapper generation');

if (path.dirname(temporaryRoot) !== workParent || !path.basename(temporaryRoot).startsWith('java-build-check-')) throw new Error('Unexpected cleanup path.');
fs.rmSync(temporaryRoot, {recursive: true, maxRetries: 10, retryDelay: 100});
console.log('All Java build article checks passed.');
