import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import yaml from 'js-yaml';
import {compile} from '@mdx-js/mdx';

// Extract the actual article rules: do not maintain a second copy of expressions.
// node scripts/verify-monitoring-fourth-batch.mjs --promtool /path/to/promtool
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  "docs/data-systems/databases/03-MongoDB核心监控指标采集与告警.md",
  "docs/data-systems/vector-databases/02-Qdrant核心监控指标采集与告警.md",
  "docs/data-systems/vector-databases/03-Weaviate核心监控指标采集与告警.md",
  "docs/networking/load-balancing-proxy/envoy/15-Envoy核心监控指标采集与告警.md",
  "docs/networking/load-balancing-proxy/haproxy/03-HAProxy核心监控指标采集与告警.md",
  "docs/development/spring-boot/03-data/09-HikariCP连接池核心监控指标采集与告警.md",
  "docs/development/java/03-concurrency/10-线程池核心监控指标采集与告警.md"
];
const arg = process.argv.indexOf('--promtool');
if (arg >= 0 && !process.argv[arg + 1]) throw new Error('--promtool requires a path');
const tool = arg >= 0 ? path.resolve(process.argv[arg + 1]) : 'promtool';
function run(args) {
  const result = spawnSync(tool, args, {cwd: root, encoding: 'utf8', timeout: 120000});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

const expressions = [], groups = [];
let diagrams = 0;
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert(match, file);
  const metadata = yaml.load(match[1]);
  assert(match[2].startsWith(`\n# ${metadata.title}\n`), file);
  await compile(match[2]);
  for (const fence of match[2].matchAll(/^```([^\n]*)\n([\s\S]*?)^```/gm)) {
    if (fence[1] === 'promql') expressions.push({file, expr: fence[2].trim()});
    if (fence[1] === 'mermaid') diagrams++;
    if (fence[1] === 'yaml') {
      const doc = yaml.load(fence[2]);
      if (doc?.groups) groups.push(...doc.groups);
    }
  }
}
assert.equal(diagrams, 7);
const alerts = new Map(groups.flatMap(group => group.rules.map(rule => [rule.alert, rule])));
assert.equal(alerts.size, 7);
const sample = (series, values) => ({series, values});
const firing = (alert, labels) => ({exp_labels: {...labels, ...alerts.get(alert).labels}, exp_annotations: alerts.get(alert).annotations});
const testAlert = (name, input, alert, checks) => ({name, interval: '1m', input_series: input,
  alert_rule_test: checks.map(([time, labels]) => ({eval_time: time, alertname: alert, exp_alerts: labels.map(l => firing(alert, l))}))});


const metric = (name, labels, values) => sample(name + '{' + Object.entries(labels).map(([k, v]) => k + '=' + JSON.stringify(v)).join(',') + '}', values);
const want = (labels, value) => ({labels: '{' + Object.entries(labels).map(([k, v]) => k + '=' + JSON.stringify(v)).join(',') + '}', value});
const mongoLabels = {cluster: 'a', mongodb_cluster: 'm', instance: 'm1'};
const mongo = (current, available) => [
  metric('mongodb_ss_connections', {...mongoLabels, job: 'mongodb', conn_type: 'current'}, current),
  ...(available === null ? [] : [metric('mongodb_ss_connections', {...mongoLabels, job: 'mongodb', conn_type: 'available'}, available)]),
];
const qLabels = {cluster: 'a', qdrant_cluster: 'q', instance: 'q1', job: 'qdrant'};
const qdrant = (pending, enabled) => [
  metric('cluster_pending_operations_total', qLabels, pending),
  metric('cluster_enabled', qLabels, enabled),
];
const wLabels = {cluster: 'a', weaviate_cluster: 'w', instance: 'w1', job: 'weaviate', class_name: 'Docs', shard_name: 's1'};
const weaviate = (size, paused) => [
  metric('queue_size', wLabels, size),
  ...(paused === null ? [] : [metric('queue_paused', wLabels, paused)]),
];
const eLabels = {cluster: 'a', proxy_cluster: 'edge', instance: 'e1', job: 'envoy', envoy_cluster_name: 'orders'};
const envoy = values => [metric('envoy_cluster_upstream_rq_pending_overflow', eLabels, values)];
const haLabels = {cluster: 'a', proxy_cluster: 'edge', instance: 'h1', job: 'haproxy', proxy: 'app', state: 'DOWN'};
const haproxy = values => [metric('haproxy_backend_status', haLabels, values)];
const hLabels = {cluster: 'a', service: 'api', instance: 'j1', job: 'app-pool', pool: 'main'};
const hikari = (pending, active, max) => [
  metric('hikaricp_connections_pending', hLabels, pending),
  metric('hikaricp_connections_active', hLabels, active),
  ...(max === null ? [] : [metric('hikaricp_connections_max', hLabels, max)]),
];
const xLabels = {cluster: 'a', service: 'api', instance: 'j1', job: 'app-executor', name: 'orders'};
const executor = (queued, remaining) => [
  metric('executor_queued_tasks', xLabels, queued),
  metric('executor_queue_remaining_tasks', xLabels, remaining),
];

