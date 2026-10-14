---
title: "Vault Kubernetes Auth、Agent、CSI 与 Operator"
sidebar_label: "07. Kubernetes 集成"
sidebar_position: 7
description: "理解 Kubernetes Auth 的 TokenReview 链路，并比较 Agent Injector、CSI Provider、Vault Secrets Operator 与应用 SDK。"
tags: [Vault, Kubernetes, Agent Injector, CSI, VSO, ServiceAccount]
---

# Vault Kubernetes Auth、Agent、CSI 与 Operator

Kubernetes 集成包含两个独立问题：**Pod 怎样证明身份**，以及**Secret 怎样交付并轮换**。Kubernetes Auth 解决前者；Agent、CSI、Vault Secrets Operator（VSO）和 SDK 是后者的不同实现。

## 1. Kubernetes Auth 完整链路

```text
Pod 使用专用 ServiceAccount
→ kubelet 挂载短期 Projected ServiceAccount Token
→ Pod/Agent 将 JWT 提交给 auth/kubernetes/login
→ Vault 校验签名、Issuer、Audience
→ Vault 通过 Kubernetes TokenReview 验证 Token 状态
→ Role 匹配 ServiceAccount、Namespace 等约束
→ 签发受 Policy 和 TTL 限制的 Vault Token
```

Kubernetes JWT 不是 Vault Token。前者用于证明集群工作负载身份，后者用于访问 Vault Path。

## 2. Reviewer 身份与信任边界

Vault 需要访问 Kubernetes API 的 TokenReview 能力。部署方式不同，Reviewer JWT、API Server CA 和地址的配置也不同。要明确：

- Vault 在集群内还是集群外；
- 谁拥有 `tokenreviews` 权限；
- API Server CA 和地址怎样轮换；
- Vault 是否复用客户端 JWT 执行 Review；
- 多个集群是否使用独立 Auth Mount。

一个 Auth Mount 混用多个安全边界不同的集群，会使 Role、Issuer 和故障定位变得复杂。通常每个集群或信任域使用独立 Mount。

## 3. Role 不能只限制 Namespace

示意配置：

```text
Role: payments-api
  bound_service_account_names      = payments-api
  bound_service_account_namespaces = payments-prod
  audience                         = vault
  token_policies                   = payments-api
  token_ttl                        = 20m
```

不要匹配 `*` ServiceAccount 和 `*` Namespace。Pod 还应显式指定 ServiceAccount，并关闭不需要的自动 Token 挂载。Audience 必须与投射 Token 和 Vault Role 一致，避免一个为其他服务签发的 Token 被拿来登录 Vault。

## 4. 四种 Secret 交付模式

| 模式 | Secret 落点 | 轮换能力 | 主要优点 | 主要代价 |
| --- | --- | --- | --- | --- |
| Agent Injector | Pod 内文件，通常共享内存卷 | 自动认证、模板、续租、缓存 | 对应用侵入低、适合动态 Secret | 每 Pod Sidecar 资源与启动依赖 |
| Secrets Store CSI Provider | CSI 临时 Volume 文件 | 驱动按能力轮换 | 应用按文件读取，无需 Sidecar | 依赖节点 DaemonSet，生命周期与挂载相关 |
| Vault Secrets Operator | 默认同步为原生 Kubernetes Secret | 控制器持续协调 | 适配原生 Secret 消费方式 | 明文进入 Kubernetes etcd/RBAC 故障域 |
| 应用 SDK/API | 应用内存或自管缓存 | 应用自行处理 | 细粒度、适合 Transit/动态 API | 代码承担认证、续租、重试和脱敏 |

VSO 还存在与 CSI 保护模式相关的企业版能力，实施前要核对版本和许可。不能把默认同步到 Kubernetes Secret 的行为与“不进入 etcd”混为一谈。

## 5. Agent Injector 的运行过程

Mutating Admission Webhook 根据 Pod 注解注入：

```text
Init Agent：Pod 启动前认证并渲染初始文件
Agent Sidecar：持续续租、重新认证和渲染
共享 Volume：应用读取结果文件
```

要验证：

- Webhook Failure Policy 是否符合可用性要求；
- Init 容器失败时是否阻止业务启动；
- 文件权限、UID/GID 和 Volume 是否为内存介质；
- 模板使用原子替换，应用是否监听变化；
- Sidecar 退出后 Pod 是否仍被判定 Ready；
- Agent 日志不会输出 Token 和模板结果。

Sidecar 成功更新文件不等于应用已使用新凭据。数据库连接池、TLS Context 和进程配置都可能仍保留旧值。

## 6. CSI Provider 的边界

CSI 在 Pod Volume Mount 阶段调用 Provider 获取 Secret。节点上的 DaemonSet 和 Kubelet 插件路径属于关键链路：

```text
Pod 调度到节点
→ kubelet NodePublishVolume
→ Secrets Store CSI Driver
→ Vault Provider 登录并读取 Secret
→ 文件挂载到 Pod
```

