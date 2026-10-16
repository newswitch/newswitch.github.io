---
title: "Nginx DNS、Resolver、动态 Upstream 与服务发现"
sidebar_label: "17. DNS、动态 Upstream 与服务发现"
sidebar_position: 17
description: "理解配置期与运行期解析、Resolver 缓存、TTL、变量 proxy_pass、Kubernetes Service 和动态后端故障。"
tags: [Nginx, DNS, Resolver, Upstream, 服务发现, Kubernetes]
---

# Nginx DNS、Resolver、动态 Upstream 与服务发现

“域名已经解析到新 IP”不代表 Nginx 正在使用新 IP。解析时机由配置形式、模块、版本和连接复用共同决定。

## 1. 三个时间点

```text
配置加载时解析
运行时按 Resolver/TTL 解析
已有 Keepalive 连接继续复用
```

即使运行时 DNS 已更新，旧 Upstream 连接也可能继续向原地址发送请求，直到连接关闭或失效。

## 2. 配置期解析

```nginx
upstream api {
    server api.internal.example.com:8080;
}
```

传统行为中主机名可能在配置加载时由系统 Resolver 解析。后续 DNS 变化是否自动采用取决于具体版本、参数和产品能力；不要假设永远跟随 TTL。

## 3. Nginx Resolver

```nginx
resolver 10.96.0.10 valid=10s ipv6=off;
resolver_timeout 2s;
```

Nginx 内置异步 Resolver 避免 Worker 执行阻塞系统 DNS。`valid` 可以覆盖响应 TTL 缓存时间，但设置过短会放大 DNS QPS，过长会延迟摘除旧地址。

Resolver 本身也要高可用，地址不可达时动态请求可能失败。

## 4. 变量 `proxy_pass`

```nginx
set $backend api.internal.example.com;

location / {
    proxy_pass http://$backend:8080;
}
```

变量触发运行时解析，但同时改变：

- URI 替换语义；
- 错误出现时机；
- Upstream Group 和连接池使用方式；
- 用户输入控制目标时的 SSRF 风险。

不要将 `$arg_url`、Host Header 等未经白名单验证的输入直接拼入 `proxy_pass`。

## 5. Upstream 动态解析

部分当前 Nginx 版本/产品支持在 Upstream `server` 使用 `resolve`，并要求共享 Zone 与 Resolver。具体语法和开源/商业可用性曾随版本变化，必须查部署版本官方文档并通过测试确认。

设计目标是：DNS 变化时更新 Peer 列表，同时让 Worker 共享运行时状态，而不是每个请求随意解析。

## 6. A、AAAA 与双栈

DNS 名称可能同时返回 IPv4/IPv6。若集群没有可用 IPv6 路由，却允许 Resolver 返回 AAAA，可能出现部分连接超时。关闭 IPv6 查询只是临时策略，长期应明确双栈能力和地址选择。

## 7. Kubernetes Service

### 7.1 ClusterIP

解析 `api.namespace.svc.cluster.local` 得到稳定 ClusterIP，由 kube-proxy/eBPF 数据面选择 Pod：

```text
Nginx → Service ClusterIP → Endpoint Pod
```

Nginx 无需直接跟踪 Pod IP，但看不到每个 Endpoint 的细粒度健康/负载。

### 7.2 Headless Service

DNS 返回多个 Pod IP：

```text
Nginx → DNS A/AAAA Set → Pod IP
```

需要正确处理 TTL、Pod 删除、Readiness 传播、连接复用和 DNS 负缓存。仅使用系统 Resolver 在启动时解析，会导致 Pod 变化后地址陈旧。

## 8. SRV 记录

SRV 可携带服务端口、优先级和权重，但 Nginx 各版本/产品对 SRV 动态 Upstream 支持不同。不能把 DNS 权重直接等同 Nginx Upstream 权重，必须验证实现。

## 9. DNS 故障模式

| 现象 | 原因候选 |
| --- | --- |
| Reload 后恢复 | 原地址只在配置期解析 |
| 新旧 Pod 都收到流量 | TTL/连接复用/Endpoint 传播 |
| 每隔 TTL 出现延迟尖刺 | DNS 查询慢、Resolver 单点 |
| 只有部分 Worker 失败 | 地址/连接池/运行时状态不同 |
| IPv4 正常、域名偶发慢 | AAAA 路径不可达 |
| `no resolver defined` | 变量目标需 Nginx Resolver |
| `host not found in upstream` | 配置加载期 DNS 失败 |

## 10. 证据链

```bash
nginx -T 2>&1 | grep -nE 'resolver|upstream|proxy_pass'
dig @10.96.0.10 api.default.svc.cluster.local A
dig @10.96.0.10 api.default.svc.cluster.local AAAA
ss -ntp | grep nginx
tcpdump -i any -nn port 53
```

日志记录 `$upstream_addr`，将“DNS 应该是什么”与“Nginx 实际连了谁”分开。

## 11. 变更和容量

- DNS TTL 与摘流窗口协调；
- Pod 终止前先取消 Readiness 并等待传播；
- Resolver 缓存过期时避免查询风暴；
- DNS 服务器容量按 Nginx 实例×刷新频率估算；
- 保留旧地址时长需小于地址复用风险窗口；
- Keepalive 最大寿命不能无限延长旧 Endpoint。

## 12. 练习与答案

**问题：** DNS TTL 为 10 秒，为什么 1 分钟后 Nginx 仍访问旧 Pod？

可能只在配置加载时解析，或已有 Keepalive 连接仍复用旧地址，也可能 Resolver/Endpoint 传播路径另有缓存。

**问题：** 为什么动态 `proxy_pass` 有 SSRF 风险？

若目标主机由请求参数/Header 控制，攻击者可能让 Nginx访问内网、云元数据或其他非预期地址。

**问题：** 使用 ClusterIP 后 Nginx 是否直接感知每个 Pod 的连接数？

通常不感知。Service 数据面在 Nginx 选中 ClusterIP 后再选择 Endpoint。

## 13. 参考资料

- [Nginx Resolver Directive](https://nginx.org/en/docs/http/ngx_http_core_module.html#resolver)
- [Nginx Upstream Module](https://nginx.org/en/docs/http/ngx_http_upstream_module.html)
- [Kubernetes DNS for Services and Pods](https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/)
