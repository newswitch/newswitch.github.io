---
title: "Nginx 静态文件、Sendfile、Buffer、Compression 与 Cache"
sidebar_label: "06. 静态文件、Buffer 与 Cache"
sidebar_position: 6
description: "从文件映射和零拷贝，进入条件请求、Range、代理缓冲、压缩、反向代理缓存、安全缓存键及回源保护。"
tags: [Nginx, Sendfile, Buffer, Cache, Compression, 静态文件]
---

# Nginx 静态文件、Sendfile、Buffer、Compression 与 Cache

静态文件、代理缓冲、压缩和缓存共同改变数据经过内存、Page Cache、临时磁盘和网络的方式。它们不能按“全部打开性能就好”配置，必须根据对象大小、复用率、客户端速度、流式语义和存储容量分别设计。

## 1. 四种不同的缓存

| 类型 | 所在位置 | 主要指令/机制 |
| --- | --- | --- |
| 浏览器/中间缓存 | 客户端和 CDN | `Cache-Control`、`Expires`、ETag |
| Linux Page Cache | Nginx 主机内核 | 文件读、回收、Readahead |
| Nginx Open File Cache | Worker 元数据/文件描述符 | `open_file_cache` |
| Nginx Proxy Cache | Nginx 磁盘和 Keys Zone | `proxy_cache_*` |

TLS Session Cache 是握手状态缓存，不是 HTTP 响应缓存。

## 2. 文件映射与安全

```nginx
location /assets/ {
    root /srv/www;
    try_files $uri =404;
}

location /downloads/ {
    alias /srv/releases/;
}
```

重点检查：

- `root` 是否拼接完整 URI；
- `alias` 与 Location 尾斜杠是否对应；
- 正则捕获是否经过严格限制；
- 符号链接、备份文件和隐藏文件是否暴露；
- Nginx Worker 是否只有读取权限；
- URI 规范化后是否产生路径穿越或意外内部跳转。

## 3. 条件请求与 Range

静态资源可使用 `Last-Modified`、ETag 和条件请求：

```text
If-Modified-Since / If-None-Match
→ 资源未变化
→ 304 Not Modified，无响应体
```

Range 允许获取部分内容，适合下载与媒体，但大量离散 Range 会增加磁盘和响应开销。应验证 CDN、压缩和缓存对 Range 的处理，避免把不同字节范围错误映射到同一缓存对象。

## 4. Sendfile、AIO 与 DirectIO

```nginx
sendfile on;
tcp_nopush on;
```

`sendfile` 可减少文件数据在内核与用户空间之间的复制，但并不等于数据不经过 Page Cache 或完全零 CPU。TLS、过滤器、压缩、容器文件系统和平台能力会改变路径。

大文件可评估：

```nginx
aio threads;
directio 8m;
```

Direct I/O 会绕开部分 Page Cache 路径并受对齐、文件系统和平台约束；随机开启可能让热点文件变慢。必须在真实磁盘、并发和命中率下测量。

## 5. Open File Cache

```nginx
open_file_cache max=10000 inactive=60s;
open_file_cache_valid 30s;
open_file_cache_min_uses 2;
open_file_cache_errors on;
```

它缓存文件描述符、大小、修改时间、目录存在信息和查找错误等，不缓存文件正文。部署原子替换、符号链接切换或高频发布时，要评估元数据陈旧窗口。

## 6. 响应与请求 Buffer

```nginx
proxy_buffering on;
proxy_buffer_size 16k;
proxy_buffers 16 16k;
proxy_busy_buffers_size 64k;
proxy_max_temp_file_size 1g;
```

响应 Buffer 满后可能写入 `proxy_temp_path`。容量要考虑并发大响应、慢客户端、临时文件空间和 inode。

请求体：

```nginx
proxy_request_buffering on;
client_body_buffer_size 128k;
client_body_temp_path /var/cache/nginx/client_temp;
```

开启后可在把请求交给后端前完整读取请求体，便于重试并隔离慢上传；代价是内存/磁盘和首包延迟。关闭后适合真正流式上传，但后端连接更久且通常难以重试。

## 7. 流式响应

SSE、LLM Token Streaming 和部分 gRPC 场景需要：

```nginx
proxy_buffering off;
proxy_cache off;
gzip off;
```

是否关闭 Gzip 取决于数据与实现，但必须验证首字节/首 Token，而不是只看总耗时。上游也可发送 `X-Accel-Buffering: no`，是否采纳取决于代理配置。

WebSocket 升级后不使用普通 HTTP 响应缓存。

## 8. Compression

```nginx
gzip on;
gzip_min_length 1024;
gzip_types text/plain text/css application/json application/javascript;
gzip_vary on;
```

压缩节省带宽但消耗 CPU，并可能使敏感内容面临长度侧信道。图片、视频和已压缩模型文件通常收益低。Brotli 不是所有 Nginx 构建的内置能力，先检查模块。

缓存必须正确区分内容编码，通常依赖 `Vary: Accept-Encoding` 或让 Cache Key 包含必要维度。

## 9. 浏览器和 CDN 缓存

带内容哈希的不可变静态文件：

```nginx
location /assets/ {
    expires 1y;
    add_header Cache-Control "public, max-age=31536000, immutable";
}
```

HTML 入口通常不应同样长缓存，否则发布后客户端仍引用旧资源。版本化 URL 比依赖全局 Purge 更可靠。

`no-cache` 表示使用前需重新验证，不等于完全不存储；`no-store` 才是禁止缓存保存，语义需要按 HTTP 标准区分。

## 10. Proxy Cache 基础配置

