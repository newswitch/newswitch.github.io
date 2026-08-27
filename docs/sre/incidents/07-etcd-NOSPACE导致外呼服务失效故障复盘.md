---
title: "etcd NOSPACE 导致外呼服务失效：一次故障复盘与错误归因校正"
sidebar_label: "07. etcd NOSPACE 导致外呼服务失效故障复盘"
sidebar_position: 7
description: "复盘602个坐席无法外呼的etcd空间故障，校正Lease续约、MVCC Revision、NOSPACE、Raft一致性与快照恢复误区，并给出可执行的恢复和预防Runbook。"
tags: [etcd, NOSPACE, MVCC, Lease, Raft, Compaction, Defrag, Snapshot, 故障复盘]
date: 2026-08-27 14:00:00
categories: SRE
---

# etcd NOSPACE 导致外呼服务失效：一次故障复盘与错误归因校正

某天下午，外呼平台中的10个拨打节点从服务发现列表中消失，602个灰度坐席无法拨打电话。现场发现etcd Backend达到配置的8 GiB边界，集群不可正常写入。团队先后尝试重启、在线压缩、扩大磁盘和快照恢复，最终在24分钟后把流量切回旧系统。

这起事故很适合学习etcd存储维护和灾难恢复，但原始归因中混合了几个常见误解：

- Lease KeepAlive不等于每次重写Key，正常续约不会每次增加MVCC Revision；
- Backend超过Quota会触发 `NOSPACE` Alarm和受限维护模式，不会自然导致Raft成员各自提交不同数据；
- 扩大文件系统不会自动改变 `--quota-backend-bytes`，但“扩容无效”也不能直接归因于Revision不一致；
- `NOSPACE`场景下官方恢复路径本来就包含Compaction、逐成员Defrag和Alarm Disarm；
- 短TTL服务发现Key从旧快照恢复后消失，可能是正确的Lease语义，不一定表示快照损坏。

因此，本文不把未经证实的推测包装成根因，而是把事故拆成：**已知事实、需要补证的假设、正确机制、恢复Runbook和架构改进**。

## 1. 事故摘要

| 项目 | 现场信息 |
| --- | --- |
| 业务 | 外呼服务发现与拨打节点注册 |
| 影响 | 602个灰度坐席无法拨打电话 |
| 拨打节点 | 10个 |
| etcd | 3.x，具体补丁版本待补充 |
| Backend Quota | 配置为8 GiB，不是etcd默认值 |
| 服务发现 | Key绑定Lease，TTL约5秒 |
| KeepAlive | 应用侧约每秒请求一次，具体SDK模式待确认 |
| 自动压缩 | 未开启 |
| 现场表现 | etcd不可正常写入、服务列表为空 |
| 应急结果 | 24分钟后切回旧系统恢复业务 |
| 尚待证明 | 40 million Revision的真实写入者、Alarm类型、quorum和快照失败原因 |

etcd当前默认Backend Quota为2 GiB；8 GiB表示环境显式调整过 `--quota-backend-bytes`。排障时不能把“磁盘8GB”“Backend文件8GB”和“Quota 8GiB”混为一谈。

## 2. 业务为什么会被etcd放大

外呼服务的控制链路可以抽象为：

```text
拨打节点启动
→ Grant Lease
→ Put /dialer/nodes/<node-id> 并绑定Lease
→ 持续KeepAlive

坐席发起拨打
→ 外呼服务读取或Watch节点目录
→ 选择可用节点
→ 发起拨打
```

如果Lease到期，绑定Key会被删除，Watch收到Delete事件。节点列表为空后，调度逻辑没有可选执行节点，所有请求快速失败。

风险并不只在etcd：业务把“控制面暂时不可用”直接转换成“数据面没有任何可用节点”。如果客户端没有本地缓存、宽限期、重新注册和降级策略，几秒钟的Lease问题就可能影响全部坐席。

## 3. 24分钟时间线

| 时间 | 动作 | 结果 | 复盘评价 |
| --- | --- | --- | --- |
| 14:05 | 收到外呼异常，发现节点列表为空 | 确认业务影响 | 应先同步启动流量回退计时器 |
| 14:12 | 重启etcd成员 | 空间问题未消失 | 重启不会回收Backend历史或碎片 |
| 14:15 | 尝试执行Compaction | 命令失败 | 应保存具体Endpoint和错误，不能只写“unhealthy” |
| 14:20 | 文件系统由8 GiB扩至16 GiB | etcd仍不可正常服务 | Quota是否同步修改、Alarm是否解除均待确认 |
| 14:25 | 尝试从快照恢复 | 失败 | 需区分完整性失败、启动参数错误、RPO过旧和Lease过期 |
| 14:29 | 流量切回旧系统 | 坐席恢复 | 业务止血成功，但可更早并行执行 |

