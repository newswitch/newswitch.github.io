import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import yaml from 'js-yaml';
import {compile} from '@mdx-js/mdx';

// node scripts/verify-monitoring-second-batch.mjs --promtool /absolute/path/to/promtool
// Checks article expressions, synthetic Prometheus series and canonical JMX inputs.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'docs/data-systems/cache/redis/04-patterns-operations/16-Redis核心监控指标采集与告警.md',
  'docs/data-systems/databases/postgresql/05-operations-internals/20-PostgreSQL核心监控指标采集与告警.md',
  'docs/data-systems/messaging/kafka/14-Kafka核心监控指标采集与告警.md',
  'docs/data-systems/search/elasticsearch/04-security-operations/18-Elasticsearch核心监控指标采集与告警.md',
  'docs/networking/load-balancing-proxy/nginx/04-production/22-Nginx核心监控指标采集与告警.md',
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

const expressions = [], groups = [], jmx = [];
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
      if (doc?.rules?.some(rule => rule.pattern)) jmx.push(...doc.rules);
    }
  }
}
const alerts = new Map(groups.flatMap(group => group.rules.map(rule => [rule.alert, rule])));
assert.equal(alerts.size, 5);
assert.equal(jmx.length, 9);
const firing = (alert, labels) => ({exp_labels: {...labels, ...alerts.get(alert).labels}, exp_annotations: alerts.get(alert).annotations});
const sample = (series, values) => ({series, values});
const testAlert = (name, input, alert, checks) => ({name, interval: '1m', input_series: input,
  alert_rule_test: checks.map(([time, labels]) => ({eval_time: time, alertname: alert, exp_alerts: labels.map(l => firing(alert, l))}))});
const redisLabels = {cluster: 'a', instance: 'r:6379', job: 'redis'};
const redisInput = (used, max) => [
  sample('redis_memory_used_bytes{cluster="a",instance="r:6379",job="redis"}', used),
  sample('redis_memory_max_bytes{cluster="a",instance="r:6379",job="redis"}', max),
];
const pgLabels = {cluster: 'a', instance: 'p:5432', datname: 'app'};
const pgAge = values => [sample('pg_stat_activity_max_tx_duration{cluster="a",instance="p:5432",job="postgres",datname="app",state="idle in transaction",application_name="web"}', values)];
const kafkaLabels = {cluster: 'a', kafka_cluster: 'events', instance: 'b:7071', job: 'kafka-jmx'};
const kafkaMin = values => [sample('kafka_broker_under_min_isr_partitions{cluster="a",kafka_cluster="events",instance="b:7071",job="kafka-jmx"}', values)];
const esLabels = {cluster: 'a', es_cluster: 'search'};
const esRed = (instance, values) => sample(`elasticsearch_cluster_health_status{cluster="a",es_cluster="search",job="elasticsearch",instance="${instance}",color="red"}`, values);
const nginxLabels = {cluster: 'a', route: 'search'};
const nginxInput = (errors, success) => [
  sample('site_nginx_requests_total{cluster="a",job="nginx-log",instance="g1",route="search",status_class="5xx"}', errors),
  sample('site_nginx_requests_total{cluster="a",job="nginx-log",instance="g1",route="search",status_class="2xx"}', success),
];

