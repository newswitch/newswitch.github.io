---
title: "配置上下文、指令继承、变量、Location 与 Reload"
sidebar_position: 3
tags: [Nginx, Configuration, Location, Reload]
description: "理解 Nginx 配置上下文、模块合并、Location 选择、URI 重写和无损发布。"
---

# 配置上下文、指令继承、变量、Location 与 Reload

```text
main → events/http/stream
http → upstream/map/server
server → location
location → nested/location-specific directives
```

“继承”由每个模块的 create/merge conf 实现，不是简单文本覆盖。有些指令继承父级，有些在子级出现任一值后整组重置，必须查模块文档并用 `nginx -T` 验证。

## Server/Location

先按 listen/SNI/Host 选 server，再按 URI 执行精确、前缀、正则等 location 规则。正则顺序和 `^~` 会改变结果。建立 URL 测试表：输入 Host/URI → 预期 location → upstream URI。

## Rewrite/Proxy URI

`rewrite`、`return`、`try_files` 和 `proxy_pass` 是否带 URI 会影响路径替换。不要靠肉眼猜，后端回显收到的 URI/Header 做自动测试。

## 变量

变量可能来自请求、map、正则 capture、upstream 或模块，求值可延迟且有缓存/副作用。动态 `proxy_pass` 还涉及 resolver 和 DNS TTL。

## Reload

```text
write candidate → nginx -t
→ atomic publish → signal HUP
→ master parses/binds → new workers
→ old workers drain
```

配置错误时旧 worker 继续；成功不代表旧长连接已退出。监控 worker 代际、连接和错误日志，保留上一配置。

## 验收题

- 指令继承为何由模块决定？
- Location 匹配为何不能只看文件顺序？
- proxy_pass URI 如何影响上游路径？
- Reload 后为何有新旧 worker 共存？

## 参考资料

- [Request processing](https://nginx.org/en/docs/http/request_processing.html)
- [Rewrite module](https://nginx.org/en/docs/http/ngx_http_rewrite_module.html)
