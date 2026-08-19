---
title: "State、Backend、锁与恢复"
sidebar_label: "06. State、Backend、锁与恢复"
sidebar_position: 6
description: "理解 State 内容、远程 Backend、锁、敏感信息、备份、State 子命令和灾难恢复边界。"
tags: [Terraform, State, Backend, Lock, Disaster Recovery]
---

# State、Backend、锁与恢复

## 1. State 保存什么

State 保存资源地址、远端 ID、属性、依赖和元数据。即使 Output 标记 Sensitive，底层属性仍可能存在 State 中。

```bash
terraform state list
terraform state show <address>
terraform show
```

输出进入工单前脱敏。

## 2. 远程 Backend

生产 Backend 需要：

- 传输和静态加密。
- 最小读写权限。
- 版本控制/快照和删除保护。
- 锁或等价并发机制。
- 审计。
- 跨故障域恢复能力。

并非所有 Backend 都提供相同锁和一致性语义，以所选实现为准。

## 3. 锁

锁防止两个写操作同时修改 State，不阻止外部控制台修改资源。确认没有活动 Apply 后才能处理遗留锁；强制解锁必须记录锁 ID、任务和操作者。

## 4. Backend 配置

Backend 凭据不写入代码和 Plan 命令行。初始化迁移前备份当前 State，确认源/目标 Backend、Workspace 和账号，先在测试副本演练。

## 5. State 操作

`state mv/rm` 等直接改变映射，风险很高。优先使用配置中的 Moved/Removed/Import 能力，使变更可评审。必须直接操作时：

1. 停止并发运行。
2. 备份 State。
3. 保存命令和完整地址。
4. 在副本演练。
5. 操作后运行全量 Plan。

## 6. 恢复

```text
冻结 Apply
→ 保存当前 State/日志/锁信息
→ 对比 Backend 历史版本
→ 确认远端真实资源
→ 在隔离副本验证恢复 State
→ 恢复后全量 Plan
→ 小范围 Apply 与验收
```

恢复旧 State 不会自动恢复远端资源，错误版本可能导致下一次 Plan 大量重建。

## 7. State 不是备份

它不保存数据库内容、磁盘数据和完整云配置历史。资源数据仍需独立备份和灾难恢复。
