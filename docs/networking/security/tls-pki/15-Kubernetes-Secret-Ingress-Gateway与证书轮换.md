---
title: "Kubernetes Secret、Ingress、Gateway 与证书轮换"
sidebar_label: "15. Kubernetes TLS"
sidebar_position: 15
description: "理解 TLS Secret、Ingress/Gateway 终止、后端重新加密、跨命名空间引用和证书轮换加载链路。"
tags: [Kubernetes, TLS Secret, Ingress, Gateway API, cert-manager]
---

# Kubernetes Secret、Ingress、Gateway 与证书轮换

Kubernetes 只负责保存和分发对象，真正执行 TLS 握手的是 Ingress Controller、Gateway 数据面、Sidecar 或应用进程。排障必须从 API 对象一直追到数据面实际加载的证书。

## 1. TLS Secret

创建：

```bash
kubectl -n gateway create secret tls api-tls \
  --cert=api.example.com.fullchain.pem \
  --key=api.example.com.key
```

对象关键结构：

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: api-tls
  namespace: gateway
type: kubernetes.io/tls
data:
  tls.crt: <base64>
  tls.key: <base64>
```

Base64 只是编码。Secret 是否在 etcd 静态加密、谁能读取、是否进入审计、备份和 Git，都是独立安全问题。

## 2. Ingress TLS 终止

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: api
  namespace: app
spec:
  tls:
    - hosts: [api.example.com]
      secretName: api-tls
  rules:
    - host: api.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: api
                port:
                  number: 8080
```

Secret 一般需与 Ingress 同命名空间，具体控制器行为还受实现和权限影响。Ingress API 描述期望状态，证书选择、热加载和上游 TLS 由 Controller 实现。

## 3. Gateway API

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: public
  namespace: gateway
spec:
  gatewayClassName: example
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      hostname: api.example.com
      tls:
        mode: Terminate
        certificateRefs:
          - kind: Secret
            name: api-tls
```

跨命名空间引用需要实现支持并由 `ReferenceGrant` 明确授权。不要因为集群中存在同名 Secret 就假定数据面会读取它。

## 4. 后端 TLS

下游 HTTPS 不代表 Gateway 到 Service 也使用 TLS：

```text
Client ==TLS==> Gateway ----HTTP----> Service
```

若需要重新加密，要配置后端协议、SNI、验证 CA 和目标名称：

```text
Client ==TLS==> Gateway ==TLS==> Service
```

各 Controller/Gateway 对 BackendTLSPolicy、注解或专用 CRD 的支持不同，必须按实现版本核对，不能把一种 Controller 的注解复制给另一种。

## 5. 应用挂载 Secret

```yaml
volumes:
  - name: tls
    secret:
      secretName: api-tls
containers:
  - name: api
    volumeMounts:
      - name: tls
        mountPath: /etc/tls
        readOnly: true
```

Secret Volume 更新通常通过节点同步和原子符号链接切换呈现，不保证应用自动重新读取。使用 `subPath` 挂载单文件还可能无法获得自动更新。需要确认应用支持 Watch、定时重载、Signal 或滚动重启。

## 6. 集群 CA 与业务 CA 不是一回事

Kubernetes 集群包含多个证书用途：

- API Server Serving Certificate；
- Kubelet Client/Serving Certificate；
- Controller/Scheduler/API Client Certificate；
- Front Proxy CA；
- Service Account Signing Key；
- 业务 Ingress/Service Certificate。

Service Account Token 签名密钥不是 TLS CA。Kubernetes 内置 CSR Signer 也不提供一个通用的“任意业务 Service 证书 CA”；例如 `kubernetes.io/kubelet-serving` 只面向符合要求的 Kubelet Serving CSR。业务证书应使用 cert-manager、Vault 或组织 PKI 等合适签发器。

Pod 中的 `/var/run/secrets/kubernetes.io/serviceaccount/ca.crt` 用于信任 Kubernetes API 相关入口，不应默认拿来签发或验证所有内部业务域名。

## 7. 轮换的真实数据链

```text
Certificate Controller
  → 更新 Secret
  → API Watch 到 Controller/Node
  → 数据面读取 Secret
  → 构建新 TLS Context
  → 新握手使用新证书
```

逐层验证：

```bash
kubectl -n gateway get secret api-tls \
  -o jsonpath='{.data.tls\.crt}' |
  base64 -d |
  openssl x509 -noout -serial -dates -subject

openssl s_client -connect api.example.com:443 \
  -servername api.example.com </dev/null 2>/dev/null |
  openssl x509 -noout -serial -dates -subject
```

两个序列号不同，说明 Secret 与真实入口没有同步，继续检查 Gateway 状态、Controller 日志、数据面配置和 CDN/LB 终止点。

## 8. 状态与事件

```bash
kubectl describe certificate -n gateway api-tls
kubectl get certificaterequest,order,challenge -A
kubectl describe gateway -n gateway public
kubectl get events -n gateway --sort-by=.lastTimestamp
```

关注 Accepted、Programmed、ResolvedRefs 等 Condition，而不是只看对象存在。

## 9. 练习与答案

**问题：** 更新 Secret 后旧 TLS 长连接会立刻切换证书吗？

不会。证书参与握手，新证书一般用于新连接；旧连接继续使用已派生流量密钥，除非被排空或关闭。

**问题：** 自定义 ServiceAccount 是否不会自动获得 Kubernetes API CA？

通常只要启用了 ServiceAccount 凭据自动挂载，投射卷同样包含 Token、Namespace 和 CA。是否挂载取决于 Pod/ServiceAccount 的 `automountServiceAccountToken` 等配置，不取决于是否名为 `default`。

## 10. 参考资料

- [Kubernetes TLS Secrets](https://kubernetes.io/docs/concepts/configuration/secret/#tls-secrets)
- [Kubernetes CSR Signers](https://kubernetes.io/docs/reference/access-authn-authz/certificate-signing-requests/)
- [Gateway API TLS Guide](https://gateway-api.sigs.k8s.io/guides/tls/)
