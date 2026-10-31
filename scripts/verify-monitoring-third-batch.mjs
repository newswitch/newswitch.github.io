import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import yaml from 'js-yaml';
import {compile} from '@mdx-js/mdx';

// Extract the actual article rules: do not maintain a second copy of expressions.
// node scripts/verify-monitoring-third-batch.mjs --promtool /path/to/promtool
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'docs/data-systems/messaging/rabbitmq/04-production/15-RabbitMQ核心监控指标采集与告警.md',
  'docs/data-systems/messaging/rocketmq/04-production/15-RocketMQ核心监控指标采集与告警.md',
  'docs/data-systems/analytics/clickhouse/04-production/17-ClickHouse核心监控指标采集与告警.md',
  'docs/development/java/04-jvm/10-JVM核心监控指标采集与告警.md',
  'docs/storage/ceph/05-operations/31-Ceph核心监控指标采集与告警.md',
  'docs/storage/nfs/07-NFS核心监控指标采集与告警.md',
  'docs/storage/object-storage/minio/14-MinIO核心监控指标采集与告警.md',
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

const rabbitLabels = {cluster: 'a', rabbitmq_cluster: 'r', vhost: 'orders', queue: 'payments'};
const rabbit = (ready, consumers, instance = 'r1') => [
  sample(`rabbitmq_detailed_queue_messages_ready{cluster="a",rabbitmq_cluster="r",job="rabbitmq-queues",instance="${instance}",vhost="orders",queue="payments"}`, ready),
  sample(`rabbitmq_detailed_queue_consumers{cluster="a",rabbitmq_cluster="r",job="rabbitmq-queues",instance="${instance}",vhost="orders",queue="payments"}`, consumers),
];
const rocketLabels = {cluster: 'a', rocketmq_cluster: 'r', topic: 't', consumer_group: 'g'};
const rocket = (age, lag) => [
  sample('rocketmq_consumer_lag_latency_milliseconds{cluster="a",rocketmq_cluster="r",job="rocketmq-broker",topic="t",consumer_group="g",is_retry="false",is_system="false"}', age),
  sample('rocketmq_consumer_lag_messages{cluster="a",rocketmq_cluster="r",job="rocketmq-broker",topic="t",consumer_group="g",is_retry="false",is_system="false"}', lag),
];
const clickLabels = {cluster: 'a', clickhouse_cluster: 'c', instance: 'c1', job: 'clickhouse'};
const click = values => [sample('ClickHouseProfileEvents_RejectedInserts{cluster="a",clickhouse_cluster="c",instance="c1",job="clickhouse"}', values)];
const jvmLabels = {cluster: 'a', instance: 'j1'};
const jvm = values => [sample('jvm_gc_pause_seconds_sum{cluster="a",instance="j1",job="jvm",action="end",cause="allocation"}', values)];
const cephLabels = {cluster: 'a', ceph_cluster: 'c'};
const ceph = (instance, values) => sample(`ceph_health_status{cluster="a",ceph_cluster="c",instance="${instance}",job="ceph-mgr"}`, values);
const nfsLabels = {cluster: 'a', instance: 'n1', job: 'nfs-client', export: 'nas:/data', protocol: 'tcp', mountaddr: '10.0.0.1', operation: 'READ'};
const nfs = (time, requests) => [
  sample('node_mountstats_nfs_operations_request_time_seconds_total{cluster="a",instance="n1",job="nfs-client",export="nas:/data",protocol="tcp",mountaddr="10.0.0.1",operation="READ"}', time),
  sample('node_mountstats_nfs_operations_requests_total{cluster="a",instance="n1",job="nfs-client",export="nas:/data",protocol="tcp",mountaddr="10.0.0.1",operation="READ"}', requests),
];
const minioLabels = {cluster: 'a', minio_cluster: 'm'};
const minio = (instance, values) => sample(`minio_cluster_health_drives_offline_count{cluster="a",minio_cluster="m",instance="${instance}",job="minio-cluster"}`, values);

