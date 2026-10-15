---
title: "vLLM v0.31 Serve 前端、协议、工具调用与安全参数"
sidebar_label: "29. Serve 前端、协议与安全参数"
sidebar_position: 29
description: "解释 vLLM v0.31 API Server 的监听、进程、TLS、CORS、Chat Template、Reasoning Parser、Tool Parser 与安全边界。"
tags: [vLLM, API Server, Tool Calling, Reasoning, TLS, 安全]
---

# vLLM v0.31 Serve 前端、协议、工具调用与安全参数

模型执行很快但接口仍然慢，问题可能位于 API Server、模板渲染、Tokenizer、Parser 或流式输出。Serve 参数控制的是这条 CPU 前端链路：

~~~text
TCP/TLS
→ HTTP/gRPC
→ 鉴权/CORS/Middleware
→ OpenAI Schema
→ Chat Template
→ Tokenizer/多模态预处理
→ EngineClient
→ EngineCore
→ Detokenizer
→ Reasoning/Tool Parser
→ SSE/JSON
~~~

## 1. 监听与进程参数

| 参数 | 控制对象 | 生产含义 |
|---|---|---|
| `--host` | API Server 监听地址 | `0.0.0.0` 需要网关、NetworkPolicy 和鉴权 |
| `--port` | HTTP 或 Python gRPC 端口 | 不要与内部通信端口混淆 |
| `--uds` | Unix Domain Socket | 同机代理可减少 TCP 管理面，注意权限 |
| `--root-path` | 反向代理子路径 | 必须与 Ingress rewrite 一致 |
| `--grpc` | 使用 Python gRPC Server | 会改变客户端协议和端口用途 |
| `--api-server-count` | API Server 进程数 | 增加前端 CPU 并行，不等于增加 Engine/GPU 副本 |
| `--headless` | 无普通前端的 Engine 模式 | 用于特定 DP/Scale-out 架构 |
| `--shutdown-timeout` | 退出等待时间 | 决定优雅停止还是直接中断 |

前端进程多并不保证吞吐线性增长。共享 Engine、IPC、Tokenizer、响应序列化和网络仍可能成为瓶颈。

## 2. CLI 与 YAML

v0.31.0 推荐使用 `vllm serve`，而不是继续围绕历史入口 `python -m vllm.entrypoints.openai.api_server` 建立新模板。

~~~yaml
model: /models/Qwen
served-model-name: qwen-prod
host: 0.0.0.0
port: 8000
api-server-count: 2
generation-config: vllm
enable-per-request-metrics: true
~~~

~~~bash
vllm serve --config /etc/vllm/config.yaml
~~~

## 3. TLS、鉴权与 CORS

| 参数族 | 用途 | 注意事项 |
|---|---|---|
| `--api-key` | 简单 Bearer Token | 不等于完整 IAM，需 Secret 管理与轮换 |
| `--ssl-keyfile` / `--ssl-certfile` | HTTPS 私钥和证书 | 文件只读挂载，限制权限 |
| `--ssl-ca-certs` | 客户端证书信任链 | mTLS 场景验证客户端证书策略 |
| `--enable-ssl-refresh` | 证书更新后热加载 | 仍要验证失败和回滚行为 |
| `--allowed-origins` | 浏览器跨域 Origin | 公网服务不要无条件开放 `*` |
| `--allowed-methods` | 跨域 Method | 只允许业务需要的方法 |
| `--allowed-headers` | 跨域 Header | 避免扩大攻击面 |
| `--middleware` | 插入 ASGI Middleware | 会进入所有请求热路径 |

更常见的生产结构是：

~~~text
Client
→ Gateway：TLS、OIDC、租户、配额、限流、审计
→ vLLM：模型协议与推理
~~~

即使入口网关已经做 TLS，vLLM Pod 间是否需要 mTLS 仍由威胁模型决定。

## 4. HTTP Parser 与接口暴露

| 参数 | 解决的问题 | 风险 |
|---|---|---|
| `--h11-max-incomplete-event-size` | 限制未完成 HTTP Event 大小 | 太小会拒绝合法大 Header，太大扩大内存风险 |
| `--h11-max-header-count` | 限制 Header 数 | 防止 Header 滥用 |
| `--disable-fastapi-docs` | 关闭 Swagger/ReDoc | 减少不必要暴露 |
| `--enable-offline-docs` | 离线环境提供本地静态文档 | 适用于隔离环境 |
| `--enable-tokenizer-info-endpoint` | 暴露 Tokenizer 信息 | 可能暴露模板与模型细节 |
| `--enable-request-id-headers` | 返回请求 ID Header | 便于网关、日志和 Trace 串联 |

这些参数不能替代网关请求体大小、连接数、超时和速率限制。

## 5. Chat Template 参数

| 参数 | 含义 |
|---|---|
| `--chat-template` | 指定 Jinja Template 文件或模板字符串 |
| `--chat-template-content-format` | 将消息 Content 解释为字符串还是 OpenAI 内容列表 |
| `--default-chat-template-kwargs` | 为模板设置默认参数 |
| `--trust-request-chat-template` | 是否允许请求携带模板 |
| `--trust-request-mm-kwargs` | 是否允许请求覆盖多模态预处理参数 |

以 Qwen 推理开关为例：

