---
title: "静态文件、Sendfile、Buffer、Compression 与 Cache"
sidebar_position: 6
tags: [Nginx, Sendfile, Buffer, Cache, Compression]
description: "理解静态文件零拷贝、代理缓冲、压缩、缓存键、新鲜度和回源保护。"
---

# 静态文件、Sendfile、Buffer、Compression 与 Cache

## 静态文件

URI 经 `root/alias/try_files` 映射路径。`alias` 尾斜杠和 location 捕获常出错；防目录穿越、符号链接和敏感文件。`sendfile` 可减少用户态复制，Direct I/O/AIO 和磁盘类型需实测。

## Buffer

请求体/上游响应可在内存 buffer，不足时落临时文件。Buffering 保护上游免受慢客户端占连接，但消耗 Nginx 内存/磁盘；SSE/流式 LLM 常需关闭相关缓冲并验证每个中间层。

## Compression

Gzip/Brotli（模块取决于构建）减少网络、增加 CPU。只压适合 MIME 和最小大小，避免已压缩内容；`Vary: Accept-Encoding` 和代理缓存键要一致。TLS 压缩敏感响应需评估侧信道。

## Cache

Cache Key 至少考虑 scheme/host/URI/query 和影响响应的 Header/身份。错误 Key 会跨用户泄露。定义 freshness、stale-if-error、lock、bypass/no-cache、Set-Cookie/Authorization 和 Purge 流程。

Cache stampede 用 cache lock、stale、TTL 抖动和上游限流治理。磁盘 cache manager/loader、keys zone 和 inode/空间监控同样重要。

## 验收题

- Buffering 如何隔离慢客户端？
- SSE 为什么容易被缓冲破坏？
- Cache Key 漏租户字段有什么风险？
- Sendfile 是否总比普通读取快？

## 参考资料

- [Core module](https://nginx.org/en/docs/http/ngx_http_core_module.html)
- [Proxy cache](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_cache)
