---
title: "Prometheus TLS、认证、NetworkPolicy、Secret、租户与指标数据安全"
sidebar_label: "13. 监控体系安全"
sidebar_position: 13
description: "为指标抓取、查询、Remote Write、Alertmanager、Grafana 和通知出口建立身份、TLS、授权、网络、Secret 与多租户安全边界。"
tags: [Prometheus, TLS, NetworkPolicy, Secret, 多租户, 安全]
---

# Prometheus TLS、认证、NetworkPolicy、Secret、租户与指标数据安全

指标不是低敏数据。它可能暴露主机名、内部地址、租户、模型名称、软件版本、请求路径、错误类型、业务规模和故障时间。监控系统还能创建 Silence、执行任意大查询、重载配置或调用管理 API，必须按生产数据系统保护。

## 1. 画出信任边界

```text
① Prometheus → Target /metrics
② Prometheus → Kubernetes/Cloud Service Discovery API
③ Prometheus → Remote Write Backend
④ Prometheus → Alertmanager
⑤ User/Grafana → Prometheus/Thanos/Mimir Query API
⑥ Alertmanager → Email/Webhook/OnCall
⑦ Operator/GitOps → Config、Rule、Secret、CRD
```

每条链路分别回答：谁是客户端、谁验证谁、谁授权什么操作、网络从哪里到哪里、Secret 如何轮换、失败如何审计。只说“集群内网所以安全”不构成控制措施。

## 2. Prometheus Web 入口 TLS 与认证

Prometheus 可通过 Web 配置文件启用 TLS 和 Basic Auth：

```yaml
# web-config.yml
tls_server_config:
  cert_file: /etc/prometheus/tls/tls.crt
  key_file: /etc/prometheus/tls/tls.key
  min_version: TLS12

basic_auth_users:
  observer: "$2y$...bcrypt-hash..."
```

```bash
prometheus \
  --config.file=/etc/prometheus/prometheus.yml \
  --web.config.file=/etc/prometheus/web-config.yml
```

Basic Auth 适合小规模受控入口，不提供复杂 RBAC。企业环境通常在受信网关或认证代理完成 OIDC、MFA、组映射和细粒度授权，再把经过验证的身份传递给后端。

TLS 私钥文件权限只允许进程账户读取。证书轮换需验证组件是否支持重载以及连接何时使用新证书，不能只替换 Secret 后假设所有长连接立即更新。

## 3. 抓取目标的 TLS 与认证

```yaml
scrape_configs:
  - job_name: secure-api
    scheme: https
    static_configs:
      - targets: ["api.internal:9443"]
    tls_config:
      ca_file: /etc/prometheus/secrets/metrics-ca/ca.crt
      cert_file: /etc/prometheus/secrets/metrics-client/tls.crt
      key_file: /etc/prometheus/secrets/metrics-client/tls.key
      server_name: api.internal
    authorization:
      credentials_file: /etc/prometheus/secrets/api-token/token
```

可使用 Basic Auth、Authorization、OAuth2 或 mTLS，具体字段按部署版本校验。遵循：

- 每个安全域使用独立只读监控身份；
- 服务端证书校验 CA 和 SAN；
- 不长期使用 `insecure_skip_verify`；
- Token/证书经文件或 Secret 引用，不写入主配置和 Git；
- 轮换保留可信重叠窗口，并同时观察旧/新凭据失败率。

## 4. Kubernetes ServiceAccount 与 RBAC

Service Discovery 身份只需要读取必要资源，不应拥有修改工作负载权限。示意：

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: prometheus-discovery
rules:
  - apiGroups: [""]
    resources: [nodes, services, endpoints, pods]
    verbs: [get, list, watch]
  - apiGroups: [discovery.k8s.io]
    resources: [endpointslices]
    verbs: [get, list, watch]
```

实际权限由 Operator/Chart 和启用的发现角色决定，应使用 `kubectl auth can-i` 验证并审计。不要为了跨 Namespace 抓取直接绑定 `cluster-admin`。

业务 `/metrics` 的访问身份和 Kubernetes API 发现身份应分开：前者读取指标，后者读取资源元数据。

## 5. NetworkPolicy

网络策略的目标是建立显式允许列表：

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-prometheus-metrics
  namespace: production
spec:
  podSelector:
    matchLabels:
      app: order-api
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: monitoring
          podSelector:
            matchLabels:
              app.kubernetes.io/name: prometheus
      ports:
        - protocol: TCP
          port: 9090
```

还需要允许 Prometheus 访问 DNS、Kubernetes API、Alertmanager、Remote Write；允许 Alertmanager 访问指定通知端点和 Cluster Peer。不同 CNI 对 Namespace/Pod Selector 组合的实现要实际验证。

NetworkPolicy 只限制网络可达性，不提供应用身份。IP 被复用或 Pod Label 配错时仍可能越权，所以还需 TLS 和认证。

## 6. 管理 API 和危险能力

重点保护：

