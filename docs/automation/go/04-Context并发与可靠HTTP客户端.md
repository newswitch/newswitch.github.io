---
title: "Go Context、并发与可靠 HTTP 客户端"
sidebar_label: "04. Context、并发与可靠 HTTP 客户端"
sidebar_position: 4
description: "从 Context 取消传播、Goroutine 生命周期、有界 Worker Pool、HTTP 连接池、重试和优雅退出构建可靠的 Go 常驻程序。"
tags: [Go, Context, Goroutine, Channel, HTTP, 并发, SRE]
---

# Go Context、并发与可靠 HTTP 客户端

Go 能很容易启动并发：

```go
go collect(target)
```

真正困难的是回答：

```text
谁等待它？
谁通知它停止？
请求超时后它会退出吗？
下游阻塞时内存会不会一直增长？
服务关闭时还在处理的请求怎么办？
```

本篇以并发采集 Kubernetes/Prometheus 证据为场景，建立可取消、有界、可观测的运行模型。

## 1. Context 表达请求生命周期

`context.Context` 携带：

- Deadline。
- Cancellation。
- 请求范围值。

惯例：

```go
func Do(ctx context.Context, input Input) (Output, error)
```

而不是：

```go
func Do(input Input, ctx context.Context)
func Do(input Input) // 内部 context.Background()
```

规则：

- `ctx` 通常是第一个参数。
- 不传 `nil`，未知时传 `context.TODO()`。
- 不把 Context 存进长期业务 Struct。
- 不用 Context 传普通配置。
- 创建 `WithCancel/WithTimeout/WithDeadline` 后调用 `cancel()`。
- 子调用使用派生 Context，确保取消向下传播。

## 2. 总 Deadline 与子预算

```go
func CollectIncident(ctx context.Context, target Target) (Report, error) {
    ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
    defer cancel()

    kubeCtx, kubeCancel := context.WithTimeout(ctx, 10*time.Second)
    defer kubeCancel()

    promCtx, promCancel := context.WithTimeout(ctx, 8*time.Second)
    defer promCancel()

    // ...
}
```

子调用 deadline 不能晚于父 deadline。设计时先分配总预算：

```text
总预算 30s
├── Kubernetes 10s
├── Prometheus 8s
├── 日志 8s
└── 汇总 4s
```

如果 Kubernetes 只用了 2 秒，可由实现决定是否把剩余时间让给其他阶段；不要无意中把串行子超时加成
不可预测的总时长。

## 3. 每个 Goroutine 都要有退出证明

Goroutine 生命周期检查表：

| 问题 | 必须有答案 |
| --- | --- |
| 谁创建？ | 父函数/组件 |
| 谁等待？ | `WaitGroup`、错误组或明确后台生命周期 |
| 如何停止？ | `ctx.Done()`、关闭输入 Channel 或服务器 Shutdown |
| 可能阻塞在哪里？ | Channel、I/O、锁、Timer |
| 阻塞时能否看到取消？ | `select` 或支持 Context 的 API |
| Panic 怎么处理？ | 让进程失败并由监督系统重启，或在边界记录后失败 |

典型泄漏：

```go
func firstResult(ctx context.Context, out chan<- Result) {
    result := expensiveCall()
    out <- result // 调用者超时返回后，没有接收方，永久阻塞
}
```

修复：

```go
select {
case out <- result:
case <-ctx.Done():
    return
}
```

但如果 `expensiveCall()` 自身不接受 Context，取消仍无法中止它。外部库的取消能力是选型条件。

## 4. Channel 所有权

经验规则：

- 创建并发送数据的一方关闭 Channel。
- 接收方不关闭别人的 Channel。
- 不关闭仍可能有发送者的 Channel。
- 关闭表示“不会再有新值”，不是发送一个业务状态。
- 从已关闭 Channel 读取会立即返回零值，需要检查 `ok`。

```go
item, ok := <-jobs
if !ok {
    return
}
```

只有一个生产者时：

