---
title: "Member Add/Remove/Replace、Learner、扩缩和滚动升级"
sidebar_label: "07. Member Add/Remove/Replace、Learner、扩缩和滚动升级"
sidebar_position: 7
description: "安全执行 etcd 成员添加、Learner 追平、移除替换和逐成员升级。"
tags: [etcd, Member, Learner, Upgrade]
---

# Member Add/Remove/Replace、Learner、扩缩和滚动升级

> 本文以 etcd 3.6 为基线。成员变更会改变 quorum，是生产变更，不是在服务器上增删一个进程那么简单。

成员列表保存在 etcd 内部，变更也必须通过 Raft 提交。执行前必须同时满足：当前集群有多数派、所有既有成员身份明确、最近快照可恢复、peer 地址已验证，并且本次只改变一个成员。

```bash
etcdctl --endpoints="$ETCD_ENDPOINTS" endpoint health --cluster
etcdctl --endpoints="$ETCD_ENDPOINTS" endpoint status --cluster -w table
etcdctl --endpoints="$ETCD_ENDPOINTS" member list -w table
etcdctl --endpoints="$ETCD_ENDPOINTS" alarm list
```

把输出附到变更单：谁是 Leader、每个 Member ID 对应哪台机器/数据目录、Raft applied index 是否接近、有没有 Learner 和 Alarm。`strict-reconfig-check` 默认启用，它会拒绝明显导致已启动成员少于新 quorum 的变更，但不能替你发现错误证书、错误磁盘或错误主机。

## 1. 扩容：先加 Learner，再提升为投票成员 {/* #扩容先加-learner再提升为投票成员 */}

```text
member add --learner
→ 用命令输出生成新成员配置
→ 使用全新空 data-dir 启动
→ Learner 从 Leader 复制日志和快照
→ 追平后 member promote
→ 再次验证 quorum 和业务
```

Learner 不参与投票，因此尚未追平或配置错误时不会立即提高 quorum。它仍会增加 Leader 的复制与网络负担，所以不要并行添加多个。etcd 只有在 Learner 的 Raft 日志充分追平后才允许提升；提升失败通常不是“强制一下”，而是继续排查网络、磁盘和复制进度。

```bash
# 在现有健康成员上执行
etcdctl --endpoints="$ETCD_ENDPOINTS" member add etcd-4 \
  --peer-urls=https://10.0.0.14:2380 \
  --learner

# 将命令返回的 ETCD_NAME、ETCD_INITIAL_CLUSTER、
# ETCD_INITIAL_CLUSTER_STATE=existing 写入新节点配置，再以空目录启动。

etcdctl --endpoints="$ETCD_ENDPOINTS" member list -w table
etcdctl --endpoints="$ETCD_ENDPOINTS" endpoint status --cluster -w table

# 用 member list 得到真实 ID，确认追平后再提升
etcdctl --endpoints="$ETCD_ENDPOINTS" member promote <LEARNER_MEMBER_ID>
```

验收不能只看进程是 `active`：新 Endpoint 必须健康，Member ID、name、peer URL 正确，Raft applied index 接近 Leader，提升后全体仍能读写，业务错误率与 P99 没有恶化。

若新成员迟迟无法启动，先停止它，修正 peer TLS、地址或数据盘；如果要撤回本次扩容，使用 `member remove <LEARNER_MEMBER_ID>` 删除这条成员记录，再清理明确对应的新 data-dir。不要在失败记录还存在时反复 `member add`。

## 2. 替换失败成员 {/* #替换失败成员 */}

少数派成员永久损坏时，正确路径是“删除旧身份，再添加新身份”，不是复制目录或改 Pod 名：

1. 确认剩余成员仍有 quorum，并冻结其他成员变更。
2. 从 `member list` 精确找到故障 Member ID，核对主机、peer URL 和故障证据。
3. 执行 `member remove <OLD_MEMBER_ID>`。
4. 以新的 name/peer URL 执行 `member add --learner`。
5. 在新机器使用空 data-dir 和命令返回的 `existing` 集群配置启动，追平后提升。
6. 验证快照、Endpoint、Raft index、Alarm 和业务。

:::warning
删除 Member 后，旧 data-dir 的身份已被永久移除。不要让旧进程重新上线，也不要让新进程复用旧目录；etcd 会拒绝已移除身份，而人工绕过保护可能造成更严重的数据一致性问题。
:::