故障可能只影响某个节点，因此要同时检查 Pod Event、kubelet、CSI Driver、Vault Provider 和 Vault Audit。Secret 作为文件更新后，应用仍需支持重载。

不要默认同时 `syncSecret` 到 Kubernetes Secret；一旦同步，就重新引入 etcd 加密、RBAC、备份和清理问题。

## 7. VSO 的适用场景

VSO 用控制器持续协调 Vault 数据到 Kubernetes 对象，适合无法改成文件读取、必须消费原生 Secret 的应用。它的状态链是：

```text
Vault Secret
→ VSO 自定义资源与控制器
→ Kubernetes Secret
→ Volume/Environment/应用
```

需要保护：

- Kubernetes etcd 静态加密和 KMS；
- Secret RBAC 与 Namespace 隔离；
- 控制器身份和可读取的 Vault Path；
- 最终 Secret 的 Owner、删除和轮换语义；
- 环境变量不会随 Secret 更新自动变化。

VSO 提高兼容性，不会自动消除 Kubernetes Secret 的风险。

## 8. 应用直连何时合理

以下场景适合 SDK/API：

- 应用高频调用 Transit Encrypt/Decrypt；
- 需要精确控制动态凭据换池；
- 需要根据业务事务决定续租和撤销；
- 不希望 Secret 写文件或 Kubernetes Secret。

但应用要正确实现 TLS 校验、登录、Token 更新、有限退避、Lease、日志脱敏和进程内存边界。若每个团队都重复造一套，应优先统一库或 Agent。

## 9. Vault 不可用时会发生什么

| 状态 | 新 Pod | 已运行 Pod |
| --- | --- | --- |
| Vault 短时不可达 | Init/CSI/VSO 可能失败或延迟 | 取决于缓存和现有凭据剩余 TTL |
| Kubernetes API 不可达 | Auth TokenReview 可能失败 | 已有 Vault Token/Secret 可能暂时可用 |
| Injector Webhook 不可达 | 取决于 Failure Policy | 现有 Pod 不受注入影响 |
| 节点 CSI Plugin 异常 | 该节点新挂载失败 | 已挂载文件可能仍存在 |

要按应用选择 Fail Closed 或有限使用仍有效缓存。不能无限使用已过期凭据，也不能因为 Vault 短抖动让所有现有连接立即退出。

## 10. 启动与轮换风暴

Deployment 大规模扩容、节点重启或 Vault 恢复时，可能同时发生登录、KV 读取、DB 凭据创建和续租。控制措施：

- 分批发布和 Pod 启动抖动；
- 有上限的指数退避；
- Agent 缓存和连接复用；
- 避免所有 Token/Lease 相同过期时刻；
- 分开监控 Auth、Secret Engine 和下游容量。

无限重试和固定 1 秒间隔会把小故障放大成 Vault 与数据库雪崩。

## 11. 排障顺序

```bash
kubectl get pod <pod> -o yaml
kubectl describe pod <pod>
kubectl auth can-i create tokenreviews.authentication.k8s.io --as=<reviewer>
kubectl logs <pod> -c vault-agent
kubectl logs -n kube-system <csi-pod> -c <container>
```

然后依次确认：

1. Pod 的 ServiceAccount 和 Namespace；
2. Projected Token 的 Issuer、Audience、到期时间；
3. Auth Mount、Kubernetes API 地址和 CA；
4. Role 绑定条件；
5. Vault Token Policy 的真实 API Path；
6. DNS、NetworkPolicy、TLS、时间；
7. Agent/CSI/VSO 的交付和应用重载状态。

不要把生产 JWT 或 Vault Token 复制到个人机器验证。

## 12. 选型结论

- 需要模板、动态凭据续租和缓存：优先 Agent；
- 应用天然读取文件且希望避免 Sidecar：评估 CSI；
- 老应用必须使用 Kubernetes Secret：评估 VSO，并接受 etcd/RBAC 边界；
- 业务需要 Transit 或精确 Lease 控制：使用统一 SDK。

一个集群可以并存多种模式，但同一个 Secret 的所有权和轮换来源必须唯一，避免控制器互相覆盖。

## 13. 练习与答案

**问题：VSO 已把 Secret 同步到 Kubernetes，是否仍需要保护 Vault？**

答案：需要。Vault 仍是上游身份和 Secret 来源；同时还新增了 Kubernetes etcd、RBAC、备份和控制器权限等风险面。

**问题：Agent 文件已变化，是否说明数据库凭据轮换成功？**

答案：不一定。还要确认应用建立了新连接池、切换流量、排空旧连接，并成功撤销旧 Lease。

参考资料：

- [Kubernetes auth method](https://developer.hashicorp.com/vault/docs/auth/kubernetes)
- [Vault Agent Injector](https://developer.hashicorp.com/vault/docs/platform/k8s/injector)
- [Secrets Store CSI Provider](https://developer.hashicorp.com/vault/docs/platform/k8s/csi)
- [Vault Secrets Operator](https://developer.hashicorp.com/vault/docs/platform/k8s/vso)
