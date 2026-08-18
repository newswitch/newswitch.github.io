---
title: "systemd-delta 命令详解：发现覆盖、drop-in 与配置漂移"
sidebar_label: "08. systemd-delta 命令详解：发现覆盖、drop-in 与配置漂移"
sidebar_position: 8
description: "完整讲解 systemd-delta 的 masked、equivalent、redirected、overridden、extended、unchanged 类型与全部参数，用于升级审计、配置漂移和故障定位。"
tags: [Linux, systemd-delta, systemd, 配置漂移, drop-in, 故障排查]
---

# systemd-delta 命令详解：发现覆盖、drop-in 与配置漂移

systemd 从 `/usr/lib`、`/run`、`/etc` 等多级目录加载 unit 和其他配置。同名高优先级文件、symlink 或 drop-in 会改变 vendor 默认。`systemd-delta` 找出这些差异，是升级前后和“另一台机器正常”排障的重要入口。

## 1. 语法与默认范围

```text
systemd-delta [OPTIONS...] [PREFIX[/SUFFIX]...]
```

无参数会扫描 systemd 已知配置层级中的本地覆盖；可用 prefix/suffix 限定，例如：

```bash
systemd-delta
systemd-delta systemd/system
systemd-delta systemd/system/sshd.service
systemd-delta /etc/systemd/system /usr/lib/systemd/system
```

输出是“存在层级差异”，不自动判断本地修改是错误还是合理策略。

## 2. 六种差异类型

| 类型 | 含义 | 典型场景 |
|---|---|---|
| `masked` | 高优先级文件链接到 `/dev/null` | unit 被 mask，任何激活通常都被阻止 |
| `equivalent` | 高低优先级文件内容等价 | 可能是遗留拷贝，仍会遮挡未来 vendor 更新 |
| `redirected` | 高优先级文件 symlink 到其他目标 | 别名、重定向或定制路径 |
| `overridden` | 高优先级完整文件覆盖 vendor 文件 | 本机复制修改，升级漂移风险最大 |
| `extended` | 存在 `*.d/*.conf` drop-in 扩展 | 推荐的局部覆盖方式，但仍需审计合并语义 |
| `unchanged` | 未被覆盖 | 通常只在显式请求该类型时显示 |

`equivalent` 不等于安全：今天相同的 `/etc` 副本会继续优先于明天升级后的 `/usr` 文件，使新修复不生效。

## 3. 全部参数

| 参数 | 含义 |
|---|---|
| `-t, --type=LIST` | 只显示指定差异类型，可逗号分隔 |
| `--diff=BOOL` | overridden 时是否显示文本 diff |
| `--no-pager` | 禁用 pager |
| `-h, --help` | 帮助 |
| `--version` | 版本 |

```bash
systemd-delta --type=masked,overridden,extended --diff=yes --no-pager
```

diff 可能包含凭据路径、命令参数、环境值和内部地址，保存或提交工单前脱敏。

## 4. 与其他命令组合

```bash
systemd-delta systemd/system/api.service
systemctl cat api.service
systemctl show api.service -p FragmentPath,DropInPaths,UnitFileState
systemd-analyze verify /etc/systemd/system/api.service
```

- `systemd-delta` 找层级差异。
- `systemctl cat` 按片段显示生效来源。
- `systemctl show` 给出 manager 已加载的路径。
- `systemd-analyze verify` 做语法/引用校验。
- `daemon-reload` 后 manager 才会重读磁盘变化。

## 5. 升级与配置漂移排查

```text
升级前保存 delta + package version
→ 升级后再次扫描
→ 检查 vendor 新增安全/兼容指令是否被完整 override 遮住
→ 将必要定制收敛为最小 drop-in
→ verify + daemon-reload + 业务验证
→ 保留回滚文件和变更记录
```

不要直接删除差异。先确认文件属于配置管理、软件包、本机管理员还是运行时工具；`/run` 差异重启后消失，`/etc` 持久；完整 override 可能为兼容旧业务而存在。

## 6. 非 unit 配置

工具也能发现 tmpfiles.d、sysctl.d、systemd 配置等遵循相似多目录优先级的覆盖。不同配置类型的合并/屏蔽规则并不完全一致，发现差异后必须阅读相应 `*.d(5)` 手册，不能套用 unit drop-in 规则。

## 7. 退出状态与自动化

命令成功返回 0，即使发现差异也不一定用非零表达“漂移不合规”。合规流水线应解析预期清单或明确类型/路径，而非仅依赖退出码；工具人类输出也可能随版本变化。

## 8. 实验与掌握标准

在 VM 对测试 unit 依次建立：等价副本、完整 override、drop-in 和 mask；观察六类输出及 `systemctl cat/show`，再用 `systemctl revert` 或手工清理测试文件、daemon-reload 并验证恢复。不要操作核心 unit。

掌握标准：能列出全部参数和六类差异，解释 `/etc`、`/run`、`/usr` 的优先级与持久性，识别完整覆盖遮挡升级，并形成可审计的最小 drop-in 治理流程。

## 9. 官方参考 {/* #官方参考 */}

- [systemd-delta(1)](https://www.freedesktop.org/software/systemd/man/latest/systemd-delta.html)
- [systemd.unit(5)](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html)

上一篇：[`coredumpctl` 命令详解](./07-coredumpctl命令详解.md)

下一篇：[`systemd-escape` 命令详解](./09-systemd-escape命令详解.md)
