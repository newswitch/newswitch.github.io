---
title: "静态文件、Sendfile、Buffer、Compression 与 Cache"
sidebar_label: "06. 静态文件、Sendfile、Buffer、Compression 与 Cache"
sidebar_position: 6
description: "理解静态文件零拷贝、代理缓冲、压缩、缓存键、新鲜度和回源保护。"
tags: [Nginx, Sendfile, Buffer, Cache, Compression]
---

# 静态文件、Sendfile、Buffer、Compression 与 Cache

## 1. 静态文件 {/* #静态文件 */}

URI 经 `root/alias/try_files` 映射路径。`alias` 尾斜杠和 location 捕获常出错；防目录穿越、符号链接和敏感文件。`sendfile` 可减少用户态复制，Direct I/O/AIO 和磁盘类型需实测。

## 2. Buffer {/* #buffer */}

请求体/上游响应可在内存 buffer，不足时落临时文件。Buffering 保护上游免受慢客户端占连接，但消耗 Nginx 内存/磁盘；SSE/流式 LLM 常需关闭相关缓冲并验证每个中间层。

## 3. Compression {/* #compression */}

Gzip/Brotli（模块取决于构建）减少网络、增加 CPU。只压适合 MIME 和最小大小，避免已压缩内容；`Vary: Accept-Encoding` 和代理缓存键要一致。TLS 压缩敏感响应需评估侧信道。

## 4. Cache {/* #cache */}

Cache Key 至少考虑 scheme/host/URI/query 和影响响应的 Header/身份。错误 Key 会跨用户泄露。定义 freshness、stale-if-error、lock、bypass/no-cache、Set-Cookie/Authorization 和 Purge 流程。

Cache stampede 用 cache lock、stale、TTL 抖动和上游限流治理。磁盘 cache manager/loader、keys zone 和 inode/空间监控同样重要。

## 5. 静态与流式两组实验 {/* #静态与流式两组实验 */}

对 1 KiB、1 MiB、1 GiB 静态文件测 sendfile 开关、并发、CPU、磁盘读和 page cache；再用 SSE/LLM 流式响应验证首 token 是否被 proxy/gzip/cache/CDN 缓冲。

```bash
curl -o /dev/null -sS -w 'start=%{time_starttransfer} total=%{time_total}\n' https://example/file
curl -N https://example/stream
```

Buffering 能隔离慢客户端与上游，但会消耗内存/临时磁盘并延迟流式数据；关闭它会让上游连接更久。压缩要按 MIME、大小和 CPU 测试，敏感响应还要考虑压缩侧信道。Cache key 必须包含真实租户/认证/编码维度，禁止缓存私有响应到共享键。

容量验收同时检查 `$request_time` 与 `$upstream_response_time`、临时文件、cache hit、磁盘水位和 open file。缓存清理/失效应有版本化 URL 或受控 purge，不能依赖全盘删除。

## 6. 验收题 {/* #验收题 */}

- Buffering 如何隔离慢客户端？
- SSE 为什么容易被缓冲破坏？
- Cache Key 漏租户字段有什么风险？
- Sendfile 是否总比普通读取快？

## 7. 参考资料 {/* #参考资料 */}

- [Core module](https://nginx.org/en/docs/http/ngx_http_core_module.html)
- [Proxy cache](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_cache)
