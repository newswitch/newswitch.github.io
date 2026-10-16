---
title: "Nginx 模块、动态模块、njs、Lua/OpenResty 与扩展边界"
sidebar_label: "21. 模块与脚本扩展"
sidebar_position: 21
description: "理解 Nginx 模块生命周期、静态/动态模块 ABI、njs 与 Lua/OpenResty 执行阶段、阻塞风险和安全运维。"
tags: [Nginx, Module, Dynamic Module, njs, Lua, OpenResty]
---

# Nginx 模块、动态模块、njs、Lua/OpenResty 与扩展边界

Nginx 的大部分能力由模块实现。扩展前要先确定逻辑应该运行在哪个配置/请求阶段、能否异步、失败时是否阻塞 Worker，以及升级时 ABI/API 是否兼容。

## 1. 模块类型

常见类别：

- Core/Event Module；
- HTTP Handler/Filter Module；
- Upstream Module；
- Stream/Mail Module；
- Variable/Log/Access 等功能模块。

一个 HTTP 模块可以注册配置指令、创建/合并配置、注册 Phase Handler、变量 Getter、Header/Body Filter 和生命周期 Hook。

## 2. 静态模块与动态模块

静态模块在构建时链接进 Nginx；动态模块生成 `.so` 并通过：

```nginx
load_module modules/ngx_http_example_module.so;
```

加载。动态不代表可以随意跨版本使用。模块需与 Nginx 版本、编译兼容选项、平台和依赖 ABI 匹配。升级 Nginx 时应重新构建/获取匹配包，并在 Canary 验证。

```bash
nginx -V 2>&1
ldd /usr/lib/nginx/modules/ngx_http_example_module.so
```

## 3. HTTP Phase 与扩展位置

```text
Post Read
→ Server Rewrite
→ Find Config
→ Rewrite
→ Post Rewrite
→ Preaccess
→ Access
→ Post Access
→ Precontent
→ Content
→ Log
```

响应还经过 Header/Body Filter Chain。鉴权适合 Access，内容生成适合 Content，响应改写适合 Filter。放错阶段会导致变量未就绪、重复执行或绕过。

## 4. Filter Chain

模块初始化时保存原 Top Filter，再把自己设置为新 Top：

```text
Module A Filter
  → Module B Filter
    → Core/Write Filter
```

每个 Filter 必须正确传递 Buffer Chain、处理 Flush/Last Buffer、临时/文件 Buffer 和异步状态。错误模块可能破坏流式输出、Content-Length 或内存生命周期。

## 5. njs

njs 是面向 Nginx 的 JavaScript 运行时，可用于变量、Access、Content、Filter 和 Fetch 等能力，具体 API 取决于模块版本。

适合：

- 轻量 Header/字段处理；
- 受控路由或鉴权逻辑；
- 小型请求/响应变换。

不适合在 Worker 内执行长 CPU 循环、巨大 JSON 处理或无界内存操作。网络 Fetch 必须有超时、目标白名单和失败策略。

## 6. Lua 与 OpenResty

OpenResty 把 Nginx、LuaJIT 和一组 `lua-nginx-module` 生态模块组合成可编程平台。Lua Coroutine 与 Cosocket 能在支持的阶段进行非阻塞网络 I/O，但普通阻塞 Lua/C 库仍会卡住 Worker。

常见阶段：

```text
init_by_lua*
init_worker_by_lua*
rewrite_by_lua*
access_by_lua*
content_by_lua*
header_filter_by_lua*
body_filter_by_lua*
log_by_lua*
```

不同阶段允许的 API 不同，Filter/Log 阶段尤其受限制。

## 7. 共享字典与状态

Lua Shared Dict 位于共享内存，适合缓存小型共享状态和限流计数，但：

- 有固定容量和淘汰；
- 单次操作原子不等于多步事务原子；
- 不跨 Nginx 实例共享；
- Reload/Restart 的状态行为需验证；
- 不应存放无保护的长期私钥或高基数无限 Key。

## 8. 阻塞与 CPU 风险

以下都可能阻塞 Worker：

- 同步文件/数据库/外部 SDK；
- DNS 解析走阻塞库；
- 复杂正则灾难性回溯；
- 大 JSON 编解码；
- 加密/压缩大对象；
- 第三方 C 模块持锁或长计算。

监控单 Worker CPU、Event Loop 延迟、Request P99，并用 Flame Graph/Profiler 确认热点。

## 9. 安全边界

脚本和模块运行在入口数据面，通常可读取 Token、Cookie、请求体和内部地址。要求：

- 固定来源、版本和 Hash；
- 代码评审与依赖扫描；
- 禁止请求参数直接控制 Fetch/文件路径；
- 日志脱敏；
- 超时、内存和响应大小限制；
- 明确 Fail-Open/Fail-Closed；
- 最小权限访问 Secret 和网络。

动态配置或在线加载代码扩大供应链风险，应纳入与 Nginx 二进制同级的发布流程。

## 10. 何时不应该扩展 Nginx

如果逻辑包含复杂业务状态、长时间计算、强事务、频繁变化依赖或需要独立扩缩容，通常放入外部鉴权/网关服务更合适。Nginx 只保留快速、确定、可降级的数据面操作。

## 11. 构建与发布

```text
固定 Nginx/OpenResty/njs/Lua 版本
→ 固定编译参数和系统依赖
→ 生成 SBOM/Hash
→ 单元测试与配置测试
→ 协议/性能/内存测试
→ Canary
→ 分批发布
→ 保留上一二进制和模块回滚
```

不要只备份 `nginx.conf`，还要备份对应二进制、动态模块、脚本和依赖。

## 12. 调试方法

- `nginx -V`：版本、编译参数和模块；
- `nginx -T`：最终配置；
- Error/Debug Log：阶段和模块错误；
- `perf`/Flame Graph：CPU 热点；
- Core Dump + GDB：Native Module 崩溃；
- njs/Lua 自身错误日志和指标；
- 压测流式、异常输入和依赖超时。

Native Module 使 Worker 崩溃时，Master 可能反复拉起，表面上服务偶发失败。要保留 Core、精确二进制和符号。

## 13. 练习与答案

**问题：** 动态模块是否可以从 Nginx 1.24 直接复制到任意 1.26 二进制？

不能假定。必须确认版本、构建兼容参数、平台和依赖 ABI，最好使用匹配发行包或重新构建。

**问题：** Lua 使用协程是否意味着所有 Lua 库都不会阻塞 Worker？

不是。只有与 Nginx 事件模型集成的非阻塞 API 才能让出执行；普通阻塞库仍会阻塞 Worker。

**问题：** 鉴权逻辑为什么通常放 Access Phase？

此时已完成路由所需解析，且可在内容生成/代理前决定是否允许请求。

## 14. 参考资料

- [Nginx Development Guide](https://nginx.org/en/docs/dev/development_guide.html)
- [njs Documentation](https://nginx.org/en/docs/njs/)
- [OpenResty Documentation](https://openresty.org/en/)
