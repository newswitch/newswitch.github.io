# 核心模块参数定位抽查

只检查所列目录中的字面命中，不是全部参数清单，也不是深度评分。0 表示没有匹配该字符串，不证明全站没有相关概念；有命中也可能只是配置或命令。下划线、短横线、别名与跨目录教程均需人工继续核对。

## Redis（17 篇源文件）

| 参数字符串 | 命中文章数 | 首个入口 |
| --- | ---: | --- |
| `maxclients` | 0 | 本目录未匹配，待语义核对 |
| `client-output-buffer-limit` | 0 | 本目录未匹配，待语义核对 |
| `tcp-keepalive` | 0 | 本目录未匹配，待语义核对 |
| `lazyfree-lazy-eviction` | 0 | 本目录未匹配，待语义核对 |
| `activedefrag` | 0 | 本目录未匹配，待语义核对 |
| `replica-ignore-maxmemory` | 0 | 本目录未匹配，待语义核对 |
| `appendfsync` | 5 | [第 98 行](<../../../docs/data-systems/cache/redis/01-client-data/01-Redis解决什么问题与一次命令的完整路径.md>) |
| `maxmemory-policy` | 2 | [第 141 行](<../../../docs/data-systems/cache/redis/01-client-data/01-Redis解决什么问题与一次命令的完整路径.md>) |

## MySQL（64 篇源文件）

| 参数字符串 | 命中文章数 | 首个入口 |
| --- | ---: | --- |
| `innodb_buffer_pool_size` | 9 | [第 189 行](<../../../docs/data-systems/databases/mysql/03-innodb-transactions/01-InnoDB内存与磁盘整体架构.md>) |
| `innodb_flush_log_at_trx_commit` | 4 | [第 108 行](<../../../docs/data-systems/databases/mysql/03-innodb-transactions/04-Redo-Undo-Binlog与一次提交的完整路径.md>) |
| `sync_binlog` | 4 | [第 109 行](<../../../docs/data-systems/databases/mysql/03-innodb-transactions/04-Redo-Undo-Binlog与一次提交的完整路径.md>) |
| `max_connections` | 13 | [第 151 行](<../../../docs/data-systems/databases/mysql/01-foundations/01-MySQL解决什么问题及一条SQL的完整路径.md>) |
| `innodb_io_capacity` | 0 | 本目录未匹配，待语义核对 |
| `transaction_isolation` | 5 | [第 297 行](<../../../docs/data-systems/databases/mysql/01-foundations/01-MySQL解决什么问题及一条SQL的完整路径.md>) |
| `binlog_expire_logs_seconds` | 1 | [第 230 行](<../../../docs/data-systems/databases/mysql/08-production-operations/06-MySQL迁移到TBase生产方案.md>) |

## PostgreSQL（21 篇源文件）

| 参数字符串 | 命中文章数 | 首个入口 |
| --- | ---: | --- |
| `shared_buffers` | 3 | [第 34 行](<../../../docs/data-systems/databases/postgresql/01-foundations-sql/01-PostgreSQL解决什么问题与一条SQL的完整路径.md>) |
| `work_mem` | 4 | [第 166 行](<../../../docs/data-systems/databases/postgresql/01-foundations-sql/05-PostgreSQL-SQL-CTE-Window-JSONB-Array与全文检索.md>) |
| `maintenance_work_mem` | 2 | [第 46 行](<../../../docs/data-systems/databases/postgresql/03-performance/12-PostgreSQL连接PgBouncer内存HugePages与IO.md>) |
| `max_connections` | 3 | [第 11 行](<../../../docs/data-systems/databases/postgresql/03-performance/12-PostgreSQL连接PgBouncer内存HugePages与IO.md>) |
| `synchronous_commit` | 3 | [第 94 行](<../../../docs/data-systems/databases/postgresql/01-foundations-sql/01-PostgreSQL解决什么问题与一条SQL的完整路径.md>) |
| `checkpoint_timeout` | 1 | [第 106 行](<../../../docs/data-systems/databases/postgresql/02-storage-concurrency/08-PostgreSQL-WAL-Commit-Checkpoint恢复与Timeline.md>) |
| `max_wal_size` | 1 | [第 107 行](<../../../docs/data-systems/databases/postgresql/02-storage-concurrency/08-PostgreSQL-WAL-Commit-Checkpoint恢复与Timeline.md>) |
| `autovacuum_vacuum_scale_factor` | 1 | [第 44 行](<../../../docs/data-systems/databases/postgresql/02-storage-concurrency/09-PostgreSQL-Vacuum-Autovacuum-Freeze与Bloat.md>) |

