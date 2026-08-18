---
title: "systemd-escape 命令详解：路径、实例与合法 unit 名转换"
sidebar_label: "09. systemd-escape 命令详解：路径、实例与合法 unit 名转换"
sidebar_position: 9
description: "完整讲解 systemd-escape 的 escape、unescape、mangle、path、suffix、template、instance 参数，理解路径 unit、模板实例、转义可逆边界和脚本安全。"
tags: [Linux, systemd-escape, systemd, unit name, template unit]
---

# systemd-escape 命令详解：路径、实例与合法 unit 名转换

unit 名只能使用受限字符，其他字节要写成 `\xHH`；路径转 unit 名还有 `/` 到 `-`、根路径和规范化规则。`systemd-escape` 实现与 systemd 相同的转换，避免脚本手写替换造成碰撞。

## 1. 基本语法

```text
systemd-escape [OPTIONS...] STRING...
```

```bash
systemd-escape 'hello world'
systemd-escape --path '/var/lib/my app'
systemd-escape --path --suffix=mount '/srv/data'
```

普通字符串转义和 path 转义不是同一算法。需要表达文件系统路径时必须 `--path`。

## 2. 全部参数

| 参数 | 含义 |
|---|---|
| `--suffix=SUFFIX` | 给结果追加 `.service/.mount/.slice` 等 suffix |
| `--template=TEMPLATE` | 把转义字符串插入 `name@.service` 的实例位置 |
| `-p, --path` | 把路径转换为 unit 名语义，规范化 `/`、`.`、`..` 等 |
| `-u, --unescape` | 反向解码转义 |
| `-m, --mangle` | 假设输入可能已转义，只转义必要部分 |
| `--instance` | `--unescape` 时只解码模板 unit 的 instance 部分 |
| `-h, --help` | 帮助 |
| `--version` | 版本 |

模式互斥关系和 suffix/template 组合由当前版本校验，脚本应让非法组合显式失败。

## 3. 路径与 mount unit

```bash
systemd-escape --path --suffix=mount /var/lib/app-data
# var-lib-app\x2ddata.mount

systemd-escape --path --unescape 'var-lib-app\x2ddata'
```

原路径中的 `-` 必须转义，否则会与 `/` 映射出的 `-` 混淆；这正是不能用 `sed 's#/#-#g'` 的原因。根 `/` 对应特殊的 `-.mount`。

## 4. 模板 unit 与 instance

```bash
systemd-escape --template=worker@.service 'tenant/a'
systemd-escape --unescape --instance 'worker@tenant-a.service'
```

在 unit 内：`%i` 是转义后的实例名，`%I` 是反转义实例；对于路径模板常结合 `%f`。反转义结果将进入文件路径或命令参数时必须重新做输入验证，不能因为来自合法 unit 名就视为安全。

## 5. `--escape`、`--mangle` 与 `--unescape`

escape 是默认：把原始字符串严格转换。mangle 面向“可能已有合法 suffix/转义”的输入，尽量保留已有结构，不适合用作安全规范化。unescape 能恢复编码内容，但路径规范化、某些输入映射和 mangle 处理不保证所有原始文本信息都可逆。

```bash
raw='tenant name/01'
escaped=$(systemd-escape -- "$raw") || exit
decoded=$(systemd-escape --unescape -- "$escaped") || exit
```

输入以 `-` 开头时使用 `--` 结束参数，避免被识别为选项。

## 6. 常见场景

| 场景 | 正确做法 |
|---|---|
| 从 mount path 得到 `.mount` 名 | `--path --suffix=mount` |
| 从任意租户 ID 得到实例名 | `--template=name@.service` |
| 解析模板 unit 的实例 | `--unescape --instance` |
| 可能已经是 unit 名的输入 | 明确需求后才用 `--mangle` |
| 仅想查看关联 mount | 也可用 `systemctl status /path` 让 systemctl 转换 |

## 7. 安全、退出码与实验

转义只保证名称语法，不提供授权、目录限制或 shell quoting。用户输入经 unescape 后可能含 `/`、空格或控制语义；用于路径时做 canonicalization 和允许目录检查，用作 argv 时不要拼进 shell。

实验覆盖：空格、连字符、中文、`@`、根路径、包含 `..` 的 path、模板实例和以 `-` 开头的字符串；验证 round trip，并把输出与 `systemctl status /path`、`systemd.unit` 规则对照。

掌握标准：能列出全部参数，区分普通/path/template 三种语义，解释 `-` 碰撞和 `%i/%I/%f`，且不会把名称转义误当作 shell/路径安全。

## 8. 官方参考 {/* #官方参考 */}

- [systemd-escape(1)](https://www.freedesktop.org/software/systemd/man/latest/systemd-escape.html)
- [systemd.unit(5) unit name escaping](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html#String%20Escaping%20for%20Inclusion%20in%20Unit%20Names)

上一篇：[`systemd-delta` 命令详解](./08-systemd-delta命令详解.md)

下一篇：[`systemd-notify` 命令详解](./10-systemd-notify命令详解.md)
