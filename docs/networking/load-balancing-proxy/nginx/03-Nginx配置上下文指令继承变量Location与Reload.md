---
title: "配置上下文、指令继承、变量、Location 与 Reload"
sidebar_label: "03. 配置上下文、指令继承、变量、Location 与 Reload"
sidebar_position: 3
description: "理解 Nginx 配置上下文、模块合并、Location 选择、URI 重写和无损发布。"
tags: [Nginx, Configuration, Location, Reload]
---

# 配置上下文、指令继承、变量、Location 与 Reload

```text
main → events/http/stream
http → upstream/map/server
server → location
location → nested/location-specific directives
```

“继承”由每个模块的 create/merge conf 实现，不是简单文本覆盖。有些指令继承父级，有些在子级出现任一值后整组重置，必须查模块文档并用 `nginx -T` 验证。

## 1. Server/Location {/* #serverlocation */}

先按 listen/SNI/Host 选 server，再按 URI 执行精确、前缀、正则等 location 规则。正则顺序和 `^~` 会改变结果。建立 URL 测试表：输入 Host/URI → 预期 location → upstream URI。

## 2. Rewrite/Proxy URI {/* #rewriteproxy-uri */}

`rewrite`、`return`、`try_files` 和 `proxy_pass` 是否带 URI 会影响路径替换。不要靠肉眼猜，后端回显收到的 URI/Header 做自动测试。

## 3. 变量 {/* #变量 */}

变量可能来自请求、map、正则 capture、upstream 或模块，求值可延迟且有缓存/副作用。动态 `proxy_pass` 还涉及 resolver 和 DNS TTL。

## 4. Reload {/* #reload */}

```text
write candidate → nginx -t
→ atomic publish → signal HUP
→ master parses/binds → new workers
→ old workers drain
```

配置错误时旧 worker 继续；成功不代表旧长连接已退出。监控 worker 代际、连接和错误日志，保留上一配置。

## 5. 配置变更实验 {/* #配置变更实验 */}

生产必须固定 Nginx 版本并核对 `nginx -V` 的编译模块；mainline/stable 指令和默认值可能不同。每次变更先渲染最终配置，再语法检查和小流量验证：

```bash
nginx -V
nginx -T > /tmp/nginx.effective.conf
nginx -t
nginx -s reload
```

`location` 选择按精确、前缀、正则等规则组合，不是简单“从上到下第一条”。变量求值和指令继承也依模块/上下文而异，应构造 URI 表格验证命中的 server/location、upstream 和响应头。

Reload 由 master 校验新配置、启动新 worker，并让旧 worker 优雅退出；语法正确仍可能造成上游、证书或权限故障。变更后同时检查 master/worker、error log、连接、5xx 和旧 worker 是否长期不退出，并保留旧配置快速回滚。

## 6. 验收题 {/* #验收题 */}

- 指令继承为何由模块决定？
- Location 匹配为何不能只看文件顺序？
- proxy_pass URI 如何影响上游路径？
- Reload 后为何有新旧 worker 共存？

## 7. 参考资料 {/* #参考资料 */}

- [Request processing](https://nginx.org/en/docs/http/request_processing.html)
- [Rewrite module](https://nginx.org/en/docs/http/ngx_http_rewrite_module.html)
