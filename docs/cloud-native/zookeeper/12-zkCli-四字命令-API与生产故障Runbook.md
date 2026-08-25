---
title: "zkCli、四字命令、API 与生产故障 Runbook"
sidebar_label: "12. 命令、API 与生产 Runbook"
sidebar_position: 12
description: "按数据检查、节点诊断和故障处置掌握 ZooKeeper 工具，并建立保护多数派的 Runbook。"
tags: [ZooKeeper, zkCli, Four Letter Words, Runbook, 故障排查]
---

# zkCli、四字命令、API 与生产故障 Runbook

ZooKeeper 排障先区分客户端问题、单 Server 问题和 Ensemble 多数派问题。命令输出是证据，不应在未确认状态时直接执行递归删除、重新格式化或覆盖数据目录。

## 1. zkCli 只读检查

```bash
zkCli.sh -server zk1:2181,zk2:2181,zk3:2181
ls /
get -s /path
getAcl /path
stat /path
```

`get -s` 同时查看数据与 Stat，可获得版本、zxid、子节点数等信息。修改和删除时使用 Version，生产避免无条件 `-1`。

## 2. 四字命令与 AdminServer

常用诊断包括 `ruok`、`srvr`、`stat`、`mntr`、`cons`。生产只启用所需命令，并限制到运维网络；`ruok=imok` 只说明进程响应，不代表节点已加入多数派或数据足够新。

```bash
echo mntr | nc zk1 2181
curl --fail http://zk1:8080/commands/monitor
```

实际命令白名单、端口和 AdminServer 路径按部署版本确认。

## 3. 前五分钟 Runbook

1. 确认受影响路径、客户端和 Session 状态；
2. 检查各节点角色、是否有 Leader、同步 Follower 数；
3. 保存延迟、Outstanding、连接、Watch、磁盘和 GC；
4. 冻结成员变更和滚动升级；
5. 判断是否仍有多数派，优先恢复网络/原成员；
6. 业务端暂停无 Fencing 的危险外部操作。

## 4. 决策树

```text
客户端失败
├─ 只有单客户端 → DNS、ACL、TLS、事件线程、连接串
├─ 单Server异常 → 进程、日志盘、GC、同步状态
└─ 整体写失败
   ├─ 无Leader/无多数派 → 恢复成员或网络
   ├─ Outstanding高 → 查Leader磁盘和请求风暴
   └─ Auth失败 → 身份、ACL、证书时间
```

## 5. 禁止动作

- 未确认多数派时同时重启所有节点；
- 从不同节点拼接/覆盖数据目录；
- 手工删除最新 Snapshot/事务日志；
- 为恢复服务临时开放 `world:anyone` 后忘记回收；
- 把 `ruok` 成功当成业务恢复。

## 6. 恢复验收与演练

验证 Leader、同步 Follower、关键 ZNode/ACL、写 CAS、Watch、Ephemeral 和客户端重连。定期演练 Leader 退出、慢盘、证书失败、Session 风暴和失去多数派，并记录实际 RTO。

参考：[ZooKeeper Administrator's Guide](https://zookeeper.apache.org/doc/current/zookeeperAdmin.html)。
