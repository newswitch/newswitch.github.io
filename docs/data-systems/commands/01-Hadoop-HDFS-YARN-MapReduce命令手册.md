---
title: Hadoop、HDFS、YARN 与 MapReduce 命令手册
sidebar_position: 1
tags: [Hadoop, HDFS, YARN, MapReduce, 命令手册]
description: 按只读、写入和危险操作分级掌握 HDFS 文件、集群健康、HA、纠删码、YARN 应用和 MapReduce 作业命令。
---

# Hadoop、HDFS、YARN 与 MapReduce 命令手册

这篇不是把 `--help` 复制一遍，而是按“确认环境 → 查看状态 → 操作数据 → 定位故障 → 受控变更”组织命令。示例采用 Hadoop 当前常见 CLI；发行版可能增加参数，执行前先运行同级 `-help` 并核对集群版本。

## 1. 安全分级

| 标记 | 含义 | 执行要求 |
|---|---|---|
| `[R]` | 只读查询 | 可在有权限的生产环境执行，但注意大目录扫描开销 |
| `[W]` | 创建或修改 | 先在个人实验目录执行，记录目标和回滚方式 |
| `[D]` | 删除、强制恢复或集群级变更 | 必须审批、备份、确认精确目标并在维护窗口执行 |

文中的 `<nameservice>`、`<application_id>`、`<path>` 都必须替换成经过只读查询确认的值。不要把占位符原样执行。

## 2. 环境与帮助

```bash
# [R] 版本和命令入口
hadoop version
hdfs version
yarn version
mapred version

# [R] 逐层查看帮助，参数应以本机输出为准
hdfs dfs -help
hdfs dfs -help ls
hdfs dfsadmin -help
yarn application -help
mapred job -help

# [R] 定位生效配置和 Java classpath
hdfs getconf -confKey fs.defaultFS
hdfs getconf -namenodes
hdfs getconf -nnRpcAddresses
hadoop classpath --glob
```

若命令连到错误集群，先检查 `HADOOP_CONF_DIR`、`core-site.xml` 和 `hdfs-site.xml`，不要急着修改远端数据。

## 3. HDFS 文件系统只读命令

```bash
# [R] 路径、大小和文件统计
hdfs dfs -ls -h /warehouse
hdfs dfs -ls -R /warehouse/example
hdfs dfs -du -h -s /warehouse/example
hdfs dfs -count -q -h /warehouse/example
hdfs dfs -stat '%n %b %r %y' /warehouse/example/file.parquet

# [R] 内容抽样与校验
hdfs dfs -head /warehouse/example/sample.txt
hdfs dfs -tail /warehouse/example/sample.log
hdfs dfs -cat /warehouse/example/sample.txt | head
hdfs dfs -checksum /warehouse/example/file.parquet

# [R] 权限和 ACL
hdfs dfs -getfacl /warehouse/example
hdfs dfs -getfattr -d /warehouse/example/file.parquet

# [R] 查找文件；大目录执行前评估 NameNode RPC 压力
hdfs dfs -find /warehouse/example -name '*.parquet' -print
```

`du` 看实际文件空间，`count -q` 同时显示 namespace/storage quota。文件很多时 `ls -R` 和 `find` 可能制造大量 RPC，优先缩小路径。

## 4. HDFS 文件写入和安全删除

```bash
# [W] 创建个人实验目录
hdfs dfs -mkdir -p /tmp/bigdata-command-lab/input

# [W] 上传、下载和跨路径复制
hdfs dfs -put -f ./sample.csv /tmp/bigdata-command-lab/input/
hdfs dfs -get /tmp/bigdata-command-lab/input/sample.csv ./downloaded.csv
hdfs dfs -cp /tmp/bigdata-command-lab/input/sample.csv /tmp/bigdata-command-lab/sample-copy.csv

# [W] 权限、所有者和副本数
hdfs dfs -chmod 750 /tmp/bigdata-command-lab
hdfs dfs -chown <owner>:<group> /tmp/bigdata-command-lab
hdfs dfs -setrep -w 2 /tmp/bigdata-command-lab/input/sample.csv

# [D] 删除前先列出精确目标；默认进入 Trash 时仍需确认
hdfs dfs -ls /tmp/bigdata-command-lab
hdfs dfs -rm /tmp/bigdata-command-lab/sample-copy.csv
hdfs dfs -rm -r /tmp/bigdata-command-lab
```

生产环境不要使用 `-skipTrash` 作为日常清理手段。即使启用 Trash，也要先确认路径不为空、不包含通配符扩张错误，并检查 snapshot/下游引用。

## 5. Block、文件健康和租约

```bash
# [R] 定位 Block、副本、节点和机架
hdfs fsck /warehouse/example/file.parquet -files -blocks -locations -racks

# [R] 汇总目录健康；大目录可能耗时
hdfs fsck /warehouse/example -summary

# [R] 列出损坏或缺失信息
hdfs fsck /warehouse/example -list-corruptfileblocks

# [R] 查看写入中的文件
hdfs fsck /warehouse/example -openforwrite

# [D] 租约恢复会改变文件状态，只对确认卡死的单文件操作
hdfs debug recoverLease -path /warehouse/example/stuck-file -retries 3
```

`fsck` 返回非零、`MISSING` 或 `CORRUPT` 时先保存输出并确认其他副本，禁止直接删除坏文件来让健康检查变绿。

## 6. NameNode、DataNode 与 HA