const tests = [
  testAlert('MongoDB pressure and recovery', mongo('95+0x30', '5+0x14 100+0x20'), 'MongoDBConnectionHeadroomLow', [['9m', []], ['11m', [mongoLabels]], ['17m', []]]),
  testAlert('MongoDB exact boundary', mongo('90+0x30', '10+0x30'), 'MongoDBConnectionHeadroomLow', [['20m', []]]),
  testAlert('MongoDB missing available is not zero', mongo('95+0x30', null), 'MongoDBConnectionHeadroomLow', [['20m', []]]),
  testAlert('MongoDB zero capacity is not a valid ratio', mongo('0+0x30', '0+0x30'), 'MongoDBConnectionHeadroomLow', [['20m', []]]),
  testAlert('Qdrant metadata pending then recovery', qdrant('2+0x12 0+0x20', '1+0x40'), 'QdrantMetadataPending', [['9m', []], ['11m', [qLabels]], ['15m', []]]),
  testAlert('Qdrant standalone mode excluded', qdrant('2+0x30', '0+0x30'), 'QdrantMetadataPending', [['20m', []]]),
  testAlert('Qdrant no pending operation', qdrant('0+0x30', '1+0x30'), 'QdrantMetadataPending', [['20m', []]]),
  testAlert('Weaviate paused nonempty queue and recovery', weaviate('100+0x30', '1+0x8 0+0x20'), 'WeaviateIndexQueuePaused', [['4m', []], ['6m', [wLabels]], ['10m', []]]),
  testAlert('Weaviate empty paused queue excluded', weaviate('0+0x30', '1+0x30'), 'WeaviateIndexQueuePaused', [['20m', []]]),
  testAlert('Weaviate missing pause metric is not zero', weaviate('100+0x30', null), 'WeaviateIndexQueuePaused', [['20m', []]]),
  testAlert('Envoy overflow counter and recovery', envoy('0+60x12 720+0x20'), 'EnvoyUpstreamOverflow', [['4m', []], ['7m', [eLabels]], ['20m', []]]),
  testAlert('Envoy no new overflow', envoy('100+0x30'), 'EnvoyUpstreamOverflow', [['20m', []]]),
  testAlert('HAProxy backend down and recovery', haproxy('1+0x4 0+0x20'), 'HAProxyBackendDown', [['1m', []], ['3m', [haLabels]], ['6m', []]]),
  testAlert('HAProxy zero-valued UP state does not indicate DOWN', [
    metric('haproxy_backend_status', {...haLabels, state: 'UP'}, '0+0x20'),
    ...haproxy('0+0x20'),
  ], 'HAProxyBackendDown', [['10m', []]]),
  testAlert('Hikari persistent saturation and recovery', hikari('5+0x8 0+0x20', '95+0x30', '100+0x30'), 'HikariPoolSaturated', [['4m', []], ['6m', [hLabels]], ['10m', []]]),
  testAlert('Hikari no waiters is a different policy', hikari('0+0x30', '95+0x30', '100+0x30'), 'HikariPoolSaturated', [['20m', []]]),
  testAlert('Hikari zero max excluded', hikari('5+0x30', '95+0x30', '0+0x30'), 'HikariPoolSaturated', [['20m', []]]),
  testAlert('Hikari missing max excluded', hikari('5+0x30', '95+0x30', null), 'HikariPoolSaturated', [['20m', []]]),
  testAlert('Executor bounded queue pressure and recovery', executor('90+0x8 0+0x20', '10+0x8 100+0x20'), 'ExecutorBoundedQueuePressure', [['4m', []], ['6m', [xLabels]], ['10m', []]]),
  testAlert('Executor exact threshold', executor('80+0x30', '20+0x30'), 'ExecutorBoundedQueuePressure', [['20m', []]]),
  testAlert('Executor zero-capacity handoff is not ordinary queue ratio', executor('0+0x30', '0+0x30'), 'ExecutorBoundedQueuePressure', [['20m', []]]),
  testAlert('Executor unrelated pool is excluded', [
    metric('executor_queued_tasks', {...xLabels, name: 'batch'}, '90+0x30'),
    metric('executor_queue_remaining_tasks', {...xLabels, name: 'batch'}, '10+0x30'),
  ], 'ExecutorBoundedQueuePressure', [['20m', []]]),
];
function expression(needle) {
  const found = expressions.filter(item => item.expr.includes(needle));
  assert.equal(found.length, 1, 'Choose a unique article expression: ' + needle);
  return found[0].expr;
}
function testExpression(name, needle, input, expected, time = '10m') {
  tests.push({name, interval: '1m', input_series: input, promql_expr_test: [{expr: expression(needle), eval_time: time, exp_samples: expected}]});
}