```nginx
proxy_cache_path /var/cache/nginx/api
    levels=1:2
    keys_zone=api_cache:100m
    inactive=30m
    max_size=20g
    use_temp_path=off;

server {
    location /public-api/ {
        proxy_pass http://api_backend;
        proxy_cache api_cache;
        proxy_cache_methods GET HEAD;
        proxy_cache_key "$scheme$host$request_uri";
        proxy_cache_valid 200 10m;
        proxy_cache_valid 404 30s;
        add_header X-Cache-Status $upstream_cache_status always;
    }
}
```

Keys Zone 保存缓存键和元数据，响应正文主要在磁盘。Zone 太小会限制可管理对象数；磁盘 `max_size` 并非瞬间硬上限，Cache Manager 异步淘汰。

## 11. Cache Key 安全

Key 必须覆盖所有会改变响应的维度：

```text
scheme + host + normalized URI + query
+ tenant + locale + representation/encoding + relevant version
```

默认只缓存 `GET` 和 `HEAD` 时，通常应让同一资源的两种请求共享缓存对象，因此不必把方法放入 Key。只有显式缓存其他方法，并且不同方法确实代表不同响应语义时，才应把经过白名单约束的方法维度加入 Key。`$request_uri` 已包含原始查询串；如果业务需要忽略参数顺序或营销参数，应先生成可控的规范化变量，不能直接删掉全部查询参数。

不能盲目把完整 Authorization/Cookie 放入 Key，这会泄露敏感信息到内存/日志并制造高基数。更安全的策略通常是私有请求不进入共享缓存，或由可信鉴权层生成受控的身份/租户分类变量。

Nginx 默认对含 `Set-Cookie`、`Vary: *`、Authorization 等响应/请求有相应缓存限制，但配置指令可以覆盖默认行为。覆盖前必须理解数据泄露风险。

## 12. Bypass 与 No Cache

```nginx
map $http_authorization $skip_cache {
    default 1;
    ""      0;
}

proxy_cache_bypass $skip_cache;
proxy_no_cache     $skip_cache $upstream_http_set_cookie;
```

- `proxy_cache_bypass`：是否不从缓存取；
- `proxy_no_cache`：是否不把本次响应写入缓存。

许多场景需要同时配置，但语义不同。

## 13. 防击穿与故障回源

```nginx
proxy_cache_lock on;
proxy_cache_lock_timeout 5s;
proxy_cache_background_update on;
proxy_cache_use_stale updating error timeout http_500 http_502 http_503 http_504;
```

Cache Lock 让同一新键尽量只有一个请求回源；Stale 可在更新或上游故障时返回旧对象。它提高可用性，也可能延长旧数据暴露时间，订单、权限和配置接口不应照搬静态内容策略。

TTL 抖动通常由应用/CDN或多种 Key/发布策略实现，防止大量对象同一秒过期。还需限制回源并发和上游容量。

## 14. Cache 状态与生命周期

`$upstream_cache_status` 常见值：

| 状态 | 含义 |
| --- | --- |
| `MISS` | 未命中并回源 |
| `HIT` | 命中有效对象 |
| `EXPIRED` | 对象过期并回源 |
| `STALE` | 返回旧对象 |
| `UPDATING` | 后台更新时返回旧对象 |
| `BYPASS` | 按规则绕过读取 |
| `REVALIDATED` | 条件请求验证后继续使用 |

Cache Loader 启动后逐步把磁盘元数据加载进共享区，Cache Manager 执行过期和容量淘汰。重启后短期命中行为可能变化。

## 15. Purge 与失效

开源官方构建并不在所有版本/发行版中提供通用 `proxy_cache_purge` 能力；NGINX Plus、第三方模块或外部缓存系统能力不同。设计优先级：

1. 内容哈希/版本化 URL；
2. 可接受的短 TTL 与重新验证；
3. 受认证、可审计、精确键的 Purge；
4. 避免在线全盘删除缓存目录。

## 16. Kubernetes 与多副本

每个 Nginx Pod 使用 `emptyDir` 时拥有独立冷缓存，重建即丢失；共享网络卷可能引入锁、延迟和一致性问题，不能假设多个 Nginx 能安全共享同一 Cache Path。通常让各副本维护本地缓存，或把跨副本缓存交给 CDN/专用缓存层。

为缓存盘设置容量、inode、驱逐和写放大监控，防止 Cache/Temp 填满节点根盘。

## 17. 验证与故障排查

```bash
curl -sSI https://example.com/assets/app.abc123.js
curl -sS -D- -o /dev/null https://example.com/public-api/item?id=1
du -sh /var/cache/nginx/api
df -h /var/cache/nginx/api
df -i /var/cache/nginx/api
```

验证相同 Key 的第一次 `MISS`、第二次 `HIT`，再改变 Host、Query、Authorization、Encoding 和租户，确认不发生错误复用。

## 18. 练习与答案

**问题：** Buffering 为什么既能保护上游，也可能增加磁盘使用？

Nginx 可快速读取上游并用内存/临时文件承接慢客户端，释放上游连接，但并发大响应会消耗 Buffer 和临时盘。

**问题：** Cache Key 漏掉租户字段有什么风险？

不同租户可能命中同一对象，造成跨租户数据泄露。

**问题：** `no-cache` 是否表示浏览器不能保存？

不是。它通常要求复用前重新验证；禁止保存使用 `no-store`。

**问题：** Sendfile 是否总比普通读取快？

不是。TLS、过滤器、存储介质、热点复用和平台实现都会改变结果，应压测。

## 19. 参考资料

- [Nginx HTTP Core Module](https://nginx.org/en/docs/http/ngx_http_core_module.html)
- [Nginx Proxy Cache](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_cache)
- [Nginx Gzip Module](https://nginx.org/en/docs/http/ngx_http_gzip_module.html)
- [RFC 9111：HTTP Caching](https://www.rfc-editor.org/rfc/rfc9111)
