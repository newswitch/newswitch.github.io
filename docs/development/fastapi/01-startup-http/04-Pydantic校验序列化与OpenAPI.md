---
title: "Pydantic、校验、序列化与 OpenAPI"
sidebar_label: "04. Pydantic、校验、序列化与 OpenAPI"
sidebar_position: 4
description: "理解类型转换、严格验证、字段默认与输出筛选，建立输入模型与公开响应的边界。"
tags: [FastAPI, Python, HTTP]
---

# Pydantic、校验、序列化与 OpenAPI

Pydantic 将外部数据转换并验证为模型。它不是简单判断 isinstance：默认模式下可能发生类型转换，因此严格与宽松必须按字段契约决定。

## 1. 输入、领域、输出

创建请求不应允许客户端指定服务器生成的 ID、租户归属或内部状态；数据库模型也不应直接充当公开响应。模型可以复用字段规则，但要保持信任边界。

默认值与输入值不同。Pydantic 默认值是否验证需看配置；FastAPI 0.148 之后对省略参数默认值的处理也有变化。不要把“校验器会在所有字段读取时都执行”当成前提。

## 2. 转换与严格字段

```python title="api_models.py"
from pydantic import BaseModel, ConfigDict, Field, ValidationError

class CreateJob(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=80)
    priority: int = Field(default=1, ge=1, le=5)

class StrictInput(BaseModel):
    count: int = Field(strict=True)

def main():
    job = CreateJob.model_validate({"name": "import", "priority": "2"})
    print(job.model_dump())
    try:
        StrictInput.model_validate({"count": "2"})
    except ValidationError:
        print("strict input rejected")
    print("name" in CreateJob.model_json_schema()["properties"])

if __name__ == "__main__":
    main()
```

```text title="api_models.out"
{'name': 'import', 'priority': 2}
strict input rejected
True
```

普通 priority 允许这里的字符串数字转换，strict count 拒绝。严格验证也不等于语义完整：名称长度合法仍可能只有空白，需再定义规范化与业务规则。

## 3. 序列化与部分更新

`model_dump` 产生 Python 数据，`model_dump_json` 产生 JSON 文本；日期、Decimal、Enum 等会有相应转换规则。签名、金额和时间精度不能依赖隐式格式猜测。

PATCH 场景需要区分字段未提供、显式 None 与具体值。`exclude_unset` 可以保留“没有输入”的语义，但仍要定义哪些字段允许清空。输入模型的默认值不应悄悄变成对数据库的覆盖操作。

## 4. 验证器与 OpenAPI

字段验证器适合字段规则，模型验证器适合跨字段关系。不要在普通模型验证中隐式调用网络或写数据库，让“构建一个对象”变成不可控 I/O。

OpenAPI 描述声明的接口，不能证明权限、事务或实际依赖健康。自定义 Response、手写错误和额外状态码仍需确保与文档一致，并通过契约测试验证。

## 5. 练习与答案

### 5.1 类型写 int，就必定拒绝字符串数字吗？

答案：不一定，默认模式可能转换。需要严格输入时显式配置 strict 并测试 JSON 与 Python 输入路径。

### 5.2 PATCH 省略 name 与 name 为 null 一样吗？

答案：通常不应混同。一个表示不修改，一个可能表示清空或非法输入；要通过字段集合与业务契约区分。

### 5.3 OpenAPI 有字段，证明服务端已经正确校验业务了吗？

答案：不能。它反映声明，业务状态、权限与数据库约束仍需要实现和测试。

## 6. 参考资料

- [Pydantic Models](https://pydantic.dev/docs/validation/latest/concepts/models/)
- [Strict Mode](https://pydantic.dev/docs/validation/latest/concepts/strict_mode/)
- [FastAPI Response Model](https://fastapi.tiangolo.com/tutorial/response-model/)
