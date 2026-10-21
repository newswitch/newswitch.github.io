---
title: "Go 时间、时区、单调钟与 Timer：测量和调度不是一件事"
sidebar_label: "04. Go 时间、时区、单调钟与 Timer：测量和调度不是一件事"
sidebar_position: 4
description: "墙上时间用于日期与业务截止点，单调时间用于测量经过多久。混淆这两者，会让超时、任务租约和跨机器比较产生隐蔽错误。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go 时间、时区、单调钟与 Timer：测量和调度不是一件事

墙上时间用于日期与业务截止点，单调时间用于测量经过多久。混淆这两者，会让超时、任务租约和跨机器比较产生隐蔽错误。

## 1. 时刻与显示

time.Time 表达时刻并携带 Location；同一时刻在不同地区显示不同小时。跨系统协议通常使用 RFC3339 并标明时区，业务日期则需明确当地日历与夏令时规则。

不要用 `time.Local` 的服务器默认值决定所有用户日期。容器缺少时区数据库时，可按部署方式提供数据或使用 time/tzdata。

## 2. 同一时刻实验

```bash
cd examples/go/core-lab
go run ./cmd/lab -case time
```

```text
same-instant=true local-hour=8 timer-stopped=true
```

完整实现和断言见 [core-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/go/core-lab)。

UTC 零点转换为 UTC+8 后显示八点，但 Equal 为 true。实验 Timer 设置一小时后触发，立即 Stop，不需要真的等待一小时。

## 3. 单调钟与跨进程租约

time.Now 获得的值可能包含单调钟读数，time.Since 与相减在条件满足时可抵抗墙上时钟调整。序列化后单调信息不会跨进程保留。

持久化租约使用数据库时间或统一时间来源，并保留时钟偏差余量。service-lab 为便于实验传入 now；多机生产环境不应假定所有 Worker 的本地时钟严格相等。fencing token 可以阻止过期持有者提交，但外部副作用仍需额外协议。

## 4. Timer 与 Ticker 的生命周期

Timer 是一次性通知，Ticker 周期发送但接收者慢时不会无限保存每个 tick。停止 Ticker 不会关闭其通道，不能只靠 range 等待它自行结束；循环应同时监听 ctx.Done。

Go 1.23 后新 Timer 通道语义发生过改变，Go 1.27 又移除了旧兼容开关。不要把旧版 Stop 后强制 drain 的代码不加条件地照搬。根据当前版本文档使用 Reset/Stop，测试取消与触发同时就绪的情况。

## 5. 练习与答案

### 5.1 两个 Time 的 == 为 false 能证明时刻不同吗

不能，Location 或单调信息可能不同，应按语义使用 Equal。

### 5.2 Ticker.Stop 会关闭 C 吗

不会，退出应通过独立取消信号。

### 5.3 序列化后的时间还能用原进程单调钟比较吗

不能，单调读数不会随常规序列化跨进程传递。

## 6. 参考资料

- [time](https://pkg.go.dev/time)
- [Go 1.27 Timer 变化](https://go.dev/doc/go1.27)
