---
title: "HTTP Phase、Module、Subrequest、Filter 与变量源码"
sidebar_label: "08. HTTP Phase、Module、Subrequest、Filter 与变量源码"
sidebar_position: 8
tags: [Nginx, 源码, HTTP Phase, Filter]
description: "沿 Nginx HTTP 阶段、模块配置、Handler、Subrequest 和 Filter Chain 阅读源码。"
---

# HTTP Phase、Module、Subrequest、Filter 与变量源码

固定 Nginx tag，从 `src/http` 阅读：配置解析创建 main/srv/loc conf，merge 后请求进入 phase engine。

```text
post-read → server-rewrite → find-config
→ rewrite → post-rewrite → preaccess → access
→ post-access → precontent → content → log
```

不同模块注册 handler；Access、Rewrite、Content 的执行顺序由 phase，不是配置文本顺序。

## Filter Chain

响应 header/body 通过 filter chain，模块保存 next filter 并调用下一个。压缩、chunked、range、substitution 等会改变 Header/Body。第三方 filter 不正确调用链会丢数据或崩溃。

## Subrequest

Auth、SSI、mirror 等可创建子请求，共享/继承部分主请求状态但有独立处理。子请求增加内部并发和 upstream，日志/Trace 要区分 main/subrequest。

## 变量

模块注册变量 getter，可能按需计算/缓存。Rewrite 中 set/map/capture 与 upstream 变量的可用阶段不同。

## 调试

Debug 构建和 error_log debug 只在隔离环境；用 request ID、gdb、perf/eBPF 追 handler/系统调用。生产动态模块必须与二进制 ABI/签名匹配。

## 验收题

- Phase 顺序为何不同于配置顺序？
- Filter 模块为什么必须调用 next filter？
- Subrequest 如何放大请求？
- 变量何时可能尚未有值？

## 参考资料

- [Development guide](https://nginx.org/en/docs/dev/development_guide.html)
- [Nginx source](https://github.com/nginx/nginx)
