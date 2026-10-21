---
title: "Go slog：结构化日志、关联字段、错误边界与脱敏"
sidebar_label: "05. Go slog：结构化日志、关联字段、错误边界与脱敏"
sidebar_position: 5
description: "日志的目标是回答一次请求为何失败，不是打印所有变量。稳定字段、合理级别、Trace 关联和敏感信息控制比输出行数更重要。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go slog：结构化日志、关联字段、错误边界与脱敏

日志的目标是回答一次请求为何失败，不是打印所有变量。稳定字段、合理级别、Trace 关联和敏感信息控制比输出行数更重要。

## 1. Logger、Handler 与属性

slog.Logger 表达日志调用，Handler 决定级别、格式和输出。JSONHandler 适合机器检索，TextHandler 适合部分交互环境。用固定属性名记录 duration、operation、error_class，而不是把每种结果塞入不同文本模板。

With 可绑定稳定上下文，LogAttrs 可明确类型。Context 不会自动让所有 Handler 读取 Trace ID，需要桥接实现；不能因为传入 InfoContext 就假定日志平台已完成链路关联。

## 2. 稳定日志实验

```bash
cd examples/go/core-lab
go run ./cmd/lab -case logs
```

```text
{"level":"INFO","msg":"task completed","task_type":"demo","attempt":1}
```

完整实现和断言见 [core-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab)。

实验用 ReplaceAttr 删除时间字段以便断言。生产日志一般保留时间与服务实例等关联字段，不能为了测试确定性而直接照抄到所有环境。

## 3. 错误由边界记录

内部函数返回带语义的错误链，由 HTTP、Worker 或消息边界记录一次主要失败。400 输入错误与依赖宕机不应采用完全相同的错误级别和告警。

日志不得包含 Authorization、完整 Cookie、JWT、密码、DSN 或默认整段模型提示。ID 是否可记录也取决于隐私策略。任何自动遍历请求对象的日志器都要检查脱敏覆盖范围。

## 4. 日志也有资源成本

同步写满磁盘或阻塞 stdout 管道会拖慢业务，异步队列则可能丢日志或占内存。要说明缓冲上限、丢弃策略、关闭排空时限和失败可观测性。

高基数字段可作为受控日志属性，但不应无脑复制成 Prometheus label。错误采样需保留总量指标，避免只留下少量样本后无法知道影响范围。

## 5. 练习与答案

### 5.1 InfoContext 自动保证输出 Trace ID 吗

不保证，取决于 Handler 或桥接逻辑。

### 5.2 把请求对象全部打日志最方便排障吗

风险很高，可能泄露凭证与个人信息，也会增加 I/O 成本。

### 5.3 每一层都打印同一个 error 更可靠吗

通常只会重复，边界统一记录并保留错误链更清晰。

## 6. 参考资料

- [log/slog](https://pkg.go.dev/log/slog)
