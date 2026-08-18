---
title: "HTTP Phase、Module、Subrequest、Filter 与变量源码"
sidebar_label: "08. HTTP Phase、Module、Subrequest、Filter 与变量源码"
sidebar_position: 8
description: "沿 Nginx HTTP 阶段、模块配置、Handler、Subrequest 和 Filter Chain 阅读源码。"
tags: [Nginx, 源码, HTTP Phase, Filter]
---

# HTTP Phase、Module、Subrequest、Filter 与变量源码

固定 Nginx tag，从 `src/http` 阅读：配置解析创建 main/srv/loc conf，merge 后请求进入 phase engine。

```text
post-read → server-rewrite → find-config
→ rewrite → post-rewrite → preaccess → access
→ post-access → precontent → content → log
```

不同模块注册 handler；Access、Rewrite、Content 的执行顺序由 phase，不是配置文本顺序。

## 1. Filter Chain {/* #filter-chain */}

响应 header/body 通过 filter chain，模块保存 next filter 并调用下一个。压缩、chunked、range、substitution 等会改变 Header/Body。第三方 filter 不正确调用链会丢数据或崩溃。

## 2. Subrequest {/* #subrequest */}

Auth、SSI、mirror 等可创建子请求，共享/继承部分主请求状态但有独立处理。子请求增加内部并发和 upstream，日志/Trace 要区分 main/subrequest。

## 3. 变量 {/* #变量 */}

模块注册变量 getter，可能按需计算/缓存。Rewrite 中 set/map/capture 与 upstream 变量的可用阶段不同。

## 4. 调试 {/* #调试 */}

Debug 构建和 error_log debug 只在隔离环境；用 request ID、gdb、perf/eBPF 追 handler/系统调用。生产动态模块必须与二进制 ABI/签名匹配。

## 5. 源码阅读方法 {/* #源码阅读方法 */}

先用 `nginx -V` 固定源码 tag 和模块集合，再从一次请求的断点/调试日志进入，而不是顺目录阅读：accept → 初始化 request → server/location 选择 → phase engine → upstream/subrequest → header/body filter → finalize。

```bash
nginx -V 2>&1
# 使用 --with-debug 构建的隔离实例
curl -H 'X-Request-ID: source-lab' http://127.0.0.1:8080/test
```

输出一张 phase/handler 调用图，并标注模块注册 handler/filter 的源码文件和 commit。Subrequest 共享部分主请求上下文但有独立生命周期，递归或大 fan-out 会放大内存和上游流量；filter 链顺序由模块构建/注册决定，不能只凭配置行顺序推断。

自定义模块必须验证异步回调、引用计数、request pool 生命周期、错误 finalize 和 reload 兼容。运行结论用 debug log、gdb/perf 和 access log 相互证明，避免把旧版本博客类名当成当前事实。

## 6. 验收题 {/* #验收题 */}

- Phase 顺序为何不同于配置顺序？
- Filter 模块为什么必须调用 next filter？
- Subrequest 如何放大请求？
- 变量何时可能尚未有值？

## 7. 参考资料 {/* #参考资料 */}

- [Development guide](https://nginx.org/en/docs/dev/development_guide.html)
- [Nginx source](https://github.com/nginx/nginx)