业务恢复优先于技术好奇心。若旧系统是经过演练的可用回退路径，应在排查etcd的同时准备切流，而不是完成四轮失败尝试后才开始。

## 4. 第一处校正：Lease KeepAlive不会持续制造MVCC Revision

### 4.1 什么操作会推进Revision

etcd的MVCC Revision表示Key-Value存储的全局逻辑版本。典型写操作会推进Revision：

- Put新Key；
- 更新已有Key的Value或Lease关联；
- Delete；
- 含写操作的成功Transaction；
- Lease过期或Revoke后删除关联Key。

同一个Key反复Put会保留多个历史版本，直到Compaction让旧版本不可访问。

### 4.2 KeepAlive与Put不是一回事

Lease KeepAlive刷新Lease的剩余TTL。etcd服务端源码明确把Lease Renew与Put/Lease Grant区分：正常Renew直接交给Lessor处理，Renewal不经过常规Raft写提交流程。

因此：

```text
每秒调用Lease KeepAlive
≠ 每秒Put一次注册Key
≠ 每秒产生一个新的MVCC Revision
```

KeepAlive仍然有成本，包括gRPC流、Leader处理、Lease数据结构、认证检查和响应；某些版本与配置还涉及Lease Checkpoint。但不能用：

```text
10节点 × 1次/秒 × 运行天数
```

直接计算MVCC Revision数量或Backend历史体积。

### 4.3 可能真正产生4000万Revision的路径

需要检查客户端是否做了以下事情：

- 每秒重新Put注册Key，而不只是KeepAlive；
- 每次心跳把时间戳、负载或状态写回Value；
- KeepAlive失败后频繁Grant新Lease并重新Put；
- 多个实例对同一Prefix持续更新；
- 另一个业务共享同一etcd并产生大量写；
- 任务、锁、选主或队列Key不断创建和删除；
- Transaction即使Value相同仍执行了真实写分支。

如果没有客户端代码、Prefix采样、Put/Txn指标和Revision增长曲线，就不能把4000万Revision归因于Lease KeepAlive。

### 4.4 如何用实验验证

在隔离测试etcd中：

```text
记录当前Revision
→ Grant一个Lease
→ Put一个绑定Lease的Key
→ 连续KeepAlive但不再Put
→ 再次读取Revision
→ 对比etcd_mvcc_put_total和Lease Renew指标
```

然后再运行“每秒Put同一个Key”的对照组。读者会看到两种客户端行为对MVCC历史的影响完全不同。

## 5. 第二处校正：NOSPACE不是Raft多数派被破坏

### 5.1 Quota是保护机制

`--quota-backend-bytes`限制的是etcd Backend数据库大小。任一成员超过配额时，etcd触发集群级 `NOSPACE` Alarm，进入受限维护模式，拒绝会继续扩大Keyspace的常规写入，主要允许读取和删除等维护操作。

常见客户端错误：

```text
etcdserver: mvcc: database space exceeded
```

这与主机文件系统返回的错误不同：

```text
no space left on device
```

前者可能是Backend尚有文件系统空间，但碰到了etcd逻辑Quota；后者是底层文件系统真的耗尽，可能让WAL、Backend Commit和日志写入都失败。

### 5.2 Raft不会允许成员各自提交不同结果

Raft多数派的意义是让已提交日志形成一致顺序。某个写请求可能超时或向客户端返回 `ErrGRPCNoSpace`，但根据官方维护文档，Quota在API层和Apply层都有检查，个别请求甚至可能已经落入Backend。因此客户端必须做幂等核对。

这不等于：

```text
成员A提交了一份业务状态
成员B提交了另一份业务状态
成员C再提交第三份
```

如果成员Backend真的出现Hash不一致，应看到 `CORRUPT` Alarm、HashKV差异或数据损坏证据，并按照数据损坏Runbook处理。不能因为各成员显示的Applied Index短暂不同，就宣布Raft“账本不一致”。Follower落后和状态机数据损坏是两件事。

### 5.3 NOSPACE与服务列表清空之间还缺证据

