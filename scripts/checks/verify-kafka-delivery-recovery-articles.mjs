// Offline article contracts and finite arithmetic models, not Kafka execution.
// Does not start brokers/Connect, execute Java or change any consumer offset.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {compile} from '@mdx-js/mdx';

const root = 'docs/data-systems/messaging/kafka/';
const specifications = [
  {file: `${root}02-Producer-Batching-Acks重试与幂等.md`, section: '9. 掌握验收', answers: 8},
  {file: `${root}03-Consumer-Group-Offset-Rebalance与顺序.md`, section: '9. 掌握验收', answers: 9},
  {file: `${root}11-MirrorMaker2跨集群复制灾备切换与一致性.md`, section: '6. 验收题', answers: 8},
];
const parser = unified().use(remarkParse);
const stripFrontmatter = source => source.replace(/^---\n[\s\S]*?\n---\n/, '');
const plain = node => node.value ?? node.children?.map(plain).join('') ?? '';
const anchors = source => [...source.matchAll(/\{\/\*\s*#([^*]+)\*\/\}/g)].map(match => match[1].trim());
const outline = nodes => nodes.filter(node => node.type === 'heading' && node.depth <= 2).map(plain);
const articles = [];
let answers = 0;

for (const specification of specifications) {
  const source = fs.readFileSync(specification.file, 'utf8').replaceAll('\r\n', '\n');
  const body = stripFrontmatter(source);
  await compile(body);
  const nodes = parser.parse(body).children;
  const baseline = execFileSync('git', ['show', `f66b942:${specification.file}`], {encoding: 'utf8'}).replaceAll('\r\n', '\n');
  assert.deepEqual(outline(nodes), outline(parser.parse(stripFrontmatter(baseline)).children), 'Original H1/H2 changed');
  for (const anchor of anchors(baseline)) assert(anchors(source).includes(anchor), `Lost anchor ${anchor}`);
  for (const field of ['title', 'sidebar_label', 'sidebar_position']) {
    const pattern = new RegExp(`^${field}:.*$`, 'm');
    assert.equal(source.match(pattern)?.[0], baseline.match(pattern)?.[0]);
  }
  const start = nodes.findIndex(node => node.type === 'heading' && node.depth === 2 && plain(node).startsWith(specification.section));
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
  articles.push({source, nodes});
}

// All displayed properties are simple key=value fragments, with no continuations.
function properties(article) {
  const blocks = article.nodes.filter(node => node.type === 'code' && node.lang === 'properties');
  assert.equal(blocks.length, 1);
  const result = new Map();
  for (const raw of blocks[0].value.split('\n')) {
    const line = raw.trim();
    if (!line || /^[#!]/.test(line)) continue;
    const equal = line.indexOf('=');
    assert(equal > 0, `Not a simple property: ${line}`);
    const key = line.slice(0, equal).trim();
    assert(!result.has(key), `Duplicate property ${key}`);
    result.set(key, line.slice(equal + 1).trim());
  }
  return result;
}
const [producer, consumer, mirror] = articles;
const producerConfig = properties(producer);
const getNumber = (map, key) => {
  assert(map.has(key), `Missing ${key}`);
  const value = Number(map.get(key));
  assert(Number.isFinite(value), `Invalid numeric ${key}`);
  return value;
};
const idempotentCompatible = config => ['all', '-1'].includes(config.get('acks'))
  && getNumber(config, 'retries') > 0
  && getNumber(config, 'max.in.flight.requests.per.connection') >= 1
  && getNumber(config, 'max.in.flight.requests.per.connection') <= 5;
assert.equal(producerConfig.get('enable.idempotence'), 'true');
assert(idempotentCompatible(producerConfig));
for (const [key, value] of [['acks', '1'], ['retries', '0'], ['max.in.flight.requests.per.connection', '6']]) {
  const invalid = new Map(producerConfig);
  invalid.set(key, value);
  assert.equal(idempotentCompatible(invalid), false);
}
assert(getNumber(producerConfig, 'delivery.timeout.ms') >= getNumber(producerConfig, 'linger.ms') + getNumber(producerConfig, 'request.timeout.ms'));
assert.equal(getNumber(producerConfig, 'batch.size'), 65536);
assert.equal(100 * getNumber(producerConfig, 'batch.size') / 2 ** 20, 6.25);
const isrRows = [...producer.source.matchAll(/^\| (1(?:\/[23])*) \| (是|否) \|/gm)];
assert.equal(isrRows.length, 3);
for (const [, members, allowed] of isrRows) assert.equal(members.split('/').length >= 2, allowed === '是');
assert(producer.source.includes('Eligible Leader Replicas'));

const consumerConfig = properties(consumer);
assert.equal(consumerConfig.get('group.protocol'), 'classic');
assert.equal(consumerConfig.get('enable.auto.commit'), 'false');
assert.equal(consumerConfig.get('isolation.level'), 'read_committed');
assert.equal(consumerConfig.get('auto.offset.reset'), 'earliest');
assert(consumerConfig.get('partition.assignment.strategy').endsWith('CooperativeStickyAssignor'));
assert(getNumber(consumerConfig, 'heartbeat.interval.ms') < getNumber(consumerConfig, 'session.timeout.ms'));
assert.equal(getNumber(consumerConfig, 'max.poll.records'), 100);

// This fixture receives every offset 100..104. Real logs may have numeric gaps.
const completionRows = [...consumer.source.matchAll(/^\| (10[0-4]) \| ([\d、]+) \| (10[1-5]) \|$/gm)];
assert.equal(completionRows.length, 5);
const completed = new Set();
let safeNext = 100;
for (const [, value, publishedSet, publishedNext] of completionRows) {
  completed.add(Number(value));
  while (completed.has(safeNext)) safeNext++;
  assert.deepEqual(publishedSet.split('、').map(Number).sort((a, b) => a - b), [...completed].sort((a, b) => a - b));
  assert.equal(Number(publishedNext), safeNext);
}
assert.equal(safeNext, 105);
const groupOutput = consumer.nodes.find(node => node.type === 'code' && node.value.startsWith('GROUP '));
const groupColumns = groupOutput.value.split('\n')[1].trim().split(/\s+/);
assert.equal(groupColumns[0], 'orders-worker');
assert.equal(Number(groupColumns[4]) - Number(groupColumns[3]), Number(groupColumns[5]));
assert.equal(Number(groupColumns[5]), 17);
const catchUpSeconds = (backlog, consumeRate, produceRate) => consumeRate <= produceRate ? Infinity : backlog / (consumeRate - produceRate);
assert.equal(catchUpSeconds(600000, 5000, 3000), 300);
assert.equal(catchUpSeconds(600000, 3000, 3000), Infinity);

const mirrorConfig = properties(mirror);
assert.equal(mirrorConfig.get('clusters'), 'A,B');
assert.equal(mirrorConfig.get('A->B.enabled'), 'true');
assert.equal(mirrorConfig.get('B->A.enabled'), 'false');
assert.equal(mirrorConfig.get('A.consumer.isolation.level'), 'read_committed');
for (const key of ['emit.offset-syncs.enabled', 'emit.checkpoints.enabled', 'sync.group.offsets.enabled']) {
  assert.equal(mirrorConfig.get(`A->B.${key}`), 'true');
}
assert.equal(mirrorConfig.get('A->B.offset-syncs.topic.location'), 'target');
assert.equal(mirrorConfig.get('A->B.replication.policy.class'), 'org.apache.kafka.connect.mirror.DefaultReplicationPolicy');
assert.equal(mirrorConfig.get('A->B.topics'), 'orders');
assert.equal(mirrorConfig.get('A->B.groups'), consumerConfig.get('group.id'));
assert.equal(mirrorConfig.get('A->B.sync.topic.acls.enabled'), 'false');
for (const key of ['replication.factor', 'offset-syncs.topic.replication.factor', 'checkpoints.topic.replication.factor', 'heartbeats.topic.replication.factor']) {
  assert.equal(getNumber(mirrorConfig, `A->B.${key}`), 3);
}
assert.equal(getNumber(mirrorConfig, 'A->B.emit.checkpoints.interval.seconds'), 10);
assert.equal(getNumber(mirrorConfig, 'A->B.sync.group.offsets.interval.seconds'), 10);

// Fixed single-sync branch from Kafka 4.1.0 OffsetSyncStore; not full selection,
// compaction, recovery, transaction, or consumer-group synchronization behavior.
function translateSingleSync(upstream, sync = {upstream: 100, downstream: 500}, initialized = true) {
  if (!initialized || !sync) return undefined;
  if (sync.upstream > upstream) return -1;
  return sync.downstream + (sync.upstream === upstream ? 0 : 1);
}
const translationRows = [...mirror.source.matchAll(/^\| (\d+) \| (\d+|无有效可用转换) \|/gm)];
assert.equal(translationRows.length, 4);
for (const [, upstream, downstream] of translationRows) {
  const actual = translateSingleSync(Number(upstream));
  assert.equal(actual, /^\d+$/.test(downstream) ? Number(downstream) : -1);
}
assert.equal(translateSingleSync(105), 501);
assert.equal(translateSingleSync(105, null), undefined);
assert.equal(translateSingleSync(105, undefined, false), undefined);
const defaultRemoteTopic = (sourceAlias, topic) => `${sourceAlias}.${topic}`;
const offsetSyncTopic = (location, sourceAlias, targetAlias) => `mm2-offset-syncs.${location === 'source' ? targetAlias : sourceAlias}.internal`;
assert.equal(defaultRemoteTopic('A', mirrorConfig.get('A->B.topics')), 'A.orders');
assert(mirror.source.includes(offsetSyncTopic('source', 'A', 'B')));
assert(mirror.source.includes(offsetSyncTopic('target', 'A', 'B')));

const mirrorOutput = mirror.nodes.find(node => node.type === 'code' && node.value.startsWith('CLUSTER GROUP'));
const rows = mirrorOutput.value.split('\n').slice(1).map(line => line.trim().split(/\s+/));
assert.equal(rows.length, 2);
for (const row of rows) assert.equal(Number(row[5]) - Number(row[4]), Number(row[6]));
assert.equal(rows[0][2], 'orders');
assert.equal(rows[1][2], 'A.orders');
assert.equal(Number(rows[1][4]), translateSingleSync(Number(rows[0][4])));
assert.equal(Number(rows[1][6]) - Number(rows[0][6]), 4);
const acknowledgedEvents = new Set(['E100', 'E101', 'E102', 'E103']);
const targetEvents = new Set(['E100', 'E102', 'E103']);
assert.equal([...acknowledgedEvents].sort().at(-1), [...targetEvents].sort().at(-1));
assert.deepEqual([...acknowledgedEvents].filter(event => !targetEvents.has(event)), ['E101']);

// Management examples in this batch are observations, not hidden reset commands.
for (const article of articles) {
  for (const block of article.nodes.filter(node => node.type === 'code' && node.lang === 'bash')) {
    assert(!/--(?:execute|reset-offsets|delete|alter|create)\b/.test(block.value));
  }
}
console.log(`PASS ${articles.length} MDX pages, ${answers} explicit answers, original outline/anchors and navigation metadata.`);
console.log('PASS 3 properties fixtures, idempotence constraints, 5 completion steps, 4 MM2 conversions, lag/topic/set arithmetic.');
console.log('No Kafka broker/Connect, Java client, real offset commit/reset, failover or WAN test was performed.');
