---
title: "SSE、WebSocket、断开与背压"
sidebar_label: "03. SSE、WebSocket、断开与背压"
sidebar_position: 3
description: "区分单向事件流与双向连接，设计心跳、断线恢复、消息上限和资源清理。"
tags: [FastAPI, HTTP, 异步任务]
---

# SSE、WebSocket、断开与背压

普通 JSON 响应一次完成，SSE 持续向客户端发送事件，WebSocket 则建立双向消息通道。连接更长，资源寿命、慢消费者与断开语义就更重要。

## 1. 协议选择

SSE 基于 HTTP 文本事件格式，适合单向进度/Token 流；WebSocket 适合需要双向消息的场景。二者都不自动提供消息持久化、恰好一次投递或跨 Worker 广播。

代理可能缓冲响应，超时也可能早于应用预期。心跳、最大空闲时间和重连行为应联合入口组件测试。

## 2. 有限 SSE 与 WebSocket 实验

```python title="api_streams.py"
from fastapi import FastAPI, WebSocket
from fastapi.responses import StreamingResponse

app = FastAPI()

@app.get("/events")
async def events():
    async def generate():
        yield "id: 1\nevent: state\ndata: ready\n\n"
    return StreamingResponse(generate(), media_type="text/event-stream")

@app.websocket("/ws")
async def websocket(websocket: WebSocket):
    await websocket.accept()
    message = await websocket.receive_text()
    await websocket.send_text(message.upper())
    await websocket.close()

def main():
    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        response = client.get("/events")
        print("data: ready" in response.text)
        with client.websocket_connect("/ws") as socket:
            socket.send_text("hello")
            print(socket.receive_text())

if __name__ == "__main__":
    main()
```

```text title="api_streams.out"
True
HELLO
```

SSE 是有限流，TestClient 可以完整消费；它不证明真实网络首块到达时间。生产无限流需要断开检测、取消处理和有上限的每连接状态。

## 3. 慢消费者与恢复

不要为每个客户端建立无界消息列表。队列满时选择等待、断开或按业务允许丢弃；长时间等待不能占着数据库事务。

SSE id/Last-Event-ID 可以参与恢复，但服务端必须保留可重放的事件和范围；WebSocket 也需要应用级消息 ID、确认与重放规则。仅仅自动重连不等于消息不丢。

## 4. 安全与资源

建立连接时验证身份和 Origin，长连接中还需考虑令牌过期、权限变化与撤销。每个连接限制消息大小、发送速率、订阅数与空闲时长。

捕获预期的断开后执行清理，异常不要在后台静默丢失。多 Worker 的内存连接表彼此独立，跨进程分发需要合适的消息层。

### 4.1 从一次回声走向长期连接

本页有限实验用于确认协议入口。继续阅读[持久化事件与重放](../07-task-service/03-事件重放断线恢复与慢消费者.md)，运行同一租户事件位置恢复，比较“当前快照”和“从某位置继续的变化”。不要把一次 HELLO 回声当成已经覆盖慢客户端和断线语义。

WebSocket 长连接至少需要一个有限接收循环、消息大小和速率限制、身份/Origin 检查，以及明确的退出动作。接收与发送并发时，用有界队列连接两个工作；队列满时按业务选择等待、断开或允许的丢弃，不能在每次广播时为每个连接无限 create_task。

客户端断开可能发生在等待输入、发送中或业务处理中，清理需要移除订阅、关闭任务并归还资源。连接仍在但权限被撤销，也需要重新验证或在有限寿命后重连；握手成功不是永久授权。

反向代理缓冲、空闲超时与最大消息规则需要真实 HTTP/WebSocket 链路验证。流式 body 开始后抛错，通常已无法换成新的 JSON 错误码，应定义流内错误或关闭语义。

## 5. 练习与答案

### 5.1 SSE 重连后自动保证事件不丢吗？

答案：不保证，需要可重放事件存储、位置标识与恢复协议。

### 5.2 WebSocket 连接越多就只多几个 socket 吗？

答案：还会增加任务、缓冲、订阅状态与心跳开销，需要按每连接成本规划容量。

### 5.3 用 TestClient 读到完整 SSE，证明代理没缓冲吗？

答案：不证明，进程内测试绕过真实代理与 TCP，首块延迟需真实链路验证。

## 6. 参考资料

- [FastAPI WebSocket](https://fastapi.tiangolo.com/advanced/websockets/)
- [StreamingResponse](https://fastapi.tiangolo.com/advanced/custom-response/#streamingresponse)
- [SSE 规范](https://html.spec.whatwg.org/multipage/server-sent-events.html)
