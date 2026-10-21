# FastAPI framework lab

包含 FastAPI 单项机制示例，以及同步任务记录服务 `task_app.py`。
完整异步执行服务另见相邻 `../task-service/`，两个实验按阶段分别运行。
基线为 CPython 3.14.8、FastAPI 0.150.0、Starlette 1.9.0、Pydantic 2.14.1、
Uvicorn 0.54.0、SQLAlchemy 2.1.5。HTTPX 0.28.1 用于出站/ASGI 示例，
httpx2 2.15.1 用于当前 Starlette TestClient。

## 安装与运行

从本目录在独立虚拟环境安装锁定依赖：

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock
.\.venv\Scripts\python.exe -m pip check
.\.venv\Scripts\python.exe api_start.py
.\.venv\Scripts\python.exe -m pytest -q test_api_contract.py tests
.\.venv\Scripts\python.exe -m uvicorn api_health:app --host 127.0.0.1 --port 8000
```

Linux/macOS 使用 `.venv/bin/python`，不需要依赖激活状态。
requirements.lock 记录 Windows/CPython 3.14 的完整教学环境版本；
它不包含跨平台 wheel 哈希保证，目标 Linux、CPU 架构仍需重建与验证。
这里包含测试与构建工具，生产应单独裁剪运行依赖。

每个 `api_*.py` 可直接运行其独立演示。TestClient/ASGITransport 不经过
真实 TCP、代理或 TLS；测试目录另含有界、环回临时端口的真实 Uvicorn 验证。

## 综合任务记录服务

`task_app.create_app(database_url, signing_key, create_schema=False)` 提供：

- 验证 HS256、issuer、audience、到期与必要身份声明；
- 请求级 Session、租户隔离、读写权限；
- 按租户与幂等键唯一约束创建任务，重复同内容返回已有记录；
- 条件版本取消、查询和有限 SSE 快照；
- 存活/就绪检查与 Engine 关闭。

它维护任务记录，不执行真实外部作业；不是完整生产认证/任务队列平台。
`create_schema=True` 仅用于隔离测试，正常入口要求预先执行迁移。
不要将测试中的固定密钥用于部署。

对一个新建的、明确用于实验的目录/数据库执行：

```bash
python -m alembic -c alembic.ini upgrade head
python -m alembic -c alembic.ini current
```

默认仅在当前目录创建 `tasks.db`。修改 alembic.ini 的 URL 前，先核对目标，
不要把实验迁移直接运行到已有业务数据库。downgrade 会删除示例表及数据，
只在可丢弃的测试库验证。

`task_app:create_from_env --factory` 从 `APP_DATABASE_URL` 与
`LAB_JWT_SECRET` 取得配置；密钥至少 32 字节，由受控 Secret 注入。
不要写入 Git、启动参数或日志。认证声明必须包含 `sub`、`tenant`、
`permissions`、`exp`、`iss=lesson-issuer`、`aud=jobs-api`；
权限为 `jobs:read` 与 `jobs:write`。生产应接真实身份系统与密钥轮换。

## 探测与验证边界

```bash
python load_probe.py --url http://127.0.0.1:8000/health/live --requests 20 --concurrency 2
```

仅对自己明确选定且允许测试的服务使用有限请求探测。这个闭环小工具有连接、
并发与请求数量上限，不是开环容量压测平台，也不产生通用 QPS 结论。

SQLite 验证不覆盖 PostgreSQL/MySQL 的锁、隔离与驱动行为；Windows 环境
不验证 systemd、容器和 Kubernetes 的真实部署。生产部署章节解释对应配置
与原理，目标平台仍需自己的集成与发布验证。

## 深化实验

从仓库根目录为同一独立环境安装 `examples/fastapi/deepening.lock`，再进入本目录：

```bash
python api_telemetry_export.py
python -m uvicorn api_otel_live:create_app --factory --host 127.0.0.1 --port 8000
python compare_load.py
```

遥测默认导出到 Console，设置 OTEL_EXPORTER_OTLP_ENDPOINT 才使用指定 OTLP HTTP
接收端；不要将真实业务数据发送到不可信地址。compare_load 只请求自己启动的环回
教学服务，每组有限二十次，结束关闭自有子进程，不产生通用容量承诺。
