---
title: "APIRouter、应用工厂与多文件工程"
sidebar_label: "05. APIRouter、应用工厂与多文件工程"
sidebar_position: 5
description: "从单文件路由演进到明确的模块边界，解释导入方向、配置、依赖、业务与存储的组合。"
tags: [FastAPI, APIRouter, Python, 工程实践]
---

# APIRouter、应用工厂与多文件工程

一个文件足以解释第一个接口，但加入数据库、身份和 Worker 后，所有对象放在一起会让导入副作用与资源归属难以判断。拆文件的依据是责任和依赖方向，不是每个函数都要单独建目录。

## 1. 先确定依赖方向

综合工程位于 `examples/fastapi/task-service/`：

```text
task_service/
  config.py       配置解析与校验
  models.py       数据表与事件记录
  database.py     Engine、Session 工厂与关闭
  auth.py         凭证验证与身份
  repository.py   事务内的创建、读取、取消
  worker.py       领取、续租、执行与提交
  api.py          HTTP 参数、依赖与响应
  main.py         将配置组合成应用
  cli.py          本地令牌与 Worker 进程入口
migrations/       结构演进
tests/            接口与状态机验证
```

models 不导入 app，Worker 不向路由函数发请求，数据库函数不从任意全局 app 对象取配置。上层把需要的能力传给下层，才能在 CLI、HTTP 和测试中复用。

## 2. APIRouter 保存什么

```python
router = APIRouter(prefix="/jobs", tags=["jobs"])

@router.get("/{job_id}")
async def read_job(job_id: int):
    return {"id": job_id}

def create_app():
    app = FastAPI()
    app.include_router(router)
    return app
```

这个片段需要导入 FastAPI 与 APIRouter；它展示组合关系，不连接数据库。Router 描述路由及依赖等上下文，不自行监听端口，也不等于一个独立进程。include_router 将声明组合进应用；当前版本内部可能保留组合上下文，不要依赖某个私有列表布局。

prefix 负责路径组织，tags 负责文档分组，dependencies 可以执行共享检查。若端点需要依赖的返回值，仍要通过参数声明接收；仅挂到 dependencies 列表不会自动产生一个可用的 user 局部变量。

## 3. 工厂创建与生命周期初始化

`create_from_env()` 读取 Settings，再创建应用。数据库 Engine 放进 lifespan，在应用开始服务时准备，在退出时关闭；模块导入只定义类和函数。

```bash
python -m uvicorn task_service.main:create_from_env --factory --host 127.0.0.1 --port 8000
```

从 task-service 目录运行，或先以适当方式安装包。工厂不会让状态自动共享：两个 Worker 会各自创建应用和连接池。全局注册的 Router 可以复用声明，但不应把可变的请求状态塞进其中。

## 4. 为什么容易循环导入

如果 main 导入 api，api 又从 main 导入 app，main 可能尚未完成初始化。把公共模型移到不依赖应用入口的模块，用工厂组合，通常比在函数里随处推迟 import 更清楚。

不要把所有参数都包进万能 service 容器。当前项目只需要 Database 和 Settings，就直接传入；当仓储需要多个实现或测试替身时，再提取小接口。抽象的价值在于保持规则稳定，而不是让文件名看起来更像某种架构。

## 5. 独立验证模块边界

导入 models、auth、worker 不应打开端口、自动迁移或无限轮询。创建两个不同配置的 app，分别进入 lifespan，数据库应隔离。再从 Worker 入口执行任务，确认它使用共享持久化状态而不是 API 进程里的内存字典。

## 6. 练习与答案

### 6.1 把全局 Session 移到 database.py 就解决并发了吗？

答案：没有，只改变了文件位置。共享 Engine/工厂可以，事务 Session 应按独立工作创建；模块边界不能代替生命周期边界。

### 6.2 Router 的 dependencies 验证了身份，函数怎样取得身份对象？

答案：在端点参数或其子依赖中声明对应 Depends。验证动作和接收返回值不是同一个声明效果。

### 6.3 新增一个统计接口，怎样验收拆分合理？

答案：路由负责输入、身份和响应，统计逻辑可直接测试，查询限制在对应存储边界；不需要让 models 反向导入 app，也不应复制一份独立连接池配置。

## 7. 参考资料

- [FastAPI 多文件应用](https://fastapi.tiangolo.com/tutorial/bigger-applications/)
- [APIRouter 参考](https://fastapi.tiangolo.com/reference/apirouter/)
