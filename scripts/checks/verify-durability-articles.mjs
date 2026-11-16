// Article contracts and teaching arithmetic only; no Redis/MySQL is started.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {unified} from 'unified';
import remarkParse from 'remark-parse';
import {compile} from '@mdx-js/mdx';

const root = 'docs/data-systems/';
const specifications = [
  {file: `${root}cache/redis/02-engine-persistence/07-Redis-RDB-AOF-fork与Copy-on-Write.md`, section: '7. 验收题', answers: 7},
  {file: `${root}cache/redis/03-ha-cluster/08-Redis主从复制PSYNC与一致性.md`, section: '7. 验收题', answers: 7},
  {file: `${root}databases/mysql/03-innodb-transactions/04-Redo-Undo-Binlog与一次提交的完整路径.md`, section: '13. 验收题', answers: 9},
];
const backup = `${root}cache/redis/04-patterns-operations/15-Redis持久化备份与Cluster恢复专项.md`;
const parser = unified().use(remarkParse);
const plain = node => node.value ?? node.children?.map(plain).join('') ?? '';
const sources = new Map();
let answers = 0;

for (const specification of [...specifications, {file: backup}]) {
  const source = fs.readFileSync(specification.file, 'utf8').replaceAll('\r\n', '\n');
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, '');
  await compile(body);
  const nodes = parser.parse(body).children;
  sources.set(specification.file, {source, nodes});

  if (!specification.section) continue;
  const start = nodes.findIndex(node => node.type === 'heading' && node.depth === 2 && plain(node).startsWith(specification.section));
  assert(start >= 0, `${specification.file}: missing answer section`);
  let end = nodes.findIndex((node, index) => index > start && node.type === 'heading' && node.depth <= 2);
  if (end < 0) end = nodes.length;
  const section = nodes.slice(start + 1, end);
  const questions = section.flatMap((node, index) => node.type === 'heading' && node.depth === 3 ? [index] : []);
  assert.equal(questions.length, specification.answers, `${specification.file}: unexpected question count`);
  for (const [index, position] of questions.entries()) {
    const response = section.slice(position + 1, questions[index + 1] ?? section.length);
    assert(response.some(node => node.type === 'paragraph' && plain(node).startsWith('答案：') && plain(node).length > 3), `${specification.file}: missing explicit answer`);
  }
  answers += questions.length;

  const baseline = execFileSync('git', ['show', `aefb2f1:${specification.file}`], {encoding: 'utf8'});
  const anchors = text => [...text.matchAll(/\{\/\*\s*#([^*]+)\*\/\}/g)].map(match => match[1].trim());
  for (const anchor of anchors(baseline)) assert(anchors(source).includes(anchor), `Lost legacy anchor: ${anchor}`);
}

const persistence = sources.get(specifications[0].file);
const persistenceOutput = persistence.nodes.find(node => node.type === 'code' && node.lang === 'text' && node.value.includes('rdb_last_cow_size:'));
assert(persistenceOutput);
const persistenceFields = Object.fromEntries(persistenceOutput.value.split('\n').map(line => line.split(':')));
assert.equal(Number(persistenceFields.rdb_last_cow_size) / 2 ** 30, 1);
assert.equal(Number(persistenceFields.latest_fork_usec) / 1000, 18);
assert.equal((160 - 80) / 80 * 100, 100);
assert(!persistence.source.includes('redis-check-aof --fix'), 'Do not make destructive repair the default check');

const replication = sources.get(specifications[1].file);
const replicationOutput = replication.nodes.find(node => node.type === 'code' && node.lang === 'text' && node.value.includes('repl_backlog_first_byte_offset:'));
assert(replicationOutput);
const fields = Object.fromEntries(replicationOutput.value.split('\n').map(line => {
  const colon = line.indexOf(':');
  return [line.slice(0, colon), line.slice(colon + 1)];
}));
const first = Number(fields.repl_backlog_first_byte_offset);
const length = Number(fields.repl_backlog_histlen);
const last = Number(fields.master_repl_offset);
const replica = Number(fields.slave0.match(/offset=(\d+)/)[1]);
assert.equal(first + length - 1, last);
assert.equal(last - replica, 50000);
// These examples assume an accepted replication ID. Range alone is not PSYNC.
const covered = processed => processed + 1 >= first && processed + 1 <= last + 1;
assert.equal(covered(950000), true);
assert.equal(covered(750000), false);
assert.equal(covered(1000000), true);
assert.equal(2 * 30 * 2, 120);
assert(128 >= 120);
const clientSession = replication.nodes.find(node => node.type === 'code' && node.lang === 'text' && /16379> SET/.test(node.value));
assert(clientSession && /SET[\s\S]+16379> WAIT 1 1000/.test(clientSession.value));
for (const block of replication.nodes.filter(node => node.type === 'code' && node.lang === 'bash')) {
  assert(!/redis-cli[^\n]*\bWAIT\b/.test(block.value), 'WAIT example must not silently start a new connection');
}

const mysql = sources.get(specifications[2].file);
const logOutput = mysql.nodes.find(node => node.type === 'code' && node.lang === 'text' && node.value.includes('Last checkpoint at'));
assert(logOutput);
const logPosition = label => Number(logOutput.value.match(new RegExp(`${label}\\s+(\\d+)`))[1]);
assert.equal(logPosition('Log sequence number') - logPosition('Log flushed up to'), 2000);
assert.equal(logPosition('Log sequence number') - logPosition('Last checkpoint at'), 50000);
assert.equal(2 / 10, 0.2); // Amortized fixed cost, not per-request elapsed time.
assert(!mysql.source.includes('SET GLOBAL'), 'This chapter should not silently lower production durability');

// A missing middle record is invisible if one checks only the largest ID.
const acknowledged = new Set([1, 2, 3]);
const recovered = new Set([1, 3]);
assert.equal(Math.max(...acknowledged), Math.max(...recovered));
assert.deepEqual([...acknowledged].filter(id => !recovered.has(id)), [2]);
const backupSource = sources.get(backup).source;
assert(!backupSource.includes('客户端收到 OK\n  → 命令已修改主节点内存'));
assert(backupSource.includes('普通逐文件复制不等于原子目录快照'));

console.log(`PASS ${sources.size} MDX pages, ${answers} explicit answers, preserved anchors and teaching contracts/arithmetic.`);
console.log('No Redis/MySQL service, SQL execution, failover or power-loss test was performed.');
