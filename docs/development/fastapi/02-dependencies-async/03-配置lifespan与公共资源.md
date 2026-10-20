---
title: "配置、lifespan 与公共资源"
sidebar_label: "03. 配置、lifespan 与公共资源"
sidebar_position: 3
description: "将启动配置、连接池与 HTTP 客户端放入明确生命周期，处理启动失败、测试和关闭。"
tags: [FastAPI, 依赖注入, asyncio]
---

# 配置、lifespan 与公共资源

导入模块应该主要建立定义，应用启动才创建需要关闭的公共资源。lifespan 把“准备好接流量”和“开始释放资源”的时点组织成明确边界。

## 1. 三种资源寿命

常量与函数定义可以随模块存在；共享 Client/Engine 通常随应用存在；请求 Session、临时文件等随一次工作存在。不要让一个请求创建并遗忘公共连接池，也不要让所有请求共享同一事务会话。

配置通过 pydantic-settings 等统一加载与校验后，再创建资源。启动失败应使应用无法进入就绪状态，而不是打印一条 warning 后继续接受无法处理的请求。

## 2. 生命周期示例

```python title="api_lifespan.py"
from contextlib import asynccontextmanager
import httpx
from fastapi import FastAPI, Request

@asynccontextmanager
async def lifespan(app):
    async with httpx.AsyncClient(trust_env=False, timeout=3.0) as client:
        app.state.client = client
        app.state.ready = True
        try:
            yield
        finally:
            app.state.ready = False

app = FastAPI(lifespan=lifespan)

@app.get("/health/ready")
async def ready(request: Request):
    return {"ready": request.app.state.ready}

def main():
    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        print(client.get("/health/ready").json())
        print(app.state.client.is_closed)
    print(app.state.client.is_closed, app.state.ready)

if __name__ == "__main__":
    main()
```

```text title="api_lifespan.out"
{'ready': True}
False
True False
```

测试用 with 才覆盖启动与关闭。Client 在整个应用作用域中复用，结束后关闭；本例没有访问外部网络。

## 3. 失败与部分初始化

多个资源按依赖顺序创建，创建后立刻登记清理；第三个资源失败时，前两个也要释放。AsyncExitStack 适合管理动态组合，避免零散 try/finally 漏掉分支。

多 Worker 各自执行 lifespan，因此每个 Worker 都可能创建自己的池、缓存与后台任务。数据库迁移、唯一调度任务等不能仅因放在 lifespan 就保证集群只执行一次。

## 4. 就绪与关闭

就绪应表示当前能够接收业务，而非所有外部系统永远健康。依赖健康检查需要预算与缓存，避免探针本身压垮数据库。存活检查不宜直接绑定短暂外部故障，防止重启风暴。

关闭时停止接收新工作，排空有界的在途任务，再释放公共资源。进程强制终止没有清理保障，应用仍需可恢复的外部状态设计。

## 5. 练习与答案

### 5.1 lifespan 里跑一次迁移，就能保证整个集群只跑一次吗？

答案：不能，多 Worker/多 Pod 会各自启动。迁移应作为受控部署步骤，具备互斥和兼容策略。

### 5.2 为什么 TestClient 不用 with 可能漏测资源？

答案：没有完整执行应用 lifespan 的进入与退出，启动初始化和关闭问题可能被绕过。

### 5.3 外部数据库短暂失败，liveness 应立刻失败吗？

答案：通常不宜直接绑定。应区分进程不可恢复故障与临时不就绪，避免无效重启扩大故障。

## 6. 参考资料

- [Lifespan Events](https://fastapi.tiangolo.com/advanced/events/)
- [Settings](https://fastapi.tiangolo.com/advanced/settings/)
- [AsyncExitStack](https://docs.python.org/3.14/library/contextlib.html#contextlib.AsyncExitStack)