若已经失去多数派，就不能再执行正常 `member remove/add`。这已是灾难恢复场景，应转到 Snapshot Restore，而不是用 `--force-new-cluster` 盲目拉起旧目录。

## 3. 缩容：先改成员列表，再回收实例 {/* #缩容先改成员列表再回收实例 */}

```bash
etcdctl --endpoints="$ETCD_ENDPOINTS" member remove <MEMBER_ID>
etcdctl --endpoints="$ETCD_ENDPOINTS" member list -w table
etcdctl --endpoints="$ETCD_ENDPOINTS" endpoint health --cluster
```

先提交 `member remove`，确认新配置生效，再停止被移除进程并回收明确对应的 PVC/磁盘。直接删除 Pod 或虚机不会删除 Member，它只会让集群长期背着一个离线投票者。

三节点缩成二节点不会减少 quorum：二节点仍需两票，反而失去单故障容忍；生产通常保持奇数投票成员。五缩三需要逐个删除，每次都等待新配置稳定，不能一次提交两个删除再看结果。

## 4. 修改 Peer 地址 {/* #修改-peer-地址 */}

只修改 `--initial-advertise-peer-urls` 并重启会让本地配置与集群成员记录不一致。正确顺序是先提交集群级更新，再用同一 URL 重启目标成员：

```bash
etcdctl --endpoints="$ETCD_ENDPOINTS" member update <MEMBER_ID> \
  --peer-urls=https://10.0.0.24:2380
```

更新前必须保证新地址的 DNS/IP、SAN、防火墙和监听配置已经准备好，并留有可恢复的旧配置。Client advertise URL 则由成员重启后自行发布，但同样要验证客户端发现与证书 SAN。

## 5. 滚动升级 {/* #滚动升级 */}

升级前阅读目标版本的**具体升级页**，确认支持的版本跨度、降级条件、客户端/Kubernetes 兼容性、已废弃参数和 Feature Gate；不要只看通用升级首页。保存并校验快照，同时保留旧二进制和配置，但不要把“有快照”误认为可以随时原地降级 data-dir。

推荐顺序：

1. 记录基线：版本、Leader、Member ID、Raft index、DB size、Alarm、业务 P99。
2. 先升级一个 follower，等待 Endpoint 恢复并追平。
3. 完成一次真实业务读写和快照检查，再处理下一个 follower。
4. 最后处理 Leader；必要时先主动迁移 Leader，减少不可控选举窗口。
5. 所有成员完成后检查集群版本、指标、日志和客户端兼容。

每一步的继续条件都是“该成员已经健康且集群重新具备原有冗余”，而不是“服务进程启动成功”。若第一台升级后出现持续选举、Raft lag、x509、数据格式或业务错误，立即停止后续升级，保留现场，按该版本官方 downgrade/rollback 条件判断能否回退二进制；不要把旧快照只恢复到单个仍在运行的集群成员。

## 6. 常见错误与判断 {/* #常见错误与判断 */}

| 现象 | 原因方向 | 正确动作 |
| --- | --- | --- |
| `unmatched member while checking PeerURLs` | 启动配置与 `member add` 登记地址不一致 | 使用 add 输出的完整成员列表和 peer URL |
| `can only promote a learner member which is in sync` | Learner 尚未追平 | 查网络、磁盘、Leader 负载和 Raft lag，等待后重试 |
| 新 Pod 一直 CrashLoop，旧 Member 仍在 | 只替换了工作负载，没改成员身份 | 核对 Member ID，按 replace 流程处理 |
| 删除一个三节点成员后又坏一台 | 变更期间冗余不足 | 停止操作，判断是否还存在 quorum；无 quorum 转灾难恢复 |
| 升级第一台后 P99 飙升 | 版本/参数/磁盘或选举异常 | 不再升级下一台，先恢复基线并确定回退边界 |

## 7. 验收题 {/* #验收题 */}

- Learner 为什么不立即投票？
- 删除 Pod 与 member remove 有何不同？
- 替换成员为何要空 data dir？
- 五节点能否同时升级两个？为什么不建议？
- 已失去多数派时，为什么正常成员变更命令无法救回集群？
- 修改 peer URL 为什么要先执行 `member update`？

## 8. 参考资料 {/* #参考资料 */}

- [Runtime reconfiguration](https://etcd.io/docs/v3.6/op-guide/runtime-configuration/)
- [Upgrade](https://etcd.io/docs/v3.6/upgrades/)
- [Disaster recovery](https://etcd.io/docs/v3.6/op-guide/recovery/)
