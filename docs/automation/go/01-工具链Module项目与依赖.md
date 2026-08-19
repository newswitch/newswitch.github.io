---
title: "Go 工具链、Module、项目与依赖"
sidebar_label: "01. 工具链、Module、项目与依赖"
sidebar_position: 1
description: "定位 Go 工具链和环境，使用 Module、Workspace、内部包、依赖校验和可复现构建组织自动化项目。"
tags: [Go, Module, Workspace, Dependency, Build]
---

# Go 工具链、Module、项目与依赖

## 1. 确认环境

```bash
go version
go env GOROOT GOPATH GOMOD GOWORK GOPROXY GOSUMDB
go env -json
```

诊断输出可能包含私有代理和路径，进入工单前脱敏。生产构建固定 Go 版本和平台，不依赖开发机自动切换结果。

## 2. 创建 Module

```bash
mkdir ops-agent && cd ops-agent
go mod init example.invalid/automation/ops-agent
```

推荐布局：

```text
ops-agent/
├── cmd/ops-agent/main.go
├── internal/
│   ├── application/
│   ├── domain/
│   └── adapters/
├── api/
├── go.mod
└── go.sum
```

`internal` 限制仓库外导入；`cmd` 入口只组装依赖、处理信号和映射退出状态。

## 3. 依赖管理

```bash
go get example.invalid/module@v1.2.3
go mod tidy
go mod verify
go list -m all
go mod graph
```

`go.sum` 校验下载模块内容，不等于依赖安全审查。私有模块需要正确的 `GOPRIVATE`、代理和凭据边界，不能把 Token 写进模块路径或 Git URL。

## 4. Workspace

`go.work` 适合本地同时开发多个 Module：

```bash
go work init ./agent ./sdk
go work sync
```

发布构建应明确是否允许 Workspace 参与，避免本地 Replace 掩盖真实版本。CI 从干净环境验证最终 Module 依赖。

## 5. 可复现构建

```bash
go test ./...
go build -trimpath -o bin/ops-agent ./cmd/ops-agent
go version -m bin/ops-agent
```

记录 GOOS、GOARCH、CGO、Build Tags、源码 Commit 和依赖。涉及 CGO 时还要固定编译器和系统库；“静态单文件”不是所有 Go 程序的默认保证。

## 6. 版本注入

```go
package version

var (
	Version = "dev"
	Commit  = "unknown"
	BuiltAt = "unknown"
)
```

流水线用受控 `-ldflags -X` 注入，但真正的供应链证据还应保存外部 Manifest、Digest 和签名。

## 7. 依赖升级

```text
小批量更新
→ 查看 Release/Security 信息
→ 单测、Race、Fuzz、集成测试
→ 构建新制品
→ 金丝雀
→ 生产晋级
```