仅有NOSPACE Alarm时，已有Lease KeepAlive是否失败、注册Key是否删除，要以具体版本、Leader状态和客户端日志为准。完整链路可能是：

```text
Backend接近Quota
→ 新Lease Grant或注册Put失败
→ 客户端重连后无法重新注册
→ 节点逐渐从目录消失
```

也可能是：

```text
文件系统真正写满或磁盘延迟失控
→ WAL/Backend Commit阻塞
→ Leader或KeepAlive流异常
→ 短TTL Lease到期
→ 节点Key被删除
```

这两条链路的恢复方法和责任归因不同。

## 6. 第三处校正：扩磁盘、调Quota和回收Backend是三件事

### 6.1 三个容量边界

```text
主机文件系统容量
  └─ etcd数据目录、WAL、日志、快照等共同使用

Backend物理文件大小：etcd_mvcc_db_total_size_in_bytes
  └─ 当前数据 + MVCC历史 + 内部可复用空闲页

Backend有效使用量：etcd_mvcc_db_total_size_in_use_in_bytes
  └─ 当前数据 + 尚未压缩的有效历史

逻辑Quota：etcd_server_quota_backend_bytes或启动参数
  └─ etcd主动设置的安全边界
```

扩展文件系统只改变第一层。如果 `--quota-backend-bytes`仍为8 GiB，Backend达到该边界后，16 GiB文件系统也不会自动解除 `NOSPACE` Alarm。

### 6.2 Compaction与Defrag的区别

```text
Compaction
→ 让旧Revision不可再查询
→ 产生Backend内部可复用页
→ 不保证物理DB文件立即缩小

Defrag
→ 重建单个成员Backend
→ 把内部空闲页归还文件系统
→ 在线执行会阻塞该成员读写
```

只开启自动Compaction不代表永远不需要Defrag；只做Defrag而不压缩有效历史，也没有多少空间可以回收。

### 6.3 调大Quota为什么只能作为受控止血

提高Quota可能为在线Compaction和恢复争取空间，但必须同时确认：

- 文件系统有足够剩余空间；
- 所有成员使用一致的Quota配置；
- 内存、快照时间、Defrag时间和恢复RTO可以承受更大Backend；
- 写入增长已经停止或受到限流；
- 后续仍会执行Compaction、Defrag和Alarm Disarm。

单纯把8 GiB改成16 GiB，只是把下一次故障向后推迟。

## 7. 第四处校正：快照恢复失败要分类

“快照恢复失败”至少可能表示：

| 类型 | 典型证据 | 含义 |
| --- | --- | --- |
| 快照完整性失败 | Hash校验失败、文件截断 | 备份制品本身不可用 |
| 工具版本或命令错误 | 参数不兼容、命令不存在 | 恢复流程未适配版本 |
| 恢复到旧数据目录 | Member/Cluster ID冲突 | 操作边界错误 |
| 多成员参数错误 | name、peer URL、initial cluster不一致 | 新逻辑集群无法形成 |
| TLS或客户端配置错误 | 进程已启动但客户端连不上 | 数据可能正常，接入失败 |
| RPO过旧 | 必需配置或用户数据缺失 | 快照可用但恢复点不满足业务 |
| Lease Key消失 | TTL到期、客户端未重新注册 | 临时状态恢复边界，不一定是损坏 |

从etcd 3.6开始，在线保存仍使用 `etcdctl snapshot save`，离线状态检查和恢复使用 `etcdutl snapshot status/restore`。

## 8. 现场第一原则：先止住业务影响

事故处理应并行分为两条线：

```text
业务恢复线
  → 停止继续扩大影响
  → 切备用注册中心/旧系统/静态节点池
  → 验证坐席拨打

技术恢复线
  → 保护现场
  → 判断NOSPACE、磁盘满、无Leader还是CORRUPT
  → 选择在线维护、成员恢复或全量Restore
```

建议预先定义：

- 影响多少坐席或持续多久触发切流；
- 切流由谁批准、谁执行、谁验证；
- 旧系统或静态节点清单最长允许使用多久；
- 恢复期间是否暂停节点注册、发布和自动扩缩容；
- 何时宣布etcd恢复，何时允许回切。

## 9. 现场保护与只读采证

以下命令中的Endpoint和证书路径必须替换为真实值。优先通过健康成员或负载均衡后端逐个访问，不要只查询一个失效VIP。

