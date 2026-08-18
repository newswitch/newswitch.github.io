---
title: "sestatus 命令详解：策略、模式、目录、boolean 与上下文总览"
sidebar_label: "02. sestatus 命令详解：策略、模式、目录、boolean 与上下文总览"
sidebar_position: 2
description: "完整讲解 sestatus 的 -v/-b 参数、当前与配置模式、策略名、MLS、deny_unknown、sestatus.conf、容器边界和诊断流程。"
tags: [Linux, sestatus, SELinux, policy, boolean, context]
---

# sestatus 命令详解：策略、模式、目录、boolean 与上下文总览

`sestatus` 比 `getenforce` 展示更多 SELinux 运行与配置状态：selinuxfs、policy root、loaded policy、当前/配置模式、MLS、deny_unknown、最大 policy version，还可列 boolean 和指定对象 context。

## 1. 语法与全部参数

```text
sestatus [-v] [-b]
```

| 参数 | 含义 |
|---|---|
| 无参数 | 状态摘要 |
| `-v` | 额外显示 `/etc/sestatus.conf` 中配置的文件/进程 context，并固定显示当前进程、init 与控制终端 context |
| `-b` | 显示全部 SELinux booleans 当前状态 |

该工具传统接口没有 GNU 风格长参数；以 SELinux/policycoreutils 3.11 为基线。

## 2. 逐字段解释

```bash
sestatus
```

| 字段 | 核心问题 |
|---|---|
| `SELinux status` | userspace 判断是否启用 |
| `SELinuxfs mount` | 内核 SELinux API 挂载在哪里 |
| `SELinux root directory` | policy/config 根目录 |
| `Loaded policy name` | 当前加载 targeted/mls 等哪套 policy |
| `Current mode` | enforcing/permissive |
| `Mode from config file` | 下次启动目标配置 |
| `Policy MLS status` | policy 是否支持 MLS |
| `Policy deny_unknown status` | 未知 class/permission 如何处理 |
| `Memory protection checking` | execmem/checkreqprot 等内存保护检查状态，版本相关 |
| `Max kernel policy version` | 内核支持的最大二进制 policy version |

当前 mode 与配置 mode 不同常由 `setenforce` 临时修改；loaded policy 与 `SELINUXTYPE=` 不同可能说明本次启动加载过程或配置发生变化。

## 3. `-v` 与 sestatus.conf

`/etc/sestatus.conf` 可列需要检查的文件和进程，例如关键 daemon/配置文件。`sestatus -v` 输出它们的 context，并对 symlink 同时观察目标。

```bash
sestatus -v
cat /etc/sestatus.conf
ps -eZ
ls -lZ /etc/passwd
```

这是抽样检查，不是全文件系统标签验证；大范围漂移用 `restorecon -nRv`、`fixfiles` 等受控流程。

## 4. `-b` 不替代 getsebool

```bash
sestatus -b
getsebool -a
```

两者都可列当前 boolean，但 `getsebool` 更适合查询明确名称；持久自定义还要看 `semanage boolean -l -C`。boolean 名称本身不说明安全影响，查看 policy man page 或 `semanage boolean -l` 描述。

## 5. 故障诊断

| 现象 | 下一步 |
|---|---|
| status disabled | 看 kernel cmdline、配置、启动日志；当前不能 setenforce 启用 |
| policy 未加载/名称异常 | `journalctl -b`、policy 文件、initramfs、磁盘/签名/版本 |
| current permissive/config enforcing | 查谁何时 setenforce、audit CONFIG_CHANGE |
| label 看似异常 | `matchpathcon`/`restorecon -n` 比较期望，不直接 chcon |
| boolean 改变 | 查 current/persistent、变更审计和业务必要性 |

## 6. 退出码与自动化

成功通常为 0，SELinux 状态/初始化失败返回非零；具体脚本不要解析对齐后的整表，优先读取 `/sys/fs/selinux/enforce`、libselinux API 或针对字段做严格匹配，并保留原始输出作证据。

## 7. 实验与掌握标准

在 VM 保存普通、`-v`、`-b` 输出；临时 setenforce 观察 current/config 分离；给 sestatus.conf 添加测试对象后验证 context；重启确认配置态。完成后恢复文件。

掌握标准：能解释每个核心字段和两个参数，区分运行态、配置态、策略能力与对象标签，知道 sestatus 是概览而非拒绝原因分析器。

## 8. 官方参考 {/* #官方参考 */}

- [sestatus(8)](https://manpages.debian.org/unstable/policycoreutils/sestatus.8.en.html)
- [sestatus.conf(5)](https://manpages.debian.org/unstable/policycoreutils/sestatus.conf.5.en.html)

上一篇：[`getenforce` 命令详解](./01-getenforce命令详解.md)

下一篇：[`setenforce` 命令详解](./03-setenforce命令详解.md)
