---
title: "chcon 命令详解：临时修改 SELinux 文件安全上下文"
sidebar_label: "04. chcon 命令详解：临时修改 SELinux 文件安全上下文"
sidebar_position: 4
description: "完整讲解 GNU chcon 9.11 的上下文、reference、user/role/type/range、递归、符号链接与 root 保护参数，以及与 restorecon/semanage 的持久性边界。"
tags: [Linux, chcon, SELinux, context, label, coreutils]
---

# chcon 命令详解：临时修改 SELinux 文件安全上下文

`chcon` 直接修改文件 `security.selinux` xattr。它改变当前标签，不修改 policy 中“这个路径应该是什么标签”的映射，所以 `restorecon`、全盘 relabel 或重新创建文件可能覆盖结果。

## 1. 三种语法

```text
chcon [OPTION]... CONTEXT FILE...
chcon [OPTION]... [-u USER] [-r ROLE] [-l RANGE] [-t TYPE] FILE...
chcon [OPTION]... --reference=RFILE FILE...
```

以 GNU coreutils 9.11 为参数基线。完整 context、分字段修改和复制 reference 三种方式互斥选择。

## 2. 上下文参数

| 短参数 | 长参数 | 含义 |
|---|---|---|
| `-u USER` | `--user=USER` | 设置 SELinux user 字段 |
| `-r ROLE` | `--role=ROLE` | 设置 role |
| `-t TYPE` | `--type=TYPE` | 设置 type；日常文件标签最常用 |
| `-l RANGE` | `--range=RANGE` | 设置 MLS/MCS level/range |
| 无 | `--reference=RFILE` | 使用参考文件完整 context |

```bash
chcon -t httpd_sys_content_t /srv/site/index.html
chcon --reference=/var/www/html /srv/site
```

上下文必须被已加载 policy 接受；标签“能写入”不保证相应 domain 有访问 allow，也不保证业务语义正确。

## 3. 符号链接与递归参数

| 参数 | 含义 |
|---|---|
| `--dereference` | 修改 symlink 指向对象；默认 |
| `-h, --no-dereference` | 修改 symlink 自身 context |
| `-R, --recursive` | 递归处理目录 |
| `-H` | 递归时跟随命令行参数中的目录 symlink |
| `-L` | 跟随遍历中遇到的所有目录 symlink，高风险 |
| `-P` | 不跟随任何 symlink；递归默认 |
| `--preserve-root` | 与 `-R` 一起拒绝处理 `/` |
| `--no-preserve-root` | 不特殊保护 `/`；默认，危险 |
| `-v, --verbose` | 每个处理对象输出诊断 |
| `--help` / `--version` | 帮助/版本 |

`-R -L` 可能越过预期目录树、循环或修改挂载进来的共享数据；先 `findmnt`、`find -xdev` 和备份标签清单，生产优先用策略驱动的 `restorecon`。

## 4. 临时标签与持久标签

```text
chcon -t TYPE PATH
  → 当前 inode xattr 改变
  → restorecon 可能恢复 policy 期望

semanage fcontext -a -t TYPE '/srv/site(/.*)?'
restorecon -Rv /srv/site
  → 本地持久映射 + 实际应用
```

如果只是把网站移到非标准目录，正确方案通常是复用已有 type 的 fcontext regex，而不是长期执行启动脚本 `chcon -R`。

## 5. inode、复制和文件系统边界

同文件系统 rename 通常保留 inode 标签；复制/新建按目标目录、创建进程和 file transition 产生新标签；NFS/CIFS、FUSE、只读或不支持 `security.selinux` xattr 的文件系统行为不同。容器 overlay 层和 volume mount 还会带入宿主 MCS/context。

## 6. 安全验证与回滚

```bash
ls -ldZ /srv/site
matchpathcon -V /srv/site /srv/site/index.html
restorecon -nRv /srv/site
```

变更前保存 `getfattr -n security.selinux`/`ls -Z`；回滚优先按 policy `restorecon`，而不是记忆旧字符串。若本地 fcontext 定义本身错误，先修 `semanage fcontext` 再 restore。

## 7. 常见错误

| 现象 | 原因方向 |
|---|---|
| Operation not supported | 文件系统/xattr/挂载不支持 |
| Invalid argument | context/type/range 不被 policy 接受 |
| Permission denied | DAC、capability、SELinux 对 relabel 权限、只读挂载 |
| 改完仍拒绝 | source domain/class/permission/boolean/其他层不匹配 |
| 重启/relabel 后消失 | 只 chcon，未建立持久 fcontext |

## 8. 实验与掌握标准

在 SELinux VM 创建 `/srv/lab`：比较创建标签；用 chcon 改 type；`restorecon -n` 预览并恢复；再用 semanage fcontext 建持久映射验证。另在 symlink 树测试 `-P/-H`，不要使用 `/` 或生产目录。

掌握标准：能列出全部参数，解释 context 四字段、symlink/递归爆炸半径，区分 inode 当前标签和 policy 路径期望，并能安全恢复。

## 9. 官方参考 {/* #官方参考 */}

- [GNU chcon 9.11](https://www.gnu.org/software/coreutils/manual/html_node/chcon-invocation.html)
- [selinux(8)](https://man7.org/linux/man-pages/man8/selinux.8.html)

上一篇：[`setenforce` 命令详解](./03-setenforce命令详解.md)

下一篇：[`restorecon` 命令详解](./05-restorecon命令详解.md)
