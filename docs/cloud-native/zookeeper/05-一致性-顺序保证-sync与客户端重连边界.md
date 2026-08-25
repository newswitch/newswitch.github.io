---
title: "一致性、顺序保证、sync 与客户端重连边界"
sidebar_label: "05. 一致性、顺序与重连边界"
sidebar_position: 5
description: "解释 ZooKeeper 的顺序保证、本地读、sync、版本 CAS 和连接丢失后的未知写结果。"
tags: [ZooKeeper, 一致性, sync, zxid, CAS]
---

# 一致性、顺序保证、sync 与客户端重连边界

ZooKeeper 提供线性化写和客户端顺序保证，但普通读可以由本地副本处理。正确使用它需要区分“全局写顺序”和“每次读都一定获得整个集群最新值”。

## 1. 主要保证

- 所有成功写入按统一 zxid 顺序提交；
- 单客户端请求按发送顺序处理；
- 成功写不会被之后的旧值覆盖；
- Watch 事件与造成事件的变化保持顺序关系；
- 客户端连接到新 Server 时，Server 必须足够新才能接受该会话。

普通本地读可能在某个时间点落后。若业务要在读前让连接 Server 追上 Leader，可先调用 `sync(path)`，再读；`sync` 不是跨多个 ZNode 的事务快照，也不能替代业务版本检查。

## 2. 写结果未知

```text
Client发送setData
→ Ensemble提交成功
→ 响应返回前连接断开
→ Client收到ConnectionLoss
```

此时不能断言写失败。盲目重试 `create` 可能得到 NodeExists，重试递增可能执行两次。应使用唯一请求标识、版本号、Multi 事务或读后判定。

## 3. 版本 CAS

`setData/delete` 可携带期望 Version。两个客户端读取同一版本后，只有第一个更新成功，第二个收到 BadVersion，并重新读取决策。这是协调正确性的核心，不应为了“省事”总使用 `-1` 忽略版本。

```text
read data, version=7
→ compute
→ setData expectedVersion=7
→ success(version=8) 或 BadVersion
```

## 4. 重连原则

- Disconnected 时暂停依赖 Leader/锁身份的外部写；
- SyncConnected 后重新读取状态，不只相信本地缓存；
- Expired 后创建新会话、重建 Ephemeral 和 Watch；
- 对未知结果执行“查询事实—判断是否已完成—幂等补偿”；
- 外部资源操作带单调 Fencing Token。

## 5. Multi 的边界

Multi 可以把多个 ZNode 检查和变更作为一个原子事务提交，适合 `check version + set/create/delete`。它不能把数据库或远程 API 纳入同一事务；跨系统仍需 Outbox、补偿或 Fencing。

## 6. 验证实验

让两个客户端并发修改同一节点并使用 Version CAS，观察一个成功、一个 BadVersion。随后在写响应途中阻断网络，证明 ConnectionLoss 代表结果未知，并实现读后判定而非无脑重复写。

参考：[ZooKeeper Programmer's Guide—Guarantees](https://zookeeper.apache.org/doc/current/zookeeperProgrammers.html#ch_zkGuarantees)。
