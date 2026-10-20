---
title: "依赖图、缓存、yield 与清理时机"
sidebar_label: "02. 依赖图、缓存、yield 与清理时机"
sidebar_position: 2
description: "理解 FastAPI 依赖解析、请求级缓存和 function/request scope，避免资源过早关闭或提交过晚。"
tags: [FastAPI, 依赖注入, asyncio]
---

# 依赖图、缓存、yield 与清理时机

Depends 声明“这个入口需要什么”，不是在定义时直接调用函数。框架构建依赖关系，在每个请求中解析参数并取得结果；yield 依赖还参与资源退出管理。

## 1. 缓存属于请求，不属于整个应用

同一依赖在一次请求中多处使用时，默认通常复用结果；不同请求不因此共享同一结果。`use_cache=False` 改变相应解析行为，但不能把它当成创建资源次数的唯一推导依据，仍要看依赖图、顺序与缓存键。

全局共享 Client/Engine 应由 lifespan 管理，请求 Session 则通常由依赖取得。不要把“依赖有缓存”误认为连接池或单例系统。

## 2. yield 的进入与退出

```python title="api_dependencies.py"
from typing import Annotated
from fastapi import Depends, FastAPI

app = FastAPI()
events = []

def resource():
    events.append("open")
    try:
        yield object()
    finally:
        events.append("close")

@app.get("/jobs")
def jobs(
    first: Annotated[object, Depends(resource, scope="function")],
    second: Annotated[object, Depends(resource, scope="function")],
):
    events.append("handler")
    return {"same": first is second}

def main():
    from fastapi.testclient import TestClient
    events.clear()
    with TestClient(app) as client:
        print(client.get("/jobs").json())
    print(events)

if __name__ == "__main__":
    main()
```

```text title="api_dependencies.out"
{'same': True}
['open', 'handler', 'close']
```

示例只创建一个对象，依赖图的两处引用复用同一结果。事件列表仅用于教学观察，不是生产级请求日志存储。

## 3. scope 改变哪一段生命周期

FastAPI 0.150 中，yield 依赖的 function scope 在路径操作结束后、响应发送前退出；request scope 则覆盖响应周期，退出更晚。默认与可组合关系应按当前依赖类型和 scope 规则理解。

流式响应如果在迭代时还需要资源，就不能在迭代前关闭；不需要继续持有数据库连接时，也不应为了慢客户端下载长期占着连接。

数据库提交最好在能决定最终业务响应的边界完成。把关键 commit 藏到响应已发送后的清理阶段，会产生“客户端收到成功，事务却提交失败”的语义问题。

## 4. 失败与替换

依赖获取失败时，已成功进入的资源仍需退出；yield 后捕获异常不能悄悄吞掉，让失败看起来成功。后台任务也不应复用已经结束的请求资源。

测试通过 dependency_overrides 替换特定依赖对象，结束后恢复。返回值相同的两个不同函数并不是同一个 override 键。

## 5. 练习与答案

### 5.1 依赖结果默认在所有请求之间共享吗？

答案：通常不是，默认缓存边界是单次请求。应用级资源需要独立生命周期设计。

### 5.2 流式输出还需要 Session，能用 function scope 吗？

答案：若 Session 在函数返回后已关闭，而流迭代才开始使用，就不合适。应调整数据读取方式或明确资源存活范围。

### 5.3 为什么不把 commit 一律放 yield 后？

答案：提交失败可能发生在成功响应之后，破坏接口语义。关键提交应在响应成功确定前完成。

## 6. 参考资料

- [Dependencies with yield](https://fastapi.tiangolo.com/tutorial/dependencies/dependencies-with-yield/)
- [依赖缓存](https://fastapi.tiangolo.com/tutorial/dependencies/sub-dependencies/)
