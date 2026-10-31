import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import yaml from 'js-yaml';
import {compile} from '@mdx-js/mdx';

// Run from any directory:
// node scripts/verify-monitoring-first-batch.mjs --promtool /absolute/path/to/promtool
// Extracts the actual article expressions: no second copy of rules to drift.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  'docs/sre/observability/01-主流组件监控指标地图.md',
  'docs/linux/system-internals/13-performance-reliability/10-Linux主机核心监控指标与告警.md',
  'docs/sre/observability/kubernetes/10-Kubernetes监控指标分层与接入清单.md',
  'docs/sre/observability/kubernetes/11-Kubernetes控制面核心指标与告警.md',
  'docs/sre/observability/kubernetes/12-Kubernetes节点工作负载与存储指标.md',
  'docs/data-systems/databases/mysql/05-performance-capacity/07-MySQL核心监控指标采集与告警.md',
  'docs/data-systems/vector-databases/milvus/04-performance-operations/17-Milvus核心监控指标采集与告警.md',
];
const toolArg = process.argv.indexOf('--promtool');
if (toolArg >= 0 && !process.argv[toolArg + 1]) throw new Error('--promtool requires a path');
const promtool = toolArg >= 0 ? path.resolve(process.argv[toolArg + 1]) : 'promtool';
function run(args) {
  const result = spawnSync(promtool, args, {encoding: 'utf8', cwd: root, timeout: 120000});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

const expressions = [];
const groups = [];
let diagrams = 0;
for (const file of files) {
  const source = fs.readFileSync(path.join(root, file), 'utf8').replaceAll('\r\n', '\n');
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`Missing frontmatter: ${file}`);
  const metadata = yaml.load(match[1]);
  if (!match[2].startsWith(`\n# ${metadata.title}\n`)) throw new Error(`Title mismatch: ${file}`);
  await compile(match[2]);
  for (const fence of match[2].matchAll(/^```([^\n]*)\n([\s\S]*?)^```/gm)) {
    if (fence[1] === 'promql') expressions.push({file, expr: fence[2].trim()});
    if (fence[1] === 'mermaid') diagrams++;
    if (fence[1] === 'yaml') {
      const document = yaml.load(fence[2]);
      if (document?.groups) groups.push(...document.groups);
    }
  }
}

const alerts = new Map(groups.flatMap(group => group.rules.map(rule => [rule.alert, rule])));
if (alerts.size !== 5) throw new Error(`Expected five article alerts, got ${alerts.size}`);
const annotationFor = name => alerts.get(name).annotations;
const firing = (name, labels) => ({exp_labels: {...labels, ...alerts.get(name).labels}, exp_annotations: annotationFor(name)});
const podLabels = {cluster: 'a', job: 'kube-state-metrics', namespace: 'demo', pod: 'waiting', uid: 'u1', phase: 'Pending'};
const podSeries = 'kube_pod_status_phase{cluster="a",job="kube-state-metrics",namespace="demo",pod="waiting",uid="u1",phase="Pending"}';
// Arithmetic with on(cluster, instance) keeps only the matching labels.
const mysqlLabels = {cluster: 'a', instance: 'db:3306'};
const mysqlInput = connected => [
  {series: 'mysql_global_status_threads_connected{cluster="a",instance="db:3306",job="mysql"}', values: connected},
  {series: 'mysql_global_variables_max_connections{cluster="a",instance="db:3306",job="mysql"}', values: '100+0x40'},
];
const milvusInput = (fail, total) => [
  {series: 'milvus_proxy_req_count{cluster="a",milvus_cluster="m",job="milvus",function_name="Search",status="fail",cause="system"}', values: fail},
  {series: 'milvus_proxy_req_count{cluster="a",milvus_cluster="m",job="milvus",function_name="Search",status="total"}', values: total},
  {series: 'milvus_proxy_req_count{cluster="a",milvus_cluster="m",job="milvus",function_name="Search",status="success"}', values: '0+588x40'},
];
const diskLabels = {cluster: 'a', instance: 'n:9100', job: 'node-exporter', device: '/dev/vda1', mountpoint: '/data', fstype: 'ext4'};
const diskSuffix = '{cluster="a",instance="n:9100",job="node-exporter",device="/dev/vda1",mountpoint="/data",fstype="ext4"}';
const diskInput = available => [
  {series: `node_filesystem_avail_bytes${diskSuffix}`, values: available},
  {series: `node_filesystem_size_bytes${diskSuffix}`, values: '200000000000+0x400'},
  {series: `node_filesystem_readonly${diskSuffix}`, values: '0+0x400'},
];

