---
title: "Gin 定位与第一个 HTTP 服务：先分清标准库和框架"
sidebar_label: "01. Gin 定位与第一个 HTTP 服务：先分清标准库和框架"
sidebar_position: 1
description: "Gin 提供路由、中间件、绑定和响应辅助，net/http 负责底层 HTTP 服务。先建立这个边界，后续源码、超时与性能分析才不会把所有行为都归给框架。"
tags: [Go, Gin, 技术原理, 实验]
---

# Gin 定位与第一个 HTTP 服务：先分清标准库和框架

Gin 提供路由、中间件、绑定和响应辅助，net/http 负责底层 HTTP 服务。先建立这个边界，后续源码、超时与性能分析才不会把所有行为都归给框架。

## 1. 框架在请求链中的位置

客户端经过 TCP/TLS 与 net/http.Server，进入实现 http.Handler 的 Gin Engine；Engine 按方法与路径找到 Handler 链，业务再访问数据库或其他服务。Gin 不替代数据库驱动，也不自带持久任务调度器。

## 2. 最小应用与版本

```go
package main

import (
    "github.com/gin-gonic/gin"
    "net/http"
)

func main() {
    router := gin.New()
    router.SetTrustedProxies(nil)
    router.Use(gin.Recovery())
    router.GET("/ping", func(c *gin.Context) { c.JSON(200, gin.H{"message":"pong"}) })
    server := &http.Server{Addr:"127.0.0.1:8080", Handler:router}
    if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed { panic(err) }
}
```

这是讲解 Handler 关系的最小程序，不是完整生产配置；后续工程明确设置超时、信号与关闭。使用固定 Gin 1.12.0，完整依赖由 service-lab/go.mod 与 go.sum 管理。

## 3. New 与 Default

gin.New 创建没有默认 Logger/Recovery 的 Engine；gin.Default 附加常用默认中间件。自行配置时不要重复安装两套日志与 Recovery。

ReleaseMode 会改变部分调试行为，不会自动开启认证、设置安全超时、限制正文或保护管理接口。可信代理也必须按实际部署配置。

## 4. 先验证请求而非追求框架跑分

```bash
cd examples/gin/service-lab
go run ./cmd/webdemo -case routing
```

```text
status=200
id=t1
```

完整代码与断言见 [service-lab](https://github.com/newswitch/newswitch.github.io/tree/main/examples/gin/service-lab)。

这个演示直接调用 Engine.ServeHTTP 验证路由，不启动永久服务器。实际监听、跨进程 Worker 和重启恢复在综合工程中完成；路由微基准无法代表数据库写接口的吞吐。

## 5. 练习与答案

### 5.1 Gin 自己实现了完整 TCP 协议栈吗

不是，它建立在 Go HTTP 等基础能力之上。

### 5.2 ReleaseMode 会自动保护接口吗

不会，认证、授权和资源限制仍需实现。

### 5.3 Default 是否等于带完整生产配置

不是，只提供部分默认中间件。

## 6. 参考资料

- [Gin 官方文档](https://gin-gonic.com/en/docs/)
- [Gin 1.12.0 源码](https://github.com/gin-gonic/gin/tree/v1.12.0)
