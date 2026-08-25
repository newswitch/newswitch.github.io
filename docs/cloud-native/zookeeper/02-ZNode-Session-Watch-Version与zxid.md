---
title: "ZNode、Session、Watch、Version 与 zxid"
sidebar_label: "02. ZNode、Session、Watch、Version 与 zxid"
sidebar_position: 2
description: "深入 ZooKeeper 层级数据模型、节点类型、条件更新、会话生命周期、Watch 通知和全局事务顺序。"
tags: [ZooKeeper, ZNode, Session, Watch, Version, zxid]
---

# ZNode、Session、Watch、Version 与 zxid

ZooKeeper 的协调能力来自几个简单原语的组合：层级 ZNode、会话绑定的临时节点、单调递增顺序节点、版本条件更新和 Watch 通知。理解这些原语，才能正确实现注册发现、选举和分布式锁。

## 1. 层级命名空间

ZooKeeper 数据组织成树：

```text
/
├── config
│   └── payment
├── services
│   └── payment
│       ├── instance-01
│       └── instance-02
└── election
    ├── candidate-0000000001
    └── candidate-0000000002
```

每个 ZNode 既可以保存一小段字节数据，也可以有子节点。这不同于普通文件系统“文件和目录分离”的模型。

ZNode 数据读写是整体原子操作，不支持把一个大对象的一部分就地修改。应用应保存小型协调元数据，而不是把大配置文件、日志或模型放进去。

## 2. ZNode 类型

### 2.1 Persistent

创建后一直存在，直到客户端显式删除。适合配置根路径、命名空间和长期元数据。

### 2.2 Ephemeral

绑定创建者 Session。Session Expired 时由 ZooKeeper 删除，适合实例注册和临时所有权。

临时节点不能拥有子节点，这是为了让会话结束时的清理语义保持明确。

### 2.3 Sequential

创建时由 ZooKeeper 在路径后追加单调序号：

```text
/lock/member-0000000021
/lock/member-0000000022
```

可与 Persistent 或 Ephemeral 组合。`EPHEMERAL_SEQUENTIAL` 是选举和锁 Recipe 的基础。

### 2.4 Container 与 TTL 等扩展

某些版本提供 Container/TTL 节点等扩展，支持范围和清理语义要按当前 Server/Client 文档验证。核心业务不应在未验证版本兼容时依赖扩展类型。

## 3. Stat 与版本号

读取 ZNode 时不仅返回 data，还返回 Stat。常见字段方向：

- `version`：data 版本；
- `cversion`：子节点列表版本；
- `aversion`：ACL 版本；
- `czxid`/`mzxid`/`pzxid`：创建、修改和子节点变化相关事务；
- `ctime`/`mtime`；
- `ephemeralOwner`；
- `dataLength`、`numChildren`。

版本号用于条件更新：

```text
Client A getData → version=7
Client B getData → version=7
Client A setData(expectedVersion=7) → 成功，version=8
Client B setData(expectedVersion=7) → BadVersion
```

这是一种 Compare-And-Set，可防止静默覆盖并发更新。使用 `-1` 忽略版本会放弃这种保护。

## 4. zxid 是什么

zxid 是 ZooKeeper 事务标识，用于表示全局写事务顺序。可以将其理解为由 Leader 为状态变更建立的有序编号。

用途包括：

- 副本同步和恢复；
- 判断事务先后；
- Leader 选举时比较数据新旧；
- Watch 事件与触发事务关联；
- 事故中确认不同副本状态。

zxid 不是某个 ZNode 自己的版本号。`version` 针对节点数据更新次数，zxid 针对全局事务顺序。

## 5. Session 与 Connection 的区别

```text
Connection：客户端到某个Server的当前TCP连接
Session：由Ensemble维护、可跨Server重连的逻辑会话
```

状态大致经历：

```text
CONNECTING
→ CONNECTED
→ DISCONNECTED（可能恢复）
→ CONNECTED到另一Server

超过Session Timeout未恢复
→ EXPIRED（不可恢复）
→ 建立全新Session
```

应用收到 `Expired` 后不能继续假装拥有原来的锁或 Leader 身份。原 Session 的临时节点已经或将被删除，必须重新参与协调。

## 6. Session Timeout 怎样选择

过短：

- 短网络抖动或 JVM Pause 造成误下线；
- 临时节点频繁删除和重建；
- 上层不断重新选主；
- 形成故障放大。

