---
title: "getcap 命令详解：检查文件 capabilities 与 namespace root ID"
sidebar_label: "13. getcap 命令详解：检查文件 capabilities 与 namespace root ID"
sidebar_position: 13
description: "完整讲解 getcap 的 -h/-n/-r/-v 参数、file capability 文本、空 capability、递归盘点、挂载与容器陷阱及安全审计方法。"
tags: [Linux, getcap, capabilities, xattr, 最小权限]
---

# getcap 命令详解：检查文件 capabilities 与 namespace root ID

`getcap` 读取文件的 `security.capability` 扩展属性，并把 file capabilities 转成可读文本。它只描述**可执行文件参与下一次 `execve()` 权限计算的输入**，不等于当前进程实际拥有的 capabilities，也不保证文件执行后一定获得这些权限。

## 1. 语法与全部参数

```text
getcap [-v] [-n] [-r] [-h] FILE [...]
```

| 参数 | 含义 |
|---|---|
| `-h` | 输出简短帮助 |
| `-n` | 同时显示非零的 user namespace root UID（namespaced file capability） |
| `-r` | 递归搜索每个目录参数 |
| `-v` | 显示所有检查过的项，包括没有 file capability 的文件 |

这些选项在当前 `getcap` 中没有对应长参数。

```bash
getcap /usr/bin/ping
getcap -n /path/to/program
sudo getcap -r /usr/local /opt
getcap -rv /small/test/tree
```

## 2. 读懂 capability 文本

常见输出：

```text
/usr/bin/ping cap_net_raw=ep
/usr/local/bin/collector cap_dac_read_search,cap_sys_ptrace+ep
```

能力名后面的 file capability flag 属于文件集合，而不是直接打印进程的五组集合：

| 标志 | 含义 |
|---|---|
| `p` | file Permitted：参与新进程 permitted 计算 |
| `i` | file Inheritable：与调用者 inheritable 相交后参与计算 |
| `e` | Effective bit：若设置，执行后把新的 permitted 提升到 effective |

典型简化模型：

```text
P'(permitted) = (P(inheritable) ∩ F(inheritable))
              ∪ (F(permitted) ∩ P(bounding))
P'(effective) = F(effective-bit) ? P'(permitted) : 0
```

实际还受 user namespace、securebits、root 特例、ambient、`no_new_privs`、LSM 和内核版本语义影响。查看运行进程应结合：

```bash
grep '^Cap\|^NoNewPrivs' /proc/PID/status
capsh --decode=HEX_VALUE
```

## 3. “没有输出”与空 capability 不同

默认模式只输出带 capability 的文件，所以命令成功但无输出通常表示目标没有 file capability；也可能是文件不存在、不可访问、底层文件系统/xattr 不支持，应检查 stderr 和退出码。

特别注意：文件 capability 被**移除**与显式写入空集合 `=` 不等价。空集合可以在非 root 情况下抑制 ambient capability 经 exec 继续保留；`getcap -v` 可帮助分辨“检查了但没有”与特殊空设置。

```bash
getcap -v /path/to/program
echo $?
getfattr -n security.capability /path/to/program 2>/dev/null
```

## 4. `-n` 与 namespaced file capability

V3 file capability 可以关联一个 user namespace root UID。`-n` 显示非零 root UID，帮助判断该 capability 是否只在特定 namespace 映射下生效：

```bash
getcap -n /path/to/program
cat /proc/PID/uid_map
```

容器镜像层中的 xattr 可能在打包、复制、解压、overlay snapshot 或跨文件系统迁移时丢失；即使保留，宿主/容器 UID 映射、bounding set、`no_new_privs` 和挂载选项也可能阻止提升。必须在实际节点、实际挂载和实际 runtime 配置中验证。

## 5. 递归盘点与性能边界

`-r` 会遍历目录树并读取 xattr。对 `/` 递归可能跨入 `/proc`、`/sys`、网络存储和海量目录，造成 I/O、权限错误和长时间运行；不要把它当无成本命令。优先限定受管软件目录和文件系统：

```bash
sudo getcap -r /usr/bin /usr/sbin /usr/local/bin /opt 2>/dev/null
```

安全基线应保存“路径 + capability + 文件包/哈希 + 所有者 + mode”，否则攻击者替换同路径二进制后，单看 capability 清单不足以判断可信性。

## 6. 标准审计与排障流程

```text
getcap -n 确认文件 xattr
→ stat/file/package manager 确认文件身份
→ findmnt 确认实际挂载与 nosuid/overlay
→ /proc/PID/status 获取进程集合
→ capsh 解码并检查 bounding/ambient/no_new_privs
→ 核对 user namespace 映射
→ 查 LSM/audit/seccomp 拒绝
→ 最小权限修复与负向验证
```

“文件有 `cap_net_bind_service=ep` 但仍不能监听端口”时，不应反复 `setcap`；先确认执行的是否同一个 inode、进程集合是否获得能力、能力是否被 bounding/no_new_privs 限制，以及端口/网络 namespace 是否正确。

## 7. 实验与掌握标准

复制一个专用测试二进制，在支持 xattr 的本地文件系统练习无属性、`+ep`、`+p`、空集合、移除属性和 `-n`；比较直接执行、systemd capability 限制和容器执行后的 `/proc/PID/status`。实验结束删除测试 xattr 和文件。

掌握标准：能列出 4 个参数；能解释 `p/i/e`、空集合和 V3 root UID；能把 file capability 与进程 P/E/I/B/A 区分；能做限定目录的安全基线与容器排障。

## 8. 官方参考 {/* #官方参考 */}

- [getcap(8)](https://manpages.debian.org/unstable/libcap2-bin/getcap.8.en.html)
- [capabilities(7)](https://man7.org/linux/man-pages/man7/capabilities.7.html)
- [cap_text_formats(7)](https://manpages.debian.org/unstable/libcap2-dev/cap_text_formats.7.en.html)

上一篇：[`aa-complain` 命令详解](./12-aa-complain命令详解.md)

下一篇：[`setcap` 命令详解](./14-setcap命令详解.md)
