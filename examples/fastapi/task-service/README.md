# Async task service

配套文章位于 `docs/development/fastapi/07-task-service/`。本工程执行有限的
字符串转换任务，以数据库结果和事件同事务提交演示可恢复执行，不连接真实业务系统。

从仓库根目录创建独立环境并安装：

```powershell
python -m venv .python-article-checks/study-venv
.\.python-article-checks\study-venv\Scripts\python.exe -m pip install -r examples/fastapi/deepening.lock
```

进入本目录后使用该解释器绝对路径，或确认已激活同一环境。Linux 的解释器是
`.python-article-checks/study-venv/bin/python`。默认 SQLite 只用于学习；不以它验证 PostgreSQL 锁模型。

```powershell
$env:APP_JWT_SECRET = python -c "import secrets; print(secrets.token_hex(32))"
$env:APP_DATABASE_URL = 'sqlite+aiosqlite:///./tasks.db'
python -m alembic upgrade head
$token = python -m task_service.cli token --tenant lab
$headers = @{Authorization="Bearer $token"; 'Idempotency-Key'='first'}
python -m uvicorn task_service.main:create_from_env --factory --host 127.0.0.1 --port 8000
```

环境变量只在当前 Shell 及其子进程继承；另一个终端需使用相同配置。
也可用编辑器将 .env.example 复制为 .env 并填入自己的实验秘密，Settings 会读取；
环境变量优先于该文件。.env 不提交，生产由受控 Secret 注入。
在保留 `$token` 的客户端终端调用：

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/jobs -Headers $headers -ContentType application/json -Body '{"name":"import"}'
python -m task_service.cli worker --once
Invoke-RestMethod -Uri http://127.0.0.1:8000/jobs/1 -Headers $headers
```

最后状态为 done，结果为 IMPORT，attempts 为 1。重复相同幂等请求不创建新任务。
首次实验库中 id 为 1；已有数据时以 POST 返回 id 为准。不要把真实令牌、配置或数据库提交到 Git。

```bash
python -m pytest -q tests
```

测试用临时文件库、可控时钟和显式 lifespan 验证恢复、并发提交、领取竞争、取消及重放。
Compose/Kubernetes 文件面向独立测试环境，部署前替换镜像与 Secret 并验证目标平台。
Kubernetes 迁移 Job 与 Deployment 需分阶段应用：先等待 Job 成功，再上线 API/Worker。
不能把整份 YAML 一次 apply 当成迁移依赖已经满足。

Worker 中断后未完成工作依赖租约过期重新领取；同一数据库内的结果提交可原子化，
外部 HTTP/支付/对象写入仍需另行设计幂等或 Outbox，不承诺跨系统恰好一次。