## Kafka（15 篇源文件）

| 参数字符串 | 命中文章数 | 首个入口 |
| --- | ---: | --- |
| `min.insync.replicas` | 2 | [第 112 行](<../../../docs/data-systems/messaging/kafka/13-Kafka-Topic-Producer-Consumer与Group命令手册.md>) |
| `enable.idempotence` | 0 | 本目录未匹配，待语义核对 |
| `max.in.flight.requests.per.connection` | 0 | 本目录未匹配，待语义核对 |
| `cleanup.policy` | 1 | [第 112 行](<../../../docs/data-systems/messaging/kafka/13-Kafka-Topic-Producer-Consumer与Group命令手册.md>) |
| `max.poll.interval.ms` | 0 | 本目录未匹配，待语义核对 |
| `isolation.level` | 0 | 本目录未匹配，待语义核对 |

## Nginx（23 篇源文件）

| 参数字符串 | 命中文章数 | 首个入口 |
| --- | ---: | --- |
| `worker_connections` | 4 | [第 59 行](<../../../docs/networking/load-balancing-proxy/nginx/01-core/07-Nginx-Master-Worker事件循环连接与定时器.md>) |
| `proxy_read_timeout` | 3 | [第 94 行](<../../../docs/networking/load-balancing-proxy/nginx/02-proxy-content/04-Nginx反向代理Upstream负载均衡健康与重试.md>) |
| `proxy_buffering` | 4 | [第 160 行](<../../../docs/networking/load-balancing-proxy/nginx/02-proxy-content/04-Nginx反向代理Upstream负载均衡健康与重试.md>) |
| `proxy_cache_valid` | 1 | [第 167 行](<../../../docs/networking/load-balancing-proxy/nginx/02-proxy-content/06-Nginx静态文件Sendfile-Buffer压缩与Cache.md>) |
| `keepalive_timeout` | 3 | [第 51 行](<../../../docs/networking/load-balancing-proxy/nginx/02-proxy-content/04-Nginx反向代理Upstream负载均衡健康与重试.md>) |
| `worker_rlimit_nofile` | 2 | [第 140 行](<../../../docs/networking/load-balancing-proxy/nginx/01-core/07-Nginx-Master-Worker事件循环连接与定时器.md>) |

## Ceph（31 篇源文件）

| 参数字符串 | 命中文章数 | 首个入口 |
| --- | ---: | --- |
| `osd_memory_target` | 3 | [第 251 行](<../../../docs/storage/ceph/03-deployment/07-部署前的集群规划.md>) |
| `min_size` | 12 | [第 112 行](<../../../docs/storage/ceph/02-architecture/04-Ceph数据组织原理.md>) |
| `nearfull` | 16 | [第 205 行](<../../../docs/storage/ceph/01-overview/01-为什么需要Ceph.md>) |
| `backfillfull` | 14 | [第 205 行](<../../../docs/storage/ceph/01-overview/01-为什么需要Ceph.md>) |
| `mclock` | 4 | [第 670 行](<../../../docs/storage/ceph/05-operations/16-Ceph日常运维.md>) |
| `pg_autoscale_mode` | 3 | [第 303 行](<../../../docs/storage/ceph/04-client-usage/11-Pool与CephX权限管理.md>) |
| `osd_max_backfills` | 0 | 本目录未匹配，待语义核对 |