```go
func produce(ctx context.Context, inputs []Input) <-chan Input {
    out := make(chan Input)
    go func() {
        defer close(out)
        for _, input := range inputs {
            select {
            case out <- input:
            case <-ctx.Done():
                return
            }
        }
    }()
    return out
}
```

## 5. 有界 Worker Pool

错误方式：

```go
for _, target := range targets {
    go collect(target)
}
```

1 万个 Target 会同时创建 Goroutine、连接和响应缓存。

有界实现：

```go
package collector

import (
    "context"
    "errors"
    "sync"
)

type Target struct {
    UID  string
    Name string
}

type Result struct {
    Target Target
    Data   any
    Err    error
}

type Collector interface {
    Collect(context.Context, Target) (any, error)
}

func RunPool(
    ctx context.Context,
    workers int,
    targets []Target,
    collector Collector,
) ([]Result, error) {
    if workers < 1 {
        return nil, errors.New("workers must be >= 1")
    }

    jobs := make(chan Target)
    results := make(chan Result)
    var wg sync.WaitGroup

    worker := func() {
        defer wg.Done()
        for {
            select {
            case <-ctx.Done():
                return
            case target, ok := <-jobs:
                if !ok {
                    return
                }
                data, err := collector.Collect(ctx, target)
                select {
                case results <- Result{Target: target, Data: data, Err: err}:
                case <-ctx.Done():
                    return
                }
            }
        }
    }

    wg.Add(workers)
    for i := 0; i < workers; i++ {
        go worker()
    }

    go func() {
        defer close(jobs)
        for _, target := range targets {
            select {
            case jobs <- target:
            case <-ctx.Done():
                return
            }
        }
    }()

    go func() {
        wg.Wait()
        close(results)
    }()

    collected := make([]Result, 0, len(targets))
    for result := range results {
        collected = append(collected, result)
    }

    if err := ctx.Err(); err != nil {
        return collected, err
    }
    return collected, nil
}
```

这里同时限制：

- 活跃任务数。
- 等待队列大小（无缓冲 Channel）。
- 返回结果何时关闭。
- 取消传播。

生产还应限制输入总数和单结果大小。

## 6. Fail Fast 还是收集部分结果

两种语义不同：

```text
Fail Fast：一个关键任务失败，取消同组任务
Best Effort：继续采集，最终返回 partial report
```

例如：

| 场景 | 策略 |
| --- | --- |
| 生成诊断证据包 | Best Effort |
| 发布门禁的必需质量评测 | Fail Fast/Fail Closed |
| 同一事务的多个步骤 | Fail Fast |
| 多个独立集群巡检 | Best Effort |

不要让底层函数自行决定全局策略。底层返回分类错误，由编排层决定。

## 7. 错误包装与分类

```go
var (
    ErrPermission = errors.New("permission denied")
    ErrThrottled  = errors.New("throttled")
)

func query(ctx context.Context) error {
    if err := call(ctx); err != nil {
        return fmt.Errorf("query prometheus: %w", err)
    }
    return nil
}
```

上层：

```go
switch {
case errors.Is(err, context.DeadlineExceeded):
    // 超时
case errors.Is(err, ErrPermission):
    // 不重试，报告权限
case errors.Is(err, ErrThrottled):
    // 有界退避
default:
    // 未知错误
}
```

不要通过字符串包含关系判断错误类型。

## 8. HTTP 超时不是一个参数

HTTP 请求可能停在：

```text
DNS
→ TCP Connect
→ TLS Handshake
→ 等连接池
→ 写 Request
→ 等 Response Header
→ 读 Body
```

一个合理的客户端骨架：

