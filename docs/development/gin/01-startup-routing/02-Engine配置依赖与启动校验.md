---
title: "Gin Engine 配置、依赖装配与启动校验"
sidebar_label: "02. Gin Engine 配置、依赖装配与启动校验"
sidebar_position: 2
description: "启动成功不只是端口监听成功。配置错误、数据库不可用、弱密钥和重复路由，应在可控边界暴露，而不是等请求进来才发现。"
tags: [Go, Gin, 技术原理, 实验]
---

# Gin Engine 配置、依赖装配与启动校验

启动成功不只是端口监听成功。配置错误、数据库不可用、弱密钥和重复路由，应在可控边界暴露，而不是等请求进来才发现。

## 1. 构造函数装配

service-lab 的 app.New 接收 Store、Telemetry、JWT key、并发上限和可选 Cache，再返回 http.Handler。业务不从全局变量随时读取一份新配置，也不在每次请求创建连接池。

必须依赖在启动时检查，可选依赖明确降级。不要让 handler 隐式连接 Redis 后才知道地址错误，也不要用所有依赖都强制在线的 liveness 造成级联重启。

## 2. 配置来源与密钥

命令行适合非敏感开关，环境变量或受控密钥挂载适合实验凭证。本工程用 LAB_JWT_KEY、LAB_DB_DRIVER、LAB_DB_DSN，避免把生产密码写进文章或启动日志。

环境变量也不是绝对安全存储，进程、容器与调试权限需限制。动态更新配置必须定义原子替换、校验与连接池重建策略，不能只修改一个共享 Map。

## 3. 明确启动顺序

```text
解析与验证配置
→ 打开 DB 并在有限预算内 Ping
→ 创建观测与可选客户端
→ 构造路由
→ 成功绑定 API 与管理 Listener
→ Serve 并等待退出信号
```

如果第二个 Listener 绑定失败，要关闭第一个及已创建依赖。service-lab 所有创建者均有 defer/Shutdown 路径；错误消息不应直接回显带密码的原始 DSN。

## 4. 测试非法配置

```bash
cd examples/gin/service-lab
go test ./internal/app ./internal/observe -count=1 -timeout=30s
```

测试覆盖认证、容量拒绝、OTLP 导出与请求行为；启动地址、缺失密钥和命令行分支还需通过实际二进制启动检查。仅构造 app.New 不会验证操作系统端口或信号。

## 5. 练习与答案

### 5.1 为什么不在每个 Handler 创建 DB

会重复建立池与连接，难以控制全局资源和关闭。

### 5.2 依赖不可用就一定要 liveness 失败吗

不应，需区分进程存活与接流量能力。

### 5.3 环境变量可以无条件写入日志吗

不能，可能包含凭证。

## 6. 参考资料

- [Gin 官方文档](https://gin-gonic.com/en/docs/)
- [Gin 1.12.0 源码](https://github.com/gin-gonic/gin/tree/v1.12.0)
