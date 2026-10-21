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

## 5. 日志调用会经过哪些阶段

一次 slog 调用包括调用点表达式求值、级别判断、构建 Record、Handler 处理以及最终写入。即使某级别关闭，传入参数中的昂贵函数仍可能已经执行；需要时先用 Enabled 再计算，或使用合适的延迟值策略。

With 建立带稳定属性的 Logger，WithGroup 组织字段命名空间；它们不会自动从 Context 取出全部业务信息。Trace ID 需要受控桥接，且不要把 Context 当作随意传输所有日志字段的万能 Map。

Handler 的 Handle 可能返回输出错误，但普通 Logger 调用并不把它作为业务错误返回给调用方。若日志丢失本身很重要，需要在输出组件侧观测，而不是期待每次 Info 都能告知落盘结果。

## 6. 把敏感类型的展示策略收敛到边界

实现 slog.LogValuer 可以让某种凭证类型默认只输出受控摘要或 [REDACTED]。resources 模式使用虚构凭证验证 redacted=true，检查日志里没有原文本，而不只检查代码中存在脱敏函数。

类型策略不是万能保险：先 fmt.Sprintf 成普通字符串、直接读取字段或使用另一个日志器，仍可能绕过它。ReplaceAttr 适合处理标准字段与属性，但不应假定能从任意嵌套对象里识别全部秘密。

采用允许记录的字段名单，避免自动序列化所有请求。密码、Cookie、Authorization、模型提示与个人数据要按实际保密要求处理，日志里的关联 ID 也不一定都适合长期保存。

## 7. 时间、单位与类别决定能否检索

同一字段保持稳定类型，例如 duration_ms 始终是数值，error_class 使用有限类别，attempt 为整数。不要有时记录字符串“2s”，有时记录数字 2000，却让查询端猜单位。

日志的时间是记录点，不自动等于数据库提交时间；异步发送也可能改变到达顺序。需要重建请求链时结合 request/trace 标识与阶段，而不是只按日志平台显示顺序推断因果。

请求 ID 与对象 ID 可以帮助定位，但复制到 Metrics label 会造成基数问题。日志、指标和 Trace 的成本与检索模型不同，不应把一份属性全集毫无选择地发给三者。

## 8. 同步、异步与退出时的取舍

同步 Handler 可能被磁盘、标准输出管道或远端出口拖慢；异步组件则需要有界队列、队列满策略、丢弃计数和有限排空时间。无界“后台发送”只是把慢 I/O 换成内存增长。

如果系统崩溃前尚未排空，最后日志可能丢失，所以关键业务事实应保存在事务数据或受审计存储中，而不只依赖一条日志“处理成功”。日志不能替代任务状态机。

测试应核对字段、脱敏与输出失败路径，不把动态时间硬编码成固定值。原 logs 实验移除时间只是为确定断言，生产保留时间的策略与实验格式需要分开。

## 9. 练习与答案

### 9.1 InfoContext 自动保证输出 Trace ID 吗

不保证，取决于 Handler 或桥接逻辑。

### 9.2 把请求对象全部打日志最方便排障吗

风险很高，可能泄露凭证与个人信息，也会增加 I/O 成本。

### 9.3 每一层都打印同一个 error 更可靠吗

通常只会重复，边界统一记录并保留错误链更清晰。

## 10. 参考资料

- [log/slog](https://pkg.go.dev/log/slog)
- [配套有限资源实验](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab/internal/foundation)