```go
func NewHTTPClient() *http.Client {
    transport := &http.Transport{
        Proxy: http.ProxyFromEnvironment,
        DialContext: (&net.Dialer{
            Timeout:   3 * time.Second,
            KeepAlive: 30 * time.Second,
        }).DialContext,
        ForceAttemptHTTP2:     true,
        MaxIdleConns:          100,
        MaxIdleConnsPerHost:   20,
        MaxConnsPerHost:       50,
        IdleConnTimeout:       90 * time.Second,
        TLSHandshakeTimeout:   5 * time.Second,
        ResponseHeaderTimeout: 8 * time.Second,
        ExpectContinueTimeout: 1 * time.Second,
    }

    return &http.Client{
        Transport: transport,
        Timeout:   15 * time.Second,
    }
}
```

同时在请求上携带 Context：

```go
req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
```

`Client.Timeout` 是整个请求上限；请求 Context 可表达上游更短 deadline。两者取较早者。

## 9. 响应体处理

```go
resp, err := client.Do(req)
if err != nil {
    return err
}
defer resp.Body.Close()

limited := io.LimitReader(resp.Body, 8<<20) // 最多 8 MiB
body, err := io.ReadAll(limited)
```

注意：

- 必须关闭 Body。
- 不信任远端响应大小。
- 为流式接口使用不同策略，不可直接 `ReadAll`。
- 连接复用要求正确消费/处理 Body；具体行为以当前 Go 文档为准。
- JSON Decoder 需要处理未知字段策略和尾随数据。
- 状态码非 2xx 时也限制错误体大小。

## 10. 重试必须受幂等性约束

可重试判断：

```go
func retryable(method string, status int, err error) bool {
    if method != http.MethodGet && method != http.MethodHead {
        return false
    }
    if err != nil {
        return !errors.Is(err, context.Canceled)
    }
    return status == 429 || status == 502 ||
        status == 503 || status == 504
}
```

退避要响应取消：

```go
func sleepContext(ctx context.Context, delay time.Duration) error {
    timer := time.NewTimer(delay)
    defer timer.Stop()

    select {
    case <-timer.C:
        return nil
    case <-ctx.Done():
        return ctx.Err()
    }
}
```

生产规则：

- 总次数上限。
- 总 deadline。
- 指数退避 + 随机抖动。
- 429 尊重 `Retry-After`。
- 每次失败记录原因但避免日志风暴。
- 写请求只有在协议提供幂等键或确定未执行时才重试。

## 11. 限速与背压

并发上限与速率上限不同：

```text
Concurrency：同时在途多少请求
Rate：单位时间发起多少请求
Burst：短时间允许多少突发
Queue：等待工作最多多少
```

当下游慢：

- 队列不能无限增长。
- 调用方要收到过载/部分失败。
- 过期任务应在入队前或出队后丢弃。
- 优先级要显式，不能靠 Goroutine 调度偶然决定。

## 12. 优雅退出

```go
func main() {
    ctx, stop := signal.NotifyContext(
        context.Background(),
        os.Interrupt,
        syscall.SIGTERM,
    )
    defer stop()

    server := &http.Server{
        Addr:              ":8080",
        Handler:           handler(),
        ReadHeaderTimeout: 5 * time.Second,
        IdleTimeout:       60 * time.Second,
    }

    errCh := make(chan error, 1)
    go func() {
        errCh <- server.ListenAndServe()
    }()

    select {
    case <-ctx.Done():
    case err := <-errCh:
        if !errors.Is(err, http.ErrServerClosed) {
            log.Printf("server failed: %v", err)
        }
    }

    shutdownCtx, cancel := context.WithTimeout(
        context.Background(),
        20*time.Second,
    )
    defer cancel()

    if err := server.Shutdown(shutdownCtx); err != nil {
        log.Printf("graceful shutdown failed: %v", err)
    }
}
```

Kubernetes 中：

```text
SIGTERM
→ readiness 变为失败/摘流
→ 停止接受新工作
→ 等待在途工作
→ flush 指标/日志
→ deadline 到达后退出
```

`terminationGracePeriodSeconds` 必须大于应用的 Shutdown Deadline，并为代理/Sidecar 留出时间。

## 13. 观测并发系统

至少暴露：

```text
requests_in_flight
queue_depth
queue_wait_seconds
request_duration_seconds
request_errors_total{reason}
request_retries_total{reason}
worker_busy
goroutines
http_connections
shutdown_duration_seconds
```

