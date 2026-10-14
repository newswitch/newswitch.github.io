---
title: "Vault 架构、Barrier、Seal 与请求路径"
sidebar_label: "01. 架构、Seal 与请求路径"
sidebar_position: 1
description: "从信任边界、初始化、Seal、Barrier、HA 转发和审计解释 Vault 处理一次请求的完整路径。"
tags: [Vault, Seal, Barrier, 架构, Secret]
---

# Vault 架构、Barrier、Seal 与请求路径

Vault 的核心价值不是“保存几个密码”，而是把**身份、最小权限、短生命周期凭据、加密和审计**放进一条可控制的请求链。理解这条链，才能区分“服务不可达”“尚未解封”“认证失败”“策略拒绝”和“下游 Secret Engine 失败”。

## 1. 先建立信任边界

```text
客户端身份与 TLS
  → Vault Core：认证、授权、路由、租约与审计
  → Security Barrier：对持久数据加密/解密
  → Storage Backend：保存密文和 Raft 元数据
  → 外部系统：KMS、数据库、CA、云 API
```

Vault 默认把 Storage Backend 当作不可信介质：存储系统即使能读取磁盘，也只应看到经过 Security Barrier 保护的数据。这个设计不能替代宿主机、TLS、KMS 和访问控制；如果攻击者已控制正在运行且已解封的 Vault 进程，威胁模型就完全不同。

| 层次 | 主要职责 | 典型故障 |
| --- | --- | --- |
| API Listener | TLS、地址监听、连接限制 | SAN 错误、证书过期、端口不通 |
| Core | 认证、策略、请求路由、租约 | Permission denied、Lease 失败 |
| Auth Method | 验证外部工作负载或人员身份 | JWT Audience、Role 绑定不匹配 |
| Secret Engine | KV、Database、PKI、Transit 等业务能力 | 数据库不可达、CA 配置错误 |
| Barrier/Seal | 保护持久数据和屏障主密钥 | Sealed、KMS 不可用 |
| Storage | 密文、Raft 日志和集群状态 | Quorum、磁盘延迟、容量耗尽 |
| Audit Device | 记录请求和响应元数据 | 设备阻塞、磁盘写满 |

## 2. Seal、Barrier 与 Storage 的区别

```text
Storage：密文放在哪里？
Barrier：持久数据用什么加密边界保护？
Seal：Vault 重启后，怎样重新获得打开 Barrier 的能力？
```

Vault 启动后默认处于 Sealed 状态。此时进程可以响应有限的系统接口，但不能正常读取受保护数据。Unseal 不是“把所有 Secret 解密到内存”，而是恢复打开加密屏障所需的密钥能力，后续数据仍按请求读取和解密。

## 3. 初始化产生什么

首次初始化会建立屏障所需的密钥材料，并产生初始管理凭据。生产环境要把初始化视为受控仪式：

- 明确参与人员、输出接收者和留痕边界；
- 分离保存 Shamir Key Share 或 Recovery Key；
- 初始 Root Token 完成引导后立即撤销；
- 不让密钥进入 Shell History、CI 日志、聊天、录屏和 Git；
- 在隔离环境验证恢复材料，而不是只验证“文件还在”。

初始化与解封不同：初始化通常只做一次，解封可能在节点每次重启后发生。

## 4. Shamir 与 Auto Unseal

| 模式 | 解封依赖 | 主要优点 | 主要风险 |
| --- | --- | --- | --- |
| Shamir | 达到阈值的 Key Share | 不依赖外部 KMS | 重启依赖人工，份额保管复杂 |
| Auto Unseal | KMS/HSM/Transit Seal 等 | 节点可自动恢复服务 | 密钥、网络、IAM 和区域成为关键依赖 |

Auto Unseal 环境通常产生 Recovery Key，而不是用于日常解封的 Shamir Share。Recovery Key 可执行部分高信任恢复操作，但不能在外部 Seal Key 已永久丢失时凭空恢复数据。

因此自动解封还要验证：

1. KMS Key 是否启用了删除保护；
2. 节点身份是否只有必要的加解密权限；
3. KMS 网络、DNS、区域和账号故障时怎样恢复；
4. 灾备环境能否访问同一密钥，或是否有受控迁移方案。

## 5. 一次请求的完整路径

以应用读取数据库动态凭据为例：