```bash
etcdctl --endpoints=<ENDPOINTS> endpoint health --cluster
etcdctl --endpoints=<ENDPOINTS> endpoint status --cluster -w table
etcdctl --endpoints=<ENDPOINTS> alarm list
etcdctl --endpoints=<ENDPOINTS> member list -w table
```

同时保存：

```bash
df -h
df -i
du -sh <ETCD_DATA_DIR>
journalctl -u etcd --since '<INCIDENT_START>'
```

从每个成员的Metrics保存：

- `etcd_server_has_leader`；
- `etcd_server_leader_changes_seen_total`；
- `etcd_server_proposals_failed_total`和pending；
- `etcd_disk_wal_fsync_duration_seconds`；
- `etcd_disk_backend_commit_duration_seconds`；
- `etcd_mvcc_db_total_size_in_bytes`；
- `etcd_mvcc_db_total_size_in_use_in_bytes`；
- `etcd_server_quota_backend_bytes`；
- `etcd_mvcc_put_total`、Delete和Txn速率；
- Lease Grant、Renew、Expired和gRPC失败指标，名称按实际版本确认。

不要在采证前执行以下动作：

- 删除 `member/wal`、`member/snap`或整个data-dir；
- 三个成员同时重启；
- 把每个成员分别作为新单节点集群启动；
- 使用 `--force-new-cluster`碰运气；
- 同时对所有在线成员Defrag；
- 把未经验证的快照覆盖原始数据目录。

## 10. 先把故障分成四类

| 分支 | Alarm/状态 | 文件系统 | 处理方向 |
| --- | --- | --- | --- |
| A：Backend Quota | `NOSPACE`，仍有Leader和quorum | 尚有维护空间 | Compact → 逐成员Defrag → Disarm |
| B：文件系统写满 | 可能NOSPACE，也可能WAL/Commit报ENOSPC | 100%或inode耗尽 | 先安全获得文件系统空间，再走A或成员恢复 |
| C：失去quorum | 无Leader，多数成员不可用 | 不一定满 | 恢复多数派或按灾备流程Restore新集群 |
| D：数据损坏 | `CORRUPT`或Hash不一致 | 不一定满 | 替换损坏成员或恢复整个集群 |

`unhealthy`只是健康检查结果，不是根因。必须继续识别它属于哪一类。

## 11. 分支A：NOSPACE但quorum仍在的恢复Runbook

### 11.1 停止异常写入

暂停会持续Put/Txn/Grant Lease的客户端、发布任务和控制器，避免维护过程中Backend继续增长。读流量是否保留取决于容量和业务止血方案。

### 11.2 在可行时保存并校验快照

只对一个健康Endpoint执行在线快照：

```bash
etcdctl --endpoints=<ONE_HEALTHY_ENDPOINT> snapshot save <SAFE_BACKUP_PATH>/before-nospace-recovery.db

etcdutl --write-out=table snapshot status \
  <SAFE_BACKUP_PATH>/before-nospace-recovery.db
```

快照和证书属于敏感数据，应写入容量充足、受控、加密的位置，不能继续写入已经满的etcd数据盘。

### 11.3 选择Compaction Revision

读取当前Revision并结合Watcher保留窗口选择压缩点：

```bash
etcdctl --endpoints=<HEALTHY_ENDPOINT> endpoint status -w json
```

紧急NOSPACE恢复时，官方示例会压缩到当前Revision，以最大化释放旧历史；代价是从更早Revision恢复的Watcher会收到已压缩错误，必须重新List后建立Watch。

```bash
etcdctl --endpoints=<HEALTHY_ENDPOINT> compact <SAFE_COMPACT_REVISION>
```

如果命令失败，必须保留完整错误：

- `no leader`：先恢复quorum；
- `context deadline exceeded`：检查Endpoint、磁盘延迟和超时；
- `required revision has been compacted`：目标已压缩，无需重复；
- TLS/认证错误：修客户端身份；
- `no space left on device`：先处理文件系统分支。

### 11.4 逐成员Defrag

在线Defrag会阻塞目标成员，三节点集群通常按Follower逐个处理，Leader最后处理。每次只指定一个Endpoint：

```bash
etcdctl --endpoints=<FOLLOWER_1_ENDPOINT> defrag
etcdctl --endpoints=<ENDPOINTS> endpoint health --cluster
etcdctl --endpoints=<ENDPOINTS> endpoint status --cluster -w table
```