过长：

- 真正故障实例长时间仍被认为在线；
- 锁和 Leader 所有权释放慢；
- 故障恢复时间变长。

应基于网络 P99、GC Pause、Server tickTime 范围和业务故障检测目标压测，而不是照抄一个固定秒数。

## 7. Watch 的语义

传统 Watch 的关键特征：

- 通知变更，不直接携带完整新值；
- 通常一次触发；
- 回调执行后需要重新读取并注册；
- 按 ZooKeeper 的顺序保证交付；
- Connection 断开期间要处理重新连接和状态重查；
- Watch 不能替代业务事件日志。

典型安全流程：

```text
getData(path, watch=true)
→ 保存data和version
→ 收到Watch事件
→ 再次getData(path, watch=true)
→ 根据新version更新本地状态
```

不要在收到事件后只修改本地状态而不重新读取，事件可能被合并或只表示“某种变化发生”。

## 8. 一次性 Watch 的竞态

```text
Watch触发
→ Client尚未重新注册
→ ZNode再次变化
→ Client可能收不到第二个一次性事件
```

正确性不能建立在“每一次变化都收到一个 Watch”上。应用应把当前 ZNode 状态作为事实，Watch 只是促使客户端重新读取。

较新版本提供 Persistent/Persistent Recursive Watch，但仍需验证客户端版本、事件规模和 Watch 管理成本。

## 9. 临时顺序节点实现 Leader 选举

```text
每个候选创建 /election/candidate-
→ ZooKeeper追加顺序号
→ 读取全部候选并排序
→ 最小编号成为Leader
→ 其他候选Watch紧邻前驱
→ 前驱删除后重新判断
```

为什么只 Watch 前驱：如果所有候选都 Watch 最小节点，Leader 退出时会同时唤醒大量客户端，形成 herd effect。

## 10. 分布式锁与 Fencing

获得最小顺序节点只能表明当前 ZooKeeper 协调结果。若客户端发生长时间暂停：

```text
旧Owner获得锁
→ 进程暂停超过Session Timeout
→ 临时节点删除
→ 新Owner获得锁并执行
→ 旧进程恢复，仍以为自己拥有锁
```

这会出现两个执行者。外部资源必须使用 fencing token，例如用单调序号作为令牌，存储层只接受更大的 token。

ZooKeeper 锁不是自动解决所有并发问题的魔法。

## 11. Multi/Transaction

需要多个 ZNode 变更原子成功或失败时，使用 multi 操作组合 create、setData、delete 和 check。它避免应用在多个独立请求之间暴露中间状态。

示例语义：

```text
check /leader version=5
setData /leader-state
create /audit/event- sequential
→ 全部提交或全部失败
```

multi 仍应保持小而有界，避免一次事务包含大量数据和节点。

## 12. 常见错误设计

1. 用 ZNode 保存几 MB 甚至更大的配置；
2. 监听根路径下成千上万高频变化；
3. Connection 断开就立即宣布 Session 失效；
4. Session Expired 后继续执行 Leader 操作；
5. 使用 `version=-1` 覆盖并发更新；
6. 认为一次性 Watch 能记录每个中间变化；
7. 所有锁竞争者 Watch 同一个节点；
8. 没有 fencing token，旧 Owner 恢复后继续写外部系统；
9. 把 zxid 当作某个节点的普通版本号。

## 13. 实验

1. 创建 persistent、ephemeral、persistent sequential 和 ephemeral sequential 节点；
2. 查看 Stat 中 version、cversion、zxid 字段变化；
3. 两个客户端用同一 version 更新，观察 BadVersion；
4. 注册一次性 Watch，连续写两次并观察事件；
5. 断开客户端但在 Session Timeout 内重连；
6. 等待 Session Expired，验证临时节点删除；
7. 用前驱 Watch 实现简化 Leader 选举；
8. 模拟旧 Leader 暂停，解释为什么需要 fencing。

## 14. 参考资料

- [Apache ZooKeeper Overview](https://zookeeper.apache.org/doc/current/zookeeperOver.html)
- [ZooKeeper Programmer's Guide](https://zookeeper.apache.org/doc/current/zookeeperProgrammers.html)
- [ZooKeeper Watcher API](https://zookeeper.apache.org/doc/current/apidocs/zookeeper-server/org/apache/zookeeper/Watcher.html)
