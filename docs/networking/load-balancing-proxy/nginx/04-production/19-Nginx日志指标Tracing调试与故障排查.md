---
title: "Nginx 日志、指标、Tracing、调试与故障排查"
sidebar_label: "19. 可观测性与故障排查"
sidebar_position: 19
description: "建立从 Request ID、Access/Error Log 到 Stub Status、Exporter、分段耗时、Debug Log 和系统证据的排障体系。"
tags: [Nginx, 可观测性, 日志, 指标, Tracing, 故障排查]
---

# Nginx 日志、指标、Tracing、调试与故障排查

只记录 `$status $request_time` 无法区分客户端慢、Nginx 排队、Upstream 建连慢还是后端处理慢。可观测性要围绕一次请求的阶段和连接生命周期设计。

## 1. 请求标识

生产中不能无条件信任客户端提供的 Request ID。最稳妥的基线是始终生成 Nginx 内部 ID，把外部 `X-Request-ID` 或 `traceparent` 作为独立字段记录；只有网关已验证其长度和字符时，才允许继续沿用外部 ID。内部 ID 的传递方式如下：

```nginx
proxy_set_header X-Request-ID $request_id;
add_header X-Request-ID $request_id always;
```

如果前置可信网关已经完成校验，可以通过 `map` 在“合法外部 ID”和 `$request_id` 之间选择；不要用 `default $http_x_request_id` 直接接收任意客户端输入。

## 2. 通用结构化访问日志

```nginx
log_format main_json escape=json
  '{"ts":"$time_iso8601",'
  '"request_id":"$request_id",'
  '"remote":"$remote_addr",'
  '"host":"$host",'
  '"method":"$request_method",'
  '"uri":"$uri",'
  '"status":$status,'
  '"bytes":$body_bytes_sent,'
  '"request_time":$request_time,'
  '"upstream":"$upstream_addr",'
  '"upstream_status":"$upstream_status",'
  '"connect":"$upstream_connect_time",'
  '"header":"$upstream_header_time",'
  '"response":"$upstream_response_time",'
  '"cache":"$upstream_cache_status",'
  '"protocol":"$server_protocol"}';
```

查询参数、Authorization、Cookie、请求体和完整 User-Agent 可能包含敏感信息或高基数。先设计采集最小集、脱敏、保留期和访问权限。

## 3. 多次 Upstream 尝试

发生重试时 `$upstream_addr`、`$upstream_status` 和时间变量可能包含多个值。分析系统必须保留序列对应关系，不能只取最后一项。

示例：

```text
upstream=10.0.1.10:8080, 10.0.1.11:8080
status=502, 200
connect=0.001, 0.002
response=0.005, 0.120
```

客户端最终 200，但第一个后端已失败；只统计最终状态会漏掉故障。

## 4. Error Log

```nginx
error_log /var/log/nginx/error.log warn;
```

级别从 debug、info、notice、warn、error、crit、alert 到 emerg。常见错误：

- `connect() failed (111: Connection refused)`；
- `upstream timed out`；
- `upstream prematurely closed connection`；
- `no live upstreams`；
- `too many open files`；
- `client intended to send too large body`；
- `could not build server_names_hash`。

错误文本需要结合请求 ID、Upstream 地址、errno 和时间，不能只截取一句。

## 5. Debug Log

Debug 需要二进制使用 `--with-debug`，并设置 Debug Level。可按来源地址限制连接调试：

```nginx
events {
    debug_connection 192.0.2.10;
}
```

Debug Log 量大且可能包含敏感 Header/URI，只在隔离/Canary 实例或短窗口使用。结束后恢复配置并销毁不必要日志。

## 6. Stub Status

```nginx
location = /nginx_status {
    stub_status;
    allow 127.0.0.1;
    deny all;
}
```

典型输出：

```text
Active connections: 291
server accepts handled requests
 16630948 16630948 31070465
Reading: 6 Writing: 179 Waiting: 106
```

