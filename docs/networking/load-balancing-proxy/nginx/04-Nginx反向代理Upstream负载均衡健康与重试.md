---
title: "Nginx 反向代理、Upstream、负载均衡、健康检查与重试"
sidebar_label: "04. Upstream、健康与重试"
sidebar_position: 4
description: "从两条独立连接理解 Upstream 选择、连接池、DNS、超时、被动健康检查、重试、幂等与故障证据链。"
tags: [Nginx, Upstream, 负载均衡, Keepalive, 重试, 健康检查]
---

# Nginx 反向代理、Upstream、负载均衡、健康检查与重试

反向代理不是把客户端 Socket 直接接到后端 Socket。Nginx 终止下游连接，再创建或复用一条独立的上游连接；两侧协议、超时、缓冲和 TLS 状态分别管理。

## 1. 一次代理请求

```text
Client Connection
  → server/location
  → 构造 Upstream Request
  → 选择 Peer
  → 获取/新建 Upstream Connection
  → 发送 Request Header/Body
  → 等待 Response Header
  → 读取 Response Body
  → Buffer/Filter/Cache
  → 下游响应
```

日志应区分连接、首部、完整响应和下游总时间：

```nginx
log_format upstream '$request_id $status '
                    'ua=$upstream_addr us=$upstream_status '
                    'uct=$upstream_connect_time '
                    'uht=$upstream_header_time '
                    'urt=$upstream_response_time rt=$request_time';
```

## 2. Upstream 定义

```nginx
upstream api_backend {
    zone api_backend 64k;
    least_conn;

    server 10.0.1.10:8080 max_fails=3 fail_timeout=10s;
    server 10.0.1.11:8080 max_fails=3 fail_timeout=10s;
    server 10.0.1.12:8080 backup;

    keepalive 128;
    keepalive_requests 1000;
    keepalive_timeout 60s;
}
```

`zone` 让 Worker 共享部分 Upstream 运行时状态；支持的动态能力与健康检查仍取决于 Nginx 版本和发行版。

## 3. 负载均衡算法

| 算法 | 特征 | 适用边界 |
| --- | --- | --- |
| Round Robin | 默认，按权重轮转 | 后端能力和请求成本接近 |
| `least_conn` | 选择活动连接较少者 | 请求时长差异明显，但连接不等于工作量 |
| `ip_hash` | 依据客户端 IP 粘滞 | NAT 用户聚集，扩缩容会重映射 |
| `hash key consistent` | 一致性哈希 | 缓存/分片亲和，仍需处理节点变化 |
| `random two least_conn` | 抽样两台再选连接少者 | 大规模池降低选择开销 |

流式推理请求持续时间差异很大时，连接数比 Round Robin 更有参考价值，但无法感知 GPU KV Cache、请求 Token 和排队深度；更复杂选择应由专用推理网关完成。

## 4. Downstream 与 Upstream Keepalive

二者不同：

```text
Client ← keepalive → Nginx
Nginx  ← upstream keepalive pool → Backend
```

`keepalive 128` 是每个 Worker 对该 Upstream Group 的空闲连接缓存上限，不是全局最大连接数，也不限制正在使用的连接。

HTTP Upstream 复用通常需要：

```nginx
proxy_http_version 1.1;
proxy_set_header Connection "";
```

后端、NAT、防火墙和 Nginx 的空闲超时不一致时，池里可能保留已被对端关闭的连接，表现为偶发首请求失败。应让上游生命周期、探活和重试策略协同。

## 5. 超时不是总时长上限

```nginx
proxy_connect_timeout 3s;
proxy_send_timeout 30s;
proxy_read_timeout 60s;
```

- Connect Timeout：建立上游连接；
- Send Timeout：两次向上游写操作之间允许的间隔；
- Read Timeout：两次从上游读操作之间允许的间隔。

Read Timeout 通常不是“整个响应必须 60 秒完成”。SSE/LLM 如果持续发送数据可以运行更久；完全没有心跳的数据空窗可能超时。

## 6. 被动失败与主动健康检查

开源 Nginx 常通过真实请求的连接/超时/错误执行被动失败统计。`max_fails` 与 `fail_timeout` 不表示后台定时 HTTP 探测，也不能证明业务深度健康。

