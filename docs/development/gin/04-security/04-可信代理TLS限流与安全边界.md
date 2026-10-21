---
title: "Gin 可信代理、TLS、限流与管理接口隔离"
sidebar_label: "04. Gin 可信代理、TLS、限流与管理接口隔离"
sidebar_position: 4
description: "客户端 IP、HTTPS 状态与容量控制常由网关和应用共同决定。若信任链配置错误，日志、限流和访问控制可能全部建立在伪造请求头上。"
tags: [Go, Gin, 技术原理, 实验]
---

# Gin 可信代理、TLS、限流与管理接口隔离

客户端 IP、HTTPS 状态与容量控制常由网关和应用共同决定。若信任链配置错误，日志、限流和访问控制可能全部建立在伪造请求头上。

## 1. ClientIP 来自哪一层

直连对端地址来自连接，X-Forwarded-For 等 Header 可被客户端伪造。只有连接确实来自可信代理地址时，才按既定规则解释转发头。

示例显式 SetTrustedProxies(nil)，不信任任何转发代理；部署网关后改为实际代理 CIDR，并保证外部无法绕过网关直接访问应用。不要把 0.0.0.0/0 当作方便的默认值。

## 2. 代理实验

```bash
cd examples/gin/service-lab
go run ./cmd/webdemo -case proxy
```

```text
status=200
client=192.0.2.10
```

完整代码与断言见 [service-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/gin/service-lab)。

测试构造远端 192.0.2.10 并注入另一个 XFF 值，禁用可信代理后仍取连接对端。真实环境还要考虑多跳代理与 IPv6，不能用这一条 Recorder 测试替代网络拓扑验证。

## 3. TLS 与容量保护

TLS 可在网关终止，应用要清楚内部链路是否需要重加密或 mTLS。错误的 X-Forwarded-Proto 信任会影响 Secure Cookie、重定向和绝对 URL。

全局并发许可、按身份/租户配额、速率限制与下游池上限是不同工具。本项目只有每进程 16 个请求许可与三秒预算，不是分布式全局限流器，增加副本会增加总体容量。

## 4. 管理入口与错误处理

Metrics 与 pprof 只在独立回环 Listener，公开 API 不挂载；在 K8s 内如需采集，应通过受控 sidecar 或管理网络重新设计，不能仅为方便采集直接改成所有地址开放。

限制 Header、Body、连接数、上传大小与调试行为，日志脱敏。Recovery 不是输入安全机制，也不会捕获所有进程级故障；OOMKill、fatal Runtime 错误和外部中断仍有自己的恢复路径。

## 5. 练习与答案

### 5.1 XFF 可以直接用于可信限流吗

只有建立并验证代理信任链后才可以。

### 5.2 每进程 16 个许可等于整个集群 16 个吗

不等于，副本会放大总体并发。

### 5.3 pprof 放公开路径但名字隐蔽就安全了吗

不安全，应隔离并限制访问。

## 6. 参考资料

- [Gin trusted proxies](https://gin-gonic.com/en/docs/deployment/)
- [http.Server](https://pkg.go.dev/net/http#Server)