Profiling：

- `go test -race ./...` 检查数据竞争。
- 使用 `runtime/pprof`/`net/http/pprof` 观察 Goroutine、Heap、CPU、Mutex、Block。
- 生产暴露 pprof 时必须鉴权和限制网络访问。
- 对比稳定负载下 Goroutine 数是否随时间持续增长。

## 14. 测试取消和泄漏

```go
func TestPoolStopsOnCancellation(t *testing.T) {
    ctx, cancel := context.WithCancel(context.Background())
    collector := &BlockingCollector{Started: make(chan struct{})}

    done := make(chan struct{})
    go func() {
        defer close(done)
        _, _ = RunPool(ctx, 2, testTargets(), collector)
    }()

    <-collector.Started
    cancel()

    select {
    case <-done:
    case <-time.After(time.Second):
        t.Fatal("pool did not stop after cancellation")
    }
}
```

还要测试：

- Response Header 不返回。
- Body 读到一半断开。
- 429 + `Retry-After`。
- 父 Context 在重试等待时取消。
- 结果消费者提前退出。
- SIGTERM 时有在途请求。

## 15. 常见错误

| 错误 | 后果 | 修复 |
| --- | --- | --- |
| 每个对象一个 Goroutine | 连接/内存风暴 | 有界 Worker Pool |
| 内部使用 `context.Background()` | 上游取消失效 | 传入并派生 Context |
| `time.Sleep` 做退避 | 取消不及时 | Timer + `select` |
| 默认 `http.Client{}` | 超时与连接行为不可控 | 配置 Client/Transport |
| 忘记关闭 Body | 资源和连接泄漏 | 成功获得 Response 后立即 defer |
| 无界 `io.ReadAll` | 远端可放大内存 | LimitReader/流式 Decoder |
| 重试所有错误 | 放大故障和副作用 | 分类 + 幂等 + 上限 |
| 发送者退出但不关结果 Channel | 消费者永久等待 | 明确所有权与 WaitGroup |
| 用 Context 传配置 | 接口隐式且难测试 | 显式参数/Struct |

## 16. 实验任务

1. 实现 4 Worker 的证据采集池。
2. 为整个任务设置 10 秒 deadline，为单请求设置 2 秒 deadline。
3. 模拟一个永不返回 Header 的 HTTP Server。
4. 在第 2 次重试等待期间取消 Context，验证立即结束。
5. 将 Target 数从 100 增加到 10000，确认 Goroutine 与内存有界。
6. 执行 `go test -race ./...`。
7. 发送 SIGTERM，验证停止接收新任务并等待已有任务。
8. 采集 Goroutine Profile，检查是否有遗留发送者。

## 17. 验收清单

- [ ] Context 是第一参数并传递到所有 I/O。
- [ ] 所有派生 Context 都调用 Cancel。
- [ ] 每个 Goroutine 有所有者、等待者和退出路径。
- [ ] Channel 关闭权清晰。
- [ ] 并发、队列、速率和响应大小有上限。
- [ ] HTTP Client 与 Transport 都有明确超时。
- [ ] 响应 Body 正确关闭。
- [ ] 重试遵守幂等、次数、deadline 和 Retry-After。
- [ ] 优雅退出与 Kubernetes Grace Period 对齐。
- [ ] 指标覆盖队列、在途、延迟、错误、重试和 Goroutine。
- [ ] 通过 Race Test，并对取消和泄漏有自动化测试。

## 18. 参考资料

- [Go Concurrency Patterns: Context](https://go.dev/blog/context)
- [Go Concurrency Patterns: Pipelines and cancellation](https://go.dev/blog/pipelines)
- [Canceling in-progress operations](https://go.dev/doc/database/cancel-operations)
- [Package context](https://pkg.go.dev/context)
- [Package net/http](https://pkg.go.dev/net/http)
- [Package runtime/pprof](https://pkg.go.dev/runtime/pprof)
