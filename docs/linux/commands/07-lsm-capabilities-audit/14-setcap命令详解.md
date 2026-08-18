---
title: "setcap 命令详解：为可执行文件授予最小 Linux capability"
sidebar_label: "14. setcap 命令详解：为可执行文件授予最小 Linux capability"
sidebar_position: 14
description: "完整讲解 setcap 的 -q/-v/-n/-f、设置/验证/删除/标准输入语法、capability 文本、exec 转换、部署丢失、风险评审与回滚。"
tags: [Linux, setcap, capabilities, xattr, 最小权限]
---

# setcap 命令详解：为可执行文件授予最小 Linux capability

`setcap` 设置、验证或移除文件的 `security.capability` 扩展属性。它可以把传统 root 权限拆成更小单元，但能力会授予**任何能执行该文件且满足 exec 条件的调用者**；给错误二进制或过强能力会形成稳定提权入口。

## 1. 语法与全部参数/操作数

```text
setcap [-q] [-n ROOTUID] [-v] [-f] {CAPABILITIES|-|-r} FILE
       [... CAPABILITIES_N FILE_N]
```

| 参数/特殊值 | 含义 |
|---|---|
| `-q` | 减少输出 |
| `-v` | 验证指定 capability 是否已在文件上，不执行设置 |
| `-n ROOTUID` | 创建/验证仅对指定 user namespace root UID 有效的 namespaced capability |
| `-f` | 即使操作被认为无效也强制完成；可影响删除及内核无法理解的设置 |
| `CAPABILITIES` | `cap_text_formats(7)` 格式的能力集合 |
| `-` | 从标准输入逐组读取 capability，以空行结束 |
| `-r` | 从目标文件移除 capability xattr |

当前版本这些选项没有长参数。`-f` 虽然 synopsis 的部分版本未列出，但当前手册明确支持；它会绕过安全检查，普通变更不要使用。

## 2. capability 文本语法

```bash
sudo setcap cap_net_bind_service=ep /usr/local/bin/web
sudo setcap cap_net_raw,cap_net_admin+ep /usr/local/bin/nettool
sudo setcap -v cap_net_bind_service=ep /usr/local/bin/web
sudo setcap -r /usr/local/bin/web
```

能力名可逗号分隔，运算符常见为 `=`、`+`、`-`，集合字母是 `e`、`i`、`p`。生产配置应写明确的最终集合，如 `cap_net_bind_service=ep`，避免在未知旧状态上增量 `+` 导致残留能力。

完整 capability 清单随内核演进，以本机为准：

```bash
capsh --print
capsh --supports=cap_bpf
capsh --explain=cap_sys_admin
```

## 3. 设置、验证、删除和空集合

`-v` 是幂等检查，可用于配置管理：匹配返回 0，不匹配返回 1。设置后必须重新读取并执行测试：

```bash
sudo setcap cap_net_bind_service=ep /usr/local/bin/web
getcap -n /usr/local/bin/web
sudo setcap -v cap_net_bind_service=ep /usr/local/bin/web
```

`-r` 移除 xattr。显式设置空 capability `=` 与移除不同：空集合可阻止非 root 进程通过 ambient/inheritable 在 exec 后保留特权。不要用“写空”代替回滚；回滚原本没有属性的文件应使用 `-r`。

## 4. 从标准输入和批量参数

命令行可传多组“能力 + 文件”，也能用 `-` 从 stdin 读取。批量操作不是跨文件原子事务：中途失败可能已修改前面的文件，变更前要逐项保存原状态并准备逐项回滚。

```bash
sudo setcap cap_net_bind_service=ep /opt/app/web cap_net_raw=ep /opt/app/pinger
```

stdin 格式容易因空行、转义或流水线错误误配，不建议直接从不受信输入生成。自动化更适合显式数组、逐文件验证并立即 `getcap -n` 回读。

## 5. `-n ROOTUID` 与 user namespace

```bash
sudo setcap -n 100000 cap_net_bind_service=ep /path/to/program
getcap -n /path/to/program
cat /proc/PID/uid_map
```

这类 V3 file capability 仅在 root UID 映射匹配的 user namespace 中参与提升，降低属性跨 namespace 意外生效的范围，但不替代文件完整性、bounding set 和 LSM。目标文件系统、内核和工具必须支持相应 xattr 格式。

## 6. 为什么设置成功却不生效

依次核对：

- 实际执行文件/inode 是否就是设置对象；脚本解释器的 capability 语义与 ELF 二进制不同。
- 复制、包升级、解压、镜像构建或 overlay 是否丢失/替换了 xattr。
- 文件系统是否支持 xattr，挂载是否存在 `nosuid` 等影响特权 exec 的约束。
- 进程 bounding set 是否包含能力，`no_new_privs` 是否禁止通过 exec 获得新权限。
- user namespace root UID、systemd `CapabilityBoundingSet=`、容器 `capDrop/capAdd` 是否匹配。
- SELinux/AppArmor、seccomp、设备 cgroup 和业务自身策略是否另行拒绝。

```bash
readlink -f /proc/PID/exe
getcap -n /proc/PID/exe
grep '^Cap\|^NoNewPrivs' /proc/PID/status
findmnt -T /proc/PID/exe -o TARGET,SOURCE,FSTYPE,OPTIONS
```

## 7. 风险分级与最小权限设计

`CAP_SYS_ADMIN` 覆盖极广，不应作为“不知道缺什么”的兜底；`CAP_DAC_READ_SEARCH` 可越过文件读取检查，`CAP_SYS_PTRACE` 可读写其他进程，`CAP_NET_ADMIN` 可改变网络状态。评审必须回答：二进制是否可信且不可被低权限用户修改、能力是否只在需要时生效、能否改为 systemd service 级能力、是否有 LSM/namespace 约束和负向测试。

对仅由单个服务使用的程序，systemd 的 `AmbientCapabilities=`、`CapabilityBoundingSet=`、`NoNewPrivileges=` 往往比永久写入共享二进制 xattr 更易审计。

## 8. 回滚、退出码与发布验证

成功返回 0，失败返回 1。回滚前区分原状态：原有别的集合就按备份恢复；原本没有就 `-r`。

```bash
getcap -n /usr/local/bin/web > /secure/change-record.txt
sudo setcap cap_net_bind_service=ep /usr/local/bin/web
sudo setcap -v cap_net_bind_service=ep /usr/local/bin/web
# rollback when originally absent
sudo setcap -r /usr/local/bin/web
getcap -v /usr/local/bin/web
```

软件升级/镜像重建后再次验证；file capability 属于部署产物的一部分，应由包或配置管理声明，而不是依赖人工命令历史。

## 9. 实验与掌握标准

在专用测试二进制上练习明确设置、增量集合、`-v` 成功/失败、`-r`、空集合、`-n` 和故意用不支持 xattr 的位置；比较 systemd/容器限制后的实际进程集合。实验结束恢复原属性。

掌握标准：能列出全部选项和特殊操作数；能解释 file `e/i/p` 与进程集合；能定位“设置成功但不生效”；能评审高危能力并完成可验证、可回滚的部署。

## 10. 官方参考 {/* #官方参考 */}

- [setcap(8)](https://manpages.debian.org/unstable/libcap2-bin/setcap.8.en.html)
- [cap_text_formats(7)](https://manpages.debian.org/unstable/libcap2-dev/cap_text_formats.7.en.html)
- [capabilities(7)](https://man7.org/linux/man-pages/man7/capabilities.7.html)

上一篇：[`getcap` 命令详解](./13-getcap命令详解.md)

下一篇：[`capsh` 命令详解](./15-capsh命令详解.md)
