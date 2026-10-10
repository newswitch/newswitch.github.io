---
title: "State、Backend、锁、加密与恢复"
sidebar_label: "06. State、Backend、锁与恢复"
sidebar_position: 6
description: "理解 State 对象绑定、Backend 持久化和锁语义，治理敏感数据、版本、OpenTofu 加密、强制解锁与灾难恢复。"
tags: [Terraform, OpenTofu, State, Backend, Lock, Disaster Recovery]
---

# State、Backend、锁、加密与恢复

State 是 IaC 控制面的核心数据。源码丢失可以从 Git 恢复，State 错误却可能让下一次 Plan 试图重复创建、错误替换或删除真实资源。

## 1. State 中保存什么

```text
资源实例地址
↔ 远端对象身份
+ Provider 配置元数据
+ 已知属性与依赖
+ Output
+ Schema/State 版本信息
```

查看命令：

```bash
terraform state list
terraform state show 'example_server.node["node-a"]'
terraform show
```

输出可能包含敏感属性，不能直接粘贴到公开工单或聊天。

## 2. 一对一绑定原则

一个远端对象应只绑定一个资源实例地址，一个地址也只拥有一个对象。若同一个云资源被导入两个 State，两个控制面可能互相覆盖；若地址被 `state rm` 后配置仍存在，下次 Plan 可能创建重复对象。

State 命令修改的是绑定，不一定修改远端对象。每次操作前必须明确“我要改映射还是改资源”。

## 3. 本地 State 与远程 Backend

本地 Backend 适合实验，State 位于工作目录；生产协作应使用提供安全访问、版本和锁语义的远程 Backend。

Backend 要求：

- 传输与静态加密；
- 最小读写/管理权限分离；
- 乐观/悲观锁或等价并发控制；
- 对象版本、快照和删除保护；
- 审计与异常访问告警；
- 跨故障域恢复；
- 明确一致性和最大对象限制。

不同 Backend 的锁和恢复能力不同，不能因为名为“remote”就假设全部具备。

## 4. Backend 凭据与配置

Backend 初始化发生在 Provider 之前，凭据来源也不同。不要把密钥写入 HCL、`-backend-config=secret=...` 命令行或 CI 日志。

优先使用环境身份、OIDC/STS、托管身份或受保护配置文件。Backend 配置可能被复制到 `.terraform` 元数据和 Plan，因此敏感参数要特别谨慎。

## 5. 锁保护什么

锁防止两个 IaC 写操作同时更新同一 State：

```text
Job A 获取锁 → Plan/Apply → 写 State → 释放锁
Job B 等待或失败
```

它不阻止：

- 用户在控制台修改真实资源；
- 另一个 State 管理同一对象；
- 外部 Controller 修改字段；
- 使用不支持锁的 Backend 并发写。

因此锁不是漂移治理，也不是跨控制面的分布式锁。

## 6. 强制解锁

只有确认原持有任务已经结束、不会再次写 State 时才强制解锁：

```bash
terraform force-unlock <LOCK_ID>
```

安全步骤：查流水线与进程 → 查 Backend 锁记录 → 联系任务所有者 → 保存锁 ID/State 版本 → 解锁 → 全量 Plan。

网络断开不代表远程 Apply 已结束。盲目解锁可能让旧任务恢复后与新任务并发写。

## 7. State 中的 Secret

即使输入或 Output 标记 Sensitive，Provider 返回的密码、连接串、私钥材料仍可能进入 State。控制措施：

- Backend 加密和最小权限；
- State 读取权限比普通源码更严格；
- 不把 State 提交 Git；
- 使用短期凭据、Ephemeral/Write-only 等受支持能力减少持久值；
- Debug/Plan/备份按 Secret 处理；
- 发现泄漏时轮换真实 Secret，而不只是删除 State 历史。

## 8. OpenTofu State/Plan 加密

OpenTofu 支持配置 State 和 Plan 静态加密，可使用 KMS 等 Key Provider 进行信封加密。它能降低 State 文件被复制后的明文泄露，但不能防止：

- 持有解密权限的任务读取；
- State 损坏或丢失；
- 旧 State 回放；
- Provider 日志或远端 API 泄露。

启用前必须备份 State 和密钥、演练迁移与恢复。已有明文 State 不能只打开开关就假设自动安全迁移；应按目标 OpenTofu 版本的迁移配置执行。每个 State 使用独立 KMS Key 能缩小爆炸半径。

Terraform 与 OpenTofu 的加密能力不能想当然互换，切换 CLI 前先验证 State/Plan 兼容。

## 9. 备份与版本

State 备份至少包含：

- 自动版本或快照；
- 不可被普通 Apply 身份删除的保留；
- 加密和独立密钥备份；
- State 标识、Serial/Lineage 等元数据；
- 定期恢复演练。

只看到 Bucket 中有旧对象，不代表能正确恢复。需要在隔离 Backend 读取、运行 `state list` 和只读 Plan，并确认没有指向生产的写权限。

## 10. State 子命令的风险

`state mv`、`state rm`、`state replace-provider` 等会直接改变映射。优先使用可评审的 `moved`、`removed`、`import` 配置块。

必须直接操作时：

1. 冻结所有 Apply；
2. 获取并验证 State 备份；
3. 使用完整带引号地址；
4. 在 State 副本演练；
5. 保存前后 `state list`；
6. 运行全量 Plan；
7. 业务和资产清单复核。

绝不直接用文本编辑器修改 JSON State。

## 11. Backend 迁移

```text
冻结写入
→ 确认源 Backend/Workspace
→ 备份并记录 State Hash/Serial
→ 配置目标加密、锁、权限、版本
→ init -migrate-state
→ 比较资源地址和 Output
→ 只读全量 Plan
→ 切换唯一流水线入口
→ 保留源端只读回退窗口
```

不要在同一次变更中迁移 Backend、升级 Provider、重构地址和修改资源属性，否则出现差异无法归因。

## 12. 灾难恢复

### 12.1 State 丢失但资源仍在

优先恢复 Backend 历史版本；无法恢复时，按资产清单重建配置并分批 Import。不要对生产直接运行空 State Apply。

### 12.2 State 比远端旧

在隔离副本恢复候选版本，读取真实对象并生成 Plan。旧 State 可能缺少新资源或引用旧 ID，不能直接覆盖当前 State。

### 12.3 State 写回失败

CLI 可能在本地生成紧急 State 文件。立即保护该文件、停止其他运行，按错误提示将其安全推回正确 Backend；不要再次 Apply 造成分叉。

## 13. State 不是业务备份

State 不包含数据库行、对象内容、磁盘完整数据和应用队列。即使 State 完整，被删除的数据盘仍需快照/备份恢复。IaC DR 与业务数据 DR 是两套相互依赖的流程。

## 14. 练习与答案

**问题：为什么拥有 Apply 权限的人不一定应该拥有 State 历史删除权限？**

答案：权限分离可以防止误操作或凭据泄露同时破坏当前控制面和恢复点。流水线可读写当前 State，备份保留/删除由更高权限管理。

**问题：恢复昨天的 State 后直接 Apply 有什么风险？**

答案：昨天后创建、替换或导入的对象映射会丢失，Plan 可能重复创建或错误删除。应在隔离副本与远端现状比较后制定恢复。

参考资料：

- [Terraform state](https://developer.hashicorp.com/terraform/language/state)
- [OpenTofu state backends and locking](https://opentofu.org/docs/language/state/backends/)
- [OpenTofu state and plan encryption](https://opentofu.org/docs/language/state/encryption/)
