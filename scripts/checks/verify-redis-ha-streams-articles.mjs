// Offline article contracts and teaching models, not a Redis implementation.
// No server is started; this cannot establish real failover or delivery safety.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {compile} from '@mdx-js/mdx';

const root = 'docs/data-systems/cache/redis/';
const specifications = [
  {file: `${root}03-ha-cluster/09-Redis-Sentinel监控与故障转移.md`, section: '6. 验收题', answers: 7},
  {file: `${root}03-ha-cluster/10-Redis-Cluster-slot-Gossip迁移与故障转移.md`, section: '6. 验收题', answers: 7},
  {file: `${root}04-patterns-operations/13-Redis-Streams-PubSub与可靠队列.md`, section: '5. 验收题', answers: 8},
];
const parser = unified().use(remarkParse);
const plain = node => node.value ?? node.children?.map(plain).join('') ?? '';
const anchors = source => [...source.matchAll(/\{\/\*\s*#([^*]+)\*\/\}/g)].map(match => match[1].trim());
const articles = [];
let answers = 0;
for (const specification of specifications) {
  const source = fs.readFileSync(specification.file, 'utf8').replaceAll('\r\n', '\n');
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, '');
  await compile(body);
  const nodes = parser.parse(body).children;
  const baseline = execFileSync('git', ['show', `c885a77:${specification.file}`], {encoding: 'utf8'});
  for (const anchor of anchors(baseline)) assert(anchors(source).includes(anchor), `Lost anchor: ${anchor}`);
  for (const field of ['title', 'sidebar_label', 'sidebar_position']) {
    const pattern = new RegExp(`^${field}:.*$`, 'm');
    assert.equal(source.match(pattern)?.[0].trim(), baseline.match(pattern)?.[0].trim(), `Changed ${field}`);
  }
  const start = nodes.findIndex(node => node.type === 'heading' && node.depth === 2 && plain(node).startsWith(specification.section));
  assert(start >= 0, `${specification.file}: missing exercise section`);
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

// Verify the published quorum examples, not membership discovery or elections.
const sentinel = articles[0].source;
const voteRows = [...sentinel.matchAll(/^\| (\d+) \| (\d+) \| (\d+) \| ([^|]+) \| ([^|]+) \|$/gm)];
assert.equal(voteRows.length, 4);
for (const [, total, quorum, reachable, odown, authorization] of voteRows) {
  const canJudge = Number(reachable) >= Number(quorum);
  const majority = Math.floor(Number(total) / 2) + 1;
  assert.equal(odown.trim().startsWith('能'), canJudge);
  assert.equal(authorization.trim().startsWith('能'), canJudge && Number(reachable) >= majority);
}
const candidates = [...sentinel.matchAll(/^\| (R\d+) \| (\d+) \| ([\d,]+) \|/gm)]
  .map(([, id, priority, offset]) => ({id, priority: Number(priority), offset: Number(offset.replaceAll(',', ''))}));
assert.equal(candidates.length, 3);
const eligible = candidates.filter(candidate => candidate.priority > 0)
  .sort((a, b) => a.priority - b.priority || b.offset - a.offset || a.id.localeCompare(b.id));
assert.equal(eligible[0].id, 'R2');
assert(candidates.find(candidate => candidate.id === 'R1').offset > eligible[0].offset);

// CRC16/XMODEM and the first, non-empty brace-pair rule from Cluster spec.
function hashInput(key) {
  const first = key.indexOf('{');
  const end = first < 0 ? -1 : key.indexOf('}', first + 1);
  return first >= 0 && end > first + 1 ? key.slice(first + 1, end) : key;
}
function crc16(value) {
  let crc = 0;
  for (const byte of Buffer.from(value)) {
    crc ^= byte << 8;
    for (let index = 0; index < 8; index++) crc = ((crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1) & 0xffff;
  }
  return crc;
}
const slot = key => crc16(hashInput(key)) % 16384;
assert.equal(crc16('123456789'), 0x31c3);
assert.equal(hashInput('a{}b{42}'), 'a{}b{42}');
assert.equal(hashInput('order:{42}:header'), '42');
const cluster = articles[1];
const keys = [...cluster.source.matchAll(/CLUSTER KEYSLOT (?:'([^']+)'|(\S+))/g)].map(match => match[1] ?? match[2]);
const slotOutput = cluster.nodes.find(node => node.type === 'code' && node.lang === 'text' && node.value.startsWith('(integer) 8000'));
assert(slotOutput);
const publishedSlots = [...slotOutput.value.matchAll(/\(integer\) (\d+)/g)].map(match => Number(match[1]));
assert.deepEqual(keys.map(slot), publishedSlots);
assert.equal(publishedSlots.length, 3);
assert.equal(publishedSlots[0], publishedSlots[1]);
assert.notEqual(publishedSlots[0], publishedSlots[2]);
const askingSession = cluster.nodes.find(node => node.type === 'code' && node.value.includes('7001> ASKING'));
assert(askingSession && /7001> ASKING\nOK\n127\.0\.0\.1:7001> GET/.test(askingSession.value));
assert(cluster.source.includes('[8000->-B_ID]') && cluster.source.includes('[8000-<-A_ID]'));
const info = cluster.nodes.find(node => node.type === 'code' && node.value.startsWith('cluster_state:'));
const infoFields = Object.fromEntries(info.value.split('\n').map(line => line.split(':')));
assert.equal(Number(infoFields.cluster_slots_assigned), 16384);
assert.equal(Number(infoFields.cluster_slots_ok), 16384);
assert.equal(Number(infoFields.cluster_size), 3);
assert.equal(Number(infoFields.cluster_known_nodes), 6);

// Replay only the finite teaching transcript, comparing every printed reply.
// This fixture omits Redis internals, clocks, persistence and concurrent clients.
const streams = articles[2];
const records = streams.nodes.filter(node => node.type === 'code' && node.lang === 'text').flatMap(node => {
  const matches = [...node.value.matchAll(/^127\.0\.0\.1:16379> (.+)$/gm)];
  return matches.map((match, index) => ({
    command: match[1],
    output: node.value.slice(match.index + match[0].length, matches[index + 1]?.index ?? node.value.length).trim(),
  }));
});
assert.equal(records.length, 13);
function render(value) {
  if (value === null) return '(nil)';
  if (typeof value === 'number') return `(integer) ${value}`;
  if (typeof value === 'string') return JSON.stringify(value);
  if (value.length === 0) return '(empty array)';
  return value.map((child, index) => {
    const prefix = `${index + 1}) `;
    return render(child).split('\n').map((line, row) => `${row ? ' '.repeat(prefix.length) : prefix}${line}`).join('\n');
  }).join('\n');
}
let now = 0;
let groupCreated = false;
let delivered = false;
const entries = new Map();
const pending = new Map();
for (const record of records) {
  const tokens = record.command.split(/\s+/);
  const command = tokens[0];
  let reply;
  if (command === 'XGROUP') {
    assert.deepEqual(tokens, ['XGROUP', 'CREATE', 'lab:orders', 'workers', '0', 'MKSTREAM']);
    assert(!groupCreated);
    groupCreated = true;
    assert.equal(record.output, 'OK');
    continue;
  } else if (command === 'XADD') {
    assert(groupCreated);
    const [,, id, ...fields] = tokens;
    entries.set(id, fields);
    reply = id;
  } else if (command === 'XREADGROUP') {
    const consumer = tokens[3];
    assert.equal(tokens.at(-1), '>');
    if (!delivered) {
      const [id, fields] = [...entries][0];
      pending.set(id, {consumer, lastAt: now, deliveries: 1});
      delivered = true;
      reply = [['lab:orders', [[id, fields]]]];
    } else {
      now += 2000;
      reply = null;
    }
  } else if (command === 'XPENDING') {
    if (tokens.length === 3) {
      reply = [1, '1000-0', '1000-0', [['c1', '1']]];
      assert.equal(pending.size, 1);
    } else {
      if (pending.size) now = pending.get('1000-0').consumer === 'c1' ? 61000 : 61020;
      reply = [...pending].map(([id, item]) => [id, item.consumer, now - item.lastAt, item.deliveries]);
    }
  } else if (command === 'XAUTOCLAIM') {
    assert.deepEqual(tokens, ['XAUTOCLAIM', 'lab:orders', 'workers', 'c2', '60000', '0-0', 'COUNT', '10']);
    const claimed = [];
    for (const [id, item] of pending) {
      if (now - item.lastAt < Number(tokens[4])) continue;
      item.consumer = tokens[3];
      item.lastAt = now;
      item.deliveries++;
      claimed.push([id, entries.get(id)]);
    }
    // A one-entry fixture completes its scan, but still has one pending entry.
    reply = ['0-0', claimed, []];
    assert.equal(pending.size, 1);
  } else if (command === 'XACK') {
    reply = pending.delete(tokens[3]) ? 1 : 0;
  } else if (command === 'XLEN') {
    reply = entries.size;
    assert.equal(pending.size, 0);
  } else if (command === 'XRANGE') {
    reply = [...entries];
  } else {
    assert.fail(`Unexpected transcript command: ${command}`);
  }
  assert.equal(record.output, render(reply), record.command);
}
assert.equal(pending.size, 0);
assert.equal(entries.size, 1);
assert.equal(1000 * 3600, 3600000);
assert.equal((1000 * 3600 * 1024 / 2 ** 30).toFixed(2), '3.43');

console.log(`PASS ${articles.length} MDX pages, ${answers} explicit answers, legacy anchors and metadata.`);
console.log(`PASS quorum/candidate arithmetic, CRC16 slots, topology excerpt and ${records.length} teaching transcript replies.`);
console.log('No Redis service, real failover, reshard, network partition or persistence test was performed.');
