---
title: "TLS、Authentication、Role、Network Isolation 与审计"
sidebar_label: "10. TLS、Authentication、Role、Network Isolation 与审计"
sidebar_position: 10
description: "保护 etcd peer/client 身份、Key Prefix 权限、管理面网络和证书轮换。"
tags: [etcd, TLS, Authentication, RBAC, Security]
---

# TLS、Authentication、Role、Network Isolation 与审计

> 本文以 etcd 3.6 为基线。TLS 解决传输机密性与身份校验，RBAC 解决 Key 空间授权，网络隔离限制攻击面；三者不能互相替代。

## 1. 三个平面，三类身份 {/* #三个平面三类身份 */}

| 平面 | 常见监听 | 合法调用者 | 主要保护 |
| --- | --- | --- | --- |
| Client API | 2379 | API Server、授权应用、备份/运维工具 | Client mTLS、etcd Auth/Role、网络 ACL |
| Peer | 2380 | etcd 成员 | Peer mTLS、仅成员网段互通 |
| Metrics/Health | 独立 metrics URL 或受控监听 | Prometheus、健康检查 | 私网绑定、mTLS 或防火墙 |

etcd 的 V3 RBAC 不会自动保护 `/metrics` 和 `/health` HTTP Handler，所以“启用了 Auth”不等于监控端口已经安全。生产设计应给每个流向写出源、目标、端口、证书身份和允许的操作。

## 2. 双向 TLS：先辨认 Client 与 Peer 参数 {/* #双向-tls先辨认-client-与-peer-参数 */}

每个成员使用独立证书，SAN 覆盖真实 advertise DNS/IP，私钥权限最小化。不要在生产依赖 `--auto-tls` 或 `--peer-auto-tls` 生成的临时自签身份。

| 流向 | 服务端证书 | 信任 CA | 要求对端证书 |
| --- | --- | --- | --- |
| Client → etcd | `--cert-file`、`--key-file` | `--trusted-ca-file` | `--client-cert-auth=true` |
| etcd Peer ↔ Peer | `--peer-cert-file`、`--peer-key-file` | `--peer-trusted-ca-file` | `--peer-client-cert-auth=true` |

```yaml
# 仅展示 TLS 关键项；监听、成员和配额等仍需完整配置
cert-file: /etc/etcd/pki/server.crt
key-file: /etc/etcd/pki/server.key
trusted-ca-file: /etc/etcd/pki/client-ca.crt
client-cert-auth: true

peer-cert-file: /etc/etcd/pki/peer.crt
peer-key-file: /etc/etcd/pki/peer.key
peer-trusted-ca-file: /etc/etcd/pki/peer-ca.crt
peer-client-cert-auth: true
```

运维命令使用 Client CA 签发的客户端证书，不要拿 Peer 私钥当通用管理员凭据：

```bash
etcdctl --endpoints="$ETCD_ENDPOINTS" \
  --cacert=/etc/etcd/pki/client-ca.crt \
  --cert=/etc/etcd/pki/ops-client.crt \
  --key=/etc/etcd/pki/ops-client.key \
  endpoint health --cluster
```

证书至少检查：有效期、签发链、SAN、用途、文件权限和实际加载路径。`x509: certificate is valid for X, not Y` 是 SAN 与连接地址不匹配，不应通过关闭校验解决；`unknown authority` 则优先核对信任链与正在生效的 CA 文件。

## 3. Auth/Role：身份不等于授权 {/* #authrole身份不等于授权 */}

当 `--client-cert-auth=true` 且启用 etcd Auth 时，客户端证书 CN 可以作为 etcd 用户名；若同时提供用户名密码，官方定义为用户名密码优先。经过 gRPC proxy/gateway 时，客户端证书身份会在代理处终止，不能假设终端用户 CN 仍会传到 etcd。

下面以 `/apps/order/` 为订单服务独占 Prefix。先在隔离集群演练，生产操作不要把密码写入 Shell 历史：

```bash
# Auth 启用前必须先有 root 用户；它会自动拥有特殊 root Role
etcdctl user add root

etcdctl role add order-rw
etcdctl role grant-permission order-rw --prefix=true readwrite /apps/order/

# 使用证书 CN 认证时可建无密码用户；密码认证则去掉 --no-password
etcdctl user add order-service --no-password
etcdctl user grant-role order-service order-rw

etcdctl role get order-rw
etcdctl user get order-service
etcdctl auth enable
```

启用后做正反两类测试：`order-service` 能读写 `/apps/order/`，但访问 `/apps/payment/` 必须返回 `permission denied`；root 运维身份仍能执行成员、快照和 Defrag 管理。只验证允许路径而不验证拒绝路径，无法证明最小权限生效。

权限授予 Prefix 时使用 `--prefix=true`，避免人工计算错误的结束 Key。每个应用独立用户/证书与 Role，不共享 root，不给整个 `/`。Kubernetes 自管 etcd 通常由 API Server 使用专用客户端身份，业务应用不应直接访问 `/registry`。

### 3.1 防止启用 Auth 后锁死 {/* #防止启用-auth-后锁死 */}

