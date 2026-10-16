---
title: "Nginx WebSocket、SSE、gRPC、FastCGI 与流式代理"
sidebar_label: "16. WebSocket、SSE、gRPC 与 FastCGI"
sidebar_position: 16
description: "比较 WebSocket、SSE、gRPC、FastCGI 与普通 HTTP 代理的连接、Buffer、超时、背压和错误边界。"
tags: [Nginx, WebSocket, SSE, gRPC, FastCGI, 流式]
---

# Nginx WebSocket、SSE、gRPC、FastCGI 与流式代理

不同协议虽然都经过 Nginx，但其连接生命周期、消息边界、Buffer 和错误处理完全不同。复制一段普通 `proxy_pass` 配置不能保证流式协议正确。

## 1. 普通 HTTP 反向代理

```nginx
location /api/ {
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_pass http://api_backend;
}
```

Nginx 可以读取完整响应头、Buffer 响应、重试尚未向客户端发送的失败，并按 HTTP Status 记录结果。

## 2. WebSocket Upgrade

WebSocket 先进行 HTTP/1.1 Upgrade，之后同一 TCP 连接承载双向 Frame：

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

location /ws/ {
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header Host $host;
    proxy_read_timeout 300s;
    proxy_pass http://ws_backend;
}
```

Upgrade 与 Connection 是 Hop-by-Hop Header，Nginx 不会自动原样转发。连接建立后普通 HTTP 响应缓存不适用。

需要应用 Ping/Pong 或业务心跳发现半开连接；把 Read Timeout 设置无限大只会长期保留僵尸状态。

## 3. SSE

SSE 是服务端到客户端的 HTTP 文本事件流：

```nginx
location /events/ {
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 5m;
    proxy_set_header Connection "";
    proxy_pass http://event_backend;
}
```

应用需及时 Flush，并发送注释心跳维持中间设备状态。客户端通过 `Last-Event-ID` 等机制恢复时，业务要决定事件重放和去重。

`curl -N` 可禁用客户端输出缓冲，用于验证事件是否逐条到达。

## 4. 大模型 Token Streaming

常见路径：

```text
Client ← SSE/Chunked ← Nginx ← SSE/Chunked ← Model Server
```

关键指标：

- TTFT：首 Token 到达；
- TPOT/ITL：后续 Token 间隔；
- 总响应时间；
- 客户端断开后上游是否取消；
- 慢客户端是否长期占用模型连接；
- Reload/扩缩容时客户端重连。

关闭 Buffer 只是条件之一，还要检查 Ingress、Service Mesh、CDN、压缩和应用 Flush。

## 5. gRPC

gRPC 通常使用 HTTP/2，Nginx 提供独立 gRPC 模块：

```nginx
upstream grpc_backend {
    server 10.0.1.20:50051;
}

location /helloworld.Greeter/ {
    grpc_pass grpc://grpc_backend;
    grpc_set_header X-Request-ID $request_id;
    grpc_read_timeout 60s;
}
```

上游 TLS 使用 `grpcs://` 并配置相应 `grpc_ssl_*` 验证。gRPC Status 常在 Trailer 中，HTTP 200 不一定代表 RPC 成功，日志和监控必须读取 `grpc-status`。

Unary、Server Streaming、Client Streaming 和 Bidirectional Streaming 对连接寿命、Body 流控和超时要求不同。

## 6. FastCGI

FastCGI 常用于 Nginx 到 PHP-FPM：

```nginx
location ~ \.php$ {
    try_files $uri =404;
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    fastcgi_pass unix:/run/php/php-fpm.sock;
}
```

风险集中在：

- SCRIPT_FILENAME 路径拼接；
- 不存在脚本被错误交给 FPM；
- Unix Socket 权限；
- FPM Worker/Queue 容量；
- `fastcgi_buffering`、`fastcgi_cache` 与动态私有响应；
- 超时与 PHP 执行时间不一致。

`try_files` 不能替代应用安全，但能避免将任意路径解释为脚本。

## 7. uWSGI 与 SCGI

Nginx 还有 uWSGI/SCGI 模块。它们与 HTTP Proxy 指令不是通用替换关系，各自有参数编码、Buffer、Cache 和超时指令。现代 Python 服务也常直接用 HTTP/ASGI，上线前根据实际应用 Server 选择协议，不因框架名称盲目使用 uWSGI 协议。

## 8. Request Buffering

流式上传或 gRPC Client Streaming 需要核对请求体是否被完整 Buffer。关闭 Buffer 后：

- 上游更早收到数据；
- 慢客户端占用上游更久；
- 切换后端和重试更困难；
- 临时盘减少但背压传给应用。

## 9. 超时矩阵

| 协议 | 关键超时 | 不能忽略 |
| --- | --- | --- |
| WebSocket | 读/写空闲 | Ping/Pong、LB Idle Timeout |
| SSE/LLM | 上游读空闲 | 心跳、首 Token、客户端断开 |
| gRPC | Connect/Read/Send | Deadline、Trailer、Stream |
| FastCGI | Connect/Send/Read | FPM Queue、执行时间 |
| 上传 | Client Body/Upstream Send | 临时盘、取消、重试 |

Nginx Timeout、上层 LB、Service Mesh、客户端 Deadline 和应用 Timeout 应形成可解释的从内到外预算。

## 10. 客户端断开与取消

客户端断开后，Nginx 是否立即终止上游取决于协议、配置和处理阶段。对昂贵模型推理/导出任务，要验证断开能否传播取消；否则用户已离开，后端仍持续消耗 GPU/CPU。

## 11. 可观测性

普通 `$upstream_response_time` 只给完整上游时长，不能直接给 TTFT/Token 间隔。可记录：

- Upstream Header Time 作为近似首响应头；
- 应用返回的模型/Token/首 Token Header；
- gRPC Status/Message；
- WebSocket Upgrade 状态和连接持续时间；
- 客户端 499 与上游取消结果。

## 12. 故障排查

| 现象 | 重点检查 |
| --- | --- |
| WebSocket 400/426 | Upgrade/Connection、HTTP Version、上游支持 |
| SSE 一次性输出 | 应用 Flush、Nginx/CDN Buffer、压缩 |
| 流每 60 秒断开 | 各层 Idle/Read Timeout 和心跳 |
| gRPC HTTP 200 但调用失败 | Trailer 中 `grpc-status` |
| PHP 502 | FPM Socket、权限、队列、进程和日志 |
| 客户端断开但 GPU 继续忙 | 取消未传播或后端忽略取消 |

## 13. 练习与答案

**问题：** SSE 是否需要 WebSocket Upgrade Header？

不需要。SSE 是普通单向 HTTP 响应流。

**问题：** gRPC 返回 HTTP 200 是否代表 RPC 成功？

不一定。最终 RPC 状态通常在 Trailer 的 `grpc-status`。

**问题：** 关闭 `proxy_buffering` 后为什么后端连接数可能上升？

慢客户端的背压直接传到后端，上游连接需要保持更久。

## 14. 参考资料

- [Nginx WebSocket Proxying](https://nginx.org/en/docs/http/websocket.html)
- [Nginx gRPC Module](https://nginx.org/en/docs/http/ngx_http_grpc_module.html)
- [Nginx FastCGI Module](https://nginx.org/en/docs/http/ngx_http_fastcgi_module.html)
