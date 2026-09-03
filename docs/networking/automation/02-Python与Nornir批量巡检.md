---
title: "Python 与 Nornir 批量巡检"
sidebar_label: "02. Python 与 Nornir 批量巡检"
sidebar_position: 2
description: "从结构化 Inventory、任务、结果、并发和异常处理开始，构建可测试的只读网络巡检器。"
tags: [Python, Nornir, YAML, Inventory, Network Automation]
---

# Python 与 Nornir 批量巡检

本篇用只读巡检学习网络自动化的基本工程结构。先把“采集正确、失败可控、结果可验证”做好，再考虑批量变更。

## 1. 不要把所有逻辑写进一个脚本

推荐拆分：

```text
network-audit/
├── config.yaml
├── inventory/
│   ├── hosts.yaml
│   ├── groups.yaml
│   └── defaults.yaml
├── audit/
│   ├── collectors.py
│   ├── parsers.py
│   ├── checks.py
│   └── report.py
├── tests/
│   ├── fixtures/
│   └── test_checks.py
└── main.py
```

- Collector 负责获取数据；
- Parser 把厂商输出转为统一结构；
- Check 只判断事实是否符合规则；
- Report 汇总证据；
- Test 使用固定样本验证逻辑。

## 2. Python 必备知识

至少掌握：

- `dict`、`list`、`set` 和推导式；
- 函数、模块、异常；
- `dataclass` 和类型提示；
- JSON/YAML 解析；
- 文件与日志；
- 虚拟环境和依赖锁定；
- `pytest` 单元测试；
- 超时、重试和并发的基本边界。

一个统一接口状态模型：

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class InterfaceState:
    device: str
    name: str
    admin_up: bool
    oper_up: bool
    description: str
    input_errors: int
    output_errors: int
```

检查函数不应依赖 CLI 原文：

```python
def interface_check(
    state: InterfaceState,
    error_delta: int | None,
    *,
    expected_admin_up: bool = True,
) -> str:
    if not expected_admin_up:
        return "SKIPPED"
    if not state.admin_up or not state.oper_up:
        return "VIOLATION"
    if error_delta is None:
        return "UNKNOWN"
    return "PASS" if error_delta == 0 else "VIOLATION"
```

示例使用 Python 3.10+ 类型写法。`expected_admin_up` 来自意图，不是从设备当前状态复制：只有意图明确允许该接口不工作，才跳过“在用接口健康”这一项；生产上联意外 Admin Down 应报告异常，不能伪装成维护豁免。

这里假设 `error_delta` 已由同一接口、同一计数周期的两个样本正确计算；缺少前样本、计数重置或接口身份改变时传入 `None`。这只是单项检查，意图与配置一致性还应另行检查。可用固定样本单独测试，不必每次连接设备。

## 3. Nornir 的角色

Nornir 是 Python 自动化框架，提供 Inventory、Task、Result、过滤和并发 Runner。它不替你决定网络意图，也不自动解决厂商解析差异。

示例 Inventory：

```yaml
# inventory/hosts.yaml
leaf01:
  hostname: 192.0.2.11
  platform: eos
  groups: [dc1_leaf]
  data:
    role: leaf
    site: dc1
    maintenance: false

leaf02:
  hostname: 192.0.2.12
  platform: eos
  groups: [dc1_leaf]
  data:
    role: leaf
    site: dc1
    maintenance: true
```

不要把真实密码写进 YAML。通过环境注入的 Secret 引用或专用凭据系统加载。

## 4. 任务、子任务和结果

示意代码：

```python
from nornir import InitNornir
from nornir.core.task import Result, Task
from nornir_netmiko.tasks import netmiko_send_command

def collect_bgp(task: Task) -> Result:
    response = task.run(
        task=netmiko_send_command,
        command_string="show bgp summary",
        use_textfsm=True,
    )
    return Result(
        host=task.host,
        result=response.result,
        changed=False,
    )