启用前保留一个已验证的 root 会话，确认所有 API Server、备份、监控和维护工具分别使用什么身份。若应用尚未切换认证，先创建并测试它的用户/Role，再在变更窗口启用。回滚只能由 root 执行 `auth disable`，所以 root 凭据必须存放在受控密钥系统，并验证紧急取用流程。

## 4. 网络隔离：默认拒绝，再逐条放行 {/* #网络隔离默认拒绝再逐条放行 */}

最小矩阵可以写成：

| 源 | 目标 | 端口 | 结果 |
| --- | --- | --- | --- |
| API Server/授权客户端网段 | etcd Client VIP/成员 | TCP 2379 | 允许，必须 mTLS |
| etcd 成员 | 其他 etcd 成员 | TCP 2380 | 允许，必须 Peer mTLS |
| Prometheus | metrics 私网地址 | 配置的 metrics 端口 | 允许，只读采集 |
| 普通 Pod、办公网、公网 | 2379/2380/metrics | 任意 | 默认拒绝 |

云安全组、宿主防火墙与 Kubernetes NetworkPolicy 要覆盖实际流量所在层。HostNetwork/静态 Pod 流量未必经过普通 Pod NetworkPolicy；因此必须从允许源和拒绝源各做一次连接测试。Client API 和 Peer 端口都不应暴露公网。

## 5. 证书轮换：双信任、逐成员、可回退 {/* #证书轮换双信任逐成员可回退 */}

只换 Leaf 证书且 CA 不变时，先分发新文件，逐成员重载或滚动，每次验证 Peer quorum 与 Client 访问。涉及 CA 轮换时，必须经历重叠信任期：

1. 盘点 Client CA、Peer CA、所有 Leaf、调用者和过期时间，生成可回退备份。
2. 让服务端和客户端信任包同时包含旧 CA 与新 CA。
3. 逐成员换 Peer/Server Leaf；每换一个就检查 Endpoint、Leader、Raft index、日志和业务。
4. 轮换 API Server、备份、Prometheus、运维工具等 Client Leaf。
5. 确认监控中已无旧 CA/Leaf 的连接与文件引用，再移除旧信任。

不要假设覆盖磁盘文件后所有长连接立即使用新证书；按目标版本、部署方式验证重新加载/重连行为。任何成员出现握手失败或 Raft lag，都停止下一成员轮换，恢复该成员上一组已知可用证书和配置。

证书告警要覆盖 Server、Peer、Client 和备份工具，按剩余天数分级，并预留变更审批时间；只盯 etcd Server 证书会漏掉 API Server 或运维客户端先过期。

## 6. 审计：记录管理动作，但不要泄露 Value {/* #审计记录管理动作但不要泄露-value */}

etcd 本身不是完整的业务审计系统。Kubernetes 场景应以 API Server Audit 记录“谁修改了哪个 Kubernetes 对象”，并额外收集 etcd 服务日志、身份系统日志和变更平台记录。至少覆盖：

- 成员 Add/Remove/Promote/Update、升级与证书轮换；
- 用户、Role、权限和 Auth Enable/Disable；
- Alarm、Compact、Defrag、Snapshot/Restore；
- TLS/认证失败、异常来源 IP 和高频拒绝；
- 配置文件、systemd/静态 Pod Manifest、Secret 与防火墙变更。

日志写入集中、不可由 etcd 管理员单独篡改的位置，包含操作者、时间、目标集群、工单、命令类别、结果与验收证据。etcd Value 可能含 Secret、令牌或业务数据，禁止把 Range/Watch 响应、密码和私钥写入普通日志或工单。

## 7. 故障定位表 {/* #故障定位表 */}

| 报错/现象 | 先查什么 | 不应怎么做 |
| --- | --- | --- |
| `certificate has expired` | 系统时间、实际加载证书、完整调用链 | 临时改系统时间或关闭 TLS |
| `unknown authority` | 服务端/客户端信任包、CA 链、配置路径 | 跳过 CA 校验 |
| `certificate is valid for ..., not ...` | SAN 与连接 DNS/IP | 改用不受控 IP 绕过 |
| `permission denied` | Auth 用户、Role、Prefix 边界 | 直接授予 root |
| Peer 持续握手失败 | Peer CA、SAN、2380 ACL、两端时间 | 同时重启所有成员 |
| `/metrics` 可被未认证访问 | metrics Handler 不受 V3 RBAC 保护 | 误以为 Auth 已覆盖，应该加 mTLS/私网/ACL |

## 8. 验收题 {/* #验收题 */}

- Peer TLS 与 Client TLS 分别防什么？
- 启用 Auth 前为何先验证 Role？
- Metrics 端口为何也需隔离？
- 证书轮换如何避免 quorum 中断？
- Client 证书 CN 经过 gRPC proxy 后为何不能代表最终客户端？
- 为什么 Auth Enable 之后仍要单独保护 `/metrics` 与 `/health`？

## 9. 参考资料 {/* #参考资料 */}

- [Transport security](https://etcd.io/docs/v3.6/op-guide/security/)
- [Role-based access control](https://etcd.io/docs/v3.6/op-guide/authentication/rbac/)