确认集群和业务稳定后再处理下一个成员。不要直接把 `defrag --cluster`当成无风险的一键修复。

### 11.5 解除Alarm并验证写入

只有所有成员Backend都回到安全水位后才执行：

```bash
etcdctl --endpoints=<ENDPOINTS> alarm list
etcdctl --endpoints=<ENDPOINTS> alarm disarm
```

使用专用健康检查Prefix执行Put/Get/Delete，并核对“之前返回NoSpace的写请求”是否实际成功。业务写入必须具备幂等性，不能无脑重放。

## 12. 分支B：文件系统真的写满

如果出现 `no space left on device`、`df`为100%或inode耗尽，etcd可能连WAL和Backend维护事务都无法可靠完成。

正确顺序：

1. 暂停外部写入和可能增长的本机日志；
2. 确认etcd数据、WAL、日志、快照分别占用多少；
3. 通过扩展文件系统或移动明确可移动的非etcd文件获得维护空间；
4. 不删除未知WAL、Snapshot和Backend文件；
5. 确认成员重新获得稳定I/O和quorum；
6. 如果同时有NOSPACE Alarm，再执行Compaction、逐成员Defrag和Disarm；
7. 修复日志轮转、备份保留和磁盘容量规划。

扩容文件系统在这个分支是必要动作，但它不会替代Backend维护，也不会自动修改etcd逻辑Quota。

## 13. 分支C：失去quorum或Leader

三成员集群至少需要两个成员正常参与共识。没有quorum时，在线Compaction无法通过Raft提交。

先判断：

- 是进程未启动、端口不通、证书过期，还是磁盘阻塞；
- 成员目录是否仍完整；
- Member ID、Cluster ID和initial cluster配置是否一致；
- 能否恢复至少两个原成员；
- 是否只有一个成员损坏，可以通过标准Member Replace恢复。

不要在原成员数据仍可能恢复时立即Restore旧快照。快照恢复会创建新的逻辑集群并改变成员/集群身份，属于灾难恢复，不是普通重启。

只有原集群无法恢复多数派，且业务接受对应RPO时，才进入全量Snapshot Restore流程。

## 14. 分支D：CORRUPT与数据不一致

真正的数据不一致需要证据：

- `CORRUPT` Alarm；
- 同Revision的HashKV不一致；
- 启动时initial corruption check失败；
- Backend或WAL校验错误；
- 官方数据损坏检查给出差异。

处理通常是清除损坏成员的持久状态并通过成员替换重新同步；如果多数成员损坏，则恢复整个集群。不要把Quota Alarm等同于Corrupt Alarm。

## 15. 快照恢复必须创建新的逻辑集群

### 15.1 保存与检查

```bash
etcdctl --endpoints=<ONE_ENDPOINT> snapshot save snapshot.db
etcdutl --write-out=table snapshot status snapshot.db
```

`snapshot status`验证Hash、Revision、Key数量和大小，但仍不能证明业务能在目标环境恢复。

### 15.2 隔离演练Restore

使用与目标etcd兼容的 `etcdutl`，恢复到新的空目录：

```bash
etcdutl snapshot restore snapshot.db \
  --name restore-test \
  --data-dir <NEW_EMPTY_DATA_DIR> \
  --initial-cluster restore-test=http://127.0.0.1:12380 \
  --initial-advertise-peer-urls http://127.0.0.1:12380 \
  --initial-cluster-token restore-drill-<UNIQUE_ID>
```

这个示例只用于隔离单节点验证。生产三成员恢复必须为每个成员使用一致的initial cluster清单、不同name/peer URL和独立数据目录，并按目标版本官方文档执行。

绝不能把Restore直接指向原生产data-dir。先保留原始目录和快照副本，确认新集群完整可用后再设计切换。

### 15.3 恢复要验证业务语义

除了etcd进程健康，还要验证：

- 关键Prefix、配置、租户和权限数量；
- Key的Value、Lease关联和Revision；
- 客户端TLS、认证与RBAC；
- Watcher能否重新List/Watch；
- 上游服务能否重新注册临时节点；
- 外呼调度是否获得可拨打节点；
- 快照RPO以内发生的业务变化如何对账。

服务发现节点属于临时状态。恢复旧快照后，不应把快照中的旧拨打节点直接当成仍然存活；真正在线的进程必须重新Grant Lease、Put并KeepAlive。若应用不能在Lease丢失后自动重新注册，这是客户端恢复能力缺陷。