const tests = [
  {name: 'Pending must persist; recovery clears', interval: '1m', input_series: [{series: podSeries, values: '1+0x12 0+0x10'}], alert_rule_test: [
    {eval_time: '9m', alertname: 'PodPendingTooLong', exp_alerts: []},
    {eval_time: '11m', alertname: 'PodPendingTooLong', exp_alerts: [firing('PodPendingTooLong', podLabels)]},
    {eval_time: '14m', alertname: 'PodPendingTooLong', exp_alerts: []},
  ]},
  {name: 'Brief Pending is not continuous Pending', interval: '1m', input_series: [{series: podSeries, values: '1+0x2 0+0x15'}], alert_rule_test: [
    {eval_time: '12m', alertname: 'PodPendingTooLong', exp_alerts: []},
  ]},
  {name: 'Deleted object is not a perpetually Pending object', interval: '1m', input_series: [{series: podSeries, values: '1+0x4 stale _x15'}], alert_rule_test: [
    {eval_time: '12m', alertname: 'PodPendingTooLong', exp_alerts: []},
  ]},
  {name: 'MySQL capacity keeps cluster identity', interval: '1m', input_series: [
    ...mysqlInput('90+0x40'),
    {series: 'mysql_global_status_threads_connected{cluster="b",instance="db:3306",job="mysql"}', values: '10+0x40'},
    {series: 'mysql_global_variables_max_connections{cluster="b",instance="db:3306",job="mysql"}', values: '100+0x40'},
  ], alert_rule_test: [
    {eval_time: '9m', alertname: 'MySQLConnectionsNearLimit', exp_alerts: []},
    {eval_time: '11m', alertname: 'MySQLConnectionsNearLimit', exp_alerts: [firing('MySQLConnectionsNearLimit', mysqlLabels)]},
  ]},
  {name: 'MySQL exact boundary and missing denominator do not fire', interval: '1m', input_series: [
    ...mysqlInput('85+0x40'),
    {series: 'mysql_global_status_threads_connected{cluster="c",instance="db:3306",job="mysql"}', values: '99+0x40'},
  ], alert_rule_test: [{eval_time: '20m', alertname: 'MySQLConnectionsNearLimit', exp_alerts: []}]},
  {name: 'MySQL recovery', interval: '1m', input_series: mysqlInput('90+0x11 10+0x20'), alert_rule_test: [
    {eval_time: '11m', alertname: 'MySQLConnectionsNearLimit', exp_alerts: [firing('MySQLConnectionsNearLimit', mysqlLabels)]},
    {eval_time: '13m', alertname: 'MySQLConnectionsNearLimit', exp_alerts: []},
  ]},
  {name: 'etcd leader loss and recovery', interval: '1m', input_series: [
    {series: 'etcd_server_has_leader{cluster="a",instance="e:2379",job="etcd"}', values: '0+0x3 1+0x10'},
  ], alert_rule_test: [
    {eval_time: '2m', alertname: 'EtcdMemberHasNoLeader', exp_alerts: [firing('EtcdMemberHasNoLeader', {cluster: 'a', instance: 'e:2379', job: 'etcd'})]},
    {eval_time: '5m', alertname: 'EtcdMemberHasNoLeader', exp_alerts: []},
  ]},
  {name: 'Milvus hard failure ratio uses total once', interval: '1m', input_series: milvusInput('0+12x40', '0+600x40'), alert_rule_test: [
    {eval_time: '8m', alertname: 'MilvusSearchHardFailures', exp_alerts: [firing('MilvusSearchHardFailures', {cluster: 'a', milvus_cluster: 'm'})]},
  ]},
  {name: 'Milvus no traffic is not a failure percentage', interval: '1m', input_series: milvusInput('0+0x40', '0+0x40'), alert_rule_test: [
    {eval_time: '20m', alertname: 'MilvusSearchHardFailures', exp_alerts: []},
  ]},
  {name: 'Filesystem declining within delivery window', interval: '1m', input_series: diskInput('10000000000-10000000x400'), alert_rule_test: [
    {eval_time: '6h', alertname: 'HostFilesystemMayFill', exp_alerts: [firing('HostFilesystemMayFill', diskLabels)]},
  ]},
  {name: 'Low filesystem space without growth is not predicted fill', interval: '1m', input_series: diskInput('10000000000+0x400'), alert_rule_test: [
    {eval_time: '6h', alertname: 'HostFilesystemMayFill', exp_alerts: []},
  ]},
];

