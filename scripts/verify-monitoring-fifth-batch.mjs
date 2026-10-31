import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import yaml from 'js-yaml';
import {compile} from '@mdx-js/mdx';

// Extract the actual article rules: do not maintain a second copy of expressions.
// node scripts/verify-monitoring-fifth-batch.mjs --promtool /path/to/promtool
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  "docs/data-systems/messaging/pulsar/03-Pulsar核心监控指标采集与告警.md",
  "docs/data-systems/analytics/doris/03-Doris核心监控指标采集与告警.md",
  "docs/data-systems/analytics/olap/05-Trino核心监控指标采集与告警.md",
  "docs/data-systems/big-data/flink/08-Flink核心监控指标采集与告警.md",
  "docs/data-systems/big-data/spark/08-Spark核心监控指标采集与告警.md",
  "docs/networking/services/dns/04-CoreDNS核心监控指标采集与告警.md",
  "docs/networking/security/tls-pki/04-operations/20-TLS证书监控指标与轮换告警.md"
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
assert.equal(alerts.size, 9);
const sample = (series, values) => ({series, values});
const firing = (alert, labels) => ({exp_labels: {...labels, ...alerts.get(alert).labels}, exp_annotations: alerts.get(alert).annotations});
const testAlert = (name, input, alert, checks) => ({name, interval: '1m', input_series: input,
  alert_rule_test: checks.map(([time, labels]) => ({eval_time: time, alertname: alert, exp_alerts: labels.map(l => firing(alert, l))}))});


const metric = (name, labels, values) => sample(name + '{' + Object.entries(labels).map(([k, v]) => k + '=' + JSON.stringify(v)).join(',') + '}', values);
const want = (labels, value) => ({labels: '{' + Object.entries(labels).map(([k, v]) => k + '=' + JSON.stringify(v)).join(',') + '}', value});
const pLabels = {cluster: 'a', pulsar_cluster: 'p', namespace: 'app/orders', topic: 'persistent://app/orders/t', partition: '0', subscription: 'payments'};
const pulsar = (backlog, consumers, instance = 'b1') => [
  metric('pulsar_subscription_back_log', {...pLabels, job: 'pulsar-broker', instance}, backlog),
  ...(consumers === null ? [] : [metric('pulsar_subscription_consumers_count', {...pLabels, job: 'pulsar-broker', instance}, consumers)]),
];
const dLabels = {cluster: 'a', doris_cluster: 'd', instance: 'b1', job: 'doris-be', path: '/data'};
const doris = (free, total) => [
  metric('doris_be_disks_avail_capacity', dLabels, free),
  ...(total === null ? [] : [metric('doris_be_disks_total_capacity', dLabels, total)]),
];
const tLabels = {cluster: 'a', trino_cluster: 't', instance: 'c1', job: 'trino-state'};
const trino = (age, success, updated) => [
  metric('site_trino_longest_queued_query_seconds', tLabels, age),
  metric('site_trino_collector_success', tLabels, success),
  metric('site_trino_collector_last_success_timestamp_seconds', tLabels, updated),
];
const fLabels = {cluster: 'a', flink_cluster: 'f', instance: 'jm1', job: 'flink-jobmanager', job_name: 'orders', job_id: 'j1'};
const flink = values => [metric('flink_jobmanager_job_lastCheckpointCompletedTimestamp', fLabels, values)];
const sLabels = {cluster: 'a', spark_cluster: 's', instance: 'driver1', job: 'spark-executors', application_id: 'app-1', application_name: 'etl', executor_id: '1'};
const spark = values => [metric('metrics_executor_failedTasks_total', sLabels, values)];
const dnsLabels = {cluster: 'a', dns_cluster: 'dns', instance: 'd1'};
const dns = (errors, success) => [
  metric('coredns_dns_responses_total', {...dnsLabels, job: 'coredns', zone: '.', rcode: 'SERVFAIL'}, errors),
  metric('coredns_dns_responses_total', {...dnsLabels, job: 'coredns', zone: '.', rcode: 'NOERROR'}, success),
];
const tlsLabels = {cluster: 'a', instance: 'https://api.example/health', job: 'tls-probe'};
const tls = (expiry, success) => [
  metric('probe_ssl_earliest_cert_expiry', tlsLabels, expiry),
  metric('probe_success', tlsLabels, success),
];
const certLabels = {cluster: 'a', namespace: 'app', name: 'api'};
const cert = (ready, instance = 'cm1') => [metric('certmanager_certificate_ready_status', {...certLabels, instance, job: 'cert-manager', condition: 'True', issuer_name: 'ca', issuer_kind: 'Issuer', issuer_group: 'cert-manager.io'}, ready)];

