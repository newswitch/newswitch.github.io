---
title: "Python CLI 与可测试命令行工程"
sidebar_label: "01. Python CLI 与可测试命令行工程"
sidebar_position: 1
tags: [Python, CLI, argparse, 测试, 自动化, SRE]
description: "从命令边界、配置优先级、退出码、依赖注入、结构化输出、超时重试和安全性出发，构建可测试的生产级 Python CLI。"
---

# Python CLI 与可测试命令行工程

一个运维脚本通常从几十行开始，随后不断增加集群参数、并发、重试、JSON 输出和修复动作。
如果没有明确边界，它很快会变成：

```text
解析参数、读环境变量、创建客户端、执行业务、打印日志、退出进程
全部写在 main() 里
```

结果是无法单测、无法复用、错误码混乱，也很难证明生产执行安全。
本篇以只读 `ai-diag` 为例，建立一套可以继续扩展的 CLI 结构。

## 1. CLI 是一个稳定接口

命令行也有消费者：

- 人。
- Shell。
- CI/CD。
- Runbook 平台。
- 其他程序。

因此以下内容都是接口契约：

```text
命令和参数名称
默认值
配置优先级
stdout / stderr
退出码
JSON 字段和类型
排序规则
超时语义
是否产生副作用
```

随意改变 JSON 字段名，和随意改变 HTTP API 一样会破坏调用方。

## 2. 项目结构

```text
ai-diag/
├── pyproject.toml
├── src/
│   └── ai_diag/
│       ├── __init__.py
│       ├── __main__.py
│       ├── cli.py
│       ├── config.py
│       ├── models.py
│       ├── service.py
│       ├── renderers.py
│       └── clients/
│           ├── kubernetes.py
│           └── prometheus.py
└── tests/
    ├── test_cli.py
    ├── test_config.py
    └── test_service.py
```

职责：

| 文件 | 职责 |
| --- | --- |
| `cli.py` | 解析参数，把输入转换为领域配置 |
| `config.py` | 合并 CLI、环境变量、配置文件和默认值 |
| `models.py` | 定义稳定输入与输出对象 |
| `service.py` | 编排业务，不直接解析参数或退出进程 |
| `clients/` | 封装外部 API 和错误分类 |
| `renderers.py` | JSON、文本等输出格式 |
| `__main__.py` | 调用 `main()`，保持极薄 |

## 3. 配置优先级

建议固定为：

```text
CLI 显式参数
  > 环境变量
  > 配置文件
  > 程序默认值
```

必须区分“用户没有提供”和“用户明确提供空值/false”。`argparse` 参数可使用 `default=None`，
合并阶段再应用默认值。

```python
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import os


@dataclass(frozen=True)
class Settings:
    cluster: str
    namespace: str
    timeout_seconds: float
    output: str
    evidence_dir: Path


def first_defined(*values):
    return next((value for value in values if value is not None), None)


def build_settings(args, file_config: dict) -> Settings:
    cluster = first_defined(
        args.cluster,
        os.getenv("AI_DIAG_CLUSTER"),
        file_config.get("cluster"),
        "current",
    )
    namespace = first_defined(
        args.namespace,
        os.getenv("AI_DIAG_NAMESPACE"),
        file_config.get("namespace"),
        "default",
    )
    timeout = float(first_defined(
        args.timeout,
        os.getenv("AI_DIAG_TIMEOUT"),
        file_config.get("timeout_seconds"),
        10,
    ))

    if not 0 < timeout <= 300:
        raise ValueError("timeout 必须在 (0, 300] 秒内")

    return Settings(
        cluster=cluster,
        namespace=namespace,
        timeout_seconds=timeout,
        output=first_defined(args.output, file_config.get("output"), "text"),
        evidence_dir=Path(first_defined(
            args.evidence_dir,
            file_config.get("evidence_dir"),
            "./evidence",
        )),
    )
```

生产注意：

- 不要把 Token、Password 当普通 CLI 参数；进程列表和 Shell History 可能泄露。
- Secret 使用短期身份、文件描述符、受限权限文件或工作负载身份。
- 输出最终生效配置时，Secret 字段必须脱敏。
- 配置文件需要 Schema 校验；未知字段最好报错，不要静默忽略拼写错误。

## 4. 子命令设计

```text
ai-diag inspect pod ...
ai-diag inspect node ...
ai-diag prom query ...
ai-diag collect incident ...
ai-diag version
```

动词和对象保持稳定，不要出现：

```text
ai-diag do
ai-diag run-task
ai-diag execute
```

这些名称无法表达副作用。

一个最小解析器：

