---
title: "Ray 安全、升级、回滚与容灾"
sidebar_label: "33. Ray 安全、升级、回滚与容灾"
sidebar_position: 33
description: "建立 Ray 可信边界、最小权限、供应链控制、KubeRay 升级回滚、GCS 容错和跨集群灾备策略。"
tags: [Ray, KubeRay, 安全, 升级, 回滚, 容灾]
---

# Ray 安全、升级、回滚与容灾

Ray 能运行 Python 代码，因此加入集群、访问 Dashboard/Jobs API 或提交 Runtime Env 的主体应被视为可以执行可信代码的
管理员，而不是普通 API 用户。

## 1. 可信边界

```text
Internet
→ WAF / Gateway（用户身份、限流）
→ Serve API（业务面）
-------------------------------
VPN / CI身份
→ Dashboard / Jobs API（管理面）
→ GCS / Raylet / Worker端口（集群内部）
```

业务用户不应访问 Ray Client、Dashboard、Jobs API、GCS 或内部 Head Service。

## 2. 网络与身份

- Kubernetes Namespace 和 NetworkPolicy 隔离业务池；
- Dashboard 使用 Port Forward、VPN 或带认证的内部代理；
- ServiceAccount 仅授予所需 CR/Pod/Service 权限；
- 云 IAM 使用 Workload Identity，不分发长期密钥；
- 管理入口记录操作者、版本、动作和结果；
- 节点间网络只对 Ray 集群成员开放。

Ray 自身的某些内部通信不是面向零信任多租户设计的，强隔离租户优先使用独立集群/账号/网络边界。

## 3. 代码与制品供应链

- 镜像使用不可变 Digest、扫描并签名；
- Python 依赖锁版本和哈希；
- Runtime Env 禁止任意公网 URI；
- 模型、Tokenizer、LoRA 固定 Revision 和校验和；
- 谨慎启用 `trust_remote_code`；
- Secret 通过 Secret Manager/CSI 注入，不写入 YAML、日志或镜像；
- 出网使用白名单代理并记录下载来源。

## 4. 数据安全

Prompt、输出、Embedding、模型权重和 KV Cache 都可能敏感。明确传输加密、静态加密、日志脱敏、保留周期、租户隔离和删除流程。
故障证据包也必须按同级数据保护。

## 5. 升级前兼容矩阵

记录并验证：

| 层 | 版本/接口 |
| --- | --- |
| Kubernetes | API、Pod Security、设备插件 |
| KubeRay | Operator、CRD、Helm Chart |
| Ray | 集群、Client、Jobs、Serve Schema |
| 推理栈 | Python、PyTorch、vLLM、CUDA/NCCL、驱动 |
| 制品 | 镜像 Digest、模型 Revision、配置 Schema |

KubeRay CRD 不由 Helm 自动完成所有生命周期升级；按照目标版本官方升级指南先处理 CRD，再升级 Operator，并在测试 CR 上验收。

## 6. 推荐发布单元

在线服务优先使用新集群发布：

```text
旧RayService集群稳定服务
→ 创建新版本集群
→ 模型加载与预热
→ 健康和兼容验收
→ 灰度切流
→ 全量观察
→ 保留旧集群回滚窗口
→ 下线旧集群
```

原地升级节省资源，但放大版本不兼容和回滚风险。RayService 的具体升级策略随 KubeRay 版本演进，部署前核对 CRD Schema。

## 7. 回滚

回滚必须包含：镜像、Serve 配置、模型/Adapter、CRD/Operator 兼容和外部数据格式。CRD 降级通常比应用镜像回滚更困难，
升级前备份 CR、Helm values 和 CRD，并确认旧 Controller 能否理解现存对象。

外部数据库发生不可逆 Schema 迁移时，“切回旧镜像”不等于完整回滚。

## 8. Head 与 GCS 容错

默认 GCS 内存状态使 Head 成为关键故障点。KubeRay 可在受支持配置中使用外部高可用 Redis 实现 GCS FT。恢复期间现有
Task/Actor 可能继续运行，但 Actor/Placement Group 创建恢复和节点注册等控制操作会受限。

GCS FT 不替代：

- Redis 自身 HA、备份和容量；
- Kubernetes 控制面 HA；
- Worker/Serve Replica 冗余；
- 模型与业务数据持久化；
- 跨区域灾备。

## 9. 灾备等级

| 等级 | 能力 | 典型 RTO/RPO 思路 |
| --- | --- | --- |
| 单集群恢复 | Pod/Node/Head 恢复 | 分钟级，依赖外部状态 |
| 同区域双集群 | Gateway 切流 | 更短 RTO，共享区域风险 |
| 跨区域冷备 | IaC + 制品重建 | RTO 较长，成本低 |
| 跨区域热备 | 双活/热备容量 | RTO 短，数据一致性复杂 |

Ray Object Store、内存 Actor 和本地 Spill 不是灾备数据源。业务状态必须有外部持久化和可验证的恢复点。

## 10. 容灾演练

1. 从空集群使用 IaC 和固定制品重建；
2. 恢复外部状态与模型；
3. 验证 DNS/Gateway 切流；
4. 检查幂等、重复请求和队列；
5. 测量实际 RTO/RPO；
6. 回切并清理临时资源。

只备份未恢复验证，不算完成容灾。

## 11. 验收清单

- [ ] 业务面与管理面网络隔离；
- [ ] 只有可信主体可提交代码和 Runtime Env；
- [ ] 镜像、依赖、模型和 Adapter 可验证；
- [ ] 兼容矩阵和升级步骤在预发通过；
- [ ] 新集群灰度与回滚已演练；
- [ ] GCS FT 的能力和限制已记录；
- [ ] RTO/RPO 由真实恢复演练证明。

下一阶段：[综合项目](../00-Ray学习路线.md#10-第八阶段综合实战)。

## 12. 官方资料 {/* #官方资料 */}

- [Ray security](https://docs.ray.io/en/latest/ray-security/index.html)
- [KubeRay upgrade guide](https://docs.ray.io/en/latest/cluster/kubernetes/user-guides/upgrade-guide.html)
- [GCS fault tolerance in KubeRay](https://docs.ray.io/en/latest/cluster/kubernetes/user-guides/kuberay-gcs-ft.html)
- [RayService incremental upgrades](https://docs.ray.io/en/latest/cluster/kubernetes/user-guides/rayservice-incremental-upgrade.html)