## 16. 如何重新调查“4000万Revision”

### 16.1 先证明Revision增长速度

定期采样Endpoint Status中的当前Revision，计算单位时间增量。不要从Backend大小倒推出Revision数量，因为每个Value大小、索引、Lease和碎片比例都不同。

可结合实际版本指标：

```promql
sum by (cluster) (rate(etcd_mvcc_put_total[5m]))

sum by (cluster) (rate(etcd_mvcc_delete_total[5m]))

sum by (cluster) (rate(etcd_mvcc_txn_total[5m]))
```

### 16.2 再定位写入Prefix和客户端

etcd没有默认提供“每个Prefix占多少历史空间”的完整账单。可以通过：

- 客户端埋点和审计日志；
- gRPC方法、证书身份和来源地址；
- 测试环境抓取写请求；
- 对当前Key数量、Value大小和Prefix分布采样；
- 代码检查心跳究竟调用KeepAlive还是Put/Txn；
- 逐个暂停非关键写入方观察Revision斜率。

不要在生产Keyspace上执行无界全量Range作为排障命令；Prefix扫描要限制范围、数量和一致性需求。

### 16.3 建立可证伪假设

| 假设 | 支持证据 | 反证 |
| --- | --- | --- |
| 每秒重写注册Key | Put速率约等于节点心跳速率，代码中有Put | KeepAlive增长但Put与Revision不增长 |
| Lease频繁丢失重建 | Grant/Revoke/Expired和重注册同时增长 | Lease ID长期稳定 |
| 其他共享业务写爆 | 其他Prefix/客户端写速率占主导 | 隔离后Revision斜率不变 |
| 当前数据本身很大 | in-use与Key/Value数量匹配 | Compaction后in-use大幅下降 |
| 主要是碎片 | total远高于in-use | 两者接近且同步增长 |

只有这张表中的证据闭环后，才能写最终RCA。

## 17. Auto Compaction应该怎么配置

时间窗口模式示例：

```text
--auto-compaction-mode=periodic
--auto-compaction-retention=1h
```

Revision数量模式示例：

```text
--auto-compaction-mode=revision
--auto-compaction-retention=10000
```

`1h`不是所有集群的标准答案。保留窗口至少要覆盖：

- Watcher最长断线和重连时间；
- 客户端从旧Revision续接的需求；
- 故障排查和审计历史；
- 写入速率变化；
- Compaction对P99的影响；
- Backend增长速度和Quota余量。

高频更新同一Key的集群可以使用较短窗口，通用配置可能保留更长历史。修改后要验证Watcher收到Compacted错误时能够重新List并继续Watch。

## 18. Defrag应该按碎片和窗口执行

碎片率可以近似观察为：

```text
1 - in_use_size / total_size
```

只有total明显高于in-use时，Defrag才有较大物理回收收益。策略应包含：

- 触发水位和最小可回收字节数；
- 一次只处理一个成员；
- Follower优先、Leader最后；
- 避开业务峰值；
- 每个成员完成后检查Leader、Raft Index、P99和Alarm；
- 超时、阻塞或业务抖动时停止处理下一成员。

Compaction可以自动化，在线Defrag需要更谨慎的编排和验收。

## 19. Quota与磁盘容量规划

Quota不能等于磁盘总容量。磁盘还要容纳：

- Backend临时增长和Defrag所需空间；
- WAL和Raft Snapshot；
- 日志；
- 在线快照或本地备份；
- 文件系统保留空间；
- 故障恢复操作余量。

需要同时定义：

```text
Backend有效数据上限
MVCC历史窗口预算
允许碎片预算
Quota
主机磁盘容量
告警到处置所需时间
峰值增长率
```

容量告警不应只写死“75%”。还应计算增长速度和耗尽时间：一个长期稳定在80%的集群可能有充足窗口，一个从40%快速升到60%的集群可能数小时后就触发Alarm。

PromQL思路：

```promql
etcd_mvcc_db_total_size_in_bytes
/
etcd_server_quota_backend_bytes
```

预测未来数小时的Backend大小：

```promql
predict_linear(etcd_mvcc_db_total_size_in_bytes[6h], 4 * 3600)
```

正式规则需要按集群和成员正确匹配Quota标签，并结合主机磁盘剩余量、in-use、碎片率和业务峰值校准。

## 20. Lease TTL与续约频率怎么设计