const tests = [
  testAlert('Redis sustained pressure and recovery', redisInput('95+0x12 50+0x20', '100+0x40'), 'RedisMemoryBudgetPressure', [['9m', []], ['11m', [redisLabels]], ['14m', []]]),
  testAlert('Redis maxmemory zero is not zero capacity', redisInput('95+0x40', '0+0x40'), 'RedisMemoryBudgetPressure', [['20m', []]]),
  testAlert('Redis strict threshold boundary', redisInput('90+0x40', '100+0x40'), 'RedisMemoryBudgetPressure', [['20m', []]]),
  testAlert('PostgreSQL old idle transaction persists then clears', pgAge('400+0x8 0+0x20'), 'PostgreSQLIdleTransactionTooOld', [['4m', []], ['6m', [pgLabels]], ['10m', []]]),
  testAlert('PostgreSQL active transaction is a different policy', [sample('pg_stat_activity_max_tx_duration{cluster="a",instance="p:5432",job="postgres",datname="app",state="active"}', '500+0x30')], 'PostgreSQLIdleTransactionTooOld', [['20m', []]]),
  testAlert('PostgreSQL deleted state is not a stuck transaction', pgAge('400+0x2 stale _x20'), 'PostgreSQLIdleTransactionTooOld', [['10m', []]]),
  testAlert('Kafka below min ISR persists then recovers', kafkaMin('1+0x4 0+0x15'), 'KafkaPartitionBelowMinISR', [['1m', []], ['3m', [kafkaLabels]], ['6m', []]]),
  testAlert('Kafka URP alone does not mean below min ISR', [sample('kafka_broker_under_replicated_partitions{cluster="a",kafka_cluster="events",instance="b:7071",job="kafka-jmx"}', '1+0x20'), ...kafkaMin('0+0x20')], 'KafkaPartitionBelowMinISR', [['10m', []]]),
  testAlert('Elasticsearch duplicate health endpoints produce one alert', [esRed('e1', '1+0x20'), esRed('e2', '1+0x20')], 'ElasticsearchPrimaryShardUnavailable', [['1m', []], ['3m', [esLabels]]]),
  testAlert('Elasticsearch health recovery', [esRed('e1', '1+0x4 0+0x20')], 'ElasticsearchPrimaryShardUnavailable', [['3m', [esLabels]], ['6m', []]]),
  testAlert('Elasticsearch cluster identity remains separate', [esRed('e1', '1+0x20'), sample('elasticsearch_cluster_health_status{cluster="b",es_cluster="search",job="elasticsearch",instance="e1",color="red"}', '0+0x20')], 'ElasticsearchPrimaryShardUnavailable', [['3m', [esLabels]]]),
  testAlert('Nginx 2 percent final server errors', nginxInput('0+12x30', '0+588x30'), 'NginxRouteServerErrors', [['8m', [nginxLabels]]]),
  testAlert('Nginx no traffic is not an error percentage', nginxInput('0+0x30', '0+0x30'), 'NginxRouteServerErrors', [['20m', []]]),
  testAlert('Nginx low traffic is handled separately', nginxInput('0+1x30', '0+5x30'), 'NginxRouteServerErrors', [['20m', []]]),
  testAlert('Nginx missing error series does not fabricate failure', nginxInput('0+0x30', '0+600x30').slice(1), 'NginxRouteServerErrors', [['20m', []]]),
];
function exprContaining(text) {
  const item = expressions.find(item => item.expr.includes(text));
  assert(item, text);
  return item.expr;
}
function testExpression(name, needle, input, expected) {
  tests.push({name, interval: '1m', input_series: input, promql_expr_test: [{expr: exprContaining(needle), eval_time: '10m', exp_samples: expected}]});
}
testExpression('Redis mean command execution uses seconds', 'redis_commands_duration_seconds_total', [
  sample('redis_commands_duration_seconds_total{cluster="a",instance="r",job="redis",cmd="get"}', '0+6x20'),
  sample('redis_commands_total{cluster="a",instance="r",job="redis",cmd="get"}', '0+600x20'),
], [{labels: '{cluster="a",instance="r",job="redis",cmd="get"}', value: 0.01}]);
testExpression('Redis no lookups is not 100 percent hit rate', 'redis_keyspace_hits_total', [
  sample('redis_keyspace_hits_total{cluster="a",instance="r",job="redis"}', '0+0x20'),
  sample('redis_keyspace_misses_total{cluster="a",instance="r",job="redis"}', '0+0x20'),
], []);
testExpression('PostgreSQL buffer hit ratio', 'pg_stat_database_blks_hit', [
  sample('pg_stat_database_blks_hit{cluster="a",instance="p",job="postgres",datname="app"}', '0+540x20'),
  sample('pg_stat_database_blks_read{cluster="a",instance="p",job="postgres",datname="app"}', '0+60x20'),
], [{labels: '{cluster="a",instance="p",job="postgres",datname="app"}', value: 0.9}]);
testExpression('Kafka uncommitted partition is excluded from known lag', 'kafka_consumergroup_lag', [
  sample('kafka_consumergroup_lag{cluster="a",kafka_cluster="events",job="kafka-offset",consumergroup="g",topic="t",partition="0"}', '100+0x20'),
  sample('kafka_consumergroup_current_offset{cluster="a",kafka_cluster="events",job="kafka-offset",consumergroup="g",topic="t",partition="0"}', '-1+0x20'),
  sample('kafka_consumergroup_lag{cluster="a",kafka_cluster="events",job="kafka-offset",consumergroup="g",topic="t",partition="1"}', '20+0x20'),
  sample('kafka_consumergroup_current_offset{cluster="a",kafka_cluster="events",job="kafka-offset",consumergroup="g",topic="t",partition="1"}', '1000+0x20'),
], [{labels: '{cluster="a",kafka_cluster="events",consumergroup="g",topic="t"}', value: 20}]);
testExpression('Elasticsearch average shard time is in seconds', 'elasticsearch_indices_search_query_time_seconds', [
  sample('elasticsearch_indices_search_query_time_seconds{cluster="a",es_cluster="search",job="elasticsearch",name="n1"}', '0+12x20'),
  sample('elasticsearch_indices_search_query_total{cluster="a",es_cluster="search",job="elasticsearch",name="n1"}', '0+600x20'),
], [{labels: '{cluster="a",es_cluster="search",name="n1"}', value: 0.02}]);
testExpression('Nginx log histogram produces seconds', 'site_nginx_request_duration_seconds_bucket', [
  ...['0', '0.5', '+Inf'].map(le => sample(`site_nginx_request_duration_seconds_bucket{cluster="a",job="nginx-log",route="search",le="${le}"}`, le === '0' ? '0+0x20' : '0+600x20')),
], [{labels: '{cluster="a",route="search"}', value: 0.495}]);

