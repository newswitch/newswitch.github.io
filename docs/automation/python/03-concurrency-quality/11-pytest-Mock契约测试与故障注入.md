---
title: "Python pytest、Mock、契约测试与故障注入"
sidebar_label: "11. pytest、Mock 与故障注入"
sidebar_position: 11
description: "使用 pytest、Fake、Mock、契约测试、临时资源、时间控制和故障注入验证自动化工具。"
tags: [Python, pytest, Mock, Contract Test, Fault Injection]
---

# Python pytest、Mock、契约测试与故障注入

自动化工具最需要测试的不是“成功返回一条记录”，而是下游超时、部分目标失败、分页中断、凭据过期和写入未知结果时的行为。

## 1. 分层测试

```text
纯函数单元测试
→ 应用服务 + Fake Port
→ Adapter 契约测试
→ 隔离环境集成测试
→ 故障注入
→ 测试环境端到端
```

测试数量应在底层更多、速度更快；端到端测试数量较少但覆盖真实边界。

## 2. 纯函数

```python
import pytest

@pytest.mark.parametrize(
    ("latency", "expected"),
    [
        (0.1, "ok"),
        (1.0, "degraded"),
        (5.0, "failed"),
    ],
)
def test_classify_latency(latency: float, expected: str) -> None:
    assert classify_latency(latency, warning=1.0, critical=5.0).value == expected
```

边界值要明确，例如等于阈值属于哪一档。

## 3. Fake 优先于大量 Mock

```python
class FakeProbe:
    def __init__(self, results: dict[str, CheckResult]) -> None:
        self.results = results
        self.calls: list[str] = []

    def probe(self, target: Target) -> CheckResult:
        self.calls.append(target.name)
        return self.results[target.name]
```

Fake 实现同一 Protocol，能测试服务层行为。Mock 更适合验证某个边界调用和异常，不应让测试与每个内部函数调用顺序强耦合。

## 4. Patch 正确位置

Patch 使用方模块中解析到的名称，而不是盲目 Patch 定义方。更稳妥的方法是依赖注入：把时钟、随机数、HTTP 客户端和文件系统边界传入服务。

```python
def run_with_deadline(clock: Clock, client: Client) -> Result:
    ...
```

这样无需修改全局模块状态。

## 5. 临时目录

```python
def test_atomic_output(tmp_path):
    target = tmp_path / "result.json"
    write_result(target, {"state": "ok"})
    assert target.read_text(encoding="utf-8") == '{"state":"ok"}'
```

测试目标包括权限、已存在文件、异常清理和同文件系统 Replace 语义。不同操作系统文件锁和 Rename 行为可能不同，需要目标平台集成测试。

## 6. HTTP 契约测试

适配器测试至少覆盖：

- URL、方法、Header 和参数编码。
- 认证刷新。
- 状态码映射。
- 分页 Cursor。
- 429 与 `Retry-After`。
- 响应 Schema 漂移。
- 超时未知结果。

Mock Server 只验证客户端假设；还需要针对真实服务版本的兼容测试，防止双方模拟都犯同一个错误。

## 7. 时间与重试

把 Clock 和 Sleeper 注入：

```python
class Sleeper(Protocol):
    def sleep(self, seconds: float) -> None: ...
```

测试无需真实等待，可以断言退避上限、最大次数、总 Deadline 和取消行为。

## 8. 并发测试

验证不变量而不是依赖任务完成顺序：

- 活动任务数从未超过上限。
- 每个输入恰好产生一个最终结果。
- 一个任务失败不会遗失已完成结果。
- 取消后不再提交新任务。
- 共享状态受保护或避免共享。
- 重试总量不超过预算。

使用超时保护测试本身，防止死锁让 CI 永久挂起。

## 9. 故障注入矩阵

| 故障 | 期望行为 |
| --- | --- |
| DNS、连接、TLS 和读取超时 | 分类清晰，满足条件才重试 |
| 认证过期 | 刷新一次或失败，不无限循环 |
| 429 | 限流并尊重预算 |
| 分页中途失败 | 报告不完整，不伪装成完整数据 |
| 一半 SSH 目标失败 | 返回部分失败和逐目标结果 |
| 磁盘满 | 不生成看似完整的证据包 |
| SIGTERM/取消 | 停止新任务并释放资源 |
| 回滚失败 | 状态标记为未知并升级人工响应 |

## 10. CI 测试矩阵

- 支持的 Python 版本。
- Linux 目标发行版；需要时包含 Windows。
- 最低和锁定依赖版本。
- 类型检查、格式、Lint 和测试。
- Wheel 构建与干净环境安装。
- 依赖、Secret 和制品扫描。

测试结果必须关联源码 Commit 和最终发布制品。
