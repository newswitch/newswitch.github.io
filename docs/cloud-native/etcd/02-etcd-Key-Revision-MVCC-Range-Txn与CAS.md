---
title: "Key、Revision、MVCC、Range、Txn 与 Compare-And-Swap"
sidebar_label: "02. Key、Revision、MVCC、Range、Txn 与 Compare-And-Swap"
sidebar_position: 2
description: "理解 etcd 全局 Revision、Key 元数据、范围读、事务比较与原子更新。"
tags: [etcd, MVCC, Transaction, CAS]
---

# Key、Revision、MVCC、Range、Txn 与 Compare-And-Swap

> 版本基线：etcd 3.6；最后核验：2026-08-18。旧版本客户端参数可能不同，实验前先检查 `etcdctl version` 与 `etcdctl <command> --help`。

这篇文章解决一个核心问题：**多个客户端同时读取和修改控制状态时，etcd 如何给出可比较、可回放、可原子更新的结果？**

学完后应能解释 Kubernetes 的 `resourceVersion`、分布式锁、Leader Election 和配置 CAS 为什么都离不开 Revision 与 MVCC。

## 1. 先建立对象模型

etcd v3 的逻辑模型是按字节排序的 Key/Value 空间。`/` 只是常用命名约定，不代表真实目录。

```text
/registry/pods/default/pod-a
/registry/pods/default/pod-b
/registry/services/specs/default/api
```

一个 Key 不只有 value，还带有用于并发控制和历史读取的元数据：

| 字段 | 含义 | 常见用途 |
| --- | --- | --- |
| `create_revision` | Key 第一次创建时的全局 Revision | 判断是否为同一代对象 |
| `mod_revision` | Key 最近一次修改所在的全局 Revision | 乐观锁和 CAS |
| `version` | 当前这一代 Key 被修改的次数 | 判断首次创建或重复更新 |
| `lease` | 绑定的 Lease ID，没有绑定时为 0 | TTL、临时对象、锁 |

删除后重新创建同名 Key，会产生新的 `create_revision`，`version` 也会重新开始。不能只用 Key 名称判断它是不是原来那个对象。

## 2. Revision 不是时间戳，也不是 Key 版本号

Revision 是集群提交状态变化的全局逻辑序号：

```text
revision 100: put /config/a=v1
revision 101: put /config/b=v1
revision 102: txn 同时更新 /config/a 和 /config/b
```

第三个事务中的多个写操作属于同一次原子提交，因此可以共享同一个 Revision。需要区分：

- **全局 Revision**：描述整个 Key 空间推进到哪一个一致视图；
- **mod_revision**：某个 Key 最近在哪个全局 Revision 被修改；
- **version**：某个 Key 从本次创建开始累计修改了多少次；
- **Raft index**：共识日志的位置，不应当作业务 Revision 使用。

Revision 只保证顺序，不表示物理时间。两个 Revision 的差值也不能换算成秒数。

## 3. MVCC 如何保存历史视图

可以把 MVCC 理解为“Key 的版本索引 + 后端值存储”：

```text
logical key /config/a
  ├─ revision 100 → v1
  ├─ revision 102 → v2
  └─ revision 108 → tombstone
```

读取最新值时，etcd 选择不大于当前 Revision 的最新可见版本；指定 Revision 读取时，则构造当时的一致视图。删除通常先形成 tombstone，历史空间最终通过 Compaction 变得不可读，再由 Defrag 回收后端空闲页。

这三个动作不能混淆：

| 动作 | 改变逻辑可读历史 | 立即缩小数据库文件 |
| --- | --- | --- |
| Delete Key | 产生删除版本 | 否 |
| Compaction | 丢弃旧 Revision 的逻辑读取能力 | 通常否 |
| Defrag | 重写后端并回收碎片 | 是，但会消耗 I/O 并影响成员 |

如果 Watch 或历史读取请求的 Revision 已被压缩，服务端会返回 compacted revision 错误。客户端不能无限重试原 Revision，而应重新 List/Range 得到新基线，再从新 Revision 继续 Watch。

## 4. Range、Prefix 与分页

Prefix 查询本质上是一个半开 Key 范围：

```text
[prefix, prefixRangeEnd)
```

这意味着一个看似简单的 `get --prefix` 可能扫描和返回成千上万个对象。风险不只在后端读取，还包括：

- Leader 或本地成员构造响应；
- gRPC 序列化与网络发送；
- 客户端一次性分配内存；
- 大响应阻塞其他控制面请求；
- 在同一 Revision 下分页时的状态保持。

安全读取先从计数、Key 和小页开始：

```bash
EP=https://127.0.0.1:2379

# 先确认数量，不取回 value
etcdctl --endpoints="$EP" get /lab/ --prefix --count-only

# 只检查 Key 名称
etcdctl --endpoints="$EP" get /lab/ --prefix --keys-only --limit=20

# 查看响应头和 Key 元数据
etcdctl --endpoints="$EP" get /lab/config -w json
```

