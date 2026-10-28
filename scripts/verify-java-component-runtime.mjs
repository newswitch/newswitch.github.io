import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {load} from 'js-yaml';

const option = name => {const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1];};
const javaHome = option('--java-home'), mavenHome = option('--maven-home');
if (!javaHome || !mavenHome) throw new Error('Supply --java-home (JDK 25) and --maven-home.');
const checks = path.resolve('.java-article-checks'); fs.mkdirSync(checks, {recursive: true});
const work = fs.mkdtempSync(path.join(checks, 'component-runtime-'));
const project = path.join(work, 'runtime-lab');
fs.cpSync('examples/java-components/runtime-lab', project, {recursive: true, filter: file => !['target', 'out'].includes(path.basename(file))});
const repository = path.resolve(option('--maven-repo') ?? path.join(checks, 'component-m2'));
const executable = name => path.join(javaHome, 'bin', name + (process.platform === 'win32' ? '.exe' : ''));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function run(command, args, {cwd = project, timeout = 60000} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {cwd, env: {...process.env, JAVA_HOME: javaHome}, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '', expired = false;
    child.stdout.on('data', buffer => output += buffer.toString()); child.stderr.on('data', buffer => output += buffer.toString());
    const timer = setTimeout(() => {expired = true; child.kill();}, timeout);
    child.once('error', error => {clearTimeout(timer); reject(error);});
    child.once('close', code => {
      clearTimeout(timer);
      if (expired || code !== 0) reject(new Error('Command failed ' + code + '\n' + output)); else resolve(output);
    });
  });
}
assert.match(await run(executable('javac'), ['-version']), /javac 25[.\s]/);
const boot = path.join(mavenHome, 'boot'), launcher = fs.readdirSync(boot).find(file => /^plexus-classworlds-.*\.jar$/.test(file));
const output = await run(executable('java'), ['-XX:ActiveProcessorCount=2', '-Xmx768m', `-Dmaven.home=${mavenHome}`,
  `-Dmaven.multiModuleProjectDirectory=${project}`, `-Dclassworlds.conf=${path.join(mavenHome, 'bin/m2.conf')}`,
  '-Dstyle.color=never', '-cp', path.join(boot, launcher), 'org.codehaus.plexus.classworlds.launcher.Launcher',
  '-B', '-ntp', `-Dmaven.repo.local=${repository}`, '-Pcompose', 'clean', 'verify'], {timeout: 600000});
fs.writeFileSync(path.join(work, 'maven.log'), output);
for (const [module, count] of [['data-jdbc', 7], ['mybatis-plus', 7], ['cache', 8]]) {
  const reports = path.join(project, module, 'target/surefire-reports');
  const report = fs.readdirSync(reports).filter(file => file.endsWith('.txt')).map(file => fs.readFileSync(path.join(reports, file), 'utf8')).join('\n');
  assert(report.includes(`Tests run: ${count}, Failures: 0, Errors: 0, Skipped: 0`), module + '\n' + report);
  console.log('PASS ' + module + ': ' + count + ' tests');
}
const jar = path.join(project, 'data-jdbc/target/data-jdbc-lab-1.0.0.jar');
const listing = await run(executable('jar'), ['tf', jar]);
assert(!listing.includes('BOOT-INF/lib/spring-boot-docker-compose-'));
assert(listing.includes('BOOT-INF/lib/spring-data-jdbc-4.1.1.jar'));
assert(listing.includes('BOOT-INF/layers.idx'));
console.log('PASS production JAR excludes Compose support; JDBC version and layer index verified');
const plusJar = path.join(project, 'mybatis-plus/target/mybatis-plus-lab-1.0.0.jar');
assert((await run(executable('jar'), ['tf', plusJar])).includes('BOOT-INF/lib/mybatis-plus-core-3.5.17.jar'));
const cacheJar = path.join(project, 'cache/target/cache-lab-1.0.0.jar');
assert((await run(executable('jar'), ['tf', cacheJar])).includes('BOOT-INF/lib/caffeine-3.2.4.jar'));
console.log('PASS actual runtime artifacts: MyBatis-Plus 3.5.17 and Caffeine 3.2.4');
const layerNames = await run(executable('java'), ['-Djarmode=tools', '-jar', jar, 'list-layers']);
for (const name of ['dependencies', 'spring-boot-loader', 'snapshot-dependencies', 'application']) assert(layerNames.includes(name));
const extracted = path.join(work, 'extracted');
await run(executable('java'), ['-Djarmode=tools', '-jar', jar, 'extract', '--layers', '--destination', extracted]);
for (const name of ['dependencies', 'spring-boot-loader', 'snapshot-dependencies', 'application']) assert(fs.statSync(path.join(extracted, name)).isDirectory());
const compose = load(fs.readFileSync(path.join(project, 'data-jdbc/compose.yaml'), 'utf8'));
assert.equal(compose.services.postgres.image, 'postgres:17');
assert(compose.services.postgres.ports.every(port => port.startsWith('127.0.0.1:')));
assert(compose.services.postgres.healthcheck.test.includes('pg_isready -U lab -d component_lab'));
const runtime = load(fs.readFileSync(path.join(project, 'data-jdbc/compose.runtime.yaml'), 'utf8'));
assert.equal(runtime.services.app.mem_limit, '512m');
console.log('PASS tools-mode layer extraction and YAML safety assertions (not a Docker execution)');