const tests = [
  testAlert('RabbitMQ persistent no consumer and recovery', rabbit('10+0x30', '0+0x8 2+0x20'), 'RabbitMQQueueWithoutConsumer', [['4m', []], ['6m', [rabbitLabels]], ['10m', []]]),
  testAlert('RabbitMQ idle queue is a different policy', rabbit('0+0x30', '0+0x30'), 'RabbitMQQueueWithoutConsumer', [['10m', []]]),
  testAlert('RabbitMQ missing consumer series is not zero', rabbit('10+0x30', '0+0x30').slice(0, 1), 'RabbitMQQueueWithoutConsumer', [['10m', []]]),
  testAlert('RabbitMQ duplicate views do not add consumer counts', [...rabbit('10+0x30', '0+0x30'), ...rabbit('10+0x30', '2+0x30', 'r2')], 'RabbitMQQueueWithoutConsumer', [['10m', []]]),
  testAlert('RocketMQ old backlog persists then clears', rocket('70000+0x30', '10+0x8 0+0x20'), 'RocketMQConsumerTooOld', [['4m', []], ['6m', [rocketLabels]], ['10m', []]]),
  testAlert('RocketMQ strict 60 second boundary', rocket('60000+0x30', '10+0x30'), 'RocketMQConsumerTooOld', [['10m', []]]),
  testAlert('RocketMQ old timestamp without lag is excluded', rocket('70000+0x30', '0+0x30'), 'RocketMQConsumerTooOld', [['10m', []]]),
  testAlert('RocketMQ missing age is not a healthy zero', rocket('70000+0x30', '10+0x30').slice(1), 'RocketMQConsumerTooOld', [['10m', []]]),
  testAlert('ClickHouse rejection counter and recovery', click('0+60x10 600+0x20'), 'ClickHouseRejectedInserts', [['4m', []], ['7m', [clickLabels]], ['18m', []]]),
  testAlert('ClickHouse no new rejection', click('600+0x30'), 'ClickHouseRejectedInserts', [['20m', []]]),
  // Initial rate windows need to fill before the sustained-condition timer starts.
  testAlert('JVM observed pause pressure and recovery', jvm('0+12x15 180+0x20'), 'JVMObservedGCPausePressure', [['9m', []], ['14m', [jvmLabels]], ['22m', []]]),
  testAlert('JVM no pauses', jvm('0+0x30'), 'JVMObservedGCPausePressure', [['20m', []]]),
  testAlert('Ceph duplicate ERR endpoints produce one alert', [ceph('m1', '2+0x20'), ceph('m2', '2+0x20')], 'CephHealthError', [['1m', []], ['3m', [cephLabels]]]),
  testAlert('Ceph ERR recovery', [ceph('m1', '2+0x6 0+0x20')], 'CephHealthError', [['3m', [cephLabels]], ['8m', []]]),
  testAlert('Ceph WARN needs another policy', [ceph('m1', '1+0x20')], 'CephHealthError', [['10m', []]]),
  testAlert('NFS slow READ with enough traffic', nfs('0+12x30', '0+120x30'), 'NFSClientReadSlow', [['4m', []], ['9m', [nfsLabels]]]),
  testAlert('NFS zero RPC is not a latency sample', nfs('0+0x30', '0+0x30'), 'NFSClientReadSlow', [['20m', []]]),
  testAlert('NFS low traffic separate policy', nfs('0+3x30', '0+30x30'), 'NFSClientReadSlow', [['20m', []]]),
  testAlert('MinIO duplicate cluster views produce one alert', [minio('m1', '1+0x30'), minio('m2', '1+0x30')], 'MinIODriveOffline', [['4m', []], ['6m', [minioLabels]]]),
  testAlert('MinIO offline recovery', [minio('m1', '1+0x8 0+0x20')], 'MinIODriveOffline', [['6m', [minioLabels]], ['10m', []]]),
  testAlert('MinIO healing state is not offline count', [minio('m1', '0+0x20'), sample('minio_system_drive_health{cluster="a",minio_cluster="m",instance="m1",job="minio-drive",drive="d1"}', '2+0x20')], 'MinIODriveOffline', [['10m', []]]),
];
function expression(needle) {
  const found = expressions.filter(item => item.expr.includes(needle));
  assert.equal(found.length, 1, `Choose a unique article expression: ${needle}`);
  return found[0].expr;
}
function testExpression(name, needle, input, expected, time = '10m') {
  tests.push({name, interval: '1m', input_series: input, promql_expr_test: [{expr: expression(needle), eval_time: time, exp_samples: expected}]});
}

