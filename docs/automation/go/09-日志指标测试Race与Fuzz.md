---
title: "Go 日志、指标、测试、Race 与 Fuzz"
sidebar_label: "09. 日志、指标、测试、Race 与 Fuzz"
sidebar_position: 9
description: "建立结构化观测，使用表驱动测试、Fake、Race Detector、Fuzz 和故障注入验证自动化服务。"
tags: [Go, Testing, Race, Fuzz, Observability]
---

# Go 日志、指标、测试、Race 与 Fuzz

## 1. 可观测字段

日志统一 `run_id/task_id/operation/target/result/error_type/duration`。指标使用低基数标签，目标级详情进入日志或证据。Trace 关联 API、队列、Worker 和下游请求。

标准 `log/slog` 或组织日志库由入口统一配置；库不擅自改变全局 Handler。

## 2. 表驱动测试

```go
func TestClassify(t *testing.T) {
	cases := []struct {
		name string
		in   int
		want string
	}{{"ok", 1, "ok"}, {"failed", 10, "failed"}}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := classify(tc.in); got != tc.want { t.Fatalf("got %q", got) }
		})
	}
}
```

## 3. Fake 和接口

应用服务使用小接口，测试提供线程安全 Fake。不要为验证内部调用顺序制造巨型 Mock；优先断言最终状态和可观察副作用。

## 4. Race

```bash
go test -race ./...
```

在有代表性的并发路径、取消和错误条件运行。Race 会增加资源开销，CI 需设置合理超时。

## 5. Fuzz

```go
func FuzzParseTask(f *testing.F) {
	f.Add([]byte(`{"id":"x"}`))
	f.Fuzz(func(t *testing.T, data []byte) {
		_, _ = ParseTask(data)
	})
}
```

建立不变量：不 Panic、不无限分配、不路径逃逸、成功结果满足 Schema。保存发现的 Corpus 并纳入回归。

## 6. 并发测试

使用 Context Deadline 防止测试永久挂起，检查所有 Goroutine 收敛、队列上限、取消停止新任务和部分失败结果完整。

## 7. 故障注入

覆盖 429、连接重置、租约过期、Worker 丢失、磁盘满、信号和回滚失败。Unknown 状态不能被测试期望误写成 Failed。