// These are canonical formatted MBean strings, not a live JVM integration test.
const jmxCases = [
  ['kafka.server<type=ReplicaManager, name=UnderReplicatedPartitions><>Value', 3, 'kafka_broker_under_replicated_partitions', 3, {}],
  ['kafka.server<type=ReplicaManager, name=UnderMinIsrPartitionCount><>Value', 1, 'kafka_broker_under_min_isr_partitions', 1, {}],
  ['kafka.server<type=BrokerTopicMetrics, name=MessagesInPerSec><>Count', 600, 'kafka_broker_messages_in_total', 600, {}],
  ['kafka.server<type=BrokerTopicMetrics, name=BytesInPerSec><>Count', 1024, 'kafka_broker_bytes_total', 1024, {direction: 'In'}],
  ['kafka.server<type=BrokerTopicMetrics, name=BytesOutPerSec><>Count', 2048, 'kafka_broker_bytes_total', 2048, {direction: 'Out'}],
  ['kafka.network<type=RequestChannel, name=RequestQueueSize><>Value', 7, 'kafka_broker_request_queue_size', 7, {}],
  ['kafka.controller<type=KafkaController, name=ActiveControllerCount><>Value', 1, 'kafka_controller_active', 1, {}],
  ['kafka.controller<type=KafkaController, name=OfflinePartitionsCount><>Value', 0, 'kafka_controller_offline_partitions', 0, {}],
  ['kafka.controller<type=KafkaController, name=LastAppliedRecordLagMs><>Value', 120, 'kafka_controller_metadata_apply_lag_seconds', 0.12, {}],
  ['kafka.network<type=RequestMetrics, name=TotalTimeMs, request=Produce><>99thPercentile', 120, 'kafka_request_duration_p99_seconds', 0.12, {request: 'Produce'}],
];
for (const [input, value, name, expected, labels] of jmxCases) {
  const matched = jmx.map(rule => ({rule, match: new RegExp(rule.pattern).exec(input)})).filter(item => item.match);
  assert.equal(matched.length, 1, input);
  const {rule, match} = matched[0];
  assert.equal(rule.name, name);
  assert.equal(value * (rule.valueFactor ?? 1), expected);
  const mapped = Object.fromEntries(Object.entries(rule.labels ?? {}).map(([key, val]) => [key, val.replace(/\$(\d+)/g, (_, n) => match[Number(n)])]));
  assert.deepEqual(mapped, labels);
}
assert(!jmx.some(rule => new RegExp(rule.pattern).test('kafka.server<type=BrokerTopicMetrics, name=MessagesInPerSec, topic=t><>Count')), 'Do not double-count topic and global metrics');

console.log(`MDX/YAML: ${files.length} articles; ${diagrams} Mermaid fences; ${jmxCases.length + 1} JMX mapping checks`);
console.log(run(['--version']));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'monitoring-second-check-'));
const rulesFile = path.join(temporary, 'rules.yaml'), testsFile = path.join(temporary, 'tests.yaml');
try {
  fs.writeFileSync(rulesFile, yaml.dump({groups: [...groups, {name: 'article-query-syntax', rules: expressions.map((item, n) => ({record: `second_article_check_${n}`, expr: item.expr}))}]}));
  fs.writeFileSync(testsFile, yaml.dump({rule_files: [rulesFile], evaluation_interval: '1m', tests}));
  console.log(run(['check', 'rules', rulesFile]));
  console.log(run(['test', 'rules', testsFile]));
  console.log(`PASS: ${expressions.length} PromQL blocks, ${alerts.size} alerts, ${tests.length} synthetic test groups`);
  console.log('Scope: no live Redis/PostgreSQL/Kafka/Elasticsearch/Nginx, JMX agent or log-pipeline integration test.');
} finally {
  for (const generated of [rulesFile, testsFile]) if (fs.existsSync(generated)) fs.unlinkSync(generated);
  fs.rmdirSync(temporary);
}