async function withServer(javaArgs, task, cwd = project) {
  const child = spawn(executable('java'), ['-XX:ActiveProcessorCount=2', '-Xmx256m', ...javaArgs,
    '--server.port=0', '--server.address=127.0.0.1'], {cwd, stdio: ['ignore', 'pipe', 'pipe']});
  let logs = '', port, closed = false, failure;
  child.on('close', () => closed = true); child.on('error', error => failure = error);
  const append = buffer => {
    logs += buffer.toString(); const matches = [...logs.matchAll(/Tomcat started on port (\d+) \(http\)/g)];
    if (matches.length) port = Number(matches.at(-1)[1]);
  };
  child.stdout.on('data', append); child.stderr.on('data', append);
  const request = (route, body) => new Promise((resolve, reject) => {
    const req = http.request({hostname: '127.0.0.1', port, path: route, method: body === undefined ? 'GET' : 'POST', timeout: 5000,
      headers: body === undefined ? {} : {'Content-Type': 'application/json'}}, response => {
      let text = ''; response.setEncoding('utf8'); response.on('data', chunk => text += chunk);
      response.on('end', () => resolve({status: response.statusCode, text})); response.on('error', reject);
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('HTTP timeout')));
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  try {
    const deadline = Date.now() + 45000;
    while (!port) {if (failure || closed || Date.now() > deadline) throw new Error('Server did not start\n' + logs); await pause(100);}
    await task(request);
  } finally {
    if (!closed) {child.kill(); const deadline = Date.now() + 5000; while (!closed && Date.now() < deadline) await pause(50);
      if (!closed) {child.kill('SIGKILL'); await new Promise(resolve => child.once('close', resolve));}}
  }
}
const smoke = async request => {
  assert.equal((await request('/api/tasks/99999')).status, 404);
  assert.equal((await request('/api/tasks', {title: ''})).status, 400);
  const created = await request('/api/tasks', {title: 'verified'}); assert.equal(created.status, 201);
  const body = JSON.parse(created.text); assert(body.id && body.title === 'verified');
  const fetched = await request('/api/tasks/' + body.id); assert.equal(fetched.status, 200); assert.equal(JSON.parse(fetched.text).title, 'verified');
};
await withServer(['-jar', jar], smoke);
console.log('PASS packaged JDBC application: real HTTP 201/200/400/404; local H2 only');
// Merge extracted layers in index order, exactly as separate COPY commands would do.
const merged = path.join(work, 'merged'); fs.mkdirSync(merged);
for (const layer of ['dependencies', 'spring-boot-loader', 'snapshot-dependencies', 'application']) fs.cpSync(path.join(extracted, layer), merged, {recursive: true});
const extractedJar = fs.readdirSync(merged).find(file => file.endsWith('.jar'));
assert(extractedJar, 'Extracted launch JAR missing');
await withServer(['-jar', path.join(merged, extractedJar)], smoke, merged);
console.log('PASS extracted-layer launch layout: same real HTTP behavior');
for (const [module, artifact, expected] of [['mybatis-plus', 'mybatis-plus-lab', 'inserted=first'], ['cache', 'cache-lab', 'loads-after-two-reads=1']]) {
  const result = await run(executable('java'), ['-XX:ActiveProcessorCount=2', '-Xmx256m', '-jar', path.join(project, module, 'target', artifact + '-1.0.0.jar')]);
  assert(result.includes(expected), result);
}
console.log('PASS MyBatis-Plus and cache executable demos; contexts closed');
console.log('SKIP Docker Compose lifecycle, PostgreSQL containers and OCI/Buildpacks image builds: require a Docker environment.');
console.log('PASS all owned Java processes exited. Artifacts: ' + path.relative(process.cwd(), work));
