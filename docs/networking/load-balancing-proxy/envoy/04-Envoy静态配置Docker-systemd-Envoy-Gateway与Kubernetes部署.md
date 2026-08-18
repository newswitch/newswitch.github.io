---
title: "Envoy 静态配置、Docker、systemd、Envoy Gateway 与 Kubernetes 部署"
sidebar_label: "04. Envoy 静态配置、Docker、systemd、Envoy Gateway 与 Kubernetes 部署"
sidebar_position: 4
description: "从单 Envoy 静态代理到 systemd、Docker 和 Envoy Gateway，讲清 bootstrap、admin、安全、配置校验、数据面滚动与控制面边界。"
tags: [Envoy, 部署, Docker, systemd, Envoy Gateway, Kubernetes]
---

# Envoy 静态配置、Docker、systemd、Envoy Gateway 与 Kubernetes 部署

Envoy 是代理数据面。一个静态 YAML 可以直接启动它，但生产往往还需要 xDS 控制面、服务发现、证书分发和配置状态。Envoy Gateway 则是独立项目：它使用 Kubernetes Gateway API 和控制器创建/管理 Envoy 数据面，不等于“把 Envoy 镜像放进 Pod”。

## 1. 形态选择

| 方式 | 适合 | 配置来源 | 责任 |
| --- | --- | --- | --- |
| 静态二进制/systemd | 边缘代理、学习 | 本地 bootstrap/static resources | 自管发布和发现 |
| Docker | 本地/标准化代理 | 挂载 YAML 或 xDS | 文件权限、信号、网络 |
| Sidecar/DaemonSet | Service Mesh/节点代理 | Mesh control plane xDS | 控制面产品负责大部分配置 |
| Envoy Gateway | K8s 南北向网关 | Gateway API + Controller | 声明式生命周期 |
| 自研 xDS 控制面 | 特殊平台 | ADS/xDS | 正确性与兼容责任最高 |

## 2. 最小静态配置的结构

```yaml
static_resources:
  listeners:
    - name: ingress_http
      address: { socket_address: { address: 0.0.0.0, port_value: 10000 } }
      filter_chains: []   # 省略 HCM/filter 完整配置
  clusters:
    - name: app
      type: STRICT_DNS
      load_assignment: {} # 省略 endpoints

admin:
  address:
    socket_address: { address: 127.0.0.1, port_value: 9901 }
```

这不是可用代理，只展示 bootstrap 顶层。完整 HTTP 代理需 Filter Chain、HTTP Connection Manager、Route 和 Cluster endpoints。

Admin 接口可读取配置、指标、证书和运行状态，也能执行危险操作，必须只监听 localhost/独立管理网并加外部鉴权，不应公开到业务入口。

## 3. 配置校验

固定 Envoy 版本执行：

```bash
envoy --version
envoy --mode validate -c /etc/envoy/envoy.yaml
envoy --mode init_only -c /etc/envoy/envoy.yaml
```

Validate 证明语法/静态校验通过，不证明 DNS、证书、xDS、upstream 和路由行为正确。上线还要启动影子实例、发送测试流量并检查 config dump。

## 4. systemd 部署

官方文档提示某些 APT 仓库维护状态可能变化，生产应使用官方稳定静态二进制/受信发行包或内部制品库，固定版本与摘要。

创建不可登录 `envoy` 用户，配置和证书只读，日志/热重启目录最小可写。systemd 示例责任：

```text
ExecStart=/usr/local/bin/envoy -c /etc/envoy/envoy.yaml --service-cluster edge
User=envoy
Restart=on-failure
LimitNOFILE=...
AmbientCapabilities=CAP_NET_BIND_SERVICE (only if truly needed)
```

优先监听高端口，由前置 LB/NAT 映射 80/443，从而去掉 root/capability。停止时给予连接排空时间，并验证 systemd signal 与 Envoy drain 行为。

## 5. Docker 部署

官方提供 amd64/arm64 镜像。使用精确稳定补丁或 digest，不用 `dev`/`latest`：

