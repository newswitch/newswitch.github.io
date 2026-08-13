---
title: Python 与 Nornir 批量巡检
sidebar_position: 2
tags: [Python, Nornir, YAML, Inventory, Network Automation]
description: 从结构化 Inventory、任务、结果、并发和异常处理开始，构建可测试的只读网络巡检器。
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
def interface_is_healthy(state: InterfaceState) -> bool:
    if not state.admin_up:
        return True
    return state.oper_up and state.input_errors == 0
```

这样可以用单元测试验证，不需要每次连接真实设备。

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

并发上限同时受以下约束：

- 自动化节点 CPU、内存和文件描述符；
- 堡垒机/AAA 会话限制；
- 设备管理平面能力；
- WAN 时延和丢包；
- 任务本身是否读取大表；
- 厂商 API 的速率限制。

从小批量测基线，逐步增加。对控制平面敏感命令设置更低并发，避免“巡检本身导致设备 CPU 升高”。

## 6. 正确处理异常

结果要区分：

```text
PASS          检查执行并符合规则
VIOLATION     检查执行成功，但发现异常
COLLECT_ERROR 无法采集
PARSE_ERROR   已采集但无法结构化
SKIPPED       维护状态或不适用
```

`COLLECT_ERROR` 不能被统计为健康，也不能因为整批有一台失败就丢掉其他结果。

示意汇总：

```python
summary = {
    "pass": [],
    "violation": [],
    "collect_error": [],
    "parse_error": [],
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

## 9. 掌握标准

你应能写出一个巡检器，满足：

- 20 台设备中 3 台不可达，17 台结果仍完整；
- 每台有超时和独立错误；
- 不同厂商先归一化再判断；
- 并发可配置；
- 密码不出现在代码、Inventory 和日志；
- 核心检查有单元测试；
- 报告能让值班人员直接找到证据。

## 参考资料

- [Nornir 官方文档](https://nornir.readthedocs.io/en/latest/)
- [Python logging 文档](https://docs.python.org/3/library/logging.html)
- [pytest 官方文档](https://docs.pytest.org/)
