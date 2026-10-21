---
title: "Go Module 包 导入与依赖基础"
sidebar_label: "03. Go Module 包 导入与依赖基础"
sidebar_position: 3
description: "Module 是版本与依赖管理单元，包是源码组织和编译单元，目录是文件布局。把三者混为一谈，容易出现 import 路径正确却找不到代码、运行了错误的 main，或不小心把依赖声明改成另一套工程。"
tags: [Go, Golang, 技术原理, 实验]
---

# Go Module 包 导入与依赖基础

Module 是版本与依赖管理单元，包是源码组织和编译单元，目录是文件布局。把三者混为一谈，容易出现 import 路径正确却找不到代码、运行了错误的 main，或不小心把依赖声明改成另一套工程。

## 1. 三个边界怎样对应

go.mod 中的 module 路径构成导入路径前缀，子目录通常形成子包；同一个普通包的源文件声明相同 package。可执行入口使用 package main，普通库包不能直接作为 main 启动。

首字母大写决定标识符是否导出，不等于整个目录都公开。internal 目录限制特定导入范围，不是操作系统权限控制。包依赖必须无环；两个包相互 import 时，应重新检查职责和依赖方向，而不是用全局变量绕过去。

例如模块路径是 `newswitch.dev/go-core-lab`，目录 `internal/demos` 的导入路径就是 `newswitch.dev/go-core-lab/internal/demos`，该目录里的源文件声明 `package demos`。main 可以调用导出的 `demos.Run`，不能直接调用未导出的辅助函数。

```text
core-lab/
├── go.mod                 module newswitch.dev/go-core-lab
├── cmd/hello/main.go      package main
├── cmd/lab/main.go        package main，导入 demos
└── internal/demos/        package demos
```

新项目可在空目录执行 `go mod init example.com/hello` 建立边界，再编写 main.go；已有工程不要重复 init 或随意改 module 路径。go mod tidy 根据实际导入整理依赖，不是更新到所有最新版本。

## 2. 用现成工程观察

```bash
cd examples/go/core-lab
go list -m
go list ./...
go mod graph
go test ./...
```

主模块名应为 newswitch.dev/go-core-lab，列出的包包括 cmd/lab、cmd/profile 和 internal/demos。这个模块没有第三方依赖；Gin 的独立工程有自己的 go.mod 和 go.sum，不通过修改 Go 标准库共享依赖。

## 3. 初始化和可复现性

被依赖包先于依赖它的包初始化。包级变量与 init 适合少量确定性注册，不适合暗中连接数据库、启动永久 Goroutine 或读取不可控远端配置；这些资源应由 main 明确创建并负责关闭。

go.sum 保存依赖内容校验记录，不是 Python 式完整锁文件；版本选择还由 go.mod 和依赖图决定。不要用手工删除 go.sum 的方式修复校验不匹配。MVS、replace、go.work 和 vendor 的深入边界放在工程专题。

## 4. 练习与答案

### 4.1 目录名必须等于包名吗

不是完全相同的概念，但遵循一致命名通常更清楚。导入使用路径，代码中通常使用该包声明的名称。

### 4.2 为什么业务代码不应到处使用 init 建连

它隐藏资源所有者与失败时机，难以测试、替换和统一关闭；显式装配更容易控制生命周期。

### 4.3 把两个项目放在相邻目录就能直接 import 吗

不能。还需要正确模块路径和版本依赖，或显式工作区/本地替换关系。

## 5. 参考资料

- [Module 入门](https://go.dev/doc/tutorial/create-module)
- [模块参考](https://go.dev/ref/mod)