生产客户端做多页读取时，应尽量固定第一次响应得到的 Revision，后续页继续读取同一视图；否则翻页期间的新增和删除可能导致重复或遗漏。具体分页字段应按所使用的 client SDK 实现。

## 5. Txn：比较后只执行一个分支

Txn 的逻辑结构是：

```text
Compare
  ├─ 全部成立 → Success operations
  └─ 任一失败 → Failure operations
```

可以比较 value、version、create_revision、mod_revision 或 lease。一个 Txn 内选中的操作分支原子应用，其他客户端不会看到“只改了一半”的中间状态。

典型的 CAS 更新流程：

```text
1. Range /config/a，得到 value=v1、mod_revision=100
2. 计算新值 v2
3. Txn 比较 mod_revision(/config/a) == 100
4. 成立则 Put v2；失败则读取当前值并重新决策
```

注意：失败分支不是异常，它往往表示“并发条件已经改变”。应用应该区分业务冲突、网络错误和服务端错误。

### 5.1 为什么先 Get 再 Put 不安全 {/* #为什么先-get-再-put-不安全 */}

```text
client A: GET v1
client B: GET v1
client A: PUT v2
client B: PUT v3   # 覆盖 A，A 的更新丢失
```

CAS 把“条件仍成立”和“写入新值”放入同一个事务，从而消除检查与写入之间的竞态窗口。

## 6. 超时不代表事务没有执行

下面的时间线很重要：

```text
client → leader: Txn
leader → majority: commit
leader/apply: success
leader → client: response 在网络中丢失
client: timeout
```

客户端只知道“没有收到结果”，不能据此断言事务失败。安全做法是：

1. 写入带业务 request_id、generation 或期望值；
2. 超时后先做线性化读取；
3. 判断目标状态是否已经出现；
4. 只有确认未生效后，才执行有界、幂等重试。

如果操作本身不是幂等的，例如“读取后递增再写入”，盲目重试可能造成重复效果。

## 7. 可复现实验

以下实验只使用 `/lab/` 前缀，仍应在独立测试集群执行。

### 7.1 实验一：观察元数据变化 {/* #实验一观察元数据变化 */}

```bash
EP=https://127.0.0.1:2379

etcdctl --endpoints="$EP" put /lab/config v1
etcdctl --endpoints="$EP" get /lab/config -w json
etcdctl --endpoints="$EP" put /lab/config v2
etcdctl --endpoints="$EP" get /lab/config -w json
```

记录两次响应中的 `create_revision`、`mod_revision` 和 `version`，解释哪些字段变化、哪些不变。

### 7.2 实验二：历史读取与 Compaction {/* #实验二历史读取与-compaction */}

1. 连续写入三个值并记录各次 Header Revision；
2. 使用 `get /lab/config --rev=<revision>` 读取旧值；
3. 仅在实验集群执行 `etcdctl compact <revision>`；
4. 再次读取更旧 Revision，观察 compacted 错误；
5. 解释为什么 Compaction 后数据库文件可能没有立即缩小。

### 7.3 实验三：制造 CAS 冲突 {/* #实验三制造-cas-冲突 */}

1. 两个终端同时读取同一个 Key 的 `mod_revision`；
2. 终端 A 以该 Revision 为条件提交新值；
3. 终端 B 使用同一个旧 Revision 再提交；
4. 验证只有一个 Success 分支执行；
5. 让终端 B 重新读取并基于新状态决策。

`etcdctl txn -i` 可进入交互式事务输入；不同版本的提示格式可能不同，先通过 `etcdctl txn --help` 确认本机语法。

## 8. 生产约束与观测

etcd 适合保存小而关键的控制状态，不适合大对象、日志、指标或复杂业务事务。上线前至少观察：

- 请求大小、Txn 操作数和响应大小；
- Range 延迟及大 Prefix 查询；
- 当前 Revision 与 Watch 消费进度；
- Compaction 后的 Watch 重建次数；
- Backend quota、数据库大小与碎片率；
- CAS 冲突率和客户端超时后的确认读取。

一次安全变更应该能回答：比较条件是什么、冲突怎样返回、超时怎样确认、历史何时被压缩、客户端怎样重建状态。

## 9. 验收题

- 一个 Txn 修改三个 Key 时，可能产生几个全局 Revision？
- 全局 Revision、`mod_revision`、`version` 和 Raft index 有何区别？
- Compaction 与 Defrag 分别影响什么？
- Prefix 分页期间为什么要固定读取 Revision？
- CAS 如何防止并发覆盖？
- Txn 超时后为什么应先读取确认而不是立即重试？

## 10. 参考资料 {/* #参考资料 */}

- [etcd API guarantees](https://etcd.io/docs/v3.6/learning/api_guarantees/)
- [etcd API reference](https://etcd.io/docs/v3.6/learning/api/)
- [etcdctl transactions](https://etcd.io/docs/v3.6/tasks/developer/how-to-transactional-write/)
- [etcd maintenance](https://etcd.io/docs/v3.6/op-guide/maintenance/)
