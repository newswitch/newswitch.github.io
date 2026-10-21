---
title: "Go Module、MVS、Workspace 与 Vendor：依赖如何被选中"
sidebar_label: "01. Go Module、MVS、Workspace 与 Vendor：依赖如何被选中"
sidebar_position: 1
description: "go.mod 不只是依赖列表，它还影响语言版本与工具链选择。理解 MVS、替换和校验，才能解释本机成功、CI 失败及版本为何没有按想象升级。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go Module、MVS、Workspace 与 Vendor：依赖如何被选中

go.mod 不只是依赖列表，它还影响语言版本与工具链选择。理解 MVS、替换和校验，才能解释本机成功、CI 失败及版本为何没有按想象升级。

## 1. 模块图与 MVS

Module 由模块路径和版本标识，包是目录级编译单位。require 声明依赖版本，构建会根据模块图选取同一模块所需版本中的较高者；MVS 不是每次自动拉取所有依赖的最新发布版。

语义导入版本要求主版本 v2 及以上通常体现在模块路径中。go.mod 的 go 指令表达最低 Go 与语言语义要求，toolchain 是工具链选择建议，不能当作第三方依赖版本。

## 2. 可检查的依赖证据

```bash
cd examples/gin/service-lab
go env GOVERSION GOTOOLCHAIN GOPROXY GOSUMDB
go list -m all
go mod graph
go mod why -m github.com/gin-gonic/gin
go mod verify
```

go.sum 保存下载内容的校验信息，不是另一种 package-lock：最终选版仍由模块图决定。不要为解决网络问题关闭 GOSUMDB 或随意删除 go.sum；先确认代理、TLS 和访问策略。

## 3. Workspace 与 replace

go.work 可在本机同时开发多个模块，但 CI 未必自动使用同一个工作区。模块发布前应在 GOWORK=off 的隔离环境验证，避免依赖本地 replace 才能成功。

replace 可指向固定 fork 或本地目录，必须记录原因与退出条件；本地绝对路径不应混入可共享发布配置。exclude 也不是安全升级的自动替代方案。

## 4. Vendor 与升级

go mod vendor 固化被选中的依赖源码，构建时需明确 vendor 模式。它不豁免漏洞扫描、许可证和来源审查；生成目录应可从版本化 go.mod/go.sum 重建。

升级先看最低 Go 与行为变更，运行单元、契约、Race、外部联调和性能回归。本系列用 Go 1.27.3 与 Gin 1.12.0；仅 Gin 的最低版本要求并不能代表所有 SQLite、Kafka、OTel 依赖的要求。

## 5. 练习与答案

### 5.1 go.sum 是精确选版锁文件吗

不是，校验内容与版本选择是不同职责。

### 5.2 go.work 让本地测试通过就够了吗

不够，要验证脱离工作区和本地替换后仍可构建。

### 5.3 关闭校验能作为常规网络修复吗

不能，应修复网络或代理而非取消完整性保护。

## 6. 参考资料

- [Module reference](https://go.dev/ref/mod)
- [Workspaces](https://go.dev/doc/tutorial/workspaces)
