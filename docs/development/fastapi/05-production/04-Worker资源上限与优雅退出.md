---
title: "Worker、资源上限与优雅退出"
sidebar_label: "04. Worker、资源上限与优雅退出"
sidebar_position: 4
description: "按每进程资源和全局预算选择 Worker，建立接流量、排空、关闭与强制终止边界。"
tags: [FastAPI, 测试, 部署, 可观测性]
---

# Worker、资源上限与优雅退出

Worker 是进程层面的并发单元，不是免费扩容按钮。每增加一个 Worker，通常会增加解释器、应用状态、连接池与模型/缓存等资源。

## 1. 进程资源账本

先估算每进程基础内存、峰值请求内存、线程、连接与文件描述符，再乘 Worker 和 Pod 数量。进程内字典与锁只在该进程有效，不能用于跨 Worker 的全局限流、幂等或任务所有权。

I/O 服务的 Worker 数量由阻塞风险、CPU 配额与依赖预算共同决定，不照搬“CPU 核乘二加一”。Kubernetes 中也可选择每容器一个进程，再通过副本扩缩，具体由运行与观测方式决定。

## 2. 显式设置服务参数

```bash
python -m uvicorn api_health:app --host 0.0.0.0 --port 8000 --workers 2 --limit-concurrency 100 --timeout-keep-alive 5 --timeout-graceful-shutdown 30
```

这是一组需要压测的示例值，不是通用推荐。limit-concurrency 的实际行为取决于 Server 协议与版本，并不等价于一个精确的全局业务队列容量；超限拒绝也要纳入客户端契约。

## 3. 查看实际配置对象

```python title="api_workers.py"
from uvicorn import Config

def main():
    config = Config("api_health:app", workers=2, limit_concurrency=100,
                    timeout_keep_alive=5, timeout_graceful_shutdown=30)
    print(config.workers, config.limit_concurrency)
    print(config.timeout_keep_alive, config.timeout_graceful_shutdown)
    print(config.reload)

if __name__ == "__main__":
    main()
```

```text title="api_workers.out"
2 100
5 30
False
```

这里只核对配置解析，不声称这些值已适合特定生产容量。真实启动、负载与信号测试需要单独执行。

## 4. 优雅退出顺序

入口先停止把新请求送来，Server 停止接新连接/请求，等待已有工作在预算内完成，再关闭 lifespan 资源。代理摘流并非零时延，因此必须考虑传播窗口。

SSE、WebSocket 与长任务需要单独的退出协议；不能无限等待。超出宽限后强制终止时，外部状态仍须可恢复，必要任务依靠持久化而非退出回调保全。

Uvicorn keep-alive timeout 不是业务请求总超时；graceful timeout 也不能代替数据库语句和 HTTP 客户端预算。

### 4.1 API Worker 与任务 Worker

同一个 Worker 词在两处职责不同：Uvicorn Worker 负责 HTTP 应用进程，任务 Worker 负责从持久化状态领取工作。关闭 API 要处理连接、响应与 lifespan；关闭任务 Worker 要停止领取、结束有限执行或让租约过期恢复，不能照搬同一段退出代码。

综合工程的 Linux 任务入口注册 SIGTERM/SIGINT，先设置停止信号，当前工作有三十秒异步预算，再关闭 Engine；容器宽限示例为四十五秒，仍需包含数据库和清理时间。Windows 控制台中断路径不同，不能用 process.terminate 的测试证明 Linux graceful shutdown。

验证退出时，在持续有限请求或运行中的任务之间发正常停止信号，记录接收新工作、已有工作结束、池关闭和进程退出的顺序。再测试超出预算的行为，确认关键状态依靠持久化恢复，而非寄托在不会被调用的 finally 上。

## 5. 练习与答案

### 5.1 增加 Worker 能共享一个内存任务列表吗？

答案：通常不能，每进程有自己的状态。需要外部存储/消息系统或明确 IPC。

### 5.2 keep-alive 五秒意味着每个请求最多五秒吗？

答案：不是，它主要涉及空闲持久连接等待，不是业务总 Deadline。

### 5.3 SIGKILL 后还能依靠 finally 保存任务吗？

答案：不能，强制终止没有正常清理保证。关键状态必须在执行过程中持久化并可恢复。

## 6. 参考资料

- [FastAPI Workers](https://fastapi.tiangolo.com/deployment/server-workers/)
- [Uvicorn Settings](https://www.uvicorn.org/settings/)
- [Uvicorn Server Behavior](https://www.uvicorn.org/server-behavior/)