把TTL从5秒改成30秒可能降低误过期和重注册压力，但不能用“Revision减少90%”作为理由，因为正常KeepAlive并不持续推进MVCC Revision。

TTL应综合：

```text
故障检测目标
+ 网络P99与短时抖动
+ Leader选举和客户端重连
+ GC/Safepoint与进程停顿
+ etcd过载时的响应延迟
+ 误摘除成本
+ 业务降级能力
```

官方Go客户端的持续KeepAlive会根据TTL安排刷新并复用双向流，应用一般不需要自己每秒创建新连接。需要验证：

- 是否使用长连接流式KeepAlive；
- 是否消费KeepAlive响应并处理Channel关闭；
- Lease Not Found后是否重新Grant、Put和Watch；
- 多个Key能否共享合理粒度的Lease；
- 客户端是否存在每秒Put“保活”的反模式；
- 服务发现是否能容忍短时etcd不可用。

## 21. 服务发现层的容灾改进

即使etcd完全正确，业务也不应把短暂控制面故障立即扩大到602个坐席。

可评估：

- 客户端缓存最后一次已知健康节点，并设置有界陈旧窗口；
- 节点列表突然变为空时二次确认，而不是瞬间清空全部数据面；
- 拨打节点在Lease丢失后自动重注册；
- 注册失败时进入明确告警状态；
- 外呼入口保留经过演练的备用池或旧系统切换；
- 把控制面不可用和拨打节点真实失效区分开；
- 对陈旧节点请求使用快速健康探测和熔断；
- 回退与回切都使用自动化清单和验收指标。

缓存会带来把请求发给失效节点的风险，所以必须有最大陈旧时间和调用级失败隔离，不能无限使用旧列表。

## 22. 备份体系的正确完成标准

```text
Snapshot Save成功
≠ Snapshot Status成功
≠ Restore命令成功
≠ etcd集群可启动
≠ 客户端可连接
≠ 业务恢复完成
```

完整演练应验证：

1. 从指定健康Endpoint保存快照；
2. 计算Hash并记录Revision、Key数量和大小；
3. 加密并复制到独立故障域和不可变存储；
4. 在隔离环境恢复新的逻辑集群；
5. 启动与原版本兼容的成员；
6. 使用正式TLS和认证客户端访问；
7. 校验关键Prefix和业务对象；
8. 让服务发现客户端重新注册临时状态；
9. 记录实际RPO、RTO和人工步骤；
10. 定期销毁演练环境并保留报告。

每月演练不一定适合所有团队，但演练周期必须小于组织能够接受的“恢复流程失效未被发现时间”。

## 23. 监控与告警清单

### 23.1 Backend与主机容量

- [ ] Backend total、in-use和两者差值
- [ ] Backend/Quota比例
- [ ] Backend增长率与预计耗尽时间
- [ ] 数据盘剩余字节和inode
- [ ] WAL、日志和备份目录增长
- [ ] 每次Compaction和Defrag结果

### 23.2 Raft与磁盘延迟

- [ ] 是否有Leader
- [ ] Leader变更
- [ ] Proposal pending、failed和committed
- [ ] 各成员Raft Term、Index和Applied Index
- [ ] WAL fsync P99
- [ ] Backend commit P99
- [ ] Peer网络失败与RTT

### 23.3 MVCC与Lease

- [ ] Put、Delete和Txn速率
- [ ] 当前Revision增长率
- [ ] Compacted Revision与历史窗口
- [ ] Lease Granted、Renewed、Expired和Revoked
- [ ] LeaseKeepAlive gRPC错误率和延迟
- [ ] Watch数量、慢Watcher和Compacted错误

### 23.4 备份与恢复

- [ ] 最近成功快照时间、Revision和Hash
- [ ] 异地副本和不可变副本
- [ ] 最近一次Restore演练时间
- [ ] Restore后业务校验结果
- [ ] 实测RPO和RTO

## 24. 改进后的事故处置时间线

同类事故再次发生时，建议：

```text
T+0      告警触发，确认坐席影响和etcd写失败
T+2m     冻结非必要写入，旧系统切流准备并行启动
T+4m     endpoint status + alarm list + df完成故障分类
T+6m     达到业务阈值即切流，不等待etcd排查结束
T+8m     quorum仍在：快照、Compact、逐成员Defrag
         quorum丢失：恢复原多数派或启动灾备Restore
T+?      Disarm、健康写测试、节点重新注册
T+?      Canary回切，观察后逐步恢复
```

