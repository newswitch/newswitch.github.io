// Static article contracts and finite educational arithmetic/lookup models only.
// Does not run perf, nsenter, tcpdump, sysctl or Linux networking commands.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {compile} from '@mdx-js/mdx';

const specifications = [
  {file: 'docs/linux/system-internals/12-observability/04-perf-PMU采样与火焰图原理.md', answers: 10},
  {file: 'docs/linux/system-internals/07-network-stack/02-routing-transport/05-路由策略路由与邻居子系统.md', answers: 10},
  {file: 'docs/linux/commands/10-deep-diagnostics/06-perf-record-report命令详解.md'},
];
const parser = unified().use(remarkParse);
const plain = node => node.value ?? node.children?.map(plain).join('') ?? '';
const body = source => source.replace(/^---\n[\s\S]*?\n---\n/, '');
const anchors = source => [...source.matchAll(/\{\/\*\s*#([^*]+)\*\/\}/g)].map(match => match[1].trim());
const sections = nodes => nodes.filter(node => node.type === 'heading' && node.depth === 2).map(plain);
const articles = [];
let answers = 0;

for (const specification of specifications) {
  const source = fs.readFileSync(specification.file, 'utf8').replaceAll('\r\n', '\n');
  await compile(body(source));
  const nodes = parser.parse(body(source)).children;
  const previous = execFileSync('git', ['show', `018adb5:${specification.file}`], {encoding: 'utf8'}).replaceAll('\r\n', '\n');
  const currentSections = sections(nodes);
  let last = -1;
  for (const section of sections(parser.parse(body(previous)).children)) {
    const index = currentSections.indexOf(section);
    assert(index > last, `Lost/reordered section: ${section}`);
    last = index;
  }
  for (const anchor of anchors(previous)) assert(anchors(source).includes(anchor), `Lost explicit anchor: ${anchor}`);
  for (const field of ['title', 'sidebar_label', 'sidebar_position']) {
    const pattern = new RegExp(`^${field}:.*$`, 'm');
    assert.equal(source.match(pattern)?.[0], previous.match(pattern)?.[0]);
  }
  if (specification.answers) {
    const start = nodes.findIndex(node => node.type === 'heading' && node.depth === 2 && plain(node) === '7. 练习与答案');
    assert(start >= 0);
    let end = nodes.findIndex((node, index) => index > start && node.type === 'heading' && node.depth <= 2);
    if (end < 0) end = nodes.length;
    const section = nodes.slice(start + 1, end);
    const questions = section.flatMap((node, index) => node.type === 'heading' && node.depth === 3 ? [index] : []);
    assert.equal(questions.length, specification.answers);
    for (const [index, position] of questions.entries()) {
      const response = section.slice(position + 1, questions[index + 1] ?? section.length);
      assert(response.some(node => node.type === 'paragraph' && plain(node).startsWith('答案：') && plain(node).length > 3));
    }
    answers += questions.length;
  }
  const blocks = language => nodes.filter(node => node.type === 'code' && node.lang === language).map(node => node.value);
  articles.push({source, nodes, blocks});
}

const [perf, routing, command] = articles;
assert(perf.source.includes('Linux v6.12'));
assert(command.source.includes('event period'));
const counts = JSON.parse(perf.blocks('json')[0]);
const {time_enabled_ns: enabled, time_running_ns: running, raw_counts: raw} = counts;
const scale = (value, timeEnabled, timeRunning) => {
  if (timeRunning <= 0 || timeEnabled < timeRunning) throw new RangeError('Invalid counter timing');
  return value * timeEnabled / timeRunning;
};
assert.equal(running / enabled, 0.25);
const cycles = scale(raw['cycles:u'], enabled, running);
const instructions = scale(raw['instructions:u'], enabled, running);
assert.equal(cycles, 6_000_000_000);
assert.equal(instructions, 12_000_000_000);
assert.equal(instructions / cycles, 2);
assert.throws(() => scale(1, enabled, 0), RangeError);
assert.throws(() => scale(1, 1, 2), RangeError);
assert.equal(200_000 / 10_000_000 * 100, 2);
assert.equal(2000 / 10000, 0.2);
assert.equal(20000 / 10000, 2);

const folded = perf.blocks('text').find(block => block.startsWith('main;serve;tokenize '));
assert(folded);
const self = new Map();
const children = new Map();
let total = 0;
for (const line of folded.split('\n')) {
  const match = line.match(/^(\S+) (\d+)$/);
  assert(match);
  const stack = match[1].split(';');
  const weight = Number(match[2]);
  total += weight;
  self.set(stack.at(-1), (self.get(stack.at(-1)) ?? 0) + weight);
  for (const symbol of stack) children.set(symbol, (children.get(symbol) ?? 0) + weight);
}
assert.equal(total, 1000);
const report = perf.blocks('text').find(block => block.startsWith('Children'));
const rows = report.split('\n').slice(1);
assert.equal(rows.length, 6);
for (const row of rows) {
  const match = row.match(/^\s*([\d.]+)%\s+([\d.]+)%\s+(\S+)$/);
  assert(match);
  const [, accumulated, own, symbol] = match;
  assert.equal(Number(accumulated), children.get(symbol) / total * 100);
  assert.equal(Number(own), (self.get(symbol) ?? 0) / total * 100);
}
assert.equal(children.get('serve'), 800);
assert.equal(self.get('serve') ?? 0, 0);
assert.equal([...self.values()].reduce((sum, value) => sum + value, 0), total);
assert([...children.values()].reduce((sum, value) => sum + value, 0) > total);
// Separate finite example: equal sample counts do not imply equal period weight.
assert.equal(2 / 4, 0.5);
assert.notEqual((1 + 1) / (1 + 1 + 9 + 9), 0.5);
assert(perf.blocks('bash').some(block => block.includes("-e '{cycles:u,instructions:u}'")));
assert(perf.blocks('bash').some(block => block.includes('--call-graph fp') && block.includes('-- sleep 30')));

const ipv4 = address => {
  const bytes = address.split('.').map(Number);
  assert.equal(bytes.length, 4);
  assert(bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255));
  return bytes.reduce((value, byte) => ((value << 8) | byte) >>> 0, 0);
};
const inPrefix = (address, prefix) => {
  const [base, lengthText] = prefix.split('/');
  const length = Number(lengthText);
  assert(length >= 0 && length <= 32);
  const mask = length === 0 ? 0 : (0xffffffff << (32 - length)) >>> 0;
  return (ipv4(address) & mask) === (ipv4(base) & mask);
};
const topology = routing.blocks('text').find(block => block.startsWith('eth0：'));
const addresses = Object.fromEntries([...topology.matchAll(/^(eth\d)：([\d.]+)\/\d+/gm)].map(match => [match[1], match[2]]));
assert.deepEqual(addresses, {eth0: '192.0.2.10', eth1: '198.51.100.10'});
const ruleBlock = routing.blocks('text').find(block => block.startsWith('0:'));
const rules = ruleBlock.split('\n').map(line => {
  const match = line.match(/^(\d+):\s+from (\S+)(?: fwmark (0x[\da-f]+)\/(0x[\da-f]+))? lookup (\S+)$/);
  assert(match, `Unrecognized teaching rule: ${line}`);
  return {priority: Number(match[1]), from: match[2], mark: match[3] ? Number(match[3]) : undefined,
    mask: match[4] ? Number(match[4]) : undefined, table: match[5]};
}).sort((a, b) => a.priority - b.priority);
assert.deepEqual(rules.map(rule => rule.priority), [0, 100, 200, 32766, 32767]);
const parseRoutes = block => block.split('\n').map(line => {
  const words = line.split(/\s+/);
  const token = key => words.includes(key) ? words[words.indexOf(key) + 1] : undefined;
  const prefix = words[0] === 'default' ? '0.0.0.0/0' : words[0];
  assert(prefix.includes('/'));
  return {prefix, length: Number(prefix.split('/')[1]), via: token('via'), dev: token('dev'),
    preferredSource: token('src'), metric: Number(token('metric') ?? 0), type: 'unicast'};
});
const table100 = routing.blocks('text').find(block => block.includes('203.0.113.64/26 via'));
const table200 = routing.blocks('text').find(block => block.includes('default via 192.0.2.1 dev eth0 metric 900'));
const tableMain = routing.blocks('text').find(block => block.includes('203.0.113.80/32 via'));
const tables = {
  local: Object.entries(addresses).map(([dev, address]) => ({prefix: `${address}/32`, length: 32, dev, type: 'local', metric: 0})),
  100: parseRoutes(table100),
  200: parseRoutes(table200),
  main: parseRoutes(tableMain),
  default: [],
};
// Only single-path destination prefix, metric, source and fwmark from these fixtures.
// Not Linux FIB: no scope/link state/iif/VRF/ECMP/Netfilter/IPv6 or socket semantics.
const lookup = ({destination, source, mark = 0}, currentTables = tables) => {
  for (const rule of rules) {
    if (rule.from !== 'all' && (!source || !inPrefix(source, rule.from))) continue;
    if (rule.mark !== undefined && (mark & rule.mask) !== rule.mark) continue;
    const candidates = (currentTables[rule.table] ?? []).filter(route => inPrefix(destination, route.prefix))
      .sort((a, b) => b.length - a.length || a.metric - b.metric);
    if (!candidates.length || candidates[0].type === 'throw') continue;
    const route = candidates[0];
    return {...route, destination, source: source ?? route.preferredSource ?? addresses[route.dev], table: rule.table};
  }
  return undefined;
};
const unmarked = lookup({destination: '203.0.113.80', source: addresses.eth1});
const marked = lookup({destination: '203.0.113.80', source: addresses.eth1, mark: 0x20});
const unbound = lookup({destination: '203.0.113.80'});
assert.equal(unmarked.table, '100');
assert.equal(unmarked.prefix, '203.0.113.64/26');
assert.equal(unmarked.via, '198.51.100.254');
assert.equal(unmarked.metric, 500);
assert.equal(marked.table, '200');
assert.equal(marked.prefix, '0.0.0.0/0');
assert.equal(marked.metric, 900);
assert.equal(marked.source, addresses.eth1); // Route selection is not SNAT.
assert.equal(unbound.table, 'main');
assert.equal(unbound.prefix, '203.0.113.80/32');
assert.equal(unbound.source, addresses.eth0);
assert.equal(lookup({destination: '203.0.113.80', source: addresses.eth1, mark: 0x120}).table, '200');
assert.equal(lookup({destination: '203.0.113.80', source: addresses.eth1, mark: 0x21}).table, '100');
assert.equal(lookup({destination: addresses.eth1, source: addresses.eth0, mark: 0x20}).type, 'local');
const direct = lookup({destination: '198.51.100.20', source: addresses.eth1});
assert.equal(direct.via, undefined);
assert.equal(direct.destination, '198.51.100.20');
assert.equal(direct.dev, 'eth1');
for (const result of [unmarked, marked, unbound]) {
  const output = routing.blocks('text').find(block => block.startsWith('203.0.113.80 ') && block.includes(`via ${result.via} `));
  assert(output, 'Missing matching teaching route-get result');
  assert(output.includes(`dev ${result.dev}`));
  assert(output.includes(result.source));
  if (result.table !== 'main') assert(output.includes(`table ${result.table}`));
}
// Hypothetical branches illustrate the documented lookup semantics, not commands.
assert.equal(lookup({destination: '203.0.113.80', source: addresses.eth1, mark: 0x20}, {...tables, 200: []}).table, '100');
const controlRoute = type => ({prefix: '203.0.113.80/32', length: 32, metric: 0, type});
assert.equal(lookup({destination: '203.0.113.80', source: addresses.eth1, mark: 0x20}, {...tables, 200: [controlRoute('throw')]}).table, '100');
assert.equal(lookup({destination: '203.0.113.80', source: addresses.eth1, mark: 0x20}, {...tables, 200: [controlRoute('blackhole')]}).type, 'blackhole');

assert.equal(Math.max(1, 0), 1);
assert.equal(Math.max(1, 2), 2);
assert.equal(Math.max(0, 0), 0);
// Conceptual RPF examples only; not fib_validate_source or its full context.
const validateSource = ({originalSource, originalDestination, ingress, mark = 0, includeMark = false, mode}) => {
  if (mode === 0) return true;
  const reverse = lookup({destination: originalSource, source: originalDestination, mark: includeMark ? mark : 0});
  return reverse?.type === 'unicast' && (mode === 2 || reverse.dev === ingress);
};
const asymmetric = {originalSource: '203.0.113.80', originalDestination: addresses.eth0, ingress: 'eth1'};
assert.equal(validateSource({...asymmetric, mode: 1}), false);
assert.equal(validateSource({...asymmetric, mode: 2}), true);
const markedInbound = {originalSource: '203.0.113.80', originalDestination: addresses.eth1, ingress: 'eth1', mark: 0x20, mode: 1};
assert.equal(validateSource({...markedInbound, includeMark: false}), true);
assert.equal(validateSource({...markedInbound, includeMark: true}), false);
assert(routing.blocks('text').some(block => block.includes(`${unmarked.via} dev ${unmarked.dev} lladdr 02:00:00:00:01:fe REACHABLE`)));
assert(routing.blocks('bash').some(block => block.includes('tcpdump -ni eth1 -e -c 20')));
for (const block of [...perf.blocks('bash'), ...routing.blocks('bash')]) {
  assert(!/sysctl\s+-w|ip (?:-4 )?(?:route|rule) (?:add|del|replace|flush)|ip (?:-4 )?neigh flush|setcap/.test(block), 'Principle examples must not silently modify host state');
}

console.log(`PASS: ${articles.length} MDX pages, ${answers} explicit answers, preserved headings/anchors/navigation metadata.`);
console.log('PASS: raw-count scaling and invalid timing, IPC/CPU arithmetic, 4 folded stacks and 6 Self/Children rows.');
console.log('PASS: 5 rules, 3 route tables, 3 route-get excerpts, source/mark/prefix/metric/control routes and finite RPF examples.');
console.log('Offline only: not a PMU/stack-unwinder/kernel-network model; no Linux commands, collection, packet capture or sysctl changes.');