```text
1. Client 与 Listener 建立 TLS
2. LB 命中 Standby 或 Active 节点
3. Standby 将请求转发给 Active
4. Core 校验 Token、Namespace、TTL 与状态
5. Identity 解析 Entity、Alias 和 Group
6. Policy 对规范化 API Path 与 Operation 求权限
7. Router 找到 database/ Secret Engine
8. Database Plugin 连接数据库并创建临时账号
9. Core 建立 Lease，返回凭据与 lease_id
10. Audit Device 记录经过处理的请求/响应元数据
11. 需要持久化的状态经 Barrier 加密后写入 Raft
```

控制信息和敏感数据并非每一步都落盘。Vault 只持久化实现功能所需的状态；动态凭据还依赖下游数据库真正执行创建和删除。

## 6. Path 是核心抽象

Auth Method、Secret Engine 和 System Backend 都挂载在 Path 上：

```text
auth/kubernetes/login
kv/data/payments/config
database/creds/payments-readonly
pki/issue/internal-service
sys/health
```

挂载路径区分大小写。相同类型的 Engine 可以挂载多次，每个挂载点拥有独立配置、角色、TTL 和策略边界。移动或禁用挂载点可能撤销相关 Lease；这不是普通目录改名。

## 7. Active、Standby 与转发

HA 集群在一个时刻只有一个 Active 节点负责产生一致的写入顺序，其余节点为 Standby。客户端命中 Standby 后，节点通常通过集群通道向 Active 转发，而不是要求每个客户端都自行发现 Leader。

应区分三种地址：

- Listener Address：进程在哪个本地地址监听；
- `api_addr`：客户端或节点应如何访问当前节点；
- `cluster_addr`：节点间请求转发和集群通信地址。

负载均衡不能只把 `200` 当健康。`/v1/sys/health` 会根据 Active、Standby、Sealed 等状态返回不同状态码，应结合参数和流量策略配置；否则可能把所有 Standby 误判为故障，也可能把 Sealed 节点送入业务池。

## 8. 审计为什么属于请求路径

审计不是普通访问日志。它要为“谁在何时以什么身份访问了哪个 Path”提供证据，同时对许多敏感字段做 HMAC 处理。

Vault 处理请求时必须能够写入至少一个可用的 Audit Device。审计目标阻塞或磁盘写满可能直接影响业务请求，所以审计设备既是安全控制，也是容量和可用性依赖。

## 9. 从错误反推故障层

| 现象 | 优先检查 |
| --- | --- |
| TCP/TLS 建连失败 | Listener、防火墙、DNS、证书 SAN/CA |
| `503` 且显示 Sealed | Seal、KMS、初始化状态 |
| `permission denied` | Token、Policy、Path、Operation、Namespace |
| 登录失败 | Auth Mount、Role、外部身份断言、时间 |
| Vault 正常但发不出凭据 | Secret Engine Plugin、数据库/CA/云 API |
| 写入间歇变慢 | Raft 磁盘、Leader、网络、Audit Device |
| 切主期间请求风暴 | LB、客户端超时/重试、连接池 |

先确定故障层，再改配置。直接发 Root Token 或重启整个集群，只会破坏证据并扩大故障。

## 10. 主机与进程安全边界

- 禁止把 Secret 写进启动参数和可公开环境变量；
- 保护进程内存、Core Dump、Swap、调试接口和运行日志；
- Vault 节点与通用业务工作负载隔离；
- 管理端口只对受控网络开放；
- 节点间证书、时间同步和主机身份必须可靠；
- 任何“临时跳过 TLS 校验”都不能进入正式配置。

## 11. 练习与答案

**问题：拿到了 Raft 数据目录，是否就能直接读出所有 Secret？**

答案：正常情况下不能，持久数据受 Security Barrier 保护。但这不意味着磁盘可以公开；攻击者仍可破坏可用性、窃取密文，或结合其他被盗材料恢复数据。

**问题：Auto Unseal 是否意味着不再需要恢复密钥？**

答案：不是。它自动化的是启动时打开 Barrier 的过程。Recovery Key 仍用于受控恢复操作，外部 KMS Key、IAM 权限和灾备访问能力也必须保护。

**问题：为什么 Vault 可达仍会返回 503？**

答案：进程存活不等于具备服务能力。节点可能尚未初始化、仍处于 Sealed 状态、失去 HA/存储能力，或健康接口按 Standby 状态返回了非 200 状态码。

参考资料：

- [Vault architecture](https://developer.hashicorp.com/vault/docs/internals/architecture)
- [Seal and unseal](https://developer.hashicorp.com/vault/docs/concepts/seal)
- [High availability](https://developer.hashicorp.com/vault/docs/concepts/ha)
- [Audit devices](https://developer.hashicorp.com/vault/docs/audit)