~~~bash
--default-chat-template-kwargs '{"enable_thinking": false}'
~~~

这不是简单的显示选项。模板变化会改变 Token 序列，因此会同时影响输出语义、Prompt 长度、Prefix Cache 命中和容量。

生产默认不应信任请求传入模板或任意多模态参数，因为客户端可以改变资源消耗和模型输入结构。

## 6. Tool Calling 参数

| 参数 | 作用 | 必须一起验证的内容 |
|---|---|---|
| `--enable-auto-tool-choice` | 允许模型自动选择工具 | 模型是否支持对应格式 |
| `--tool-call-parser` | 将模型文本解析成 Tool Call | Parser 必须匹配模型家族 |
| `--tool-parser-plugin` | 注册外部 Parser | 插件代码、版本和供应链 |
| `--tool-strict-level` | 提高工具名/参数 Schema 约束 | 与请求级 `strict` 和模型能力共同生效 |
| `--exclude-tools-when-tool-choice-none` | 不选择工具时不把定义放进 Prompt | 会改变 Prompt Token 和 Prefix Cache |
| `--tool-server` | 接入远程或演示工具服务 | 工具执行权限与网络隔离是独立安全域 |

`tool-call-parser` 不是让模型“学会使用工具”，而是把模型已经生成的特定文本格式转换成 API 结构。Parser 选错时，模型可能输出看似正确的文本，但 API 的 `tool_calls` 为空。

## 7. Reasoning Parser

推理模型可能把“思考”和“最终回答”编码成特殊标记或结构。`--reasoning-parser` 负责解释输出格式：

~~~text
模型 Token
→ Detokenizer
→ Reasoning Parser
→ reasoning_content / content
~~~

Parser 需要与模型模板、模型版本和流式协议共同测试：

- 非流式完整响应；
- 流式边界恰好切在特殊标记中间；
- Tool Call 与 Reasoning 同时出现；
- 模型输出不完整标记；
- 客户端取消请求。

## 8. Tokenizer 与 Renderer 并发

`--renderer-num-workers` 控制异步 Renderer 线程池，用于并行 Tokenization、Chat Template 和多模态预处理。它不增加 GPU Batch。

判断是否需要增加：

~~~text
GPU Kernel 之间存在空洞
+ EngineCore 没有足够请求
+ API 进程 CPU 高
+ Tokenization/模板阶段耗时明显
→ 才考虑增加 Renderer Worker
~~~

线程数过大可能带来 CPU 争抢、缓存失效、内存峰值和 NUMA 远端访问。

## 9. 日志与响应参数

| 参数 | 作用 | 代价 |
|---|---|---|
| `--enable-log-requests` | 记录请求信息 | INFO/DEBUG 级别决定是否涉及输入内容 |
| `--enable-log-outputs` | 记录模型输出 | 可能泄露敏感数据 |
| `--enable-log-deltas` | 记录流式增量 | 日志量显著上升 |
| `--max-log-len` | 限制输入日志长度 | 长度限制不等于脱敏 |
| `--enable-per-request-metrics` | 在响应中携带时间指标 | 增加响应字段和处理 |
| `--sse-keep-alive-interval` | 空闲期间发送 SSE 注释 | 防止中间代理误判空闲超时 |
| `--response-role` | Chat Response 的默认 Role | 影响客户端协议兼容 |

请求日志默认应只保留 ID、Token 数、租户、状态、耗时和错误类型，不记录原始 Prompt、上传媒体或模型完整输出。

## 10. 故障映射

| 现象 | 优先检查 |
|---|---|
| GPU 空闲但 TTFT 高 | Renderer、Tokenizer、模板、API CPU、IPC |
| 工具调用返回普通文本 | 模型模板、Tool Parser、Auto Tool Choice |
| 推理内容混入最终答案 | Reasoning Parser 与模板版本 |
| 流式连接被网关提前关闭 | 网关 Read Timeout、SSE Keepalive、客户端取消 |
| 多 API 进程后延迟反而变差 | CPU 限额、线程争抢、IPC 和负载分配 |
| 只在大 Header 请求失败 | H11 大小和数量限制 |
| Prefix Cache 命中下降 | 模板默认参数或工具定义改变了前缀 Token |

## 11. 验收题与答案

**问题：`api_server_count=4` 是否代表有四份模型？**

答案：不代表。它扩展的是 API Server 前端进程；模型 Engine 和 GPU 副本数量由另一层配置决定。

**问题：为什么 Parser 参数也会影响性能？**

答案：模板和工具定义改变 Prompt Token；Parser 还进入输出热路径。错误的模板会降低 Prefix Cache 命中，复杂流式解析也会消耗前端 CPU。

**问题：为什么不应默认开启 `trust_request_chat_template`？**

答案：它允许客户端改变服务端模板和资源消耗，可能绕过统一 Token 预算、破坏缓存隔离并扩大代码/模板注入风险。

## 12. 官方资料

- [vLLM v0.31.0 Serve CLI](https://docs.vllm.ai/en/v0.31.0/cli/serve/)
- [vLLM v0.31.0 Server Arguments](https://docs.vllm.ai/en/v0.31.0/configuration/serve_args/)
- [OpenAI-compatible Server](https://docs.vllm.ai/en/v0.31.0/serving/openai_compatible_server/)
