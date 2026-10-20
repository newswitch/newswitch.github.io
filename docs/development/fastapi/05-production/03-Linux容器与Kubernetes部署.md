---
title: "Linux、容器与 Kubernetes 部署"
sidebar_label: "03. Linux、容器与 Kubernetes 部署"
sidebar_position: 3
description: "将模块入口、进程、信号、探针、代理和依赖约束组织成可运行部署，明确平台差异。"
tags: [FastAPI, 测试, 部署, 可观测性]
---

# Linux、容器与 Kubernetes 部署

部署不是把开发命令放到服务器上后台运行。解释器、产物、工作目录、用户权限、端口、信号和配置，都需要从隐含条件变成显式约定。

## 1. 最小生产入口

虚拟环境采用绝对解释器路径；在受控工作目录执行 `python -m uvicorn api_health:app --host 0.0.0.0 --port 8000`。不启用 reload，不在启动时临时升级依赖。

Linux 可用 systemd 管理：

```ini
[Unit]
Description=Task API
After=network.target

[Service]
User=task-api
WorkingDirectory=/opt/task-api
ExecStart=/opt/task-api/.venv/bin/python -m uvicorn api_health:app --host 127.0.0.1 --port 8000
Restart=on-failure
TimeoutStopSec=40
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
```

用户、目录和依赖须先创建并赋予最小权限；示例不是可直接覆盖现有机器服务的脚本。敏感配置通过受控文件/Secret 注入，不写在 unit 公共参数中。

## 2. 探针应用

```python title="api_health.py"
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, Response

@asynccontextmanager
async def lifespan(app):
    app.state.ready = True
    try:
        yield
    finally:
        app.state.ready = False

app = FastAPI(lifespan=lifespan)

@app.get("/health/live")
async def live():
    return {"alive": True}

@app.get("/health/ready")
async def ready(request: Request, response: Response):
    value = request.app.state.ready
    if not value:
        response.status_code = 503
    return {"ready": value}

def main():
    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        print(client.get("/health/live").status_code)
        print(client.get("/health/ready").status_code)

if __name__ == "__main__":
    main()
```

```text title="api_health.out"
200
200
```

本例就绪仅表示本地初始化完成。真实系统还需按业务能力定义依赖检查，并避免探针重试放大故障。

## 3. 容器构建

```dockerfile
FROM python:3.14-slim
WORKDIR /app
COPY requirements.lock .
RUN python -m pip install --no-cache-dir -r requirements.lock
COPY api_health.py .
USER 10001:10001
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "api_health:app", "--host", "0.0.0.0", "--port", "8000"]
```

基础 tag 会变化，生产应解析并固定已验证 digest；依赖锁也需针对目标 Linux/CPU 架构重新验证，不把 Windows 环境验证当成容器验证。JSON CMD 让 Python 直接接收信号，避免不必要的 Shell 包裹。

## 4. Kubernetes 配置重点

Deployment 设置受测镜像、非 root、安全上下文、CPU/内存 requests/limits 和 terminationGracePeriodSeconds；Service 暴露固定端口；ConfigMap/Secret 承载相应配置。

startupProbe 允许初始化，readinessProbe 决定是否接流量，livenessProbe 检查不可恢复的进程问题。退出宽限要覆盖入口摘流、在途请求排空与资源清理；不要只给一个很短的默认值。

以下清单用于已经构建并上传镜像的探针应用，先将镜像替换为自己验证过的地址与 digest：

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: task-api
spec:
  replicas: 2
  selector:
    matchLabels:
      app: task-api
  template:
    metadata:
      labels:
        app: task-api
    spec:
      terminationGracePeriodSeconds: 40
      containers:
        - name: api
          image: registry.example.com/task-api:replace-with-tested-image
          ports:
            - containerPort: 8000
          env:
            - name: PYTHONDONTWRITEBYTECODE
              value: "1"
          resources:
            requests:
              cpu: "250m"
              memory: "128Mi"
            limits:
              cpu: "1"
              memory: "512Mi"
          securityContext:
            runAsNonRoot: true
            allowPrivilegeEscalation: false
          startupProbe:
            httpGet:
              path: /health/live
              port: 8000
            periodSeconds: 2
            failureThreshold: 30
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8000
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /health/live
              port: 8000
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: task-api
spec:
  selector:
    app: task-api
  ports:
    - port: 80
      targetPort: 8000
```

CPU/内存值仅用于说明配置位置，必须按目标负载测量。先在选定测试命名空间 apply，再检查 Deployment rollout、Pod 事件、探针和 Service Endpoint；不要省略镜像拉取、架构和安全上下文验证。

入口 TLS、Host、路径前缀与代理头需要一致。只信任受控代理的 forwarded 信息，不对任意客户端开放代理头信任。

## 5. 练习与答案

### 5.1 systemd 能成功启动，说明目录与导入路径永远无关吗？

答案：不能，WorkingDirectory、解释器和产物仍决定导入与相对文件路径，必须显式配置并验证。

### 5.2 容器内有四个 Worker，每个连接池十个，上限还是十个吗？

答案：通常可能累计到四十个，再乘副本数。需要按整个部署预算连接。

### 5.3 数据库短暂不可用，是否该用 liveness 一直重启？

答案：通常不应如此，应区分暂时不就绪与进程损坏，防止重启风暴。

## 6. 参考资料

- [FastAPI Docker](https://fastapi.tiangolo.com/deployment/docker/)
- [Uvicorn Deployment](https://www.uvicorn.org/deployment/)
- [Kubernetes Probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/)
