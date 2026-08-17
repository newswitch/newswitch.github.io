---
title: Nginx 大模型网关日志配置实践
sidebar_label: "10. Nginx 大模型网关日志配置与请求观测"
description: 面向 vLLM / OpenAI 兼容推理网关的 Nginx 访问日志格式、关键字段与落盘注意事项。
sidebar_position: 10
---

## 1. 背景

在大模型服务（如 vLLM / OpenAI API 兼容接口）中，网关层通常承担以下职责：

- 请求转发（Reverse Proxy）
- 鉴权与多租户隔离
- 限流与流控
- 可观测性（日志 / 指标 / tracing）

在实际使用过程中，默认的 Nginx access_log 难以满足大模型场景的需求，主要体现在：

- 无法识别请求所属用户或租户
- 无法区分不同模型的调用情况
- 无法获取 token 消耗信息（计费核心指标）
- 无法进行有效的性能分析（尤其是推理耗时）

因此，需要对日志体系进行针对性设计。

## 2. 设计目标

本方案的目标如下：

- **请求可追踪性**：为每个请求生成或透传 trace_id
- **多维度标识能力**：支持 user_id / tenant_id / api_key 维度
- **模型级别观测**：记录模型名称（model）
- **资源消耗统计**：支持 prompt_tokens / completion_tokens / total_tokens
- **性能分析能力**：区分网关耗时与上游推理耗时
- **日志结构化**：使用 JSON 格式，便于接入日志系统（ELK / Loki / ClickHouse）

## 3. 架构设计

整体请求链路如下：

```text
Client → Nginx → LLM Backend（vLLM） → Response(Header包含统计信息) → Nginx → access_log
```

关键设计点：

### 3.1 trace_id 管理

- 优先使用客户端透传的 `X-Request-Id`
- 若不存在，则由 Nginx 自动生成

### 3.2 Token 信息获取

由于 Nginx 无法感知模型内部推理过程，token 统计必须由后端服务返回，例如：

```text
X-Model: Qwen2.5-72B-Instruct
X-Prompt-Tokens: 1024
X-Completion-Tokens: 512
X-Total-Tokens: 1536
```

Nginx 通过 `$upstream_http_*` 变量读取这些信息。

## 4. 实现方案

### 4.1 trace_id 生成与透传

```nginx
map $http_x_request_id $trace_id {
    default $http_x_request_id;
    ""      $request_id;
}
```

### 4.2 日志格式设计（JSON）

```nginx
log_format llm_json escape=json
'{'
    '"time":"$time_iso8601",'
    '"trace_id":"$trace_id",'
    '"remote_addr":"$remote_addr",'

    '"method":"$request_method",'
    '"uri":"$request_uri",'
    '"status":$status,'

    '"request_time":$request_time,'
    '"upstream_response_time":"$upstream_response_time",'
    '"upstream_addr":"$upstream_addr",'

    '"user_id":"$http_x_user_id",'
    '"tenant_id":"$http_x_tenant_id",'
    '"api_key_id":"$http_x_api_key_id",'

    '"model":"$upstream_http_x_model",'
    '"prompt_tokens":"$upstream_http_x_prompt_tokens",'
    '"completion_tokens":"$upstream_http_x_completion_tokens",'
    '"total_tokens":"$upstream_http_x_total_tokens"'
'}';
```

### 4.3 启用 access_log

```nginx
access_log /var/log/nginx/llm_access.log llm_json;
```

### 4.4 反向代理配置

```nginx
location /v1/ {
    proxy_pass http://vllm_backend;

    proxy_http_version 1.1;

    # trace_id 透传
    proxy_set_header X-Request-Id $trace_id;

    # 用户信息透传
    proxy_set_header X-User-Id $http_x_user_id;
    proxy_set_header X-Tenant-Id $http_x_tenant_id;
    proxy_set_header X-Api-Key-Id $http_x_api_key_id;

    # 流式响应优化
    proxy_buffering off;
    proxy_request_buffering off;

    proxy_connect_timeout 10s;
    proxy_read_timeout 600s;
}
```

## 5. 日志示例

```json
{
  "time": "2026-04-30T10:20:30+09:00",
  "trace_id": "abc-123",
  "remote_addr": "10.1.1.5",
  "method": "POST",
  "uri": "/v1/chat/completions",
  "status": 200,
  "request_time": 3.521,
  "upstream_response_time": "3.500",
  "user_id": "user_001",
  "tenant_id": "tenant_a",
  "model": "Qwen2.5-72B-Instruct",
  "total_tokens": "1536"
}
```

## 6. 关键注意事项

### 6.1 token 数据来源

Nginx 不具备推理感知能力，token 信息必须由后端服务返回。

### 6.2 JSON 转义

必须开启：

```nginx
escape=json
```

否则可能导致日志格式破坏。

### 6.3 流式接口处理

对于流式推理接口（SSE / chunked response），建议关闭缓冲：

```nginx
proxy_buffering off;
```

### 6.4 upstream_response_time 特性

在部分异常或短连接场景下，该字段可能为空，需要在后续分析系统中做兼容处理。

## 7. 扩展与演进方向

该日志方案可以进一步扩展为完整的可观测体系：

- **日志系统**：接入 ELK / Loki，实现检索与分析
- **指标系统**：基于日志提取 QPS / 延迟 / token 使用量
- **计费系统**：基于 token 数据实现按量计费
- **链路追踪**：结合 trace_id 接入分布式 tracing 系统（如 OpenTelemetry）

## 8. 总结

本文通过对 Nginx access_log 的扩展，实现了大模型网关场景下的：

- 请求追踪（trace_id）
- 多维度标识（用户 / 租户 / API Key）
- 资源消耗统计（token）
- 性能分析（网关与上游耗时拆分）

该方案在不引入额外网关组件的前提下，为大模型服务提供了基础的可观测与计费能力。