```bash
# [R] 集群容量、节点和坏盘概况
hdfs dfsadmin -report
hdfs dfsadmin -report -live
hdfs dfsadmin -report -dead

# [R] SafeMode、拓扑和 HA 角色
hdfs dfsadmin -safemode get
hdfs dfsadmin -printTopology
hdfs haadmin -getServiceState <nn-id-1>
hdfs haadmin -getServiceState <nn-id-2>
hdfs haadmin -checkHealth <nn-id-1>

# [R] NameNode JMX（端口以集群配置为准）
curl -fsS 'http://<namenode-host>:<http-port>/jmx?qry=Hadoop:service=NameNode,name=FSNamesystemState'

# [D] 进入/离开 SafeMode、手工故障转移属于集群级变更
hdfs dfsadmin -safemode enter
hdfs dfsadmin -safemode leave
hdfs haadmin -failover <from-nn-id> <to-nn-id>
```

手工 failover 前要确认自动故障转移、JournalNode quorum、fencing 和目标 Standby 的 edits lag。`-forceactive` 一类强制选项可能造成双主，本文不提供直接执行模板。

## 7. Snapshot、Quota 与存储策略

```bash
# [R] 查看可创建 snapshot 的目录和差异
hdfs lsSnapshottableDir
hdfs snapshotDiff /warehouse/example snap-before snap-after

# [W] 创建 snapshot（目录必须已由管理员设为 snapshottable）
hdfs dfs -createSnapshot /warehouse/example before-maintenance

# [D] 删除 snapshot 前确认备份和引用
hdfs dfs -deleteSnapshot /warehouse/example before-maintenance

# [R] 查看配额和存储策略
hdfs dfs -count -q -h /warehouse/example
hdfs storagepolicies -getStoragePolicy -path /warehouse/example

# [D] 设置配额/策略会影响后续写入
hdfs dfsadmin -setSpaceQuota 10t /warehouse/example
hdfs storagepolicies -setStoragePolicy -path /warehouse/example -policy <policy-name>
```

Snapshot 几乎瞬时创建，但后续删除/覆盖的旧 Block 仍占空间。容量排查必须把 snapshot 保留考虑进去。

## 8. Balancer、Mover 与纠删码

```bash
# [R] 查看 EC policy
hdfs ec -listPolicies
hdfs ec -getPolicy -path /warehouse/cold

# [W] 在新实验目录设置 EC policy；不要直接改已有热目录
hdfs dfs -mkdir -p /tmp/bigdata-command-lab-ec
hdfs ec -setPolicy -path /tmp/bigdata-command-lab-ec -policy <ec-policy>

# [D] Balancer/Mover 会产生大量磁盘和网络流量
hdfs balancer -threshold 10
hdfs mover -p /warehouse/example
```

Balancer 执行前记录集群使用率、under-replicated blocks、业务 P99 和可用带宽；执行中持续观察移动字节、磁盘 await 与跨机架流量。不要在副本恢复高峰同时启动。

## 9. YARN 集群、节点和队列

```bash
# [R] 集群与节点
yarn node -list -all
yarn node -status <node-id>
yarn cluster -list-node-labels

# [R] 应用列表、状态和尝试
yarn application -list -appStates RUNNING,ACCEPTED
yarn application -status <application_id>
yarn applicationattempt -list <application_id>
yarn container -list <application_attempt_id>

# [R] 队列状态；命令支持随调度器/版本确认
yarn queue -status <queue-name>

# [R] 聚合日志
yarn logs -applicationId <application_id>
yarn logs -applicationId <application_id> -containerId <container_id>

# [D] 终止应用会中断任务并可能触发外部重试
yarn application -kill <application_id>
```

`ACCEPTED` 长时间不运行时依次检查队列 pending resources、AM 资源、用户限制、节点标签和单 Container request。`RUNNING` 不代表数据有输出，还要看引擎进度。

## 10. MapReduce 作业

```bash
# [R] 列出和查看作业
mapred job -list all
mapred job -status <job_id>
mapred job -history <history-file-or-job-id>

# [R] Counters 是定位 Shuffle、记录数和本地性的关键
mapred job -counter <job_id> <group_name> <counter_name>

# [D] 终止作业
mapred job -kill <job_id>
```

重点比较 Map input/output、Reduce input/output、spilled records、HDFS bytes、failed attempts 和 data-local tasks。输出记录异常时先停发布，不要只调性能。

## 11. 十分钟实验

1. 用 `getconf` 记录目标集群与 NameNode。
2. 创建 `/tmp/bigdata-command-lab`，上传一个文件并记录 checksum。
3. 用 `fsck` 找出 Block、副本和机架。
4. 用 `dfsadmin -report` 对应副本所在 DataNode 的容量状态。
5. 用 `yarn application -list` 找一个自己的应用并查看 status/logs。
6. 删除实验目录前再次 `ls` 精确确认目标。

实验记录至少包含命令、时间、集群、退出码、关键输出和清理结果。

## 12. 掌握验收

- 不查资料完成 HDFS 上传、校验、Block 定位和下载；
- 从 `dfsadmin -report`、`fsck` 和 HA 状态区分控制面/数据面故障；
- 从 YARN `ACCEPTED` 状态定位队列、AM 或节点约束；
- 从 MapReduce counters 识别数据放大和 spill；
- 在执行任何 `[D]` 命令前写出目标、影响、回滚和验证。

下一篇：[Hive、Beeline 与 Metastore 命令手册](./02-Hive-Beeline与Metastore命令手册.md)

## 参考资料

- [Hadoop File System Shell](https://hadoop.apache.org/docs/current/hadoop-project-dist/hadoop-common/FileSystemShell.html)
- [HDFS Commands Guide](https://hadoop.apache.org/docs/current/hadoop-project-dist/hadoop-hdfs/HDFSCommands.html)
- [YARN Commands](https://hadoop.apache.org/docs/current/hadoop-yarn/hadoop-yarn-site/YarnCommands.html)

