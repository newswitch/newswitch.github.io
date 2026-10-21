---
title: "FastAPI 学习路线：HTTP、异步与可靠服务"
sidebar_label: "00. FastAPI 学习路线"
sidebar_position: 0
description: "以可恢复任务服务为主线，学习 FastAPI 的 HTTP、依赖、异步数据库、安全、Worker、事件流、部署、源码与性能诊断。"
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

[逐篇示例](https://github.com/newswitch/newswitch.github.io/tree/main/examples/fastapi/framework-lab)保留小实验和同步任务记录服务 `task_app.py`，便于观察单项机制；[异步综合工程](https://github.com/newswitch/newswitch.github.io/tree/main/examples/fastapi/task-service)继续实现独立 Worker、租约恢复、结果提交与事件重放。后者执行有限字符串转换，不连接真实业务系统。两个项目按阶段分别运行，不混用数据库结构和签发配置。

## 3. 入门与 HTTP：五篇

| 顺序 | 主题 | 核心问题 |
| --- | --- | --- |
| 1 | [第一个 FastAPI 项目与应用启动](./01-startup-http/01-第一个FastAPI项目与应用启动.md) | 什么是应用对象，开发重载与生产启动有什么不同 |
| 2 | [Uvicorn、ASGI、Starlette 与 FastAPI](./01-startup-http/02-Uvicorn-ASGI-Starlette与FastAPI.md) | 连接、ASGI 消息与应用调用怎样衔接 |
| 3 | [路由、路径、查询、请求体与响应](./01-startup-http/03-路由路径查询请求体与响应.md) | 输入来自哪里，状态码与错误如何约定 |
| 4 | [Pydantic、校验、序列化与 OpenAPI](./01-startup-http/04-Pydantic校验序列化与OpenAPI.md) | 类型注解何时参与运行校验，输入输出模型为什么分开 |
| 5 | [APIRouter、应用工厂与多文件工程](./01-startup-http/05-APIRouter应用工厂与多文件工程.md) | 模块依赖和资源初始化怎样分开 |

## 4. 依赖与异步：四篇

| 顺序 | 主题 | 核心问题 |
| --- | --- | --- |
| 6 | [中间件、异常与请求上下文](./02-dependencies-async/01-中间件异常与请求上下文.md) | 调用先后与错误传播怎样影响响应 |
| 7 | [依赖图、缓存、yield 与清理时机](./02-dependencies-async/02-依赖图缓存yield与清理时机.md) | 一个请求中对象怎样创建和释放 |
| 8 | [配置、lifespan 与公共资源](./02-dependencies-async/03-配置lifespan与公共资源.md) | 连接池和客户端为什么不能随意在导入时创建 |
| 9 | [同步、异步、线程池与事件循环阻塞](./02-dependencies-async/04-同步异步线程池与事件循环阻塞.md) | 工作在哪个线程执行，阻塞怎样放大尾延迟 |

## 5. 数据与安全：六篇

| 顺序 | 主题 | 核心问题 |
| --- | --- | --- |
| 10 | [SQLAlchemy、连接池与 Session](./03-data-security/01-SQLAlchemy连接池与Session.md) | 连接、会话与请求生命周期是否一致 |
| 11 | [事务、并发更新与数据库迁移](./03-data-security/02-事务并发更新与数据库迁移.md) | 成功响应对应哪次提交，发布如何演进表结构 |
| 12 | [身份认证、密码哈希与 JWT](./03-data-security/03-身份认证密码哈希与JWT.md) | 凭证校验、过期、撤销与密钥如何处理 |
| 13 | [授权、多租户与浏览器安全](./03-data-security/04-授权多租户与浏览器安全.md) | 登录为什么不等于有权访问资源，CORS 为什么不等于授权 |
| 14 | [AsyncSession 与异步数据库访问](./03-data-security/05-AsyncSession与异步数据库访问.md) | 等待、会话、连接池和隐式 I/O 怎样衔接 |
| 15 | [PostgreSQL 锁竞争与在线结构演进](./03-data-security/06-PostgreSQL锁竞争与在线结构演进.md) | 真实并发如何失败，已有数据如何兼容演进 |

## 6. I/O 与任务：四篇

| 顺序 | 主题 | 核心问题 |
| --- | --- | --- |
| 16 | [HTTP 客户端、复用、超时与可靠调用](./04-io-tasks/01-HTTP客户端复用超时与可靠调用.md) | 请求失败是否允许重做，资源上限设在哪里 |
| 17 | [上传、下载、文件与流](./04-io-tasks/02-上传下载文件与流.md) | 大对象如何避免占满内存和磁盘 |
| 18 | [SSE、WebSocket、断开与背压](./04-io-tasks/03-SSE-WebSocket断开与背压.md) | 慢客户端、断线与背压如何收敛 |
| 19 | [BackgroundTasks 与持久化任务](./04-io-tasks/04-BackgroundTasks与持久化任务.md) | 响应返回、工作完成和结果持久化为什么是不同事件 |

## 7. 测试与生产运行：五篇

| 顺序 | 主题 | 核心问题 |
| --- | --- | --- |
| 20 | [pytest、HTTPX、依赖替换与集成测试](./05-production/01-pytest-HTTPX依赖替换与集成测试.md) | 替换依赖能证明什么，真实数据库还要测什么 |
| 21 | [日志、指标、Trace 与请求关联](./05-production/02-日志指标Trace与请求关联.md) | 一次慢请求怎样跨线程、依赖与数据库关联 |
| 22 | [Linux、容器与 Kubernetes 部署](./05-production/03-Linux容器与Kubernetes部署.md) | 进程、信号、探针、反向代理和 TLS 怎样配合 |
| 23 | [Worker、资源上限与优雅退出](./05-production/04-Worker资源上限与优雅退出.md) | 多进程状态如何处理，何时停止接收和排空请求 |
| 24 | [OpenTelemetry 导出与请求耗时分析](./05-production/05-OpenTelemetry导出与请求耗时分析.md) | 真正产生的 Span 和指标怎样送出并解释 |

## 8. 源码与诊断：五篇

| 顺序 | 主题 | 核心问题 |
| --- | --- | --- |
| 25 | [启动、路由注册与应用构建源码](./06-internals-diagnostics/01-启动路由注册与应用构建源码.md) | 装饰器何时执行，路由表如何形成 |
| 26 | [请求、依赖、响应与清理源码](./06-internals-diagnostics/02-请求依赖响应与清理源码.md) | ASGI 消息如何变成函数参数，再变成响应 |
| 27 | [压测、容量与延迟分解](./06-internals-diagnostics/03-压测容量与延迟分解.md) | 吞吐、并发、服务时间和排队如何区分 |
| 28 | [事件循环阻塞、慢请求与内存排障](./06-internals-diagnostics/04-事件循环阻塞慢请求与内存排障.md) | 如何用证据区分 CPU、线程池、数据库池和外部等待 |
| 29 | [并发压测与瓶颈对照实验](./06-internals-diagnostics/05-并发压测与瓶颈对照实验.md) | 同样的等待放在不同执行位置，实测怎样变化 |

## 9. 异步任务服务综合实践：五篇

1. [任务服务的数据模型与接口实现](./07-task-service/01-任务服务的数据模型与接口实现.md)
2. [Worker 租约、重试与幂等执行](./07-task-service/02-Worker租约重试与幂等执行.md)
3. [事件重放、断线恢复与慢消费者](./07-task-service/03-事件重放断线恢复与慢消费者.md)
4. [任务服务运行配置、迁移与部署](./07-task-service/04-任务服务运行配置迁移与部署.md)
5. [并发故障注入与验收实验](./07-task-service/05-并发故障注入与验收实验.md)

先按运行文章把完整服务启动，再返回前三篇追踪状态和事务，最后独立修改一项功能并补反例测试。综合实践是基础机制的组合，不要求先学习另一套 Web 框架。

## 10. 阅读进度与版本边界

本系列提供 34 篇技术文章。示例固定 CPython 3.14.8、FastAPI 0.150.0、Starlette 1.9.0、Pydantic 2.14.1、Uvicorn 0.54.0、SQLAlchemy 2.1.5；出站客户端使用 HTTPX 0.28.1，TestClient 使用 httpx2 2.15.1。原示例环境保持不变，深化实验使用 `examples/fastapi/deepening.lock` 增加明确的驱动、类型检查和遥测依赖。平台相关部署仍需在目标环境验证。

源码文章沿一个请求解释组件的职责、数据与资源生命周期，只引用关键调用点；压测结论会带机器配置、请求形态、并发与数据规模，不把一台机器上的结果当成通用容量。

## 11. 参考资料

- [FastAPI 教程](https://fastapi.tiangolo.com/tutorial/)
- [ASGI Specification](https://asgi.readthedocs.io/en/latest/specs/main.html)
- [Starlette 文档](https://www.starlette.io/)
- [Pydantic 文档](https://docs.pydantic.dev/latest/)
- [Uvicorn 部署](https://www.uvicorn.org/deployment/)
