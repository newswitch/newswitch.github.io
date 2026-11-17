// Article/source contracts, Python AST, TS/TSX syntax and pure DTO tests only.
// Does not start Temporal/Backstage, run Workflow/Replay or execute router Jest tests.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {compile} from '@mdx-js/mdx';
import {transformSync} from '@babel/core';
import yaml from 'js-yaml';

const specifications = [
  {file: 'docs/automation/temporal/08-测试时间跳跃与故障注入.md', examples: 'examples/automation/temporal-testing'},
  {file: 'docs/automation/backstage/07-插件架构与集成开发.md', examples: 'examples/automation/backstage-ops-status'},
];
const parser = unified().use(remarkParse);
const plain = node => node.value ?? node.children?.map(plain).join('') ?? '';
const body = text => text.replace(/^---\n[\s\S]*?\n---\n/, '');
const anchors = source => [...source.matchAll(/\{\/\*\s*#([^*]+)\*\/\}/g)].map(match => match[1].trim());
const headings = nodes => nodes.filter(node => node.type === 'heading' && node.depth === 2).map(plain);
const normalizeIndent = source => source.replaceAll('\r\n', '\n').split('\n').map(line => line.trimStart()).join('\n').trim();
// The repository formatter compacts repeated blank lines inside code fences too.
const normalizeBlankLines = source => source.replace(/\n{3,}/g, '\n\n').trim();
const read = file => fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
const articles = [];
let answers = 0;
let matchedSnippets = 0;

for (const specification of specifications) {
  const source = read(specification.file);
  await compile(body(source));
  const nodes = parser.parse(body(source)).children;
  const baseline = execFileSync('git', ['show', `5e9152e:${specification.file}`], {encoding: 'utf8'}).replaceAll('\r\n', '\n');
  let last = -1;
  for (const heading of headings(parser.parse(body(baseline)).children)) {
    const index = headings(nodes).indexOf(heading);
    assert(index > last, `Lost/reordered heading: ${heading}`);
    last = index;
  }
  for (const anchor of anchors(baseline)) assert(anchors(source).includes(anchor));
  for (const field of ['title', 'sidebar_label', 'sidebar_position']) {
    const pattern = new RegExp(`^${field}:.*$`, 'm');
    assert.equal(source.match(pattern)?.[0], baseline.match(pattern)?.[0]);
  }
  const start = nodes.findIndex(node => node.type === 'heading' && plain(node) === '8. 练习与答案');
  const end = nodes.findIndex((node, index) => index > start && node.type === 'heading' && node.depth <= 2);
  assert(start >= 0 && end > start);
  const section = nodes.slice(start + 1, end);
  const questions = section.flatMap((node, index) => node.type === 'heading' && node.depth === 3 ? [index] : []);
  assert.equal(questions.length, 10);
  for (const [index, position] of questions.entries()) {
    const response = section.slice(position + 1, questions[index + 1] ?? section.length);
    assert(response.some(node => node.type === 'paragraph' && plain(node).startsWith('答案：') && plain(node).length > 3));
  }
  answers += questions.length;
  const code = nodes.filter(node => node.type === 'code');
  for (const node of code) {
    const title = node.meta?.match(/title="([^"]+)"/)?.[1];
    if (!title) continue;
    const [file, fragment] = title.split('#');
    const example = read(path.join(specification.examples, file));
    if (fragment) assert(normalizeBlankLines(normalizeIndent(example)).includes(normalizeBlankLines(normalizeIndent(node.value))), `Excerpt mismatch: ${title}`);
    else assert.equal(normalizeBlankLines(node.value), normalizeBlankLines(example), `Full source mismatch: ${title}`);
    matchedSnippets += 1;
  }
  for (const node of code.filter(node => ['ts', 'tsx'].includes(node.lang))) {
    transformSync(node.value, {
      filename: node.lang === 'tsx' ? 'snippet.tsx' : 'snippet.ts', configFile: false, babelrc: false,
      plugins: [['@babel/plugin-transform-typescript', {isTSX: node.lang === 'tsx'}]],
    });
  }
  const json = code.filter(node => node.lang === 'json').map(node => JSON.parse(node.value));
  const yml = code.filter(node => node.lang === 'yaml').flatMap(node => yaml.loadAll(node.value));
  articles.push({source, code, json, yml});
}

const temporalDirectory = specifications[0].examples;
const pythonFiles = ['workflows.py', 'fakes.py', 'test_activity.py', 'test_workflow.py'];
const pythonSources = Object.fromEntries(pythonFiles.map(file => [file, read(path.join(temporalDirectory, file))]));
const pythonIndex = process.argv.indexOf('--python');
const python = pythonIndex >= 0 ? process.argv[pythonIndex + 1] : 'python';
assert(python);
const astProgram = `import ast, json, sys
sources = json.load(sys.stdin)
tests = {}
for filename, source in sources.items():
    tree = ast.parse(source, filename=filename)
    tests[filename] = [node.name for node in ast.walk(tree)
                       if isinstance(node, ast.AsyncFunctionDef) and node.name.startswith('test_')]
assert len(tests['test_activity.py']) == 4
assert len(tests['test_workflow.py']) == 4
print('PASS Python AST: 4 files, 4 Activity and 4 Workflow test definitions; no SDK code executed')
`;
process.stdout.write(execFileSync(python, ['-c', astProgram], {
  input: JSON.stringify(pythonSources), encoding: 'utf8', timeout: 15000,
}));
assert.equal(read(`${temporalDirectory}/requirements.txt`).trim(), 'temporalio==1.36.1');
assert(pythonSources['workflows.py'].includes('"apply_change"'));
assert(pythonSources['fakes.py'].includes('@activity.defn(name="apply_change")'));
assert(pythonSources['workflows.py'].includes('maximum_attempts=3'));
assert(pythonSources['test_workflow.py'].includes('await self.env.shutdown()'));
assert(pythonSources['test_workflow.py'].includes('test_server_existing_path=os.environ.get("TEMPORAL_TEST_SERVER")'));
assert(pythonSources['test_workflow.py'].includes('await Replayer(workflows=[ApprovalWorkflow]).replay_workflow(history)'));
const manualTest = pythonSources['test_workflow.py'].split('async def test_signal_before_deadline_and_retry')[1].split('async def test_non_retryable_failure')[0];
assert(manualTest.indexOf('await self.env.sleep') < manualTest.indexOf('await handle.signal'));
assert(manualTest.indexOf('await handle.signal') < manualTest.indexOf('await handle.result'));
assert.equal(3 * 2000 + 2 * 1000, 8000); // Three full attempts + two fixed backoffs, ignoring queue/overhead.
assert(8000 < 10000);

const backstageDirectory = specifications[1].examples;
const tsFiles = [
  'common/permissions.ts', 'common/contract.ts', 'backend/model.ts', 'backend/router.ts',
  'backend/plugin.ts', 'backend/router.test.ts', 'frontend/plugin.tsx', 'frontend/OpsStatusPage.tsx', 'policy/CustomPolicy.ts',
];
const compiled = new Map();
for (const file of tsFiles) {
  const output = transformSync(read(path.join(backstageDirectory, file)), {
    filename: file, configFile: false, babelrc: false,
    plugins: [['@babel/plugin-transform-typescript', {isTSX: file.endsWith('.tsx')}]],
  });
  assert(output?.code);
  compiled.set(file, output.code);
}
// Only these two dependency-free modules are evaluated. Other files are syntax checked.
const loadPureModule = async file => import(`data:text/javascript;base64,${Buffer.from(compiled.get(file)).toString('base64')}`);
const model = await loadPureModule('backend/model.ts');
const contract = await loadPureModule('common/contract.ts');
const expected = articles[1].json[0];
assert.deepEqual(await model.readFixtureSnapshot('orders'), expected);
assert.equal(await model.readFixtureSnapshot('unknown-service'), undefined);
assert.equal(model.isServiceId('orders'), true);
assert.equal(model.isServiceId('bad_id'), false);
assert.equal(model.isServiceId(''), false);
assert.equal(model.isServiceId(123), false);
assert.equal(model.isServiceId(`a${'b'.repeat(32)}`), false);
const first = await model.readFixtureSnapshot('orders');
first.status = 'degraded';
assert.equal((await model.readFixtureSnapshot('orders')).status, 'ready');
assert.deepEqual(contract.parseSnapshot(expected), expected);
for (const input of [null, [], {}, {...expected, status: 'unknown'}, {...expected, source: 'live'},
  {...expected, serviceId: 'bad_id'}, {...expected, observedAt: 'not-a-date'}, {...expected, environment: 'production'}]) {
  assert.throws(() => contract.parseSnapshot(input), /Invalid snapshot response/);
}
assert.deepEqual(contract.parseSnapshot({...expected, unrelated: 'ignored'}), expected);
const router = read(`${backstageDirectory}/backend/router.ts`);
const authentication = router.indexOf('await httpAuth.credentials');
const authorization = router.indexOf('await permissions.authorize');
const denial = router.indexOf('decision?.result !== AuthorizeResult.ALLOW');
const dataAccess = router.indexOf('await readSnapshot(id)');
assert(authentication >= 0 && authorization > authentication && denial > authorization && dataAccess > denial);
assert(router.includes("allow: ['user']"));
const plugin = read(`${backstageDirectory}/backend/plugin.ts`);
assert(plugin.includes("pluginId: 'ops-status'"));
assert(plugin.includes('permissionsRegistry.addPermissions([opsStatusReadPermission])'));
assert(!plugin.includes('unauthenticated'));
assert.equal((read(`${backstageDirectory}/backend/router.test.ts`).match(/\bit\('/g) ?? []).length, 6);
const front = read(`${backstageDirectory}/frontend/OpsStatusPage.tsx`);
assert(front.includes("discovery.getBaseUrl('ops-status')"));
assert(front.includes('client.fetch(') && front.includes('parseSnapshot(await response.json())'));
assert(front.includes('controller.abort()') && front.includes('clearTimeout(timeout)'));
const component = articles[1].yml.find(doc => doc.kind === 'Component');
assert.equal(component.metadata.annotations['example.com/ops-service-id'], expected.serviceId);
assert.equal(component.spec.owner, 'group:default/ops-readers');
assert.deepEqual(articles[1].yml.find(doc => doc.permission), {permission: {enabled: true}});
assert(read(`${backstageDirectory}/policy/CustomPolicy.ts`).includes('this.userInfo.getUserInfo(user.credentials)'));
assert(articles[0].source.includes('1.36.1') && articles[1].source.includes('v1.56.5'));

console.log(`PASS: ${articles.length} MDX pages, ${answers} answers, preserved headings/anchors/metadata, ${matchedSnippets} source-matched examples.`);
console.log(`PASS: ${tsFiles.length} TS/TSX modules parsed/transformed; actual fixture/DTO validation and YAML/JSON contract checks.`);
console.log('Limits: no TypeScript typecheck or Backstage dependency resolution; router Jest, real authentication, Workflow/Replay and fault tests not executed here.');