- Accepts 与 Handled 差值可提示连接处理资源问题；
- Requests 是累计请求，不是瞬时 QPS；
- Waiting 多数是 Keepalive，不必然异常；
- 开源 Stub Status 粒度有限，不能直接给每个 Upstream 的完整指标。

## 7. Exporter 与指标系统

Exporter 通常抓取 Stub Status 或产品 API，再暴露 Prometheus 指标。需确认：

- 指标来自开源 Stub Status、NGINX Plus API 还是 Ingress Controller；
- Label 是否包含 Host/Path/Upstream 等高基数；
- 抓取失败是否有自身告警；
- Counter 重置与 Pod 重建如何处理；
- 指标端点是否经过认证和网络隔离。

日志适合逐请求明细，指标适合聚合趋势，Tracing 适合跨组件因果；三者不能互相完全替代。

## 8. Trace Context

若接入 OpenTelemetry/模块或上游 Trace，应遵循标准 Trace Context，并区分：

- 外部传入 Trace ID 是否采信；
- Nginx 是否创建 Span；
- Upstream 子 Span 的开始/结束位置；
- 采样决策和敏感属性；
- 流式长请求 Span 何时结束。

模块能力取决于 Nginx 构建和版本，先确认动态模块/API，不在配置中假设一定可用。

## 9. 系统证据

```bash
nginx -V 2>&1
nginx -T 2>&1
ps -o pid,ppid,psr,stat,%cpu,rss,etime,cmd -C nginx
ss -lntp
ss -s
pidstat -p ALL 1
vmstat 1
iostat -xz 1
sar -n DEV,TCP,ETCP 1
df -h; df -i
```

Nginx 指标正常但业务慢时，继续检查 DNS、网络重传、磁盘 Temp/Cache、Cgroup Throttling 和 Upstream。

## 10. 分层排障树

```text
DNS 正确？
→ TCP/TLS 成功？
→ Nginx 是否收到请求？
→ server/location 是否正确？
→ 是否被限流/鉴权/WAF 拒绝？
→ Upstream 选了谁、连接多久？
→ 首响应头与完整响应多久？
→ 客户端发送/接收是否慢？
```

### 10.1 499

Nginx 常用 499 表示客户端在响应完成前关闭连接。原因可能是客户端 Deadline、上层 LB 超时、用户取消、网络断开，或 Nginx/上游太慢导致客户端先放弃。不能直接归咎客户端。

### 10.2 502

重点查协议、连接拒绝、上游提前关闭、无有效 Header、DNS 和 TLS 验证。

### 10.3 504

通常表示等待 Upstream 超时，结合 Connect/Header/Response Time 判断发生阶段，并检查重试是否叠加总时延。

## 11. 告警设计

- 外部黑盒 DNS/TCP/TLS/HTTP 可用性；
- 5xx/499/429 分接口与实例比例；
- P95/P99 Request/Upstream/Connect/Header Time；
- Active、Accept、Handled 和 Worker 存活；
- CPU Throttle、RSS、FD、磁盘/inode；
- Cache 命中/回源和 Temp 写入；
- Upstream 单节点错误和重试；
- 配置版本、Reload 失败和证书到期。

告警应包含路由到 Runbook 的上下文，不仅是一条“5xx 高”。

## 12. 练习与答案

**问题：** 最终 HTTP 200，为什么仍要观察 `$upstream_status` 序列？

可能先请求一个失败节点再重试成功，最终状态掩盖了后端故障和额外延迟。

**问题：** 499 是否一定是用户主动关闭浏览器？

不是，也可能是客户端/上层代理 Deadline 或网络中断，常由服务端慢间接触发。

**问题：** Stub Status 的 Waiting 很高是否代表请求排队？

不一定，多数是 HTTP Keepalive 等待新请求；结合 Active、请求率、连接寿命和资源判断。

## 13. 参考资料

- [Nginx Log Module](https://nginx.org/en/docs/http/ngx_http_log_module.html)
- [Nginx Stub Status Module](https://nginx.org/en/docs/http/ngx_http_stub_status_module.html)
- [Nginx Debugging Log](https://nginx.org/en/docs/debugging_log.html)
