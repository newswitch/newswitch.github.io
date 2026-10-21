---
title: "Gin 测试体系：Recorder、真实 HTTP、故障注入与外部联调"
sidebar_label: "01. Gin 测试体系：Recorder、真实 HTTP、故障注入与外部联调"
sidebar_position: 1
description: "不同层次的测试回答不同问题。把 Handler、真实连接、持久状态和外部服务分开验证，才能清楚知道“通过”究竟证明了什么。"
tags: [Go, Gin, 技术原理, 实验]
---

# Gin 测试体系：Recorder、真实 HTTP、故障注入与外部联调

不同层次的测试回答不同问题。把 Handler、真实连接、持久状态和外部服务分开验证，才能清楚知道“通过”究竟证明了什么。

## 1. 四层证据

Recorder 直接调用 Handler，用于状态、绑定、权限和路由；httptest.Server 经真实本机 TCP，用于请求生命周期与 SSE 断开；独立二进制验证配置、文件数据库和跨进程 Worker；真实 PostgreSQL、Redis、Kafka 验证各协议和部署兼容。

缺少某层就明确标注，不用内存替身代替 Broker 结论。测试是否执行与测试是否编译也要分开。

## 2. 本机可执行集合

```bash
cd examples/gin/service-lab
go test ./... -count=1 -timeout=60s
go vet ./...
# 回到仓库根目录
node scripts/verify-go-gin-labs.mjs --go /path/to/go
```

Windows 的 --go 可传 go.exe 完整路径。验证脚本会运行两个模块测试、独立实验、有限 profile/Fuzz/Benchmark，再启动自己拥有的 API 进程，创建任务、用另一个 Worker 进程处理，重启 API 后检查状态仍存在。

## 3. 重点故障断言

重复键同内容保持 ID，异内容冲突；跨租户有效 JWT 看不到对象；事务事件写失败时业务回滚；旧租约 token 和过期 token 都不能提交；第三次租约耗尽后最终进入 FAILED。

消息测试模拟“Broker 已接受但确认丢失”，验证重复 event ID 不产生重复通知。真实 OTel 测试通过本地 HTTP 收到 Protobuf，核对父子 Span；不是只检查 tracer 对象非空。

## 4. 外部测试必须显式开启

```bash
go test -tags=integration ./integration -count=1 -timeout=90s
```

按 README 设置 GO_LAB_PG_DSN、GO_LAB_REDIS_ADDR、GO_LAB_KAFKA_ADDR 与新空 Topic。测试要求回环隔离环境，不操作生产库；缺参数会失败而非 Skip。

本机 Docker 引擎未运行，外部测试只完成编译，不列为通过。Race 也需支持平台和 C 工具链，未完成时单独列出；Windows 的进程终止不证明 Linux SIGTERM 排空正确。

## 5. 练习与答案

### 5.1 外部测试编译成功等于联调通过吗

不等于。

### 5.2 本地 HTTP 测试与 Recorder 完全等价吗

不等价，后者不经过真实连接。

### 5.3 缺中间件时自动 Skip 可以计为通过吗

不能，应明确未验证。

## 6. 参考资料

- [httptest](https://pkg.go.dev/net/http/httptest)
- [本系列验证脚本](https://github.com/newswitch/newswitch.github.io/blob/main/scripts/verify-go-gin-labs.mjs)
