---
title: "日志、指标、Trace 与请求关联"
sidebar_label: "02. 日志、指标、Trace 与请求关联"
sidebar_position: 2
description: "用低基数指标、上下文和跨度分解请求，理解 FastAPI 原生遥测与导出链路的责任。"
tags: [FastAPI, 测试, 部署, 可观测性]
---

# 日志、指标、Trace 与请求关联

日志记录离散事件，指标表达长期趋势，Trace 连接一次请求的因果与耗时。三者互补；只看“接口总耗时”不能区分排队、数据库池等待与下游执行。

## 1. 指标设计

至少记录请求率、错误率、延迟分布、在途数量和关键队列/池等待。标签使用路由模板而非具体 URL，不把 user_id、job_id 或原始查询串变成无限基数标签。

延迟需要明确是处理函数结束、响应头就绪，还是完整 body 发送结束。流式响应和客户端断开会使这几个时间明显不同。

## 2. 路由模板计数实验

```python title="api_observe.py"
from collections import Counter
from time import monotonic
from fastapi import FastAPI

app = FastAPI()
counts = Counter()

@app.middleware("http")
async def observe(request, call_next):
    started = monotonic()
    response = await call_next(request)
    route = request.scope.get("route")
    pattern = getattr(route, "path", "unmatched")
    counts[(pattern, response.status_code)] += 1
    response.headers["X-Elapsed-Nonnegative"] = str(monotonic() >= started)
    return response

@app.get("/jobs/{job_id}")
async def job(job_id: int):
    return {"id": job_id}

def main():
    from fastapi.testclient import TestClient
    counts.clear()
    with TestClient(app) as client:
        client.get("/jobs/1")
        result = client.get("/jobs/2")
    print(dict(counts))
    print(result.headers["X-Elapsed-Nonnegative"])

if __name__ == "__main__":
    main()
```

```text title="api_observe.out"
{('/jobs/{job_id}', 200): 2}
True
```

Counter 只演示聚合维度，不是生产指标导出器，也不覆盖响应发送后故障。真实指标需支持并发、进程和采集生命周期。

## 3. FastAPI 0.150 的原生遥测

当前版本已经提供原生 OpenTelemetry 支持，包含请求相关 traces、metrics 与 logs 的能力；将数据真正送往观测后端，还需要对应 SDK/exporter、provider 或自动配置。

本系列基本依赖未启用外部导出，不假定仅导入 FastAPI 就有一个可查询的远端监控系统。采用原生或其他 instrumentation 时应防止重复埋点与重复 Span，并检查采样、属性和秘密过滤。

## 4. 证据关联

入口生成/验证请求标识，向可信下游传播 Trace context，数据库与外部调用产生子跨度；连接池等待最好单独观测。一个下游 span 很长不说明全是网络，里面也可能包含池排队。

错误体给客户端稳定代码和关联 ID，服务器保留脱敏堆栈。采集队列与导出失败也需要指标，避免监控系统自己堵住业务。

## 5. 练习与答案

### 5.1 job_id 作为指标标签有什么风险？

答案：取值持续增长，会造成高基数时间序列和内存/存储压力。应使用路由模板并在 Trace/日志中按需关联具体对象。

### 5.2 中间件返回 Response 的时间等于 SSE 完成时间吗？

答案：不等于，流的发送可能发生在之后。必须定义计时边界。

### 5.3 当前 FastAPI 有原生遥测，就不需要配置导出了吗？

答案：仍需要建立 provider/exporter 与后端链路，并验证数据确实到达，避免把 API 支持当成完整平台已经部署。

## 6. 参考资料

- [FastAPI OpenTelemetry](https://fastapi.tiangolo.com/advanced/opentelemetry/)
- [OpenTelemetry Python](https://opentelemetry.io/docs/languages/python/)