```python
import argparse


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ai-diag",
        description="AI Infra 只读诊断工具",
    )
    parser.add_argument("--cluster")
    parser.add_argument("--namespace")
    parser.add_argument("--timeout", type=float)
    parser.add_argument("--output", choices=("text", "json"), default="text")
    parser.add_argument("--evidence-dir")

    commands = parser.add_subparsers(dest="command", required=True)

    inspect_cmd = commands.add_parser("inspect", help="检查 Kubernetes 对象")
    inspect_sub = inspect_cmd.add_subparsers(dest="resource", required=True)

    pod_cmd = inspect_sub.add_parser("pod")
    pod_cmd.add_argument("name")
    pod_cmd.add_argument("--since", default="30m")

    prom_cmd = commands.add_parser("prom", help="查询 Prometheus")
    prom_sub = prom_cmd.add_subparsers(dest="prom_command", required=True)
    query_cmd = prom_sub.add_parser("query")
    query_cmd.add_argument("expression")
    query_cmd.add_argument("--at")

    commands.add_parser("version")
    return parser
```

## 5. `main()` 不承载业务

错误做法：

```python
def main():
    args = parser.parse_args()
    client = create_real_client()
    # 之后 300 行业务逻辑
    sys.exit(1)
```

可测试做法：

```python
from collections.abc import Sequence
import json
import sys


EXIT_OK = 0
EXIT_USAGE = 2
EXIT_PARTIAL = 3
EXIT_REMOTE = 4
EXIT_PERMISSION = 5
EXIT_INTERNAL = 10


def run(argv: Sequence[str], service_factory, stdout, stderr) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(list(argv))
        settings = build_settings(args, file_config={})
        service = service_factory(settings)
        result = service.execute(args)

        if args.output == "json":
            print(json.dumps(result.to_dict(), ensure_ascii=False), file=stdout)
        else:
            print(result.to_text(), file=stdout)

        return EXIT_PARTIAL if result.partial else EXIT_OK
    except PermissionError as exc:
        print(f"权限不足: {exc}", file=stderr)
        return EXIT_PERMISSION
    except RemoteAPIError as exc:
        print(f"远端 API 失败: {exc}", file=stderr)
        return EXIT_REMOTE
    except ValueError as exc:
        print(f"参数或配置错误: {exc}", file=stderr)
        return EXIT_USAGE
    except Exception as exc:
        print(f"内部错误: {type(exc).__name__}", file=stderr)
        return EXIT_INTERNAL


def main() -> int:
    return run(
        argv=sys.argv[1:],
        service_factory=create_service,
        stdout=sys.stdout,
        stderr=sys.stderr,
    )
```

`__main__.py`：

```python
from .cli import main

raise SystemExit(main())
```

这样测试可以直接调用 `run()`，不需要启动子进程。

## 6. 退出码设计

| 退出码 | 语义 | 调用方动作 |
| ---: | --- | --- |
| 0 | 完整成功 | 继续 |
| 2 | 参数/配置错误 | 修正调用 |
| 3 | 部分数据源失败，报告仍可用 | 标记不完整并决定是否继续 |
| 4 | 远端 API 临时或永久失败 | 查看错误分类 |
| 5 | 权限不足 | 修正 RBAC/身份 |
| 10 | 未预期内部错误 | 提交缺陷并保留诊断 ID |

不要把“发现对象异常”总是当程序执行失败：

```text
命令成功完成检查，发现 Pod NotReady
```

这可以是退出码 0 + 结构化 `findings`，也可由专门的 `--fail-on finding` 策略控制。
程序错误与被检查系统异常是不同维度。

## 7. stdout、stderr 和日志

规则：

- `stdout`：最终结果，可被管道消费。
- `stderr`：进度、警告、错误和调试日志。
- JSON 模式下，`stdout` 只能有一个合法 JSON 文档或 JSON Lines。
- 不把彩色进度条混进 JSON。
- 日志时间使用带时区的 RFC 3339。
- 每次执行生成 `run_id`，用于关联日志、Trace 和证据包。

建议 JSON 外壳：

```json
{
  "schema_version": "1.0",
  "tool_version": "0.4.0",
  "run_id": "01J...",
  "started_at": "2026-08-07T08:00:00Z",
  "finished_at": "2026-08-07T08:00:03Z",
  "target": {
    "cluster": "prod-a",
    "namespace": "ai-serving"
  },
  "partial": false,
  "errors": [],
  "findings": []
}
```

## 8. 超时、重试和幂等

每次外部调用都要有超时。整个命令还需要总预算：

```text
命令总超时 30s
├── Kubernetes 10s
├── Prometheus 8s
├── 日志 8s
└── 汇总与落盘 4s
```

不要让每个子调用各自最多 30 秒，导致总执行时间无法预测。

重试只适合：

- 连接复位、临时 DNS、网关 502/503/504。
- 明确可重试的 429，并尊重 `Retry-After`。
- 幂等 GET/LIST，或带服务端幂等键的写操作。

不应自动重试：

- 401/403。
- 参数错误。
- Schema 不兼容。
- 未知结果的非幂等写操作。

退避：