## etcd（11 篇源文件）

| 参数字符串 | 命中文章数 | 首个入口 |
| --- | ---: | --- |
| `quota-backend-bytes` | 1 | [第 80 行](<../../../docs/cloud-native/etcd/05-etcd-WAL-Snapshot-bbolt-Compaction-Defrag与Quota.md>) |
| `auto-compaction-retention` | 0 | 本目录未匹配，待语义核对 |
| `snapshot-count` | 0 | 本目录未匹配，待语义核对 |
| `heartbeat-interval` | 0 | 本目录未匹配，待语义核对 |
| `election-timeout` | 0 | 本目录未匹配，待语义核对 |

## Kubernetes（163 篇源文件）

| 参数字符串 | 命中文章数 | 首个入口 |
| --- | ---: | --- |
| `startupProbe` | 3 | [第 35 行](<../../../docs/cloud-native/kubernetes/operations/application-delivery/05-部署有状态应用.md>) |
| `failureThreshold` | 3 | [第 188 行](<../../../docs/cloud-native/kubernetes/operations/application-delivery/05-部署有状态应用.md>) |
| `maxUnavailable` | 6 | [第 224 行](<../../../docs/cloud-native/kubernetes/ai-native/05-大模型部署与调优.md>) |
| `evictionHard` | 0 | 本目录未匹配，待语义核对 |
| `topologySpreadConstraints` | 3 | [第 63 行](<../../../docs/cloud-native/kubernetes/ai-native/07-AI工作负载调度.md>) |
| `terminationGracePeriodSeconds` | 7 | [第 360 行](<../../../docs/cloud-native/kubernetes/controllers/01-概述.md>) |

## Prometheus（16 篇源文件）

| 参数字符串 | 命中文章数 | 首个入口 |
| --- | ---: | --- |
| `scrape_interval` | 4 | [第 53 行](<../../../docs/sre/observability/prometheus/01-model-query/01-Prometheus解决什么问题与一条指标的完整路径.md>) |
| `scrape_timeout` | 3 | [第 118 行](<../../../docs/sre/observability/prometheus/01-model-query/01-Prometheus解决什么问题与一条指标的完整路径.md>) |
| `evaluation_interval` | 3 | [第 57 行](<../../../docs/sre/observability/prometheus/01-model-query/01-Prometheus解决什么问题与一条指标的完整路径.md>) |
| `storage.tsdb.retention.time` | 2 | [第 104 行](<../../../docs/sre/observability/prometheus/01-model-query/04-Prometheus-TSDB-Head-WAL-Block-Compaction与Retention.md>) |
| `sample_limit` | 0 | 本目录未匹配，待语义核对 |
| `query.max-concurrency` | 0 | 本目录未匹配，待语义核对 |

## vLLM（45 篇源文件）

| 参数字符串 | 命中文章数 | 首个入口 |
| --- | ---: | --- |
| `max-num-batched-tokens` | 4 | [第 693 行](<../../../docs/ai-systems/inference/vllm/02-execution/24-昇腾910B-vLLM-Ascend与原生vLLM源码差异.md>) |
| `max-num-seqs` | 5 | [第 692 行](<../../../docs/ai-systems/inference/vllm/02-execution/24-昇腾910B-vLLM-Ascend与原生vLLM源码差异.md>) |
| `block-size` | 4 | [第 45 行](<../../../docs/ai-systems/inference/vllm/04-parameters/25-vLLM-Serve生产参数参考.md>) |
| `gpu-memory-utilization` | 4 | [第 49 行](<../../../docs/ai-systems/inference/vllm/04-parameters/25-vLLM-Serve生产参数参考.md>) |
| `enforce-eager` | 6 | [第 347 行](<../../../docs/ai-systems/inference/vllm/01-architecture/02-vllm-serve启动与初始化全流程.md>) |