function expressionContaining(text) {
  const found = expressions.find(item => item.expr.includes(text));
  if (!found) throw new Error(`Article expression not found: ${text}`);
  return found.expr;
}
tests.push({name: 'Counter reset handles lost interval and returns to steady rate', interval: '1m', input_series: [
  {series: 'mysql_global_status_questions{cluster="a",instance="db:3306",job="mysql"}', values: '0+600x5 0+600x10'},
], promql_expr_test: [{expr: expressionContaining('rate(mysql_global_status_questions'), eval_time: '10m', exp_samples: [
  {labels: '{cluster="a",instance="db:3306",job="mysql"}', value: 8},
]}, {expr: expressionContaining('rate(mysql_global_status_questions'), eval_time: '12m', exp_samples: [
  {labels: '{cluster="a",instance="db:3306",job="mysql"}', value: 10},
]}]});
tests.push({name: 'PSI seconds to time percentage', interval: '1m', input_series: [
  {series: 'node_pressure_cpu_waiting_seconds_total{cluster="a",instance="n:9100",job="node-exporter"}', values: '0+6x20'},
], promql_expr_test: [{expr: expressionContaining('node_pressure_cpu_waiting_seconds_total'), eval_time: '10m', exp_samples: [
  {labels: '{cluster="a",instance="n:9100",job="node-exporter"}', value: 10},
]}]});
tests.push({name: 'Milvus histogram milliseconds become seconds', interval: '1m', input_series: [
  ...['0', '100', '+Inf'].map(le => ({
    series: `milvus_proxy_sq_latency_bucket{cluster="a",milvus_cluster="m",job="milvus",query_type="search",db_name="d",collection_name="c",le="${le}"}`,
    values: le === '0' ? '0+0x20' : '0+600x20',
  })),
], promql_expr_test: [{expr: expressionContaining('milvus_proxy_sq_latency_bucket'), eval_time: '10m', exp_samples: [
  {labels: '{cluster="a",milvus_cluster="m",db_name="d",collection_name="c"}', value: 0.099},
]}]});

console.log(`Validated MDX/YAML: ${files.length} articles, ${diagrams} Mermaid fences`);
console.log(run(['--version']));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'monitoring-article-check-'));
const rulesFile = path.join(temporary, 'rules.yaml');
const testsFile = path.join(temporary, 'tests.yaml');
try {
  fs.writeFileSync(rulesFile, yaml.dump({groups: [...groups, {
    name: 'article-query-syntax', rules: expressions.map((item, i) => ({record: `article_check_${i}`, expr: item.expr})),
  }]}));
  fs.writeFileSync(testsFile, yaml.dump({rule_files: [rulesFile], evaluation_interval: '1m', tests}));
  console.log(run(['check', 'rules', rulesFile]));
  console.log(run(['test', 'rules', testsFile]));
  console.log(`PASS: ${expressions.length} PromQL blocks, ${alerts.size} alerts, ${tests.length} synthetic test groups`);
  console.log('Scope: syntax and synthetic series only; no live Linux, Kubernetes, MySQL or Milvus integration test.');
} finally {
  for (const generated of [rulesFile, testsFile]) if (fs.existsSync(generated)) fs.unlinkSync(generated);
  fs.rmdirSync(temporary);
}
