---
title: "pytest、Fixture、Mock、契约与异步测试"
sidebar_label: "02. pytest、Fixture、Mock、契约与异步测试"
sidebar_position: 2
description: "按规则、适配器、集成与入口分层验证，理解测试隔离、替身能力及异步生命周期。"
tags: [Python, CPython, 工程实践]
---

# pytest、Fixture、Mock、契约与异步测试

测试不是证明“代码从来不会错”，而是在明确输入、环境与断言下提供可重复证据。最有价值的断言通常同时检查正常结果、失败语义和状态没有被错误改变。

## 1. 测试分层

纯规则测试不接网络与数据库；适配器测试检查协议、超时和映射；集成测试使用真实依赖；入口测试验证安装产物与进程行为。Mock 可以缩小范围，不能把被替换的系统也宣称验证过。

本系列使用 pytest 9.1.1。测试应有清楚的 arrange、act、assert，并限制线程、时间和临时目录，不访问现有生产资源。

## 2. 参数化与资源隔离

```python title="test_contract.py"
import pytest

def parse_port(text):
    port = int(text)
    if not 1 <= port <= 65535:
        raise ValueError("invalid port")
    return port

@pytest.mark.parametrize("text,expected", [("1", 1), ("8000", 8000)])
def test_valid_port(text, expected):
    assert parse_port(text) == expected

@pytest.mark.parametrize("text", ["0", "65536", "bad"])
def test_invalid_port(text):
    with pytest.raises(ValueError):
        parse_port(text)

def test_file_isolated(tmp_path):
    target = tmp_path / "state.txt"
    target.write_text("ready", encoding="utf-8")
    assert target.read_text(encoding="utf-8") == "ready"
```

使用 `python -m pytest -q test_contract.py` 运行，共 6 个参数化测试用例。tmp_path 为测试提供独立目录；不要把固定 `/tmp/state` 或用户真实配置当成测试夹具。

## 3. Fixture 与 Mock 的边界

Fixture 管理准备与清理，scope 决定共享多久。session 级可变 Fixture 可能使测试依赖执行顺序；yield 后清理也要覆盖中途失败。

Mock 应在代码实际查找符号的位置替换。只断言“调用过一次”往往不足，还要验证参数、结果、失败后的状态与重试次数。过度 Mock 可能让真实驱动签名变化无法暴露。

环境变量与时钟通过注入或 monkeypatch 控制，测试结束恢复；不要污染整个后续测试进程。

## 4. 异步测试

异步测试需要与所用 pytest 插件/AnyIO 后端匹配。HTTPX ASGITransport 验证应用调用，但通常不会自动替你执行全部 lifespan，需要显式管理。

后台任务、连接池和线程应在测试结束前关闭；“测试函数已经返回”不表示它创建的工作已经结束。时间断言优先用事件与可控时钟，避免依赖毫秒级 sleep 推测顺序。

### 4.1 运行真正的异步与替身测试

安装深化依赖后，从 advanced-lab 执行 `python -m pytest -q test_deepening.py test_study_tasks.py`。AnyIO 插件选择 asyncio 后端，测试中的 async def 才会被正确等待；不安装相应插件而只写异步测试，不能获得相同执行语义。

AsyncMock 分别模拟成功与 TimeoutError，断言 await_count 和最后调用参数。mock.called 只说明创建过一次调用，不能证明异步结果被 await。替换业务实际查找符号的位置，也不要把模拟驱动的成功当成真实 SQL 已提交。

资源测试使用 yield Fixture，在退出路径关闭 Engine、文件或任务。取消测试先等待 opened Event，再 cancel 并 await，最后断言 cleaned；这样检查生命周期，而不是在一个 sleep 之后猜测清理已经发生。

把 monkeypatch 用于环境与时钟，tmp_path 用于文件，参数化用于边界组合。测试若只有返回值断言，容易漏掉失败后文件被截断、重试次数无界或租约仍持有；结果、状态、副作用和资源都应按契约检查。

## 5. 练习与答案

### 5.1 Mock 数据库返回正确结果，是否验证了 SQL 与事务？

答案：没有。它主要验证调用方逻辑；SQL、约束、隔离和驱动需要真实数据库层测试。

### 5.2 Fixture scope 越大越好吗？

答案：不是。共享可变状态会降低隔离，可能使测试顺序敏感。只对昂贵且可安全复用的资源扩大作用域。

### 5.3 异步测试通过，为什么退出时还有 pending Task 警告？

答案：创建的任务未被正确观察和关闭。测试应负责其资源生命周期，而不是忽略退出警告。

## 6. 参考资料

- [pytest Fixture](https://docs.pytest.org/en/stable/how-to/fixtures.html)
- [pytest 参数化](https://docs.pytest.org/en/stable/how-to/parametrize.html)
- [AnyIO 测试](https://anyio.readthedocs.io/en/stable/testing.html)
