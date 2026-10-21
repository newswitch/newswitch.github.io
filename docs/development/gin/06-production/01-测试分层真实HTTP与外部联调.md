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

## 5. 为每一类结论选择足够的测试边界

路由与字段验证适合 Recorder，提交、Flush、取消和断连适合真实 HTTP，配置与文件持久性适合独立进程，数据库锁与 Broker 交接需要真实服务。层次更高不代表总能替代更低层的确定故障测试。

protocol 模块实际发现：JSON 编码失败无错误策略可能返回空 201，真实 HTTP 才能同时核对客户端收到的结果；requestflow 模块又用 Recorder 精确固定注册与链顺序。两者不应合并成一句“接口测试通过”。

容器网络、TLS 终止与 Service 摘流还在更外层，需要目标环境证据。测试报告应按这些层次记录，而不是用一个总 PASS 隐去未执行项。

## 6. 先控制前置状态，再验证资源回收

连接池测试先借走唯一连接，SSE 测试等待真实流事件后关闭客户端，租约测试注入明确 now。这样失败条件可解释，不靠随意 Sleep 猜测某个阶段已经发生。

对返回 504 的请求，还需看后台 active、许可、连接与任务是否归零；对事务错误，还需看业务与事件行是否一致；对重复投递，还需看 Inbox 和通知数量。只检查状态码无法确认这些事实。

临时端口、目录与自建子进程都由测试拥有者清理，异常路径也要 Join。不能让每次验证都在电脑上留下永久服务，或要求人工找进程收尾。

## 7. 扩大回归范围而不混淆证据等级

本系列验证脚本串联两个模块的普通测试、vet、模块校验、有限 CLI 实验、profile、Fuzz、编译证据与真实 API/Worker。新增 foundation 与 routing 测试覆盖语言与请求链的剩余边界。

显式 integration 集合要求隔离地址，编译检查只证明代码可构建；只有真实连接并通过断言才算数据库、缓存或 Broker 验证。Race、Linux 信号排空与 Kubernetes 发布也分别记录。

回归失败时保留原始失败信息和执行命令，先修复原因，再复跑受影响层；不要过滤出成功行或把未配置环境改成自动跳过来制造全绿。

## 8. 练习与答案

### 8.1 外部测试编译成功等于联调通过吗

不等于。编译只确认测试代码与依赖可构建；真实数据库、Redis 或 Kafka 已连接且通过状态断言，才算完成对应联调。

### 8.2 本地 HTTP 测试与 Recorder 完全等价吗

不等价，后者不经过真实连接。

### 8.3 缺中间件时自动 Skip 可以计为通过吗

不能，应明确未验证。

## 9. 参考资料

- [httptest](https://pkg.go.dev/net/http/httptest)
- [本系列验证脚本](https://github.com/newswitch/newswitch.github.io/blob/main/scripts/verify-go-gin-labs.mjs)
- [完整服务实验源码](https://github.com/newswitch/newswitch.github.io/tree/main/examples/gin/service-lab)