```bash
docker run -d --name envoy-lab \
  --restart unless-stopped \
  -p 127.0.0.1:10000:10000 \
  -p 127.0.0.1:9901:9901 \
  -v "$PWD/envoy.yaml:/etc/envoy/envoy.yaml:ro" \
  envoyproxy/envoy:<fixed-stable-version> \
  -c /etc/envoy/envoy.yaml
```

9901 仅为本机实验映射，生产不要对业务网暴露。官方镜像以非 root 用户运行时，挂载配置、证书和日志目录必须对该 UID/GID 有正确权限；不要为解决权限直接 `--privileged`。

## 6. 静态到 xDS

生产 bootstrap 通常只保留节点身份、admin、xDS cluster 和动态资源入口：

```text
Envoy starts with bootstrap
→ connects to management server
→ receives Listener/Route/Cluster/Endpoint/Secret
→ validates and warms resources
→ ACK or NACK with version/error
→ activates new config atomically where supported
```

xDS 连接断开时，Envoy 通常继续使用最后有效配置；但 endpoint、证书和路由不再更新。部署必须告警控制面连接、NACK、stale version 和 warming 资源。

## 7. Kubernetes 裸 Envoy

Deployment/DaemonSet/Sidecar 都可运行 Envoy，但你必须自己提供：

- bootstrap ConfigMap/Secret 及变更机制；
- xDS 控制面和 node identity；
- Service/端口、readiness 与 admin 管理面隔离；
- resources、HPA、PDB、TopologySpread；
- preStop/drain 和 termination grace；
- SDS/TLS Secret、NetworkPolicy、PodSecurity；
- Access Log/Stats/Tracing 采集。

readiness 不应因为一个可选 upstream 暂时失败就踢掉所有 Envoy，也不能只测进程端口而忽略 Listener/xDS 是否就绪。

## 8. Envoy Gateway

Envoy Gateway 安装 Gateway API CRD 和控制器，再根据 GatewayClass/Gateway/HTTPRoute 创建 Envoy Proxy：

```text
Gateway API objects
→ Envoy Gateway controller
→ generated infra + xDS config
→ Envoy proxy fleet
→ status written back to resources
```

安装使用固定 Envoy Gateway release/Helm Chart，不能照官方 `latest` quickstart 直接上生产。评审 Controller 与 Gateway API 版本、CRD conversion、Envoy image、Provider、扩展 Policy 和升级顺序。

## 9. 统一验收

```text
binary/image: exact version and digest
bootstrap: validate/init_only and secret permissions
listeners/routes/clusters/endpoints: active and expected
xDS: connected, version, ACK/NACK, warming state
traffic: HTTP/1.1, HTTP/2, gRPC, WebSocket/SSE as required
failure: upstream reset/slow, xDS outage, bad config, pod termination
security: admin isolation, downstream/upstream TLS, SDS rotation
capacity: connections, memory, worker concurrency, circuit breakers, P99
observability: access log, stats, trace and config version correlation
```

常用 Admin 证据包括 `/ready`、`/stats`、`/config_dump`、`/clusters` 和证书信息，但必须从受控管理通道访问并脱敏保存。

## 10. 热重启、滚动与回滚

Envoy 支持 hot restart 等机制，但容器/Kubernetes 更多采用多副本滚动：先让新 Pod 获取并 warm 完配置、readiness 通过，再从 LB 摘除旧 Pod、drain 连接、等待 grace 后退出。

升级前验证 bootstrap/xDS API、Filter、Wasm、TLS 和控制面兼容。Canary 少量代理实例，观察 NACK、crash、协议错误、P99 和连接。回滚保留旧镜像与旧 xDS 资源版本，且确保控制面仍能向旧 Envoy 下发兼容资源。

## 11. 参考资料

- [安装 Envoy](https://www.envoyproxy.io/docs/envoy/latest/start/install)
- [Envoy Docker 镜像](https://www.envoyproxy.io/docs/envoy/latest/start/docker)
- [启动与配置校验](https://www.envoyproxy.io/docs/envoy/latest/start/quick-start/run-envoy.html)
- [Envoy Gateway 文档](https://gateway.envoyproxy.io/docs/)
