---
title: "HTTP 客户端、复用、超时与可靠调用"
sidebar_label: "01. HTTP 客户端、复用、超时与可靠调用"
sidebar_position: 1
description: "在异步服务中管理出站连接池、响应生命周期、预算和错误映射，避免重试放大。"
tags: [FastAPI, HTTP, 异步任务]
---

# HTTP 客户端、复用、超时与可靠调用

入口服务往往需要访问多个下游。请求延迟不仅由路由函数决定，还包含连接池等待、下游排队与响应读取；入口取消也不一定撤销下游副作用。

## 1. 共享客户端，请求独立预算

AsyncClient 通常随应用 lifespan 复用，设置总连接与空闲连接上限。每个请求携带自己的剩余预算与关联标识，不把用户 Authorization 无条件转发到任意下游。

不要在 async 路由里使用同步 Client 堵住事件循环。也不要每次循环创建新的 AsyncClient，让握手与连接数不断放大。

## 2. 出站调用与错误映射

```python title="api_outbound.py"
import asyncio
import httpx

async def fetch(client, job_id):
    response = await client.get(f"/jobs/{job_id}")
    response.raise_for_status()
    return response.json()

async def main():
    def handle(request):
        if request.url.path == "/jobs/1":
            return httpx.Response(200, json={"id": 1})
        return httpx.Response(503)

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(handle), base_url="https://upstream.test",
        timeout=httpx.Timeout(2.0, connect=0.5, pool=0.2),
        limits=httpx.Limits(max_connections=10), trust_env=False,
    ) as client:
        print(await fetch(client, 1))
        try:
            await fetch(client, 2)
        except httpx.HTTPStatusError as error:
            print("upstream:", error.response.status_code)

if __name__ == "__main__":
    asyncio.run(main())
```

```text title="api_outbound.out"
{'id': 1}
upstream: 503
```

MockTransport 不验证真实网络。本例不自动重试，避免让读者把任何 503 都直接重放。真实接口应将预期下游故障转换成稳定的公开错误，同时保留内部证据。

## 3. 预算与重试

连接、读、写与池等待分别设预算，外层再限制总 Deadline。多个并发下游调用要限制扇出；尾延迟可能由最慢分支决定，而重试会增加该下游负载。

只对允许重复的操作重试，使用有限次数、退避与抖动，并考虑 Retry-After。超时后的 POST 可能已完成，必须有幂等键/查询协议，不能因为没收到响应就重新创建任务。

## 4. 流与安全

流式读取需要关闭 Response，且限制总字节。把整个大响应 `aread` 后再发给客户端，不能称为低内存透传。

严格验证目标 URL、代理、TLS 信任与重定向。SSRF 防护要覆盖解析与实际连接路径，而非只检查用户输入字符串是否含有某个域名。

## 5. 练习与答案

### 5.1 每个请求新建客户端，为什么可能变慢？

答案：连接复用减少，握手、socket 与池管理开销增加。应在合适生命周期内复用。

### 5.2 下游超时后，入口应该一律返回五百吗？

答案：不应一概而论，应按超时、不可用、协议错误与业务拒绝定义错误契约，并避免泄露内部信息。

### 5.3 三个重试是否只增加客户端耗时？

答案：也增加下游负载，可能在故障时形成放大。需共享总预算并具有限流/退避策略。

## 6. 参考资料

- [HTTPX Async](https://www.python-httpx.org/async/)
- [HTTPX Limits](https://www.python-httpx.org/advanced/resource-limits/)
- [HTTPX Exceptions](https://www.python-httpx.org/exceptions/)
