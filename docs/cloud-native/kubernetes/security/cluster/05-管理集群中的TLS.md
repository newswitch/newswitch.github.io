---
title: "管理 Kubernetes 集群中的 TLS"
sidebar_label: "05. 管理集群中的 TLS"
sidebar_position: 5
description: "区分 Kubernetes 控制面 CA、etcd CA、Front Proxy CA、ServiceAccount 签名密钥、Kubelet Bootstrap 与业务证书。"
tags: [Kubernetes, TLS, PKI, CSR, Kubelet]
---

# 管理 Kubernetes 集群中的 TLS

Kubernetes 不是“只有一个根 CA”。实际部署可能分别使用集群 CA、etcd CA、Front Proxy CA 和外部业务 CA；ServiceAccount Token 签名密钥又是另一套用途。混用这些私钥会扩大信任和故障范围。

通用握手、X.509 字段、证书文件和路径验证见 [TLS 与 PKI 从零到生产学习路线](../../../../networking/security/tls-pki/00-TLS与PKI从零到生产学习路线.md)。本章只讨论 Kubernetes 控制面和节点身份。

## 1. 信任域总图

```text
cluster CA
  ├─ kube-apiserver serving certificate
  ├─ kube-controller-manager client certificate
  ├─ kube-scheduler client certificate
  ├─ admin client certificate
  └─ kubelet client/serving certificate（按部署方式）

etcd CA
  ├─ etcd server/peer certificate
  └─ apiserver-etcd client certificate

front-proxy CA
  └─ front-proxy client certificate

ServiceAccount signing key pair
  └─ 签名 JWT，不是 TLS CA

business/public CA
  └─ Ingress、Gateway、业务 Service 证书
```

具体证书是否共用 CA 取决于安装工具和组织设计。生产环境应记录每个 CA 的用途、私钥位置、有效期、轮换责任人和恢复方法。

## 2. 一次 kubectl 请求

```text
kubectl
  ├─ 用 kubeconfig 中 CA 验证 apiserver Serving Certificate
  └─ 用 Client Certificate、Bearer Token 或 Exec Credential 认证自己
          ↓
kube-apiserver
  ├─ 验证客户端身份
  ├─ 执行 Authentication / Authorization / Admission
  └─ 作为客户端使用独立证书连接 etcd、kubelet 或聚合 API
```

TLS 客户端认证成功只得到用户名和组，RBAC 仍决定是否允许某个 API 动作。

## 3. kubeadm 常见文件

典型控制平面目录 `/etc/kubernetes/pki` 可能包含：

| 文件 | 用途 |
| --- | --- |
| `ca.crt` / `ca.key` | Kubernetes Cluster CA 证书/私钥 |
| `apiserver.crt` / `apiserver.key` | API Server 服务端身份 |
| `apiserver-kubelet-client.*` | API Server 调 Kubelet 的客户端身份 |
| `front-proxy-ca.*` | 聚合层代理 CA |
| `front-proxy-client.*` | RequestHeader Proxy Client |
| `sa.key` / `sa.pub` | ServiceAccount Token 签名/验证 |
| `etcd/ca.*` | etcd CA |
| `etcd/server.*`、`peer.*` | etcd Client/Peer TLS |
| `apiserver-etcd-client.*` | API Server 连接 etcd |

CA 私钥并非所有控制平面节点都必须长期在线保存。高可用设计要在自动签发能力与私钥暴露面之间做选择。

## 4. API Server Serving Certificate

证书 SAN 必须覆盖客户端实际访问的名称和地址，例如：

- Kubernetes Service DNS；
- ClusterIP；
- 控制平面节点名称/IP；
- 负载均衡 VIP/DNS；
- 组织额外配置的 API Endpoint。

新增 VIP 后若证书没有相应 SAN，TCP 可以成功但 Kubectl 会报主机名不匹配。应重新签发证书，而不是在 Kubeconfig 中跳过验证。

## 5. Pod 内访问 API Server

启用 ServiceAccount Token 自动挂载时，投射卷通常包含：

```text
/var/run/secrets/kubernetes.io/serviceaccount/token
/var/run/secrets/kubernetes.io/serviceaccount/ca.crt
/var/run/secrets/kubernetes.io/serviceaccount/namespace
```

这对自定义 ServiceAccount 同样成立，除非 Pod 或 ServiceAccount 禁用了 `automountServiceAccountToken`。这里的 `ca.crt` 用于建立到 Kubernetes API 的信任，不是让业务 Pod 签发任意证书的 CA 私钥。

## 6. CSR API 与 Signer

CSR 对象包含：

- DER CSR 的 Base64；
- `signerName`；
- 请求用途；
- 申请者 Kubernetes 身份；
- Approval/Denial Condition；
- 签发后的证书。

内置 Signer 有明确用途：

| Signer | 典型用途 |
| --- | --- |
| `kubernetes.io/kube-apiserver-client-kubelet` | Kubelet 客户端身份 |
| `kubernetes.io/kubelet-serving` | Kubelet HTTPS Serving 身份 |
| `kubernetes.io/kube-apiserver-client` | API Server 客户端证书 |
| `kubernetes.io/legacy-unknown` | 兼容历史用途，是否签发取决于部署 |

