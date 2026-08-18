---
title: "AI HTTP 与 gRPC 接口诊断"
sidebar_label: "02. AI HTTP 与 gRPC 接口诊断"
sidebar_position: 2
description: "使用 curl、jq、openssl s_client 与 grpcurl 验证健康检查、模型元数据、流式推理、TLS、超时和网关链路。"
tags: [HTTP, gRPC, curl, grpcurl, SSE, TLS, 推理服务]
---

# AI HTTP 与 gRPC 接口诊断

接口返回HTTP 200不代表一次生成成功：SSE可能在首Token后中断，网关可能返回缓存结果，客户端超时可能发生在服务仍计算时，gRPC health通过也不代表模型已加载。

## 1. 分层探测

```text
DNS/TCP/TLS
→ Gateway/Ingress认证与路由
→ 进程存活
→ 模型就绪与身份
→ 非流式最小请求
→ 流式首Token与结束标记
→ 取消/超时传播
→ 负载下SLO
```

基础网络、TLS命令详见网络命令库；这里聚焦AI协议语义。

## 2. curl请求计时 `[R/A]`

```bash
curl --silent --show-error --output response.json \
  --write-out 'code=%{http_code} dns=%{time_namelookup} connect=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total}\n' \
  --connect-timeout 3 --max-time 30 \
  http://service:8000/v1/models
```

关键参数：`-sS`、`-o`、`-w`、`--connect-timeout`、`--max-time`、`--retry`、`--retry-all-errors`、`--resolve`、`--noproxy`、`--http1.1`、`--http2`、`--trace-time`、`--trace-ascii`。请求重试可能导致重复推理和成本，应只对幂等探测使用。

## 3. OpenAI兼容请求 `[A]`

```bash
curl -sS http://service:8000/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $AI_API_TOKEN" \
  -H 'X-Request-ID: probe-001' \
  --data @request.json | jq .
```

令牌从环境/Secret注入，不在日志中展开。固定请求应包含model、messages、temperature=0、max_tokens和stream值；保存响应中的模型名、usage、finish reason和请求ID。

## 4. SSE流式完整性 `[A]`

```bash
curl -N --no-buffer -sS \
  --max-time 60 \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $AI_API_TOKEN" \
  --data @stream-request.json \
  http://service:8000/v1/chat/completions
```

客户端要记录：请求发出、响应头、首个非空data事件、每个chunk、结束标记、连接关闭和退出码。TTFB不一定等于TTFT；代理缓冲可能把多个事件合并。用 `-N` 禁用curl输出缓冲，同时检查Ingress的响应缓冲设置。

## 5. TLS和路由隔离

```bash
openssl s_client -connect gateway.example:443 -servername ai.example </dev/null
curl --resolve ai.example:443:<ip> https://ai.example/health
```

`--resolve` 可绕过DNS但保留Host/SNI，用于区分DNS和网关；不要使用 `-k/--insecure` 作为生产修复，只可在受控诊断中证明证书校验是变量。

## 6. grpcurl `[R/A]`

```bash
grpcurl -plaintext service:8001 list
grpcurl -plaintext service:8001 describe grpc.health.v1.Health
grpcurl -plaintext -d '{"service":""}' service:8001 grpc.health.v1.Health/Check
```

TLS场景：

```bash
grpcurl -cacert ca.pem \
  -authority ai.example \
  -H "authorization: Bearer $AI_API_TOKEN" \
  service:443 package.Service/Method
```

重要参数：`-plaintext`、`-insecure`、`-cacert`、`-cert`、`-key`、`-authority`、`-H`、`-d`、`-import-path`、`-proto`、`-protoset`、`-max-time`、`-connect-timeout`、`-v`。服务关闭reflection时必须提供proto/protoset；这是正常安全配置，不等于gRPC不可用。

## 7. 网关和服务对照

对同一请求依次测试：Pod localhost、Service、Ingress/Gateway、外部域名。保持请求体、模型、Token和超时一致，分别记录请求ID。只有这样才能判断延迟或错误在哪一层引入。

## 8. 常见故障

| 现象 | 判断 |
|---|---|
| health 200、模型请求404 | 路由前缀、模型名、API版本或服务尚未加载 |
| 非流式成功、流式超时 | 代理缓冲、idle timeout、SSE结束语义、客户端解析 |
| 首Token快、总耗时长 | Decode慢、输出过长、客户端背压或网络吞吐 |
| 499/取消后GPU仍忙 | 取消未传播到engine，检查网关、server和scheduler |
| gRPC UNAVAILABLE | DNS/TCP/TLS/HTTP2、Service端口和连接池 |
| gRPC UNIMPLEMENTED | 方法/协议版本错误或reflection关闭，提供proto验证 |
| 401只发生在网关 | Header转发、Token受众/范围、网关策略 |

## 9. 掌握标准 {/* #掌握标准 */}

能分开DNS、TLS、路由、模型就绪和推理语义；能验证SSE完整结束；能使用proto诊断关闭reflection的gRPC；能通过同请求逐层对照定位网关问题。

## 10. 官方资料 {/* #官方资料 */}

- [curl manual](https://curl.se/docs/manpage.html)
- [grpcurl](https://github.com/fullstorydev/grpcurl)
