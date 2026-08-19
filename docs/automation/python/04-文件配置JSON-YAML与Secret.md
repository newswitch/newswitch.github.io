---
title: "Python 文件、配置、JSON、YAML 与 Secret"
sidebar_label: "04. 文件、配置与 Secret"
sidebar_position: 4
description: "安全处理路径、编码、临时文件、原子替换、JSON/YAML Schema、配置优先级和敏感数据生命周期。"
tags: [Python, pathlib, JSON, YAML, Config, Secret]
---

# Python 文件、配置、JSON、YAML 与 Secret

配置是自动化工具的输入协议。读取成功不代表配置正确；解析成功也不代表目标、安全边界和字段组合有效。

## 1. 使用 pathlib

```python
from pathlib import Path

config_path = Path("/etc/ops-audit/config.json")
raw = config_path.read_text(encoding="utf-8")
```

路径来自外部输入时，解析并验证允许根：

```python
allowed_root = Path("/var/lib/ops-audit").resolve(strict=True)
requested = Path(user_path).resolve(strict=False)

if requested != allowed_root and allowed_root not in requested.parents:
    raise ValueError("path outside allowed root")
```

随后仍要考虑符号链接竞争、Owner、Mode 和挂载边界。高权限写入最好由受限组件完成。

## 2. 编码和换行

始终显式编码：

```python
text = path.read_text(encoding="utf-8")
path.write_text(text, encoding="utf-8", newline="\n")
```

二进制内容使用 `read_bytes()`/`write_bytes()`。不要用文本接口处理证书、压缩包和模型文件。

## 3. JSON

```python
import json

data = json.loads(raw)
if not isinstance(data, dict):
    raise ValueError("top-level config must be an object")
```

写出稳定格式：

```python
payload = json.dumps(
    result,
    ensure_ascii=False,
    sort_keys=True,
    separators=(",", ":"),
)
```

是否需要紧凑或可读格式取决于接口；Hash 和签名场景还需要定义规范化方法，不能假设普通 JSON Dump 天然唯一。

## 4. YAML

YAML 功能比 JSON 更复杂。使用维护中的解析库并选择安全加载接口，不加载不可信对象构造标签。解析后同样执行 Schema 和业务校验。

注意：不同 YAML 版本、隐式类型和重复 Key 处理可能不同。对机器接口优先选择语义更窄的 JSON；对人工配置则固定解析器、版本和测试样例。

## 5. Schema 与业务校验

```text
语法解析
→ 类型和必需字段
→ 枚举、范围、格式
→ 跨字段约束
→ 权限和目标范围
→ 外部引用是否存在
```

例如 `environment=production` 与 `dry_run=false` 的组合可能要求额外审批，不能只检查两个字段各自合法。

## 6. 配置优先级

推荐：

```text
代码中的安全默认值
< 配置文件
< 环境变量
< CLI 参数
```

最终生成不可变配置对象，并在启动日志中输出“来源与非敏感摘要”，不要输出 Secret 值。

## 7. 原子写入

```python
import os
import tempfile
from pathlib import Path

def atomic_write_text(target: Path, content: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{target.name}.", dir=target.parent)
    temp_path = Path(temporary)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_path, target)
    except BaseException:
        temp_path.unlink(missing_ok=True)
        raise
```

同目录临时文件使最终 Replace 位于同一文件系统。生产实现还要处理 Mode、Owner、目录持久化、SELinux/ACL、多文件事务和备份。

## 8. Secret

Secret 不应进入：

- Git 和默认配置。
- CLI 参数和进程列表。
- 日志、异常、Trace 和指标 Label。
- 测试快照和证据包。
- 长期临时文件。

配置对象可保存 Secret 引用，由运行时使用短期身份获取。`repr=False` 只能减少意外显示，不能让内存中的值变安全：

```python
from dataclasses import dataclass, field

@dataclass(frozen=True)
class Credentials:
    token: str = field(repr=False)
```

## 9. 文件故障测试

- 非 UTF-8 或截断文件。
- JSON/YAML 类型错误和重复字段。
- 目录不可写、磁盘满、只读文件系统。
- Replace 前进程中断。
- 符号链接和路径逃逸。
- Secret 脱敏是否覆盖异常路径。
