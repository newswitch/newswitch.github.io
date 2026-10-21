---
title: "Go 表驱动测试、Fake 与契约测试：测试什么才有价值"
sidebar_label: "02. Go 表驱动测试、Fake 与契约测试：测试什么才有价值"
sidebar_position: 2
description: "覆盖率不能代替断言质量。一个可靠测试应说明输入、可观察结果和失败边界，并区分内存替身、真实协议与外部服务验证。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go 表驱动测试、Fake 与契约测试：测试什么才有价值

覆盖率不能代替断言质量。一个可靠测试应说明输入、可观察结果和失败边界，并区分内存替身、真实协议与外部服务验证。

## 1. 表驱动结构

把输入、期望值和错误类别放入 test case，逐条 t.Run。比较结果时关心行为，而不是私有函数调用顺序。错误使用 errors.Is/As，不把易变化文本作为全部契约。

t.Helper 改善失败位置，t.Cleanup 绑定资源释放，t.TempDir 避免污染工程。并行测试共享环境变量、端口、全局 Gin mode 或数据库时，需要明确隔离，不要盲目 t.Parallel。

## 2. 运行实际断言

```bash
cd examples/go/core-lab
go test ./... -count=1 -timeout=30s
go test ./internal/demos -run TestPipeline -v
```

TestExperiments 对每个案例的输出逐条比较，TestPipeline 检查大于队列容量的输入、取消和非法 Worker 上限。测试不通过时应保留完整失败证据，不应过滤输出后只显示 PASS。

## 3. Fake 不能证明什么

内存 Publisher 可模拟“实际接收但返回超时”，用于验证稳定事件 ID、重试与 Inbox 去重；它不能证明 Kafka ACL、分区、重平衡和客户端版本兼容。

httptest.Recorder 验证 Handler，httptest.Server 验证本机真实 HTTP，外部 Postgres/Redis/Kafka 才验证对应系统契约。这些层次都需要，但不能互相冒充。

## 4. 故障测试的断言

事务失败不只断言 error，还要查询业务行和 Outbox 是否同时回滚；租约过期要证明旧 token 不能提交；跨租户请求应看不到目标，而不只是返回非 200。

不要把外部服务缺失时 t.Skip 的测试计作通过。本系列外部联调使用显式 build tag 与必要环境变量，未配置就失败，默认本地测试不触碰真实服务。

## 5. 练习与答案

### 5.1 覆盖率 100% 能证明故障恢复正确吗

不能，需要具体失败场景与状态不变量断言。

### 5.2 Fake Kafka 通过等于真实 Broker 通过吗

不等于。

### 5.3 测试资源关闭应该依赖人工清理吗

不应，使用 Cleanup、defer 和有界等待。

## 6. 参考资料

- [testing](https://pkg.go.dev/testing)
- [httptest](https://pkg.go.dev/net/http/httptest)
