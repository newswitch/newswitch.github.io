// Literal navigation coverage only. This is not a required-parameter catalogue.
import fs from 'node:fs';

const directory = 'contributing/audits/2026-11-16-content-depth';
const inventory = JSON.parse(fs.readFileSync(`${directory}/inventory.json`, 'utf8'));
const catalog = [
  ['Redis', 'docs/data-systems/cache/redis/', ['maxclients', 'client-output-buffer-limit', 'tcp-keepalive', 'lazyfree-lazy-eviction', 'activedefrag', 'replica-ignore-maxmemory', 'appendfsync', 'maxmemory-policy']],
  ['MySQL', 'docs/data-systems/databases/mysql/', ['innodb_buffer_pool_size', 'innodb_flush_log_at_trx_commit', 'sync_binlog', 'max_connections', 'innodb_io_capacity', 'transaction_isolation', 'binlog_expire_logs_seconds']],
  ['PostgreSQL', 'docs/data-systems/databases/postgresql/', ['shared_buffers', 'work_mem', 'maintenance_work_mem', 'max_connections', 'synchronous_commit', 'checkpoint_timeout', 'max_wal_size', 'autovacuum_vacuum_scale_factor']],
  ['Kafka', 'docs/data-systems/messaging/kafka/', ['min.insync.replicas', 'enable.idempotence', 'max.in.flight.requests.per.connection', 'cleanup.policy', 'max.poll.interval.ms', 'isolation.level']],
  ['Nginx', 'docs/networking/load-balancing-proxy/nginx/', ['worker_connections', 'proxy_read_timeout', 'proxy_buffering', 'proxy_cache_valid', 'keepalive_timeout', 'worker_rlimit_nofile']],
  ['Ceph', 'docs/storage/ceph/', ['osd_memory_target', 'min_size', 'nearfull', 'backfillfull', 'mclock', 'pg_autoscale_mode', 'osd_max_backfills']],
  ['etcd', 'docs/cloud-native/etcd/', ['quota-backend-bytes', 'auto-compaction-retention', 'snapshot-count', 'heartbeat-interval', 'election-timeout']],
  ['Kubernetes', 'docs/cloud-native/kubernetes/', ['startupProbe', 'failureThreshold', 'maxUnavailable', 'evictionHard', 'topologySpreadConstraints', 'terminationGracePeriodSeconds']],
  ['Prometheus', 'docs/sre/observability/prometheus/', ['scrape_interval', 'scrape_timeout', 'evaluation_interval', 'storage.tsdb.retention.time', 'sample_limit', 'query.max-concurrency']],
  ['vLLM', 'docs/ai-systems/inference/vllm/', ['max-num-batched-tokens', 'max-num-seqs', 'block-size', 'gpu-memory-utilization', 'enforce-eager']],
];

const modules = catalog.map(([name, prefix, terms]) => {
  const files = inventory.items.filter(item => item.file.startsWith(prefix));
  if (!files.length) throw new Error(`No source files for ${name}: ${prefix}`);
  const topics = terms.map(term => {
    const hits = files.flatMap(item => {
      const lines = fs.readFileSync(item.file, 'utf8').replaceAll('\r\n', '\n').split('\n');
      const index = lines.findIndex(line => line.toLowerCase().includes(term.toLowerCase()));
      return index < 0 ? [] : [{file: item.file, line: index + 1, context: lines.slice(Math.max(0, index - 1), index + 7).join('\n')}];
    });
    return {term, hits};
  });
  return {name, prefix, articles: files.length, topics};
});
const warning = 'Literal-term presence/absence is navigation evidence only, not proof of explanation quality, correctness or required coverage. Aliases, underscores, translated concepts and cross-module coverage require manual review.';
fs.writeFileSync(`${directory}/parameter-coverage.json`, JSON.stringify({warning, modules}, null, 2) + '\n');

const lines = ['# 核心模块参数定位抽查', '', '只检查所列目录中的字面命中，不是全部参数清单，也不是深度评分。0 表示没有匹配该字符串，不证明全站没有相关概念；有命中也可能只是配置或命令。下划线、短横线、别名与跨目录教程均需人工继续核对。', ''];
for (const module of modules) {
  lines.push(`## ${module.name}（${module.articles} 篇源文件）`, '', '| 参数字符串 | 命中文章数 | 首个入口 |', '| --- | ---: | --- |');
  for (const topic of module.topics) {
    const first = topic.hits[0];
    const entry = first ? `[第 ${first.line} 行](<../../../${first.file}>)` : '本目录未匹配，待语义核对';
    lines.push(`| \`${topic.term}\` | ${topic.hits.length} | ${entry} |`);
  }
  lines.push('');
}
fs.writeFileSync(`${directory}/parameters.md`, lines.join('\n').trimEnd() + '\n');
console.log(`Indexed ${modules.length} modules; no parameter-depth pass/fail assigned.`);