const opLabels = {...mongoLabels, job: 'mongodb', op_type: 'reads'};
testExpression('MongoDB microseconds to seconds', 'mongodb_ss_opLatencies_latency', [
  metric('mongodb_ss_opLatencies_latency', opLabels, '0+12000000x20'),
  metric('mongodb_ss_opLatencies_ops', opLabels, '0+600x20'),
], [want(opLabels, 0.02)]);
testExpression('MongoDB zero operations excluded', 'mongodb_ss_opLatencies_latency', [
  metric('mongodb_ss_opLatencies_latency', opLabels, '0+0x20'),
  metric('mongodb_ss_opLatencies_ops', opLabels, '0+0x20'),
], []);
testExpression('MongoDB connection counter reset', 'mongodb_ss_connections_totalCreated', [
  metric('mongodb_ss_connections_totalCreated', {...mongoLabels, job: 'mongodb'}, '0+60x10 0+60x10'),
], [want({...mongoLabels, job: 'mongodb'}, 1)], '20m');

function buckets(name, labels, high, step) {
  return ['0', String(high), '+Inf'].map(le => metric(name, {...labels, le}, le === '0' ? '0+0x20' : '0+' + step + 'x20'));
}
testExpression('Qdrant successful REST histogram is already seconds', 'rest_responses_duration_seconds_bucket',
  buckets('rest_responses_duration_seconds_bucket', {...qLabels, status: '200', method: 'POST', endpoint: '/collections/{name}/points/query'}, 0.5, 600),
  [want({cluster: 'a', qdrant_cluster: 'q', instance: 'q1'}, 0.495)]);
testExpression('Qdrant pending total is current gauge not rate', 'cluster_pending_operations_total', qdrant('5+0x20', '1+0x20'),
  [want({__name__: 'cluster_pending_operations_total', ...qLabels}, 5)]);
testExpression('Weaviate milliseconds converted to seconds', 'queries_durations_ms_bucket',
  buckets('queries_durations_ms_bucket', {...wLabels, query_type: 'nearVector'}, 500, 600),
  [want({cluster: 'a', weaviate_cluster: 'w', class_name: 'Docs', query_type: 'nearVector'}, 0.495)]);
testExpression('Envoy milliseconds converted to seconds', 'envoy_cluster_upstream_rq_time_bucket',
  buckets('envoy_cluster_upstream_rq_time_bucket', eLabels, 500, 600),
  [want({cluster: 'a', proxy_cluster: 'edge', envoy_cluster_name: 'orders'}, 0.495)]);
