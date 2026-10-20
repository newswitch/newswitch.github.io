---
title: "pytest、HTTPX、依赖替换与集成测试"
sidebar_label: "01. pytest、HTTPX、依赖替换与集成测试"
sidebar_position: 1
description: "按进程内应用、真实数据库与真实网络划分测试证据，管理 lifespan、override 和并发场景。"
tags: [FastAPI, 测试, 部署, 可观测性]
---

# pytest、HTTPX、依赖替换与集成测试

测试 HTTP 接口至少有三层：直接调用业务规则、通过 ASGI 调用应用、通过真实网络访问进程。不同层验证不同边界，不能把其中一层通过写成“整条链路没问题”。

## 1. 测试矩阵

| 层级 | 可以证明 | 仍需另外验证 |
| --- | --- | --- |
| 规则单元测试 | 状态转换、输入输出 | 框架、数据库、网络 |
| TestClient/ASGITransport | 路由、依赖、序列化 | 真实 TCP、代理与 TLS |
| 目标数据库集成 | SQL、事务、约束 | 跨服务整体故障 |
| Uvicorn 真实 HTTP | 导入、进程、端口、协议 | 生产入口和容量 |

Starlette 1.9 的 TestClient 使用本系列锁定的 httpx2；异步示例仍明确使用 HTTPX 0.28.1。测试工具升级同样需要验证，不能只因为应用包没改就忽略客户端兼容。

## 2. 对数据库接口进行测试

下面与同一示例目录中的 api_database.py 配套：

```python title="test_api_contract.py"
import pytest
from fastapi.testclient import TestClient
from api_database import app

@pytest.fixture
def client():
    with TestClient(app) as value:
        yield value

def test_create_job(client):
    response = client.post("/jobs", json={"name": "import"})
    assert response.status_code == 201
    assert response.json() == {"id": 1, "name": "import"}

@pytest.mark.parametrize("name", ["", "x" * 81])
def test_invalid_name(client, name):
    response = client.post("/jobs", json={"name": name})
    assert response.status_code == 422
```

运行 `python -m pytest -q test_api_contract.py`，共 3 个用例。每个 Fixture lifespan 建立独立内存库，避免测试依赖已有数据。

## 3. 依赖替换

`app.dependency_overrides[original] = replacement` 根据原始依赖对象替换。测试结束清理，避免后续用例仍使用假身份或假 Session；共享 app 的并发测试还要防止 override 互相覆盖。

替换成内存 Repository 可以验证业务路径，却不能验证真实数据库锁或 SQL。数据库集成测试应使用独立数据库/Schema、确定的迁移与清理机制，不连接用户现有生产库。

## 4. 异步与网络

ASGITransport 不等于自动执行 lifespan，异步测试需要显式启动与关闭资源。真实 HTTP 测试则应只绑定环回临时端口、设置启动与请求期限，并只终止自己创建的进程。

长连接测试要区分完整有限流与首块时延；并发更新要验证最终数据库状态，而不只是所有请求都返回成功。

## 5. 练习与答案

### 5.1 用假身份测试通过，能证明 JWT 验证正确吗？

答案：不能，它绕过了认证链。需要分别验证令牌签名、必要声明、过期和错误路径。

### 5.2 为什么 override 必须清理？

答案：它是应用状态，遗留会污染其他测试。应放在可靠的 finally/Fixture 清理边界。

### 5.3 真实 Uvicorn 测试可以用固定生产端口吗？

答案：不应如此，应使用受控临时端口与自有进程，避免干扰已有服务并设置完整退出机制。

## 6. 参考资料

- [Testing](https://fastapi.tiangolo.com/tutorial/testing/)
- [Overrides](https://fastapi.tiangolo.com/advanced/testing-dependencies/)
- [Async Tests](https://fastapi.tiangolo.com/advanced/async-tests/)