时间只是示例，实际阈值应通过演练确定。关键是业务恢复和etcd恢复并行，且每个决策有明确截止时间。

## 25. 最终RCA应该怎么写

在证据补齐前，建议使用分层结论：

### 25.1 已确认事实

- Backend达到配置的8 GiB边界或文件系统空间异常；
- etcd无法正常接受业务所需写操作；
- 服务发现节点列表最终为空；
- 602个坐席无法拨打；
- 24分钟后通过切回旧系统恢复。

### 25.2 高可信因果链

```text
etcd存储维护和容量治理缺失
→ 空间边界触发
→ 注册中心无法提供业务所需可写能力
→ 短TTL临时节点未能维持或恢复注册
→ 外呼调度没有可选节点
→ 灰度坐席拨打失败
```

### 25.3 尚待补证

- Backend增长是否主要来自外呼系统；
- 外呼客户端调用的是Lease KeepAlive还是周期Put；
- 4000万Revision由哪些Prefix和客户端产生；
- 现场是NOSPACE、文件系统ENOSPC、无Leader还是CORRUPT；
- Compaction失败的原始错误；
- 扩容后Quota是否修改、Alarm是否Disarm；
- 快照是完整性失败、Restore参数失败，还是业务临时Key过期。

不能把“待补证”部分写成确定事实。

## 26. 复盘Checklist

- [ ] `--auto-compaction-mode`和retention已按Watcher窗口配置
- [ ] Compaction后有基于碎片率的逐成员Defrag策略
- [ ] Backend total/in-use、Quota和主机磁盘同时监控
- [ ] 告警包含增长率和预计耗尽时间
- [ ] 能区分NOSPACE、ENOSPC、NO LEADER和CORRUPT
- [ ] 客户端Put/Txn与Lease Renew速率可观察
- [ ] 已验证KeepAlive不会被误实现为周期Put
- [ ] Lease TTL覆盖网络、选举、GC和重连抖动
- [ ] Lease丢失后客户端会自动重新注册
- [ ] 服务列表为空时存在有界降级策略
- [ ] 快照使用正确工具保存和校验
- [ ] Restore在隔离环境定期演练
- [ ] 临时Lease数据和持久业务数据分别定义恢复语义
- [ ] 业务切流阈值、执行人和回切步骤已演练
- [ ] 所有恢复操作保留完整命令、输出和时间线

## 27. 本篇小结

这起事故真正暴露的不是“一行自动压缩参数没写”，而是四层防线同时缺失：

```text
存储层：没有历史窗口、碎片和Quota治理
观测层：没有提前发现增长和耗尽时间
恢复层：快照没有经过端到端Restore演练
业务层：控制面短暂失效立即清空全部可用节点
```

更重要的是，故障复盘必须尊重分布式系统的真实机制：

- KeepAlive不是Put；
- NOSPACE不是CORRUPT；
- Follower暂时落后不是数据分叉；
- Compaction不是Defrag；
- 扩磁盘不是调Quota；
- 快照文件存在不是业务可恢复。

一个好的RCA不只是讲出一个顺畅故事，而是让每一条因果关系都能被日志、指标、源码、实验或变更结果验证。

## 28. 相关学习

- [WAL、Snapshot、bbolt、Compaction、Defrag与Quota](../../cloud-native/etcd/05-etcd-WAL-Snapshot-bbolt-Compaction-Defrag与Quota.md)
- [Kubernetes etcd备份、控制面故障和恢复边界](../../cloud-native/etcd/11-Kubernetes-etcd备份控制面故障与恢复边界.md)
- [etcd读一致性、延迟、吞吐与容量规划](../../cloud-native/etcd/09-etcd读一致性延迟吞吐fsync与容量规划.md)

## 29. 参考资料

- [etcd：Maintenance](https://etcd.io/docs/v3.7/op-guide/maintenance/)
- [etcd：Configuration options](https://etcd.io/docs/v3.7/op-guide/configuration/)
- [etcd：Disaster recovery](https://etcd.io/docs/v3.7/op-guide/recovery/)
- [etcd：Data corruption](https://etcd.io/docs/v3.7/op-guide/data_corruption/)
- [etcd：Lease API](https://etcd.io/docs/v3.7/learning/api/)
- [etcd服务端Lease Renew实现](https://github.com/etcd-io/etcd/blob/main/server/etcdserver/v3_server.go)