主动健康检查的指令和能力取决于 NGINX Plus、第三方模块、Ingress Controller 或外部负载均衡器。写配置前必须确认实际二进制：

```bash
nginx -V 2>&1
```

健康要分层：端口存活、进程就绪、依赖可用和业务容量不是同一个信号。

## 7. 重试语义

```nginx
proxy_next_upstream error timeout http_502 http_503 http_504;
proxy_next_upstream_tries 2;
proxy_next_upstream_timeout 5s;
```

重试前必须回答：

1. 请求体是否已经发送给上游？
2. 上游是否可能已经执行副作用？
3. 响应是否已经发给客户端？
4. 请求体是否可重放，是否已落临时文件？
5. 总体延迟预算还剩多少？

GET 也不天然无副作用，POST 也可以通过幂等键安全重试。正确边界来自业务语义。

关闭 `proxy_request_buffering` 后，Nginx 边收客户端请求体边发给上游；一旦开始发送，请求通常更难安全切换到另一后端。

## 8. Upstream DNS 与动态地址

静态主机名通常在配置解析时解析；动态解析能力依赖 `resolver`、变量、Upstream `resolve` 支持及具体版本/产品。Kubernetes Pod IP 变化时，必须验证 Nginx 是否会更新地址，而不是只看 DNS TTL。

```nginx
resolver 10.96.0.10 valid=10s ipv6=off;
resolver_timeout 2s;
```

动态 `proxy_pass http://$backend` 会改变 URI 处理、错误发现和性能特征，还必须防止用户输入控制目标地址造成 SSRF。

## 9. 上游 TLS

```nginx
proxy_ssl_server_name on;
proxy_ssl_name api.internal.example.com;
proxy_ssl_trusted_certificate /etc/nginx/ca/internal-ca.pem;
proxy_ssl_verify on;
proxy_ssl_verify_depth 2;
```

“使用 HTTPS”不等于验证了后端身份。需要同时启用验证、提供信任 CA、设置正确 SNI/名称并验证失败策略。

## 10. Buffering 与背压

开启 `proxy_buffering` 时，Nginx 尽快读上游并通过内存/临时文件隔离慢客户端；关闭后，上游更直接承受下游消费速度。对普通 API，Buffering 有助释放上游连接；对 SSE/Token Streaming，可能推迟首块输出。

请求体由 `proxy_request_buffering` 控制，两者不能混为一谈。

## 11. 常见故障证据

| 现象 | 证据与判断 |
| --- | --- |
| `502` 且 `uct` 极短 | Connection Refused、协议错误、上游提前关闭 |
| `504` 且 `uht` 接近 Read Timeout | 上游迟迟未返回响应头 |
| 多个 `$upstream_addr` | 发生了重试或内部切换 |
| `rt` 远大于所有 `urt` | 客户端慢、队列、重试间空档或本地处理 |
| 首次请求偶发失败 | Keepalive 连接被中间设备回收 |
| 一台节点持续低流量 | 权重、失败状态、哈希、DNS 或健康配置 |

## 12. 可复现实验

准备两个返回实例标识的后端，连续请求并查看日志：

```bash
for i in 1..20; do
  curl -sS -H 'Host: api.example.com' http://127.0.0.1:8080/
done
```

依次停止后端、制造超时、返回 503、发送不可重放请求，验证实际重试次数与日志序列。

## 13. 练习与答案

**问题：** `keepalive 128` 是否限制该 Upstream 最多 128 条连接？

不是。它限制每个 Worker 缓存的空闲 Upstream Keepalive 连接，活动连接可更多。

**问题：** Upstream 返回 500 是否默认重试？

取决于 `proxy_next_upstream` 配置，而且即使允许也必须考虑请求是否已产生副作用。

**问题：** 连接数最少是否等于负载最低？

不等于。连接成本、请求大小、CPU/GPU 队列和下游速度可能不同。

## 14. 参考资料

- [Nginx Upstream Module](https://nginx.org/en/docs/http/ngx_http_upstream_module.html)
- [Nginx Proxy Module](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [Nginx Upstream Keepalive](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#keepalive)
