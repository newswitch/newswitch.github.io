---
title: "Go REST、gRPC、SSH 与系统集成"
sidebar_label: "07. REST、gRPC、SSH 与系统集成"
sidebar_position: 7
description: "为 HTTP、gRPC、SSH 和事件系统建立认证、超时、连接池、Schema、错误与观测边界。"
tags: [Go, REST, gRPC, SSH, Integration]
---

# Go REST、gRPC、SSH 与系统集成

## 1. 统一端口，不统一协议语义

应用层可依赖小接口，但 HTTP 状态码、gRPC Status、SSH Exit Code 和消息确认各有不同语义。适配器负责转换为稳定领域错误，同时保留请求 ID 和原始 Cause。

## 2. REST

- 复用 `http.Client` 与 Transport。
- 请求绑定 Context。
- 设置连接、TLS、响应头和总 Deadline。
- 限制响应体大小。
- 验证 TLS，不使用全局跳过。
- 分页防重复 Cursor 和无限结果。

写操作重试必须有幂等条件。

## 3. gRPC

- 每次 RPC 传 Deadline。
- 区分可重试 Status。
- 控制消息大小和流背压。
- 长连接处理 Keepalive 与负载均衡策略。
- Proto 字段演进遵守兼容规则，不复用已删除字段编号。

客户端、代理和服务端都可能重试，避免层层放大。

## 4. SSH

验证 Host Key、使用最小身份、限制算法和连接数。不要把参数拼成远端 Shell 字符串；优先固定脚本与结构化 stdin。文件传输后校验摘要、权限和业务生效。

## 5. 事件系统

消息“至少一次”投递意味着消费者必须去重。只有处理成功并持久化结果后再确认；失败进入有限重试和死信流程。消息 Schema、Producer 版本和 Correlation ID 进入审计。

## 6. 观测

每个适配器输出操作名、耗时、错误类型、尝试次数和下游 Request ID。目标、完整 URL 和错误正文不进入高基数指标。

## 7. 测试

- Mock/Fake 验证应用策略。
- 本地测试服务器验证协议编码。
- 真实版本契约测试验证模拟未覆盖的差异。
- 故障注入覆盖超时、断流、429、Unavailable、Host Key 变化和重复消息。
