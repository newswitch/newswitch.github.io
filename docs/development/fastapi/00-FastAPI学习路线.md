---
title: "FastAPI 学习路线：HTTP、异步与可靠服务"
sidebar_label: "00. FastAPI 学习路线"
sidebar_position: 0
description: "以一个任务服务为主线，规划 FastAPI 的 HTTP 契约、依赖、异步、数据、安全、部署、源码与诊断学习顺序。"
tags: [Python, FastAPI, ASGI, Web开发, 学习路线]
---

# FastAPI 学习路线：HTTP、异步与可靠服务

FastAPI 将路由、输入校验、依赖声明和 OpenAPI 组织成 Python Web 应用；Starlette 提供底层 ASGI Web 能力，Pydantic 处理数据模型，Uvicorn 等 ASGI Server 负责运行应用与处理网络协议。理解这些边界，比记住一组装饰器更重要。

本系列只选择 FastAPI 作为 Web 框架。数据库客户端、测试工具和部署组件按需要引入，不另起多套 Web 框架课程。

## 1. 前置知识

从 [Python 学习路线](../python/00-Python学习路线.md)进入，优先掌握名称绑定、可变对象、函数参数、模块、异常、类型注解与异步。`async def` 的具体执行方式，以及同步函数是否进入线程池，要结合调用位置分析，不能凭函数声明判断整个请求是否非阻塞。

HTTP 方法、状态码、幂等性与资源建模可以配合[HTTP、gRPC 与 API 契约设计](../02-services/01-HTTP-gRPC与API契约设计.md)学习。

## 2. 贯穿项目

项目采用一个任务服务，逐步增加能力：

```text
POST   /jobs        创建任务
GET    /jobs/{id}   查询状态
DELETE /jobs/{id}   请求取消
GET    /events      订阅事件
GET    /health/live
GET    /health/ready
```

示例从内存状态开始，但会明确多 Worker 下内存不共享、进程重启会丢失等边界。进入数据专题后再加入持久化、事务、权限和迁移；进入异步任务专题后区分进程内后台工作与可恢复任务系统。

