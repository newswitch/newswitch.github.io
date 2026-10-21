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

## 值共享、I/O 与 JSON 协议

```bash
go run ./cmd/value-lab -mode slice
go run ./cmd/value-lab -mode map
go run ./cmd/value-lab -mode interface
go run ./cmd/value-lab -mode io
go run ./cmd/value-lab -mode json
go test ./internal/valueflow -v -count=1 -timeout=20s
```

Slice 对照容量限制、超容量追加、嵌套浅复制、Delete 清尾与重叠 copy；Map 对照值副本写回、Clone 的嵌套共享与显式键排序。接口验证方法集、typed nil、errors.As 匹配 nil 指针与方法值保存的接收者。

I/O 验证数据与 EOF 同时返回、短写、WriterTo/ReaderFrom 优先级、LimitReader 截断与 MaxBytesError。JSON 使用 encoding/json 兼容 API，验证三态 Optional、全新 DTO 与复用差异、未知字段、尾部、数字精度、重复键和大小写行为。DecodeOne 不是完整 HTTP 入口；上限、媒体类型、业务与授权仍由调用方负责。Optional 只演示入站，不是通用 PATCH 或输出序列化框架。

这些实验不访问外部服务，不依赖磁盘满或永久阻塞，不通过 unsafe 绑定运行时内存布局。

## 语言基础、类型与资源边界

```bash
go run ./cmd/foundation-lab -mode language
go run ./cmd/foundation-lab -mode types
go run ./cmd/foundation-lab -mode resources
go test ./internal/foundation -v -count=1 -timeout=20s
go test ./internal/foundation -run '^$' -fuzz FuzzPrefixRunes -fuzztime=2s -parallel=2
```

language 对照循环内声明与外部赋值变量、可变参数共享、指针重定向、Join 错误和 defer 求值顺序。types 实际编译 Go 1.27 方法自身的类型参数，验证命名切片保留、UTF-8 宽度、反射可设置性和排序次键。

resources 只在自己创建并核验的随机临时目录操作文件，检查 Write/Sync/Close/Rename 后读取，再清理该目录；目标起初不存在，不证明跨平台覆盖、目录同步或断电恢复。Timer 测试先接收第一次通知再 Reset，不把调度时间当精度保证；日志使用虚构凭证并检查脱敏；ReadFrame 先验证两字节长度，再读取最多 256 字节的正文。

PrefixRunes 明确按码点而非字素簇截断，限制最多 4096 字节；Fuzz 只检查有限合法文本的前缀、UTF-8 与长度性质，不操作外部资源。

根目录联合脚本另构建 Linux/amd64、Linux/arm64 的 hello 并检查构建信息；这是目标编译，不是目标系统运行验收。

## Race 验证

```bash
go test -race ./... -count=1 -timeout=60s
```

需要支持的平台和相应 C 工具链。没有执行时不能把普通测试视为 Race 通过。

仓库根目录的 `scripts/verify-go-gin-labs.mjs --go <实际可执行文件路径>` 联合验证 Go/Gin，生成结果在忽略目录 `.go-article-checks/`。该参数是说明形式，运行时换成真实路径。