testExpression('RabbitMQ ready view is not replica sum', 'queue_messages_ready', [...rabbit('10+0x20', '1+0x20'), ...rabbit('10+0x20', '1+0x20', 'r2')], [{labels: '{cluster="a",rabbitmq_cluster="r",vhost="orders",queue="payments"}', value: 10}]);
testExpression('RocketMQ milliseconds converted to seconds', 'rocketmq_consumer_lag_latency_milliseconds', rocket('70000+0x20', '10+0x20'), [{labels: '{cluster="a",rocketmq_cluster="r",topic="t",consumer_group="g"}', value: 70}]);
testExpression('RocketMQ incoming messages do not have the lag-only is_retry label', 'rocketmq_messages_in_total', [
  sample('rocketmq_messages_in_total{cluster="a",rocketmq_cluster="r",job="rocketmq-broker",node_id="b1",topic="t",message_type="normal",is_system="false"}', '0+600x20'),
], [{labels: '{cluster="a",rocketmq_cluster="r",topic="t"}', value: 10}]);
const clickTimes = (duration, count) => [
  sample('ClickHouseProfileEvents_QueryTimeMicroseconds{cluster="a",instance="c1",job="clickhouse"}', duration),
  sample('ClickHouseProfileEvents_Query{cluster="a",instance="c1",job="clickhouse"}', count),
];
testExpression('ClickHouse microseconds converted to seconds', 'QueryTimeMicroseconds', clickTimes('0+12000000x20', '0+600x20'), [{labels: '{cluster="a",instance="c1",job="clickhouse"}', value: 0.02}]);
testExpression('ClickHouse zero queries excluded', 'QueryTimeMicroseconds', clickTimes('0+0x20', '0+0x20'), []);
testExpression('ClickHouse counter reset does not create negative rejection rate', 'RejectedInserts', click('0+60x10 0+60x10'), [{labels: '{cluster="a",clickhouse_cluster="c",instance="c1",job="clickhouse"}', value: 1}], '20m');
const memory = (used, max) => [
  sample('jvm_memory_used_bytes{cluster="a",instance="j1",job="jvm",area="heap",id="old"}', used),
  sample('jvm_memory_max_bytes{cluster="a",instance="j1",job="jvm",area="heap",id="old"}', max),
];
testExpression('JVM unknown pool max excluded', 'jvm_memory_max_bytes', memory('50+0x20', '-1+0x20'), []);
testExpression('JVM known pool ratio', 'jvm_memory_max_bytes', memory('50+0x20', '100+0x20'), [{labels: '{cluster="a",instance="j1",job="jvm",area="heap",id="old"}', value: 0.5}]);
testExpression('Ceph latency sum uses seconds before milliseconds conversion', 'ceph_osd_op_r_latency_sum', [
  sample('ceph_osd_op_r_latency_sum{cluster="a",ceph_cluster="c",job="ceph-daemon",ceph_daemon="osd.1"}', '0+12x20'),
  sample('ceph_osd_op_r_latency_count{cluster="a",ceph_cluster="c",job="ceph-daemon",ceph_daemon="osd.1"}', '0+600x20'),
], [{labels: '{cluster="a",ceph_cluster="c",job="ceph-daemon",ceph_daemon="osd.1"}', value: 20}]);
testExpression('NFS request average is already seconds', 'operations_request_time_seconds_total', nfs('0+12x20', '0+120x20'), [{labels: '{cluster="a",instance="n1",job="nfs-client",export="nas:/data",protocol="tcp",mountaddr="10.0.0.1",operation="READ"}', value: 0.1}]);
const minioTraffic = (errors, requests) => [
  sample('minio_api_requests_5xx_errors_total{cluster="a",minio_cluster="m",instance="m1",job="minio-api",name="GetObject",type="s3"}', errors),
  sample('minio_api_requests_total{cluster="a",minio_cluster="m",instance="m1",job="minio-api",name="GetObject",type="s3"}', requests),
];
testExpression('MinIO no traffic excluded', 'minio_api_requests_5xx_errors_total', minioTraffic('0+0x20', '0+0x20'), []);
testExpression('MinIO API server error ratio', 'minio_api_requests_5xx_errors_total', minioTraffic('0+6x20', '0+600x20'), [{labels: '{cluster="a",minio_cluster="m",name="GetObject"}', value: 0.01}]);
testExpression('MinIO custom le counter supports complete-bucket fixture', 'ttfb_seconds_distribution', ['0', '0.5', '+Inf'].map(le => sample(`minio_api_requests_ttfb_seconds_distribution{cluster="a",minio_cluster="m",instance="m1",job="minio-api",name="GetObject",type="s3",le="${le}"}`, le === '0' ? '0+0x20' : '0+600x20')), [{labels: '{cluster="a",minio_cluster="m",name="GetObject"}', value: 0.495}]);
testExpression('MinIO duplicate offline views are not summed', 'minio_cluster_health_drives_offline_count', [minio('m1', '1+0x20'), minio('m2', '1+0x20')], [{labels: '{cluster="a",minio_cluster="m"}', value: 1}]);

console.log(`MDX/YAML: ${files.length} articles; ${diagrams} Mermaid fences`);
console.log(run(['--version']));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'monitoring-third-check-'));
const rulesFile = path.join(temporary, 'rules.yaml'), testsFile = path.join(temporary, 'tests.yaml');
try {
  fs.writeFileSync(rulesFile, yaml.dump({groups: [...groups, {name: 'article-query-syntax', rules: expressions.map((item, n) => ({record: `third_article_check_${n}`, expr: item.expr}))}]}));
  fs.writeFileSync(testsFile, yaml.dump({rule_files: [rulesFile], evaluation_interval: '1m', tests}));
  console.log(run(['check', 'rules', rulesFile]));
  console.log(run(['test', 'rules', testsFile]));
  console.log(`PASS: ${expressions.length} PromQL blocks, ${alerts.size} alerts, ${tests.length} synthetic test groups`);
  console.log('Scope: synthetic series only; no live brokers, ClickHouse, JVM binders, Ceph, NFS namespaces or MinIO endpoint integration.');
} finally {
  for (const generated of [rulesFile, testsFile]) if (fs.existsSync(generated)) fs.unlinkSync(generated);
  fs.rmdirSync(temporary);
}