`kubernetes.io/kubelet-serving` 不是通用 Service 证书签发器。提交任意 DNS SAN 的业务 CSR 并人工 Approve，不保证内置 Signer 会签发，也会违反其身份约束。Ingress/Service 证书应使用 cert-manager、Vault PKI 或组织 CA。

## 7. Kubelet TLS Bootstrap

新节点常用 Bootstrap Token 进行初始认证：

```text
Bootstrap Kubeconfig
  → Kubelet 创建 Client CSR
  → Approver 检查请求者、CN、Group、Usage
  → Signer 签发 Kubelet Client Certificate
  → Kubelet 写入并轮换客户端证书
```

Serving Certificate 是另一条 CSR 和审批策略。自动批准 Serving CSR 会允许节点声明访问者要验证的地址，必须有可靠的 Node/SAN 约束，不能简单批准所有 Pending CSR。

## 8. 查看 CSR

```bash
kubectl get csr
kubectl describe csr <name>
kubectl get csr <name> -o jsonpath='{.spec.request}' |
  base64 -d |
  openssl req -noout -text -verify
```

批准前检查：

1. Requesting User/Groups；
2. Signer Name；
3. Subject CN/O；
4. SAN；
5. Usages；
6. 请求来源与节点登记信息；
7. 是否已有重复、异常或高频请求。

```bash
kubectl certificate approve <name>
kubectl certificate deny <name>
```

Approval 是授权决策，不等于签发已经成功。继续观察 `.status.certificate` 和 Signer 日志。

## 9. 到期与轮换

kubeadm 管理的控制面证书可先检查：

```bash
sudo kubeadm certs check-expiration
```

不要直接执行全量 Renew。先确认：

- 当前集群是否由 kubeadm 管理；
- 外部 CA 模式还是本地 CA；
- 高可用节点之间怎样同步；
- 静态 Pod/进程何时重新加载；
- Kubeconfig 是否嵌入旧客户端证书；
- etcd Peer/Client Certificate 的轮换顺序；
- 回滚材料和快照是否验证。

轮换后从真实 Endpoint 检查证书序列号，并验证控制器、调度器、Kubelet、etcd 和聚合 API。

## 10. 故障排查

### 10.1 API Server 证书

```bash
openssl s_client -connect api.example.com:6443 \
  -servername api.example.com \
  -CAfile /etc/kubernetes/pki/ca.crt \
  -verify_hostname api.example.com \
  -verify_return_error </dev/null
```

### 10.2 Kubeconfig

```bash
kubectl config view --raw
kubectl --v=8 get --raw=/readyz
```

谨慎处理 `--raw` 输出，其中可能含嵌入式凭据；不要粘贴完整 Kubeconfig 到公共工单。

### 10.3 Kubelet

```bash
journalctl -u kubelet --since '-30 min'
ls -l /var/lib/kubelet/pki
openssl x509 -in /var/lib/kubelet/pki/kubelet-client-current.pem \
  -noout -subject -issuer -serial -dates
```

### 10.4 常见模式

| 现象 | 重点检查 |
| --- | --- |
| `x509: certificate has expired` | 是客户端还是服务端证书、进程是否加载旧文件 |
| `certificate signed by unknown authority` | CA Bundle、链、错误 Endpoint |
| `certificate is valid for ..., not ...` | API VIP/DNS 是否在 SAN |
| Kubelet CSR Pending | RBAC、Approver、Signer、请求字段 |
| 一台控制平面异常 | 证书同步、静态 Pod Reload、时间与权限 |
| etcd Peer 失败 | Peer CA、SAN、双向证书和成员地址 |

## 11. 备份边界

必须区分：

- etcd 数据快照；
- CA 私钥与证书；
- ServiceAccount 签名密钥；
- Kubeconfig；
- 加密配置及 KMS 依赖。

拥有 Cluster CA 私钥或 ServiceAccount 签名私钥可能足以伪造高权限身份。备份必须加密、隔离、审计，并定期恢复验证。

## 12. 练习与答案

**问题：** ServiceAccount 的 `sa.key` 是不是集群 TLS 根 CA 私钥？

不是。它用于签名 ServiceAccount JWT；Cluster CA 私钥用于签发相应 X.509 证书，二者用途不同。

**问题：** CSR 被 Approved 后一直没有证书，为什么？

Approve 只表示授权。还要有负责该 `signerName` 的 Signer，且请求满足其字段约束并能访问签名材料。

**问题：** 能否用 Kubelet Serving Signer 给普通 Web Service 签证书？

不应这样做。该 Signer 的身份和用途面向 Kubelet，业务服务应使用专门 PKI。

## 13. 参考资料

- [Kubernetes PKI Certificates and Requirements](https://kubernetes.io/docs/setup/best-practices/certificates/)
- [Certificate Signing Requests](https://kubernetes.io/docs/reference/access-authn-authz/certificate-signing-requests/)
- [Kubelet TLS Bootstrapping](https://kubernetes.io/docs/reference/access-authn-authz/kubelet-tls-bootstrapping/)
- [kubeadm Certificate Management](https://kubernetes.io/docs/tasks/administer-cluster/kubeadm/kubeadm-certs/)