const responseLabels = {cluster: 'a', proxy_cluster: 'edge', instance: 'e1', job: 'envoy', envoy_http_conn_manager_prefix: 'ingress_http'};
const envoyResponses = (error, success) => [
  metric('envoy_http_downstream_rq_xx', {...responseLabels, envoy_response_code_class: '5'}, error),
  metric('envoy_http_downstream_rq_xx', {...responseLabels, envoy_response_code_class: '2'}, success),
];
testExpression('Envoy final response denominator', 'envoy_http_downstream_rq_xx', envoyResponses('0+6x20', '0+594x20'), [want({cluster: 'a', proxy_cluster: 'edge'}, 0.01)]);
testExpression('Envoy no traffic excluded', 'envoy_http_downstream_rq_xx', envoyResponses('0+0x20', '0+0x20'), []);
const haResponseLabels = {cluster: 'a', proxy_cluster: 'edge', instance: 'h1', job: 'haproxy', proxy: 'app'};
testExpression('HAProxy final response denominator', 'haproxy_frontend_http_responses_total', [
  metric('haproxy_frontend_http_responses_total', {...haResponseLabels, code: '5xx'}, '0+6x20'),
  metric('haproxy_frontend_http_responses_total', {...haResponseLabels, code: '2xx'}, '0+594x20'),
], [want({cluster: 'a', proxy_cluster: 'edge', proxy: 'app'}, 0.01)]);
testExpression('HAProxy average seconds is a gauge', 'haproxy_backend_queue_time_average_seconds', [
  metric('haproxy_backend_queue_time_average_seconds', haResponseLabels, '0.02+0x20'),
], [want({__name__: 'haproxy_backend_queue_time_average_seconds', ...haResponseLabels}, 0.02)]);
testExpression('Hikari acquire timer uses seconds', 'hikaricp_connections_acquire_seconds_sum', [
  metric('hikaricp_connections_acquire_seconds_sum', hLabels, '0+6x20'),
  metric('hikaricp_connections_acquire_seconds_count', hLabels, '0+600x20'),
], [want(hLabels, 0.01)]);
testExpression('Hikari no returned connections has no usage average', 'hikaricp_connections_usage_seconds_sum', [
  metric('hikaricp_connections_usage_seconds_sum', hLabels, '0+0x20'),
  metric('hikaricp_connections_usage_seconds_count', hLabels, '0+0x20'),
], []);
testExpression('Executor idle is task wait seconds', 'executor_idle_seconds_sum', [
  metric('executor_idle_seconds_sum', xLabels, '0+12x20'),
  metric('executor_idle_seconds_count', xLabels, '0+600x20'),
], [want(xLabels, 0.02)]);
testExpression('Executor bounded queue ratio', 'executor_queue_remaining_tasks', executor('90+0x20', '10+0x20'), [want(xLabels, 0.9)]);
testExpression('Executor handoff denominator excluded', 'executor_queue_remaining_tasks', executor('0+0x20', '0+0x20'), []);

console.log(`MDX/YAML: ${files.length} articles; ${diagrams} Mermaid fences`);
console.log(run(['--version']));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'monitoring-fourth-check-'));
const rulesFile = path.join(temporary, 'rules.yaml'), testsFile = path.join(temporary, 'tests.yaml');
try {
  fs.writeFileSync(rulesFile, yaml.dump({groups: [...groups, {name: 'article-query-syntax', rules: expressions.map((item, n) => ({record: `fourth_article_check_${n}`, expr: item.expr}))}]}));
  fs.writeFileSync(testsFile, yaml.dump({rule_files: [rulesFile], evaluation_interval: '1m', tests}));
  console.log(run(['check', 'rules', rulesFile]));
  console.log(run(['test', 'rules', testsFile]));
  console.log(`PASS: ${expressions.length} PromQL blocks, ${alerts.size} alerts, ${tests.length} synthetic test groups`);
  console.log('Scope: synthetic series only; no live MongoDB, vector databases, proxies, HikariCP or executor instrumentation integration.');
} finally {
  for (const generated of [rulesFile, testsFile]) if (fs.existsSync(generated)) fs.unlinkSync(generated);
  fs.rmdirSync(temporary);
}


