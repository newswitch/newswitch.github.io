---
title: "第一个 FastAPI 项目与应用启动"
sidebar_label: "01. 第一个 FastAPI 项目与应用启动"
sidebar_position: 1
description: "从固定环境、应用对象和可运行入口开始，区分本地测试、开发重载与生产进程。"
tags: [FastAPI, Python, HTTP]
---

# 第一个 FastAPI 项目与应用启动

FastAPI 应用是一个 ASGI 可调用对象。Uvicorn 导入它并驱动请求；路由函数描述业务入口，不负责自己监听网卡。

## 1. 固定环境

本系列使用 CPython 3.14.8、FastAPI 0.150.0、Starlette 1.9.0、Pydantic 2.14.1、Uvicorn 0.54.0。HTTP 客户端示例使用 HTTPX 0.28.1；Starlette 1.9 的 TestClient 使用 httpx2 2.15.1，二者不是同一个分发包。

完整约束在源码 `examples/fastapi/framework-lab/requirements.lock`。创建虚拟环境后从该文件安装，不逐篇执行无版本升级。示例工程还包含数据库与测试依赖，它们不代表引入第二个 Web 框架。

## 2. 第一个应用

```python title="api_start.py"
from fastapi import FastAPI

def create_app():
    application = FastAPI(title="Task service")

    @application.get("/health/live")
    async def live():
        return {"status": "alive"}

    @application.get("/jobs/{job_id}")
    async def get_job(job_id: int):
        return {"id": job_id, "state": "ready"}

    return application

app = create_app()

def main():
    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        response = client.get("/jobs/1")
        print(response.status_code, response.json())

if __name__ == "__main__":
    main()
```

```text title="api_start.out"
200 {'id': 1, 'state': 'ready'}
```

本例只返回固定规则结果，不声称已经保存真实任务。`create_app` 创建独立应用，便于隔离测试与配置；模块级 app 只注册路由，不启动网络或连接外部系统。

## 3. 真正监听端口

从示例目录执行：

```bash
python -m uvicorn api_start:app --host 127.0.0.1 --port 8000
```

`api_start:app` 表示模块名与属性名，不是文件路径。成功启动后访问 `http://127.0.0.1:8000/jobs/1`；本机开发可加 `--reload`，生产不使用自动重载。退出使用正常信号，让应用完成关闭。

`127.0.0.1` 仅本机访问；`0.0.0.0` 监听所有相应 IPv4 接口，会改变暴露范围。不要在没配置认证、代理和访问控制时把教学服务直接暴露公网。

## 4. 从进程到接口

解释器先导入模块并注册路由，Server 再启动生命周期与监听；请求到达后匹配路径、解析参数、调用函数、序列化响应。应用对象、进程与 Pod 不等价：一个 Pod 可以运行不同数量的进程，每个进程通常有独立的应用内存。

TestClient 在进程内测试 ASGI，不验证真实端口、TLS、反向代理与网络超时。真实服务验证需要另外启动 Uvicorn 并通过 TCP 访问。

## 5. 练习与答案

### 5.1 写了 app = FastAPI，就已经监听八千端口了吗？

答案：没有。它创建应用对象；需要 Uvicorn 等 ASGI Server 加载并运行。

### 5.2 为什么不在生产打开 reload？

答案：重载用于开发，涉及监控文件和进程重启，不是稳定发布机制。生产使用明确产物与进程管理。

### 5.3 TestClient 返回二百，证明防火墙放通了吗？

答案：不证明。它通常不经过真实 TCP 路径，需要独立的网络入口验证。

## 6. 参考资料

- [FastAPI First Steps](https://fastapi.tiangolo.com/tutorial/first-steps/)
- [Uvicorn 配置](https://www.uvicorn.org/settings/)
- [FastAPI 版本说明](https://fastapi.tiangolo.com/deployment/versions/)