const tests = [
  testAlert('Pulsar no consumer persists and recovers', pulsar('10+0x30', '0+0x8 1+0x20'), 'PulsarSubscriptionWithoutConsumer', [['4m', []], ['6m', [pLabels]], ['10m', []]]),
  testAlert('Pulsar empty subscription excluded', pulsar('0+0x30', '0+0x30'), 'PulsarSubscriptionWithoutConsumer', [['20m', []]]),
  testAlert('Pulsar missing consumers is not zero', pulsar('10+0x30', null), 'PulsarSubscriptionWithoutConsumer', [['20m', []]]),
  testAlert('Pulsar duplicate owner views do not duplicate alert', [...pulsar('10+0x30', '0+0x30'), ...pulsar('10+0x30', '0+0x30', 'b2')], 'PulsarSubscriptionWithoutConsumer', [['6m', [pLabels]]]),
  testAlert('Doris low disk and recovery', doris('5+0x12 50+0x20', '100+0x40'), 'DorisDataDirectoryLowSpace', [['9m', []], ['11m', [dLabels]], ['15m', []]]),
  testAlert('Doris zero total excluded', doris('0+0x30', '0+0x30'), 'DorisDataDirectoryLowSpace', [['20m', []]]),
  testAlert('Doris missing total excluded', doris('5+0x30', null), 'DorisDataDirectoryLowSpace', [['20m', []]]),
  testAlert('Doris strict ten percent boundary', doris('10+0x30', '100+0x30'), 'DorisDataDirectoryLowSpace', [['20m', []]]),
  testAlert('Trino old queue with fresh collector then stale', trino('90+0x30', '1+0x30', '0+60x8 480+0x25'), 'TrinoQueuedQueryTooOld', [['4m', []], ['6m', [tLabels]], ['11m', []]]),
  testAlert('Trino failed collector not business zero', trino('90+0x30', '0+0x30', '0+60x30'), 'TrinoQueuedQueryTooOld', [['20m', []]]),
  testAlert('Trino queue exact boundary', trino('60+0x30', '1+0x30', '0+60x30'), 'TrinoQueuedQueryTooOld', [['20m', []]]),
  testAlert('Flink checkpoint ages and then progresses', flink('1000+0x11 720000+60000x20'), 'FlinkCheckpointTooOld', [['5m', []], ['9m', [fLabels]], ['13m', []]]),
  testAlert('Flink never completed timestamp negative excluded', flink('-1+0x30'), 'FlinkCheckpointTooOld', [['20m', []]]),
  testAlert('Flink never completed timestamp zero excluded', flink('0+0x30'), 'FlinkCheckpointTooOld', [['20m', []]]),
  testAlert('Spark active executor failures and recovery', spark('0+60x12 720+0x20'), 'SparkExecutorTaskFailures', [['4m', []], ['7m', [sLabels]], ['22m', []]]),
  testAlert('Spark Driver row excluded', [metric('metrics_executor_failedTasks_total', {...sLabels, executor_id: 'driver'}, '0+60x30')], 'SparkExecutorTaskFailures', [['20m', []]]),
  testAlert('CoreDNS sustained SERVFAIL and recovery', dns('0+120x12 1440+0x25', '0+5880x40'), 'CoreDNSServfailRatio', [['4m', []], ['8m', [dnsLabels]], ['22m', []]]),
  testAlert('CoreDNS no traffic excluded', dns('0+0x30', '0+0x30'), 'CoreDNSServfailRatio', [['20m', []]]),
  testAlert('CoreDNS low traffic separate policy', dns('0+1x30', '0+5x30'), 'CoreDNSServfailRatio', [['20m', []]]),
  testAlert('TLS approaching expiry with verified probe', tls('604800+0x30', '1+0x30'), 'TLSCertificateExpiringSoon', [['9m', []], ['11m', [tlsLabels]]]),
  testAlert('TLS long lifetime excluded', tls('1814400+0x30', '1+0x30'), 'TLSCertificateExpiringSoon', [['20m', []]]),
  testAlert('TLS failed handshake handled by failure policy', tls('604800+0x30', '0+0x30'), 'TLSCertificateExpiringSoon', [['20m', []]]),
  testAlert('TLS invalid zero expiry not fabricated certificate', tls('0+0x30', '1+0x30'), 'TLSCertificateExpiringSoon', [['20m', []]]),
  testAlert('TLS verified probe failure and recovery', tls('604800+0x30', '0+0x5 1+0x20'), 'TLSVerifiedProbeFailed', [['1m', []], ['3m', [tlsLabels]], ['7m', []]]),
  testAlert('TLS successful probe excluded', tls('604800+0x30', '1+0x30'), 'TLSVerifiedProbeFailed', [['20m', []]]),
  testAlert('Certificate not ready then recovered', cert('0+0x16 1+0x20'), 'CertificateManagerNotReady', [['14m', []], ['16m', [certLabels]], ['18m', []]]),
  testAlert('Certificate duplicate ready view not sum', [...cert('0+0x30'), ...cert('0+0x30', 'cm2')], 'CertificateManagerNotReady', [['16m', [certLabels]]]),
  testAlert('Certificate True zero checked independently from False one', [...cert('0+0x30'), metric('certmanager_certificate_ready_status', {...certLabels, instance: 'cm1', job: 'cert-manager', condition: 'False'}, '1+0x30')], 'CertificateManagerNotReady', [['16m', [certLabels]]]),
];
function expression(needle) {
  const found = expressions.filter(item => item.expr.includes(needle));
  assert.equal(found.length, 1, 'Choose a unique article expression: ' + needle);
  return found[0].expr;
}
function testExpression(name, needle, input, expected, time = '10m') {
  tests.push({name, interval: '1m', input_series: input, promql_expr_test: [{expr: expression(needle), eval_time: time, exp_samples: expected}]});
}
testExpression('Pulsar precomputed rate is read as gauge', 'pulsar_rate_in', [
  metric('pulsar_rate_in', {cluster: 'a', pulsar_cluster: 'p', namespace: 'app/orders', topic: 't', job: 'pulsar-broker', instance: 'b1'}, '100+0x20'),
], [want({cluster: 'a', pulsar_cluster: 'p', namespace: 'app/orders'}, 100)]);
testExpression('Doris global query excludes per-user duplicate', 'doris_fe_query_total', [
  metric('doris_fe_query_total', {cluster: 'a', doris_cluster: 'd', instance: 'fe1', job: 'doris-fe'}, '0+600x20'),
  metric('doris_fe_query_total', {cluster: 'a', doris_cluster: 'd', instance: 'fe1', job: 'doris-fe', user: 'app'}, '0+600x20'),
], [want({cluster: 'a', doris_cluster: 'd', instance: 'fe1'}, 10)]);
testExpression('Trino queue state remains a gauge', 'site_trino_queries', [
  metric('site_trino_queries', {...tLabels, state: 'QUEUED'}, '5+0x20'),
], [want({__name__: 'site_trino_queries', ...tLabels, state: 'QUEUED'}, 5)]);
testExpression('Flink checkpoint timestamp milliseconds converted once', 'flink_jobmanager_job_lastCheckpointCompletedTimestamp', flink('1000+0x20'), [want(fLabels, 599)]);
testExpression('Flink last duration milliseconds converted once', 'flink_jobmanager_job_lastCheckpointDuration', [
  metric('flink_jobmanager_job_lastCheckpointDuration', fLabels, '2000+0x20'),
], [want(fLabels, 2)]);
testExpression('Spark counter reset handled before aggregation', 'metrics_executor_failedTasks_total', [
  metric('metrics_executor_failedTasks_total', sLabels, '0+60x10 0+60x10'),
], [want(sLabels, 1)], '20m');
testExpression('Spark Shuffle bytes per second', 'metrics_executor_totalShuffleRead_bytes_total', [
  metric('metrics_executor_totalShuffleRead_bytes_total', sLabels, '0+6000x20'),
], [want({cluster: 'a', spark_cluster: 's', application_id: 'app-1', application_name: 'etl'}, 100)]);
testExpression('CoreDNS SERVFAIL response denominator', 'coredns_dns_responses_total', dns('0+120x20', '0+5880x20'), [want(dnsLabels, 0.02)]);
function buckets(name, labels) {
  return ['0', '0.5', '+Inf'].map(le => metric(name, {...labels, le}, le === '0' ? '0+0x20' : '0+600x20'));
}
testExpression('CoreDNS request histogram uses seconds', 'coredns_dns_request_duration_seconds_bucket',
  buckets('coredns_dns_request_duration_seconds_bucket', {...dnsLabels, job: 'coredns', zone: '.', type: 'A'}),
  [want({...dnsLabels, type: 'A'}, 0.495)]);
