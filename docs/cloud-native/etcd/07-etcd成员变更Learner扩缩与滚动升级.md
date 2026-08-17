---
title: "Member Add/Remove/Replace、Learner、扩缩和滚动升级"
sidebar_position: 7
tags: [etcd, Member, Learner, Upgrade]
description: "安全执行 etcd 成员添加、Learner 追平、移除替换和逐成员升级。"
---

# Member Add/Remove/Replace、Learner、扩缩和滚动升级

成员变更本身通过 Raft 提交。任何时候保持原集群多数派，且一次只改变一个成员。

## 添加 Learner

```text
member add --learner
→ provision new empty data dir with existing cluster config
→ start learner and replicate
→ monitor raft index lag
→ member promote after caught up
```

Learner 不投票，避免未追平节点改变 quorum。提升前确认 lag 和健康；集群通常限制 Learner 数量。

## 替换失败成员

确认剩余 quorum → remove 旧 member ID → add 新 peer URL → 空目录启动 existing → 追平。不要让新进程复用旧 identity/data dir，也不要仅改 StatefulSet Pod 名。

## 缩容

先 member remove，再停进程/回收 PVC。三缩二不会容忍任何故障，通常保持三；五缩三需逐个操作并观察。

## 滚动升级

验证支持的版本跨度、客户端/Kubernetes兼容和 snapshot。一次一个 follower，追平后再下一个，最后 leader；每步检查 endpoint status、term/index、alarm 和业务。版本功能/存储升级后降级受限，保留官方 downgrade 点。

## 验收题

- Learner 为什么不立即投票？
- 删除 Pod 与 member remove 有何不同？
- 替换成员为何要空 data dir？
- 五节点能否同时升级两个？为什么不建议？

## 参考资料

- [Runtime reconfiguration](https://etcd.io/docs/v3.6/op-guide/runtime-configuration/)
- [Upgrade](https://etcd.io/docs/v3.6/upgrades/)
