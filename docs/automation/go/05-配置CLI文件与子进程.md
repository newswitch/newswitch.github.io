---
title: "Go 配置、CLI、文件与子进程"
sidebar_label: "05. 配置、CLI、文件与子进程"
sidebar_position: 5
description: "设计 Flag 和配置优先级、安全文件写入、结构化输出以及带 Context 的子进程执行。"
tags: [Go, CLI, Config, File, os-exec]
---

# Go 配置、CLI、文件与子进程

## 1. CLI 契约

入口负责参数、配置、日志初始化、信号和退出码。`flag` 适合简单 CLI；复杂子命令可选择成熟库，但公共接口仍需版本管理。

```go
func main() {
	os.Exit(run())
}

func run() int {
	// parse → validate → assemble → execute → render
	return 0
}
```

业务包不调用 `os.Exit`，否则 Defer 和测试边界被破坏。

## 2. 配置优先级

```text
安全默认值 < 配置文件 < 环境变量 < CLI
```

合并后一次校验，输出非敏感来源摘要。不要直接执行配置内容或把 Secret 打印为 `%+v`。

## 3. 文件安全

使用 `filepath.Clean/Abs/EvalSymlinks` 辅助检查，但仍要验证允许根、Owner、Mode 和竞争窗口。原子写入采用目标目录临时文件、Flush/Sync、权限校验和 Rename；多文件更新不是单次 Rename 的事务。

## 4. JSON

```go
encoder := json.NewEncoder(stdout)
encoder.SetEscapeHTML(false)
if err := encoder.Encode(result); err != nil {
	return fmt.Errorf("encode result: %w", err)
}
```

外部 JSON 使用 `DisallowUnknownFields` 是否合适取决于兼容策略；读取后仍需业务校验和大小上限。

## 5. 子进程

```go
cmd := exec.CommandContext(ctx, "systemctl", "is-active", "--quiet", service)
var stderr bytes.Buffer
cmd.Stderr = &stderr
err := cmd.Run()
```

参数数组不经过 Shell。需要管道时用 Go I/O 连接或固定脚本，不拼接不可信字符串。Context 取消后的进程组和派生子进程行为要在目标 OS 验证。

## 6. 输出与退出码

- stdout：正式结果。
- stderr：日志和诊断。
- JSON Schema：带版本。
- 退出码：参数、认证、依赖、部分失败、取消等稳定分类。

## 7. 信号

使用 `signal.NotifyContext` 在顶层创建取消 Context，停止接收新任务、等待有限宽限期并输出最终状态。不要让每个包各自监听信号。