- `--web.enable-admin-api`：Snapshot、删除 Series 等管理能力；
- `--web.enable-lifecycle`：Reload/退出接口；
- Remote Write Receiver：允许外部写入 Series；
- Alertmanager Silence API：可隐藏通知；
- Grafana Admin/Data Source Proxy；
- Thanos/Mimir 管理、Ring、Runtime Config 和 Tenant API；
- Debug、Profile 和内部状态端点。

不要把管理 API 与只读查询 API 放在同一个不受控公网入口。代理层按路径、方法和身份授权，并对变更操作记录审计。

## 7. Secret 生命周期

Secret 包括：抓取 Token、客户端证书、Remote Write 凭据、对象存储密钥、Webhook URL、SMTP 密码和 Grafana Data Source Token。

```text
Secret Manager/KMS
→ External Secrets/CSI/受控部署
→ 只读文件挂载
→ 组件Reload或滚动更新
→ 验证新凭据
→ 撤销旧凭据
```

避免通过环境变量暴露给进程列表、Crash Dump 或诊断输出。文件权限、备份、日志脱敏、轮换失败告警和紧急吊销缺一不可。

## 8. 指标与 Label 隐私

禁止或严格控制：

- 用户名、邮箱、手机号、Token、Session ID；
- Request ID、Trace ID 作为常规 Label；
- 原始 SQL、请求体、完整 URL 和查询参数；
- 可能揭示客户业务规模的租户维度；
- 密钥文件路径、内部安全策略和漏洞详情。

指标应使用低基数分类，详细上下文进入受控日志/Trace，通过 Exemplar 或时间关联查询。删除敏感指标后还要考虑 Retention、Snapshot、Remote Store 和 Dashboard 缓存中的历史副本。

## 9. 多租户边界

单机 Prometheus 本身不是强多租户系统。用 Grafana Folder 隐藏 Dashboard 不能阻止用户直接查询其他 Series。

真正的多租户后端应在写入和查询入口：

- 由可信代理完成认证并设置 Tenant ID；
- 拒绝客户端覆盖内部 Tenant Header；
- 每租户限制 Series、Samples/s、查询并发、范围和返回量；
- 对象存储、缓存和规则路径保持租户隔离；
- 管理员跨租户查询需要独立权限和审计。

Mimir 等系统通常依赖外部认证代理，不能把“Header 存在”误解为身份已经可信。

## 10. 查询与写入资源攻击

即使用户只能读，也可能通过超长范围、无界正则、复杂 Join 或高并发耗尽 CPU/内存。写入端可通过高基数 Label 和大 Payload 消耗资源。

控制措施：

- 查询超时、并发、最大 Samples/Series/Range；
- Query Frontend 排队、拆分、缓存和租户公平性；
- Remote Write 请求大小、速率和 Series 限制；
- Scrape Sample/Label/Body 限制；
- Grafana 用户权限和默认时间范围；
- 对被拒绝请求、429、超时和限额持续监控。

## 11. Alertmanager 通知出口

Webhook 可以把内部告警内容发送到外部系统，也可能成为 SSRF 或数据外传通道。Receiver URL 应来自受控配置，只允许必要目的地址，经 Egress Policy/Proxy 限制。

通知正文不要包含 Secret、完整查询参数或个人数据。Webhook 接收端验证来源、限制 Body、幂等处理，并避免在错误日志回显认证头。

## 12. 供应链与配置安全

- 镜像固定版本和 Digest，验证来源；
- 审核 Exporter/Plugin，它们通常能读取宿主和数据库；
- Node Exporter 的 Textfile Collector 目录不可被不可信用户写入；
- Grafana Plugin 启用签名和允许列表；
- Rule、Dashboard、Relabel、Alertmanager Route 通过 Git 审批；
- Operator/CRD 升级审查权限变化；
- 禁止 Dashboard 中内嵌可复用管理员 Token。

## 13. 安全验收

1. 未认证访问 Query、Reload、Admin API 应被拒绝；
2. 低权限用户无法跨 Tenant 查询；
3. Prometheus 只能发现和读取必要 Kubernetes 资源；
4. 抓包确认关键链路 TLS 且证书校验正确；
5. 轮换 CA、Token、对象存储密钥和 Webhook Secret；
6. 注入高基数、超大查询和伪造 Tenant Header，验证限制；
7. 审计能还原谁修改了规则、路由和 Silence；
8. 备份中 Secret 已加密并有访问审计。

## 14. 练习与答案

**问题：Grafana Folder 已按团队隔离，是否等于指标数据隔离？**

答案：不等于。用户若能访问共享 Data Source 或 Query API，仍可能查询其他 Label；隔离必须由查询后端和可信身份强制执行。

**问题：NetworkPolicy 已限制只允许 Prometheus Pod，为什么仍建议 mTLS？**

答案：网络策略基于网络身份和 Label，不能证明应用身份，也不加密流量；两者防护层次不同。

## 15. 参考资料

- [Prometheus HTTPS and Authentication](https://prometheus.io/docs/prometheus/latest/configuration/https/)
- [Prometheus Security Model](https://prometheus.io/docs/operating/security/)
- [Prometheus Configuration](https://prometheus.io/docs/prometheus/latest/configuration/configuration/)
