---
title: restorecon 命令详解：按策略检查与恢复 SELinux 文件标签
sidebar_position: 5
description: 完整讲解 restorecon 的递归、dry-run、强制字段、exclude、文件列表、NUL、digest、线程、边界和计数参数，以及大规模 relabel 安全流程。
tags: [Linux, restorecon, SELinux, relabel, file context]
---

# `restorecon` 命令详解：按策略检查与恢复 SELinux 文件标签

`restorecon` 根据当前 policy 的 file-context 匹配，检查或修改文件 xattr。默认只改 type；`-F/-U` 可扩大到 user/role/range。它与 `setfiles` 是同一 executable 的不同调用模式。

## 1. 语法

```text
restorecon [OPTIONS] PATH...
restorecon -f INPUTFILE [OPTIONS]
```

以 SELinux userspace/policycoreutils 3.11 为基线。最安全起步：

```bash
restorecon -nvv /srv/app
restorecon -nRvx /srv/app
```

`-n` 只检查不写，结合 verbose 显示将修改的对象。

## 2. 输入、递归与边界参数

| 参数 | 含义 |
|---|---|
| `-R, -r` | 递归处理目录 |
| `-e DIR` | 排除绝对目录，可重复 |
| `-f FILE` | 从文件读取路径；`-` 表示 stdin |
| `-0` | 输入项以 NUL 分隔，保留空格/引号/反斜杠 |
| `-i` | 忽略不存在路径 |
| `-x` | 不跨文件系统边界 |
| `-m` | 不读 `/proc/mounts` 排除 non-seclabel mount |

```bash
find /srv/app -xdev -print0 | restorecon -nvv -0 -f -
```

对不可信/任意文件名使用 NUL 管道。`-m` 会改变挂载排除判断，只有明确存在“non-seclabel 上嵌套 seclabel mount”时使用。

## 3. 写入范围参数

| 参数 | 含义 |
|---|---|
| `-n` | dry-run，不修改标签 |
| `-F` | 强制完整 context：user/role/type/range，并覆盖 customizable type |
| `-U` | 除 type 外也改 user/role，不改 range |
| `-v` | 显示变化；多个 `-v` 增加详细度 |
| `-p` | 按 1K 文件块/全系统百分比显示进度，与 `-v` 互斥 |
| `-c` | 统计会/已 relabel 数；只有至少一个被 relabel 时退出 0 |
| `-W` | 报告 file-context 规则没有匹配文件的统计警告 |

默认遇到已有标签时一般只修 type；`-F` 爆炸半径明显更大，可能覆盖 MCS 容器范围/自定义标签，不能为“确保生效”随手加。

## 4. digest 与性能参数

| 参数 | 含义 |
|---|---|
| `-D` | 在目录维护 `security.sehash` SHA1 digest，后续相同 spec 可跳过 |
| `-I` | 忽略已有 digest，强制检查并在成功时更新 |
| `-T N` | 最多 N 线程；0=可用 CPU 数，1=默认单线程 |
| `-h, -?` | 帮助 |
| `-o FILE` | 已废弃、不再支持；不要使用 |

并行 relabel 会增加 metadata IO、锁竞争、缓存污染和 audit 输出；生产先估算 inode 数、存储能力、备份窗口和业务延迟。

## 5. 规则优先级

期望标签来自 vendor policy 和本地 `file_contexts.local`。`semanage fcontext` 的本地规则优先级高，并按“最近添加先匹配”，不是简单“最具体正则优先”。先检查：

```bash
semanage fcontext -l -C
matchpathcon /srv/app/file
restorecon -nvv /srv/app/file
```

若规则错误，restorecon 会忠实地应用错误期望；必须先修规则。

## 6. 大规模 relabel 安全流程

1. 保存 policy 版本、本地 fcontext export、当前标签抽样和挂载图。
2. `-nRv -x` 预览数量与范围，检查 NFS/CephFS/overlay/容器 volume。
3. 分目录、单线程小批写入；观察 IO、错误和服务 AVC。
4. 明确是否需要 `-F/-U`，默认不要。
5. 验证应用、再次 dry-run、保存 audit FS_RELABEL 证据。

对 `/` 执行递归 relabel 会触碰全系统并可让服务重启后不可用，必须走发行版离线/启动 relabel 流程。

## 7. 退出码陷阱

一般错误返回非零，但 `-c` 特殊：至少一个文件需要/发生 relabel 才返回 0，没有变化可能非零。自动化必须按此语义解释，不能把“系统已正确无变化”当成故障。

## 8. 实验与掌握标准

在 VM 建本地 fcontext；故意 chcon 错 type；依次 `-nvv`、普通恢复、`-D`/再次运行、`-I`；用包含空格/换行名验证 `-0 -f -`；测试 `-x` 不跨临时挂载。不要在 `/` 实验。

掌握标准：能列出全部参数，解释 default type-only 与 `-F/-U`、local rule 优先级、digest/线程和 `-c` 退出语义，设计可控制范围的大规模 relabel。

## 官方参考

- [restorecon(8)](https://manpages.debian.org/unstable/policycoreutils/restorecon.8.en.html)
- [selinux_restorecon(3)](https://manpages.debian.org/unstable/libselinux1-dev/selinux_restorecon.3.en.html)

上一篇：[`chcon` 命令详解](./04-chcon命令详解.md)

下一篇：[`semanage` 命令详解](./06-semanage命令详解.md)