nr = InitNornir(config_file="config.yaml")
targets = nr.filter(role="leaf", site="dc1")
results = targets.run(task=collect_bgp)
```

生产代码还需处理：

- 解析器没有命中模板；
- 设备返回错误文本但 SSH 本身成功；
- 子任务失败而父任务仍返回；
- 部分设备超时；
- 同一个平台不同版本字段变化；
- 输出过大和敏感字段脱敏。

## 5. 并发不是越大越好

### 5.1 Runner 并行的是主机任务，不是所有语句

典型 ThreadedRunner 可以并行处理多个 host；单个 host 的组合任务中，普通 `task.run` 子任务按调用顺序执行。线程数不会自动把同一设备里的每条 CLI 都同时运行。

返回结构要沿层级读取：`AggregatedResult[主机名]` 是该主机的 `MultiResult`，其中保存父任务及子任务 `Result`；既要看聚合 failed，也要保留实际异常的子任务、exception 和原始输出。只打印最外层 result 字符串会丢失失败位置。见 [Nornir 结果模型](https://nornir.readthedocs.io/en/latest/tutorial/task_results.html)。

### 5.2 并发上限不等于每秒请求上限

并发上限同时受以下约束：

- 自动化节点 CPU、内存和文件描述符；
- 堡垒机/AAA 会话限制；
- 设备管理平面能力；
- WAN 时延和丢包；
- 任务本身是否读取大表；
- 厂商 API 的速率限制。

从小批量测基线，逐步增加。对控制平面敏感命令设置更低并发，避免“巡检本身导致设备 CPU 升高”。

若平均一台采集 2 秒、20 个 worker 且没有其他瓶颈，稳态吞吐约为 10 台/秒，不是 20 台/秒。若每台再发 5 条命令，设备请求量还需按任务内容计算。连接池、AAA 限流和大表解析都可能改变这个估算。

连接超时、单命令读取超时和整台任务截止时间分别覆盖不同等待阶段。外层等待超时也不一定终止底层阻塞线程；应让连接插件设置自己的有界超时，并在后续步骤检查截止时间。

## 6. 正确处理异常

结果要区分：

```text
PASS          检查执行并符合规则
VIOLATION     检查执行成功，但发现异常
COLLECT_ERROR 无法采集
PARSE_ERROR   已采集但无法结构化
UNKNOWN       数据不完整或计数不连续，无法判定该项
SKIPPED       维护状态或不适用
```

`COLLECT_ERROR` 不能被统计为健康，也不能因为整批有一台失败就丢掉其他结果。

Nornir 默认会记录失败主机，后续顶层任务可能跳过它们。`on_failed`、`recover_host` 或重置失败集合会改变后续资格，但不证明设备真的恢复。采集 BGP 失败后，希望继续独立采集 NTP，就要明确异常隔离策略；不能把跳过的 NTP 当成成功。见 [失败任务处理](https://nornir.readthedocs.io/en/latest/tutorial/failed_tasks.html)。

解析成功也不等于事实完整：空列表可能表示确实没有邻居，也可能是模板未覆盖当前版本。把模板未命中的原始字符串当成空结果，会将 PARSE_ERROR 错报为“邻居数量为零”。输出类型、必需字段、解析器版本和设备型号应一同校验。

示意汇总：

```python
summary = {
    "pass": [],
    "violation": [],
    "collect_error": [],
    "parse_error": [],
    "unknown": [],
    "skipped": [],
}
```

## 7. 做一个真实巡检项目

检查内容：

1. 所有生产上联 Admin/Oper 都为 Up；
2. BGP 邻居符合 Inventory 中的期望数量；
3. NTP 同步且偏差在阈值内；
4. CPU、内存和温度不超过阈值；
5. 配置最近变更者和变更时间可追踪；
6. 接口错误计数比较“增量”，而非只看累计值；
7. 处于维护中的设备标记 SKIPPED。

输出 JSON：

```json
{
  "run_id": "audit-20260807-001",
  "started_at": "2026-08-07T10:00:00+08:00",
  "device": "leaf01",
  "check": "bgp_neighbors",
  "status": "PASS",
  "expected": 4,
  "actual": 4,
  "evidence": "structured-result/bgp/leaf01.json"
}
```

## 8. 测试策略

- Parser 测试：用设备输出样本验证结构化结果；
- Rule 测试：边界值、空数据、异常状态；
- Inventory 测试：地址唯一、角色合法、必填字段完整；
- 集成测试：只连接实验设备；
- 回归测试：每次支持新设备版本时保留样本。

错误输出也要作为 Fixture，否则异常路径永远没有被测试。

### 8.1 巡检项目参考判定

| 输入 | 合理输出 |
| --- | --- |
| 20 台中 3 台连接超时 | 17 台保留结果，3 台 COLLECT_ERROR，不能报全网健康 |
| 预期 4 个邻居，实际获取完整列表只有 3 个 | VIOLATION，并保存缺失邻居身份 |
| CLI 正常返回但解析模板未命中 | PARSE_ERROR，不把文本长度当邻居数 |
| 历史错误为 100，本周期仍为 100 | 增量为 0，不因累计值非零直接判当前劣化 |
| 计数从 100 变 5，同时设备重启 | 标记不连续，不计算负速率 |
| 接口符合维护豁免 | SKIPPED，注明原因，不混入 PASS 分母 |

报告至少同时给出检查覆盖率和已完成样本中的异常率。17 个已采集全正常不等于 20 台全部正常。计数连续性还可参考[网络遥测](./07-网络可观测性与Telemetry.md)。

## 9. 掌握标准

你应能写出一个巡检器，满足：

- 20 台设备中 3 台不可达，17 台结果仍完整；
- 每台有超时和独立错误；
- 不同厂商先归一化再判断；
- 并发可配置；
- 密码不出现在代码、Inventory 和日志；
- 核心检查有单元测试；
- 报告能让值班人员直接找到证据。

### 9.1 思考与解答

**changed=False 就是巡检成功吗？**

不是，它只描述是否报告变更，仍须看 failed、exception、数据有效性和检查结果。

**为什么第二次顶层任务没有某台设备的结果？**

它可能已被记入 failed hosts、被过滤或不适用；应记录跳过原因，而不是假定健康。

**20 个 worker 就是每秒 20 台吗？**

不是，吞吐还取决于每台耗时和共享资源限制。并发和速率是不同量。

**空邻居列表应当 PASS 还是 VIOLATION？**

先确认采集与解析完整，再与预期比较。若设备本来不应有邻居，可不适用；预期有邻居才是违规，解析失败则是另一种错误。

## 10. 参考资料 {/* #参考资料 */}

- [Nornir 官方文档](https://nornir.readthedocs.io/en/latest/)
- [Python logging 文档](https://docs.python.org/3/library/logging.html)
- [pytest 官方文档](https://docs.pytest.org/)
