---
title: "sysbench 基准测试、工作负载建模与结果解释"
sidebar_label: "04. sysbench 基准测试、工作负载建模与结果解释"
sidebar_position: 4
tags: [MySQL, sysbench, 基准测试, 压力测试]
description: "掌握 sysbench prepare/run/cleanup、数据与并发建模、分阶段加压、结果解释和可复现实验报告。"
---

# sysbench 基准测试、工作负载建模与结果解释

基准测试不是为了得到一个最大的 TPS 数字，而是回答明确问题：系统在目标工作负载下的容量边界在哪里，哪个资源先饱和，变更是否改善了用户关心的 SLO。

## 1. 实验契约

开始前写清：

```text
假设：新增索引能降低读 P99，写吞吐下降不超过 5%
版本/配置/硬件：固定
数据量：大于 Buffer Pool 或符合生产工作集
读写比例与 SQL 分布：接近生产
并发阶梯：8/16/32/64/128
预热/正式时长：明确
成功条件与停止条件：明确
```

## 2. 标准生命周期

```bash
sysbench oltp_read_write \
  --db-driver=mysql \
  --mysql-host=127.0.0.1 --mysql-port=3306 \
  --mysql-user=bench --mysql-password='REDACTED' \
  --mysql-db=sbtest --tables=16 --table-size=1000000 \
  prepare

sysbench oltp_read_write \
  --db-driver=mysql \
  --mysql-host=127.0.0.1 --mysql-port=3306 \
  --mysql-user=bench --mysql-password='REDACTED' \
  --mysql-db=sbtest --tables=16 --table-size=1000000 \
  --threads=64 --time=600 --warmup-time=60 \
  --report-interval=10 --percentile=99 \
  run

sysbench oltp_read_write ... cleanup
```

不要把密码留在 shell history；使用受限测试账户、配置文件或密钥注入。参数名称以安装版本的 `sysbench --help` 和脚本 help 为准。

## 3. 数据集决定结论

- 完全装入 Buffer Pool：主要测试 CPU/锁/执行；
- 大于内存：更能暴露存储与缓存；
- 单表过小：热点与生产不同；
- 均匀随机：无法模拟超级租户和热点 key；
- prepare 后立即跑：数据和缓存状态可能偏离生产。

必要时修改 Lua 脚本，模拟真实事务、参数倾斜、think time 和热点，而不是把内置 OLTP 当成业务替身。

## 4. 分阶段加压

```text
预热 → 稳态低并发 → 并发阶梯 → 饱和 → 恢复
```

每个阶梯保持足够时间，观察吞吐是否继续增长、P99 是否上翘、错误是否出现、恢复后是否回到基线。不要从 1 线程直接跳到 1000 线程把实例打死。

## 5. 同步采集

sysbench：TPS/QPS、latency avg/P95/P99、errors/reconnects、公平性。

MySQL：Threads_running、digest、锁等待、redo、Buffer Pool、临时表、复制延迟。

OS：CPU run queue、RSS/swap、磁盘 IOPS/延迟/队列、网络重传。

若客户端 CPU 或网络先满，测到的是压测机上限。至少监控负载发生器本身。

## 6. 解读饱和曲线

```text
并发增加，吞吐线性增长：尚有余量
吞吐趋平，P99 上升：进入排队区
吞吐下降，错误上升：过载
停止加压后恢复慢：存在积压、脏页或回滚
```

生产容量应位于拐点之前，并给故障、备份、流量波动留下余量。

## 7. A/B 实验

每次只改变一个主要因素；重复至少数轮，交替顺序减少温度/缓存漂移。报告必须包含原始命令、Git 版本、配置 diff、数据生成、预热、时间序列和置信范围，而不是只给平均 TPS。

## 8. 常见误区

- 空库或极小数据代表生产；
- 只看平均值；
- 每轮缓存状态不同；
- 测试期间有备份/巡检却未记录；
- 为追峰值关闭生产必需的持久性；
- 使用管理员账户和真实数据；
- 只测试正常路径，不测热点、锁和副本延迟。

## 9. 验收报告模板

```text
目标与假设
环境指纹
数据与 workload
命令和时间线
吞吐-并发、P99-并发曲线
CPU/I/O/锁/复制饱和证据
失败与恢复行为
容量建议和安全余量
限制、回滚和下一实验
```

## 参考资料

- [sysbench 官方仓库](https://github.com/akopytov/sysbench)
- [MySQL Benchmarking and Stress Testing](https://dev.mysql.com/doc/refman/8.4/en/benchmarking.html)