[配套示例工程](https://github.com/newswitch/newswitch.github.io/tree/main/examples/fastapi/framework-lab)包含逐篇实验、锁定依赖和综合任务记录服务 `task_app.py`。综合服务将身份、租户、数据库、幂等创建和条件取消组合起来；它维护记录，不代表已经执行了真实外部作业。

## 3. 入门与 HTTP：四篇

| 顺序 | 主题 | 核心问题 |
| --- | --- | --- |
| 1 | [第一个 FastAPI 项目与应用启动](./01-startup-http/01-第一个FastAPI项目与应用启动.md) | 什么是应用对象，开发重载与生产启动有什么不同 |
| 2 | [Uvicorn、ASGI、Starlette 与 FastAPI](./01-startup-http/02-Uvicorn-ASGI-Starlette与FastAPI.md) | 连接、ASGI 消息与应用调用怎样衔接 |
| 3 | [路由、路径、查询、请求体与响应](./01-startup-http/03-路由路径查询请求体与响应.md) | 输入来自哪里，状态码与错误如何约定 |
| 4 | [Pydantic、校验、序列化与 OpenAPI](./01-startup-http/04-Pydantic校验序列化与OpenAPI.md) | 类型注解何时参与运行校验，输入输出模型为什么分开 |

## 4. 依赖与异步：四篇

| 顺序 | 主题 | 核心问题 |
| --- | --- | --- |
| 5 | [中间件、异常与请求上下文](./02-dependencies-async/01-中间件异常与请求上下文.md) | 调用先后与错误传播怎样影响响应 |
| 6 | [依赖图、缓存、yield 与清理时机](./02-dependencies-async/02-依赖图缓存yield与清理时机.md) | 一个请求中对象怎样创建和释放 |
| 7 | [配置、lifespan 与公共资源](./02-dependencies-async/03-配置lifespan与公共资源.md) | 连接池和客户端为什么不能随意在导入时创建 |
| 8 | [同步、异步、线程池与事件循环阻塞](./02-dependencies-async/04-同步异步线程池与事件循环阻塞.md) | 工作在哪个线程执行，阻塞怎样放大尾延迟 |

## 5. 数据与安全：四篇

| 顺序 | 主题 | 核心问题 |
| --- | --- | --- |
| 9 | [SQLAlchemy、连接池与 Session](./03-data-security/01-SQLAlchemy连接池与Session.md) | 连接、会话与请求生命周期是否一致 |
| 10 | [事务、并发更新与数据库迁移](./03-data-security/02-事务并发更新与数据库迁移.md) | 成功响应对应哪次提交，发布如何演进表结构 |
| 11 | [身份认证、密码哈希与 JWT](./03-data-security/03-身份认证密码哈希与JWT.md) | 凭证校验、过期、撤销与密钥如何处理 |
| 12 | [授权、多租户与浏览器安全](./03-data-security/04-授权多租户与浏览器安全.md) | 登录为什么不等于有权访问资源，CORS 为什么不等于授权 |

## 6. I/O 与任务：四篇

| 顺序 | 主题 | 核心问题 |
| --- | --- | --- |
| 13 | [HTTP 客户端、复用、超时与可靠调用](./04-io-tasks/01-HTTP客户端复用超时与可靠调用.md) | 请求失败是否允许重做，资源上限设在哪里 |
| 14 | [上传、下载、文件与流](./04-io-tasks/02-上传下载文件与流.md) | 大对象如何避免占满内存和磁盘 |
| 15 | [SSE、WebSocket、断开与背压](./04-io-tasks/03-SSE-WebSocket断开与背压.md) | 慢客户端、断线与背压如何收敛 |
| 16 | [BackgroundTasks 与持久化任务](./04-io-tasks/04-BackgroundTasks与持久化任务.md) | 响应返回、工作完成和结果持久化为什么是不同事件 |

## 7. 测试与生产运行：四篇

| 顺序 | 主题 | 核心问题 |
| --- | --- | --- |
| 17 | [pytest、HTTPX、依赖替换与集成测试](./05-production/01-pytest-HTTPX依赖替换与集成测试.md) | 替换依赖能证明什么，真实数据库还要测什么 |
| 18 | [日志、指标、Trace 与请求关联](./05-production/02-日志指标Trace与请求关联.md) | 一次慢请求怎样跨线程、依赖与数据库关联 |
| 19 | [Linux、容器与 Kubernetes 部署](./05-production/03-Linux容器与Kubernetes部署.md) | 进程、信号、探针、反向代理和 TLS 怎样配合 |
| 20 | [Worker、资源上限与优雅退出](./05-production/04-Worker资源上限与优雅退出.md) | 多进程状态如何处理，何时停止接收和排空请求 |

## 8. 源码与诊断：四篇

| 顺序 | 主题 | 核心问题 |
| --- | --- | --- |
| 21 | [启动、路由注册与应用构建源码](./06-internals-diagnostics/01-启动路由注册与应用构建源码.md) | 装饰器何时执行，路由表如何形成 |
| 22 | [请求、依赖、响应与清理源码](./06-internals-diagnostics/02-请求依赖响应与清理源码.md) | ASGI 消息如何变成函数参数，再变成响应 |
| 23 | [压测、容量与延迟分解](./06-internals-diagnostics/03-压测容量与延迟分解.md) | 吞吐、并发、服务时间和排队如何区分 |
| 24 | [事件循环阻塞、慢请求与内存排障](./06-internals-diagnostics/04-事件循环阻塞慢请求与内存排障.md) | 如何用证据区分 CPU、线程池、数据库池和外部等待 |

## 9. 阅读进度与版本边界

本系列已提供 24 篇技术文章。示例固定 CPython 3.14.8、FastAPI 0.150.0、Starlette 1.9.0、Pydantic 2.14.1、Uvicorn 0.54.0、SQLAlchemy 2.1.5；出站客户端使用 HTTPX 0.28.1，TestClient 使用 httpx2 2.15.1。完整依赖与运行方法在源码 `examples/fastapi/framework-lab/` 中维护，平台相关部署仍需在目标环境验证。

源码文章沿一个请求解释组件的职责、数据与资源生命周期，只引用关键调用点；压测结论会带机器配置、请求形态、并发与数据规模，不把一台机器上的结果当成通用容量。

## 10. 参考资料

- [FastAPI 教程](https://fastapi.tiangolo.com/tutorial/)
- [ASGI Specification](https://asgi.readthedocs.io/en/latest/specs/main.html)
- [Starlette 文档](https://www.starlette.io/)
- [Pydantic 文档](https://docs.pydantic.dev/latest/)
- [Uvicorn 部署](https://www.uvicorn.org/deployment/)
