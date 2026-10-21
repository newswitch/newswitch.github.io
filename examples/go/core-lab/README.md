# Go core-lab

配套 [Go 学习路线](https://newswitch.github.io/docs/development/go/Go学习路线/)。固定基线 Go 1.27.3，errgroup 使用 x/sync v0.23.0；不替换系统工具链，不依赖外部中间件。

## 运行

```bash
go version
go run ./cmd/lab
go run ./cmd/lab -case slice
go run ./cmd/lab -case interfaces
go run ./cmd/lab -case context
go test ./... -count=1 -timeout=30s
go vet ./...
```

无 `-case` 时列出全部有限实验。TCP/HTTP 案例只监听随机回环端口，用完关闭。测试逐条断言输出，而不是只检查退出码。

`pipeline.go` 的 SquareAll 提供可取消、有界输入队列的版本，调用方在函数返回前不得并发修改输入。其测试使用 1000 个任务，避免基础示例的三条结果缓冲掩盖错误关闭顺序。

## 性能与属性实验

```bash
go test ./internal/demos -run '^$' -bench BenchmarkSum -benchmem -count=5
go test ./internal/demos -run '^$' -fuzz FuzzSum -fuzztime=5s -parallel=2
go run ./cmd/profile -mode cpu -dir out -duration 1s
go run ./cmd/profile -mode heap -dir out -duration 100ms
go run ./cmd/profile -mode mutex -dir out -duration 100ms
go run ./cmd/profile -mode block -dir out -duration 100ms
go run ./cmd/profile -mode goroutine -dir out -duration 100ms
go run ./cmd/profile -mode trace -dir out -duration 100ms
go tool pprof -top out/cpu.pprof
go tool pprof -top -sample_index=inuse_space out/heap.pprof
```

profile 命令始终退出，不默认启动浏览器或永久管理服务。heap 仅保留 8 MiB 演示数据；mutex/block 争用量固定。数字受机器与采样影响，不作为跨环境性能承诺。`-duration` 对 CPU 控制运行窗口，对其他固定工作量案例只是参数合法性约束。

## 运行时与因果实验

```bash
go run ./cmd/runtime-lab -mode scheduler -dir out/scheduler
go run ./cmd/runtime-lab -mode gc -gogc 20 -total-mib 32
go run ./cmd/runtime-lab -mode gc -gogc 100 -total-mib 32
go run ./cmd/runtime-lab -mode view -dir out/view
go run ./cmd/runtime-lab -mode clone -dir out/clone
go tool pprof -top -sample_index=inuse_space out/view/retained.pprof
go test ./internal/runtimeprobe -count=1 -timeout=30s
```

scheduler 仅设置一个 P，运行两个有限计算、Channel、回环 TCP 和 Timer，全部 Join 后写出 trace。Timer 实测延迟不是固定时间片；用 trace 观察具体状态。

gc 累计分配 8..128 MiB，只保留一个 512 KiB 缓冲，周期数包含最后一次显式 GC。不要把周期数差直接当作服务吞吐收益。view/clone 输入均为 8 MiB、可见结果均为 64 字节，验证底层数组引用与复制的保留差异，不制造 OOM。

编码优化先保证输出相同，再比较每操作成本：

```bash
go test ./internal/demos -run TestEncoding -count=1
go test ./internal/demos -run '^$' -bench BenchmarkEncode -benchmem -count=3
go run ./cmd/profile -mode cpu -encoder dynamic -dir out/dynamic -duration 500ms
go run ./cmd/profile -mode cpu -encoder typed -dir out/typed -duration 500ms
```

两者都保留 []byte 的 Base64 协议；固定时长 profile 的完成次数不同，不能仅比较热点百分比。runtimeprobe 通过进程级全局参数和引用简化观察，应作为独立命令串行使用，不直接当作并发 Web Handler 库。

## 并发、HTTP 与编译对照

```bash
go run ./cmd/mechanism-lab -mode channel
go run ./cmd/mechanism-lab -mode locks
go run ./cmd/mechanism-lab -mode http-client
go run ./cmd/mechanism-lab -mode http-server
go test ./internal/mechanism -v -count=1 -timeout=30s
go test ./internal/mechanism -run '^$' -bench 'Benchmark(Inline|Opaque|Published|Borrowed)' -benchmem -count=3
go test ./internal/mechanism -run '^$' -gcflags='newswitch.dev/go-core-lab/internal/mechanism=-m=2 -d=ssa/check_bce/debug=1'
```

Channel 对照关闭排空、Slice 别名与复制、nil 分支和取消 Join；locks 固定两次 atomic 更新之间的读取，说明无 Race 也可能观察到不一致总额，同时验证 Mutex 不变量和不可变配置快照。实验不用 Sleep 猜测同步。

HTTP 客户端固定为回环 HTTP/1.1、512 KiB 正文、单连接，结合 GotConn 与服务端计数定位池等待。Go 1.27.3 对较小的提前关闭正文有有限排空优化，不能把“不读完必然不复用”当通用结论。服务端实验分别验证正常排空、Shutdown 超时不自动取消 Handler，以及 Close 之后的连接取消；所有自建监听和后台任务都在返回前回收，不处理系统信号。

分配实验使用 64 字节 Record，对照内联立即读取、非内联返回、全局保留和只读借用。0/1 allocs/op 是固定工具链回归基线，不是所有 Go 版本的语言承诺。Prefix 函数只在合法输入范围内比较结果，配合 BCE 报告和反汇编观察循环内检查，不关闭安全检查。

## 生命周期与流式背压

```bash
go run ./cmd/lifecycle-lab -mode context
go run ./cmd/lifecycle-lab -mode group
go run ./cmd/lifecycle-lab -mode pipeline
go run ./cmd/lifecycle-lab -mode leak -dir out/lifecycle
go test ./internal/lifecycle -v -count=1 -timeout=30s
```

固定 x/sync v0.23.0，实际验证 errgroup：首个错误关联取消、Wait 统一 Join、成功 Wait 后组 Context 也取消、SetLimit 的许可等待不会被 Context 自动打断。AfterFunc 的 stop 也不代表回调已经结束。

Run 生成有限整数并逐条消费，jobs/results 容量均受控，返回前 Join 全部生产者、Worker 和关闭协调者。它与仍保留全部输入输出的 SquareAll 不同。默认 1000 项、2 个 Worker、队列容量 2，消费者只保存平方累加值；回调自己的缓存和外部资源不在通道内存边界内。测试覆盖处理与消费失败、中途取消、零缓冲和重复 20 次取消。

leak 模式暂时保留 8 个无取消分支的阻塞发送者，采集文本堆栈后全部接收并 Join，再验证可取消版本。包括 profile 写失败的路径，所有发送者也会在返回前释放；不会留下永久演示进程。profile 归类只统计本实验函数，不要求全进程 Goroutine 数绝对不变。

## Race 验证

```bash
go test -race ./... -count=1 -timeout=60s
```

需要支持的平台和相应 C 工具链。没有执行时不能把普通测试视为 Race 通过。

仓库根目录的 `scripts/verify-go-gin-labs.mjs --go <实际可执行文件路径>` 联合验证 Go/Gin，生成结果在忽略目录 `.go-article-checks/`。该参数是说明形式，运行时换成真实路径。
