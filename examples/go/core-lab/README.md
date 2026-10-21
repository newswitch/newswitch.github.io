# Go core-lab

配套 [Go 学习路线](https://newswitch.github.io/docs/development/go/Go学习路线/)。固定基线 Go 1.27.3；不替换系统工具链，不依赖外部中间件。

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

Race 另行运行：

```bash
go test -race ./... -count=1 -timeout=60s
```

需要支持的平台和相应 C 工具链。没有执行时不能把普通测试视为 Race 通过。

仓库根目录的 `scripts/verify-go-gin-labs.mjs --go <实际可执行文件路径>` 联合验证 Go/Gin，生成结果在忽略目录 `.go-article-checks/`。该参数是说明形式，运行时换成真实路径。