```text
delay = min(cap, base × 2^attempt) + random_jitter
```

必须有最大次数和总 deadline。

## 9. 默认只读、Dry Run 与确认

一个诊断工具默认：

```text
允许：get/list/watch/log/query
禁止：delete/patch/update/create
```

若后续加入动作：

```text
ai-diag plan cordon node-17
ai-diag apply plan.json --approval-token ...
```

不要把读和写隐藏在同一 `inspect` 命令里。写操作至少需要：

- 明确动作名称。
- 目标 UID，而非只用可复用名称。
- 前置条件。
- 影响范围。
- Dry Run 结果。
- 审批。
- 幂等键。
- 验证和回滚。

## 10. 依赖注入与测试替身

业务层依赖协议，不依赖具体 SDK：

```python
from typing import Protocol


class ClusterReader(Protocol):
    def get_pod(self, namespace: str, name: str) -> dict: ...
    def list_events(self, namespace: str, uid: str) -> list[dict]: ...


class MetricsReader(Protocol):
    def instant_query(self, promql: str, at: float | None) -> list[dict]: ...


class DiagnosticService:
    def __init__(
        self,
        cluster: ClusterReader,
        metrics: MetricsReader,
    ):
        self.cluster = cluster
        self.metrics = metrics

    def inspect_pod(self, namespace: str, name: str):
        pod = self.cluster.get_pod(namespace, name)
        events = self.cluster.list_events(namespace, pod["uid"])
        metrics = self.metrics.instant_query(
            f'up{{pod="{name}",namespace="{namespace}"}}',
            at=None,
        )
        return build_report(pod, events, metrics)
```

测试替身：

```python
class FakeCluster:
    def get_pod(self, namespace, name):
        return {"uid": "u-1", "name": name, "ready": False}

    def list_events(self, namespace, uid):
        return [{"reason": "FailedMount"}]


def test_not_ready_pod_contains_mount_finding():
    service = DiagnosticService(FakeCluster(), FakeMetrics())
    report = service.inspect_pod("test", "model-0")
    assert any(item.code == "POD_FAILED_MOUNT" for item in report.findings)
```

测试应覆盖：

- 无对象。
- 无权限。
- API 超时。
- 429 和有限重试。
- 一个数据源失败但另一个成功。
- Unicode 名称和空结果。
- JSON Schema 稳定。
- stdout 不混入日志。
- Secret 不出现在异常字符串。

## 11. 临时文件与证据包安全

- 使用系统安全临时目录。
- 创建文件时限制权限。
- 文件名不直接拼接用户输入，防止路径穿越。
- 不用 `shell=True` 拼接命令。
- Kubernetes 日志、环境变量和对象注解可能包含 Secret，落盘前脱敏。
- 压缩包使用相对路径白名单，防止 Zip Slip。
- 为每个文件和总清单计算 SHA-256。
- 写入先落临时文件，再原子重命名。
- 设置保留时间，到期安全清理。

## 12. 发布与兼容性

版本至少包含：

```text
tool_version
git_commit
build_time
python_version
dependency_lock_digest
output_schema_version
```

发布前：

```bash
python -m unittest
python -m compileall src
python -m ai_diag --help
python -m ai_diag version
```

如果使用额外依赖，还应固定锁文件并做依赖漏洞与许可证检查。

## 13. 实验任务

1. 创建 `inspect pod` 子命令，只使用假数据。
2. 实现 text 和 JSON 两种 Renderer。
3. 固定 0、2、3、4、5、10 退出码并写测试。
4. 注入 Kubernetes 与 Prometheus 客户端。
5. 模拟 Prometheus 超时，输出 `partial=true`，保留 Kubernetes 结果。
6. 为配置优先级写参数化测试。
7. 检查 JSON 模式的 stdout 没有任何日志。
8. 生成带清单和 SHA-256 的证据目录。

## 14. 验收清单

- [ ] `main()` 很薄，业务逻辑不调用 `sys.exit()`。
- [ ] 配置优先级和未知字段处理明确。
- [ ] stdout/stderr 有严格边界。
- [ ] JSON 有独立 Schema Version。
- [ ] 退出码可预测。
- [ ] 所有远端调用有 deadline。
- [ ] 重试只针对可重试且幂等的操作。
- [ ] 默认只读，写操作有独立命令和审批。
- [ ] 业务层通过 Protocol/接口依赖客户端。
- [ ] 测试包含超时、权限、部分失败和脱敏。
- [ ] 证据文件有安全路径、最小权限和校验和。

## 15. 参考资料

- [Python argparse](https://docs.python.org/3/library/argparse.html)
- [Python dataclasses](https://docs.python.org/3/library/dataclasses.html)
- [Python unittest](https://docs.python.org/3/library/unittest.html)
- [Python logging](https://docs.python.org/3/library/logging.html)
- [Python tempfile](https://docs.python.org/3/library/tempfile.html)

