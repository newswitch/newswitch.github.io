---
title: "Envoy Native、Wasm、Dynamic Module 与 Filter 扩展开发"
sidebar_position: 12
tags: [Envoy, Filter, Wasm, Dynamic Module, Extension]
description: "比较 Envoy 原生扩展、Wasm 和动态模块的能力、隔离、发布、性能与故障边界。"
---

# Envoy Native、Wasm、Dynamic Module 与 Filter 扩展开发

扩展开发的第一问不是“用哪种语言”，而是已有内置 Filter、ext_authz/Rate Limit 等外部服务或控制面配置能否完成。自定义代码进入代理关键路径会增加升级、性能和安全责任。

## 1. 选择边界

| 方式 | 优点 | 代价/边界 |
| --- | --- | --- |
| 内置/Native C++ Extension | 能力完整、性能高、深度集成 | 编译/发布 Envoy，崩溃影响进程，升级成本高 |
| Wasm/Proxy-Wasm | 沙箱、跨语言、可动态交付 | ABI/Host 能力限制、VM 开销、调试复杂 |
| Dynamic Module | 可加载本地/远程原生模块，能力随扩展点演进 | ABI/版本/供应链风险，原生错误可影响进程 |
| External Service | 语言自由、进程隔离、集中策略 | 网络延迟、可用性、连接池和失败策略 |

Dynamic Module 是快速演进能力，支持范围和安全语义应以固定 Envoy stable 版本文档为准，不能按开发版字段直接上生产。

## 2. Filter 生命周期

HTTP Filter 通常处理 request headers/data/trailers 与 response headers/data/trailers；Network Filter 处理连接和字节事件。回调可继续、暂停、缓冲或本地响应。异步调用必须安全保存 Stream 状态，并处理超时、取消、下游断开和回调晚到。

线程模型要求避免阻塞 Worker。共享状态必须线程安全且有容量上限；每 Stream/连接对象及时释放。Response Filter 顺序与 Request 方向不同，组合插件前画出实际链路。

## 3. 配置与发布

Typed protobuf 配置可在加载前校验并支持版本演进。动态扩展还需考虑 ECDS/xDS ACK/NACK、依赖 warming 和失败策略。发布要求：

- 固定 Envoy、SDK/ABI、编译器、模块/wasm digest；
- 制品签名、SBOM、漏洞和许可证扫描；
- 配置 Schema、默认安全值与未知字段策略；
- 单 Route/节点 Canary，指标和日志能区分版本；
- 拉取/加载/初始化失败的 fail-open/close 明确；
- 保留一键禁用和最后稳定制品。

## 4. 测试矩阵

单元测试之外，覆盖分块 Body、超大 Header、HTTP/2 多 Stream、gRPC、SSE、reset、取消、外调超时、配置热更新和进程 drain。Fuzz 解析边界，基准测试 CPU/请求、P99、每连接/Stream 内存与日志量。

## 5. 源码阅读入口

从注册的 extension name/type URL 找 Factory，再跟踪配置创建、Filter 实例、回调和统计。遇到问题先确定是配置构建期、初始化/warming、请求回调还是清理阶段，再进入对应源码，而不是通读整个 Envoy 仓库。

## 6. 掌握标准

你应能用风险与运行模型选择内置、External、Wasm 或原生扩展，设计不阻塞 Worker 的回调，完成配置兼容、供应链固定、灰度与故障注入。

## 参考资料

- [Envoy Extending](https://www.envoyproxy.io/docs/envoy/latest/extending/extending)
- [Envoy Dynamic Modules](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/advanced/dynamic_modules)