testExpression('CoreDNS Forward histogram uses seconds', 'coredns_proxy_request_duration_seconds_bucket',
  buckets('coredns_proxy_request_duration_seconds_bucket', {...dnsLabels, job: 'coredns', proxy_name: 'forward', to: '10.0.0.1:53'}),
  [want({...dnsLabels, to: '10.0.0.1:53'}, 0.495)]);
testExpression('TLS Unix seconds remaining days', 'probe_ssl_earliest_cert_expiry', tls('604800+0x20', '1+0x20'), [want(tlsLabels, 604200 / 86400)]);
testExpression('Certificate ready views are not summed', 'certmanager_certificate_ready_status', [...cert('1+0x20'), ...cert('1+0x20', 'cm2')], [want(certLabels, 1)]);

console.log(`MDX/YAML: ${files.length} articles; ${diagrams} Mermaid fences`);
console.log(run(['--version']));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'monitoring-fifth-check-'));
const rulesFile = path.join(temporary, 'rules.yaml'), testsFile = path.join(temporary, 'tests.yaml');
try {
  fs.writeFileSync(rulesFile, yaml.dump({groups: [...groups, {name: 'article-query-syntax', rules: expressions.map((item, n) => ({record: `fifth_article_check_${n}`, expr: item.expr}))}]}));
  fs.writeFileSync(testsFile, yaml.dump({rule_files: [rulesFile], evaluation_interval: '1m', tests}));
  console.log(run(['check', 'rules', rulesFile]));
  console.log(run(['test', 'rules', testsFile]));
  console.log(`PASS: ${expressions.length} PromQL blocks, ${alerts.size} alerts, ${tests.length} synthetic test groups`);
  console.log('Scope: synthetic series only; no live messaging, OLAP, Flink/Spark jobs, DNS, TLS handshake or Trino adapter integration.');
} finally {
  for (const generated of [rulesFile, testsFile]) if (fs.existsSync(generated)) fs.unlinkSync(generated);
  fs.rmdirSync(temporary);
}


