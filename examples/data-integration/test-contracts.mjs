import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';

const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
const job = JSON.parse(read('seatunnel/smoke.conf'));
const orders = JSON.parse(read('nifi/orders.json'));
const recipe = JSON.parse(read('nifi/recipe.json'));
const messages = read('airbyte/source-messages.jsonl').trim().split(/\r?\n/).map(line => JSON.parse(line));

test('SeaTunnel smoke remains a single-parallelism bounded, non-database job', () => {
  assert.deepEqual(job.env, {parallelism:1, job:{mode:'BATCH'}});
  assert.deepEqual(Object.keys(job.source), ['FakeSource']);
  assert.deepEqual(Object.keys(job.sink), ['Console']);
  assert.equal(job.source.FakeSource.row.num, 4);
  assert.equal(job.source.FakeSource.plugin_output, job.sink.Console.plugin_input);
  assert.deepEqual(job.source.FakeSource.schema.fields, {order_id:'bigint', status:'string'});
});

test('NiFi recipe is explicitly not an importable flow export', () => {
  assert.equal(recipe.format, 'human-readable-recipe-not-nifi-flow-export');
  assert.equal(recipe.engine, 'Traditional');
  assert.equal(recipe.scope, 'single-node-isolated-test');
  assert.equal(recipe.generate.trigger, 'Run Once');
  assert.equal(recipe.generate['Batch Size'], 1);
  assert.equal(recipe.generate['Data Format'], 'Text');
  assert.equal(recipe.generate['Unique FlowFiles'], false);
  assert.equal(recipe.log['Log Payload'], false);
});

test('Synthetic orders have unique keys and paid selection matches the article', () => {
  assert.equal(new Set(orders.map(order => order.order_id)).size, orders.length);
  const paid = orders.filter(order => order.status === 'paid');
  assert.equal(orders.length, recipe.expected.input_records);
  assert.equal(paid.length, recipe.expected.paid_records);
  assert.deepEqual(paid.map(order => order.order_id), recipe.expected.paid_order_ids);
  // This fixture allows exactly two fractional digits. Sum integer cents rather
  // than pretending binary floating point is a database DECIMAL validator.
  const cents = paid.reduce((total, order) => {
    assert.match(order.amount, /^\d+\.\d{2}$/);
    return total + BigInt(order.amount.replace('.', ''));
  }, 0n);
  assert.equal(cents.toString(), recipe.expected.paid_amount.replace('.', ''));
});

test('NiFi recipe routes originals and failures to inspection, not silent discard', () => {
  for (const relationship of ['original', 'failure']) {
    assert(recipe.connections.some(edge => edge.from === 'query' && edge.relationship === relationship && edge.to.startsWith('stopped-inspection-')));
  }
  assert.deepEqual(recipe.auto_terminate.map(item => item.processor), ['log']);
});

test('Airbyte synthetic messages share one stream and use epoch milliseconds', () => {
  const [record, state] = messages;
  assert.equal(record.type, 'RECORD');
  assert.equal(record.record.emitted_at, Date.parse('2026-11-14T00:00:00Z'));
  assert.equal(state.type, 'STATE');
  assert.equal(state.state.type, 'STREAM');
  assert.deepEqual(state.state.stream.stream_descriptor, {name:record.record.stream, namespace:record.record.namespace});
  assert.equal(state.state.stream.stream_state.cursor, record.record.data.updated_at);
});

test('SeaTunnel pure-transfer lower bound uses GiB and MiB consistently', () => {
  assert.equal(120 * 1024 / 40, 3072);
  assert.equal(3072 / 60, 51.2);
});

test('Steady backlog math and NiFi free-space window match the examples', () => {
  assert.equal(((30 - 20) * 3600 / 1024).toFixed(1), '35.2');
  assert.equal(20 * 1024 / (10 - 6), 5120);
  assert.equal((5120 / 60).toFixed(1), '85.3');
});

test('Airbyte illustrative workload budget excludes platform and safety overhead', () => {
  assert.equal((1 + 2 + 1) * 5, 20);
});
