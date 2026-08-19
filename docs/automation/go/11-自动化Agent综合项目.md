---
title: "Go 自动化 Agent 综合项目"
sidebar_label: "11. 自动化 Agent 综合项目"
sidebar_position: 11
description: "构建从控制面领取只读任务、执行受限插件、续租、取消、输出证据并安全升级的 Go Agent。"
tags: [Go, Agent, Worker, 自动化, 综合项目]
---

# Go 自动化 Agent 综合项目

## 1. 目标

Agent 从控制面领取签名任务，只执行允许列表中的只读检查。具备租约、心跳、Deadline、有界并发、取消、结果上传和优雅退出。

## 2. 结构

```text
cmd/agent
internal/controlplane
internal/executor
internal/plugins
internal/evidence
internal/identity
internal/observability
```

## 3. 主路径

```text
建立机器身份
→ 长轮询/流式领取任务
→ 验证 Schema、签名、目标和能力
→ 获取租约
→ 有界 Worker 执行
→ 续租与心跳
→ 上传分片结果
→ 提交最终状态和证据摘要
```

## 4. 安全

- Agent 非 root，按插件授予最小 Capability。
- 控制面和 Agent 双向认证。
- 任务包含唯一 ID、Deadline、Nonce 和允许操作。
- 禁止任意 Shell 字符串。
- Secret 按任务短期获取，不落盘。
- 本地 Spool 有容量和保留限制。

## 5. 故障

控制面断开时停止领取，已领取任务按租约策略完成或取消。结果上传失败进入有界 Spool；磁盘满时停止新任务。Agent 崩溃后控制面把任务标为 Unknown，查询或人工确认后再重试。

## 6. 升级

```text
新 Agent 协议兼容验证
→ 1 个测试节点
→ 少量生产节点
→ 观察任务成功率、延迟和泄漏
→ 分批推广
```

升级前排空或转移任务，保留旧制品和回滚配置。

## 7. 验收

- [ ] 所有 Goroutine 在取消后收敛。
- [ ] 并发、队列、Spool 和结果大小有限。
- [ ] 重复任务不重复产生副作用。
- [ ] 断网、磁盘满和 Worker 崩溃得到 Unknown/Partial 状态。
- [ ] Race、Fuzz、集成和升级回滚测试通过。
- [ ] 任务、Agent 版本、Commit、制品 Digest 和证据可关联。
