---
title: "SQLAlchemy、连接池与 Session"
sidebar_label: "01. SQLAlchemy、连接池与 Session"
sidebar_position: 1
description: "将 Engine、Connection、Session 与事务分开，构建请求级会话和明确提交的数据库接口。"
tags: [FastAPI, SQLAlchemy, 安全]
---

# SQLAlchemy、连接池与 Session

Engine 管理连接获取与池策略，Connection 是一次底层连接使用，Session 管理 ORM 状态与事务。三者不是同一个“数据库对象”，也不应拥有完全相同的生命周期。

## 1. 所有权

应用通常共享 Engine，每个请求/并发工作建立独立 Session。Session 不是线程安全或任务安全的共享事务容器；AsyncSession 也不能让多个并发任务随意共用。

连接池上限要乘上 Worker、Pod 和服务副本。每进程十个连接，在二十个副本下不是十个，而可能是数百个连接预算。

## 2. 完整接口示例

```python title="api_database.py"
from contextlib import asynccontextmanager
from typing import Annotated
from fastapi import Depends, FastAPI, Request
from pydantic import BaseModel, Field
from sqlalchemy import String, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column
from sqlalchemy.pool import StaticPool

class Base(DeclarativeBase):
    pass

class Job(Base):
    __tablename__ = "jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))

class CreateJob(BaseModel):
    name: str = Field(min_length=1, max_length=80)

@asynccontextmanager
async def lifespan(app):
    engine = create_engine("sqlite://", poolclass=StaticPool,
                           connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    app.state.engine = engine
    try:
        yield
    finally:
        engine.dispose()

app = FastAPI(lifespan=lifespan)

def session(request: Request):
    with Session(request.app.state.engine) as value:
        yield value

@app.post("/jobs", status_code=201)
def create_job(body: CreateJob,
               db: Annotated[Session, Depends(session, scope="function")]):
    row = Job(name=body.name)
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "name": row.name}

def main():
    from fastapi.testclient import TestClient
    with TestClient(app) as client:
        response = client.post("/jobs", json={"name": "import"})
        print(response.status_code, response.json())

if __name__ == "__main__":
    main()
```

```text title="api_database.out"
201 {'id': 1, 'name': 'import'}
```

SQLite 内存库与 StaticPool 只用于这个小实验，避免不同线程取得不同内存库。它不代表生产多进程共享数据库，也不能证明 PostgreSQL/MySQL 的隔离与锁行为。

## 3. 为什么成功响应前提交

add 将对象加入 Session，不代表已提交；flush 将相应操作发送到事务，commit 才完成提交边界。提交失败应在响应成功前暴露，失败后的 Session 通常还需 rollback 才能继续使用。

访问过期属性或懒加载关系可能发起额外 SQL。不要在 Session 关闭后才让序列化器意外触发查询；应在明确边界加载和转换需要的公开字段。

## 4. 生产约束

create_all 用于示例初始化，不是已有数据库升级工具。生产用迁移管理结构变化，配置连接与语句超时、池等待预算、凭证与 TLS。

连接池过大可能压垮数据库，过小则排队。先测池等待和事务占用时间，避免在持有事务时调用慢 HTTP 或等待用户输入。

### 4.1 按一次请求计算连接占用

Engine → 池 → Connection → 事务，以及 Session → ORM 身份映射是相关但不同的关系。Session 首次发 SQL 后可能一直持有事务连接，直到提交、回滚或关闭；读请求也可能自动开始事务，不能认为只有 INSERT 才占连接。

例如每秒二十个请求、平均持有连接零点二秒，稳定前提下平均占用约四条；若不小心在事务内等待两秒 HTTP，平均需求就会大幅增加。这个平均估算不能替代峰值、尾延迟和故障余量，应实际测池等待和最长持有者。

同一 Session 读同一主键可能复用身份映射里的对象，不表示数据库从未变化。expire、refresh、隔离级别和事务边界决定再次看见什么。将 ORM 对象直接交给输出序列化，可能触发懒加载并产生 N+1 查询；应明确查询所需字段和关系，再形成公开输出。

同步与异步版本的完整对照见[AsyncSession](./05-AsyncSession与异步数据库访问.md)。小型 SQLite 例子继续用于观察 API 顺序，真实锁竞争与在线迁移进入[PostgreSQL 实验](./06-PostgreSQL锁竞争与在线结构演进.md)，两种实验不能互相替代。

## 5. 练习与答案

### 5.1 Engine 与 Session 可以都做成全局单例吗？

答案：Engine 常可共享，但 Session 通常应按工作隔离，不能让并发请求共享同一事务状态。

### 5.2 flush 后就能向客户端承诺持久化成功吗？

答案：不能，事务尚可能回滚或提交失败。成功语义应对应明确提交点。

### 5.3 内存 SQLite 测试通过，能证明生产死锁处理正确吗？

答案：不能。锁、隔离、连接与驱动行为不同，需要目标数据库的专项集成测试。

## 6. 参考资料

- [SQLAlchemy Session Basics](https://docs.sqlalchemy.org/en/21/orm/session_basics.html)
- [SQLAlchemy Pooling](https://docs.sqlalchemy.org/en/21/core/pooling.html)
- [FastAPI SQL](https://fastapi.tiangolo.com/tutorial/sql-databases/)
