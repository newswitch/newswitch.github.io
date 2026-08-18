---
title: "install 命令详解：复制、建目录、权限与部署语义"
sidebar_label: "18. install 命令详解：复制、建目录、权限与部署语义"
sidebar_position: 18
description: "完整讲解 GNU coreutils install 的四种语法与全部参数，覆盖目录创建、权限所有者、备份、比较、strip、SELinux、安全发布和部署边界。"
tags: [Linux, install, GNU coreutils, 文件部署, 权限]
---

# install 命令详解：复制、建目录、权限与部署语义

`install` 把“复制文件、创建父目录、设置 mode/owner/group、可选 strip”组合成一个面向构建与部署的命令。它不是软件包管理器，也不保证多文件事务、原子发布或配置回滚。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 软件包 | `coreutils` |
| 安全级别 | `[W]/[D]`，可创建、覆盖、变更权限和所有者 |
| 主要对象 | 普通文件、目标目录、mode、owner、group、SELinux 上下文 |

```bash
type -a install
env install --version
env install --help
```

## 2. 四种完整语法

```text
install [OPTION]... [-T] SOURCE DEST
install [OPTION]... SOURCE... DIRECTORY
install [OPTION]... -t DIRECTORY SOURCE...
install [OPTION]... -d DIRECTORY...
```

前三种复制文件；第四种创建目录。它通常不复制目录树，目录布局应显式列出或交给构建系统、`cp -a`、`rsync`、软件包管理器处理。

## 3. GNU coreutils 9.11 全部参数

| 短参数 | 长参数 | 值 | 作用 |
|---|---|---:|---|
| `-b` | `--backup[=CONTROL]` | 可选 | 覆盖前备份；备份策略见下文 |
| `-C` | `--compare` | 无 | 内容及部分属性无需更新时不改写目标 |
| `-c` | 无 | 无 | 兼容选项，忽略 |
| `-D` | 无 | 无 | 将最后操作数视为文件，创建缺失的目标父目录后复制 |
| `-d` | `--directory` | 无 | 把所有操作数视为待创建目录 |
| 无 | `--debug` | 无 | 解释文件复制方式，隐含 `-v` |
| `-g GROUP` | `--group=GROUP` | 必需 | 设置组，默认当前进程组 |
| `-m MODE` | `--mode=MODE` | 必需 | 设置 mode，默认 `u=rwx,go=rx,a-s`，即常见 `0755` |
| `-o OWNER` | `--owner=OWNER` | 必需 | 设置 owner；通常需要特权 |
| 无 | `--preserve-context` | 无 | 保留源文件 SELinux 安全上下文 |
| `-p` | `--preserve-timestamps` | 无 | 保留源 atime 与 mtime |
| `-s` | `--strip` | 无 | 安装后剥离符号表 |
| 无 | `--strip-program=PROGRAM` | 必需 | 指定执行 strip 的程序 |
| `-S SUFFIX` | `--suffix=SUFFIX` | 必需 | 指定备份后缀 |
| `-t DIR` | `--target-directory=DIR` | 必需 | 显式目标目录 |
| `-T` | `--no-target-directory` | 无 | 强制把 DEST 当作普通目标文件，而非目录 |
| `-v` | `--verbose` | 无 | 输出每个创建/复制的对象 |
| `-Z` | `--context[=CTX]` | 可选 | 设置 SELinux 上下文；无 CTX 时按默认类型调整 |
| 无 | `--help` | 无 | 显示帮助并退出 |
| 无 | `--version` | 无 | 显示版本并退出 |

`--preserve-context` 与 `-Z` 互斥。实际可用性取决于 coreutils 构建和 SELinux 环境。

## 4. 复制与 `-T/-t`

```bash
install -m 0755 -- build/server /usr/local/bin/server
install -m 0644 -t /etc/myapp -- conf/app.yaml conf/logging.yaml
install -T -m 0644 -- generated.conf /etc/myapp/app.conf
```

`-T` 是重要防御：若脚本预期 `/etc/myapp/app.conf` 是文件，但它被替换成目录，不加 `-T` 时源文件可能被复制进该目录，形成错误布局；加 `-T` 会失败。

## 5. `-D` 与 `-d`

### 5.1 创建父目录并安装文件

```bash
install -D -m 0644 -- app.yaml /opt/myapp/etc/app.yaml
```

`-D` 创建目标文件所需的缺失父目录，再复制最后文件。它不是“递归复制目录”。

### 5.2 只创建目录

```bash
install -d -m 0750 -o app -g app -- /var/lib/myapp /var/log/myapp
```

在 `-d` 递归创建中，中间父目录通常以 `0755` 创建，不受最终 `-m` 和 `umask` 以相同方式控制。敏感布局应逐级安装并用 `stat` 验证所有父目录，而不是只检查叶目录。

## 6. mode、owner、group

```bash
install -m u=rw,go= -o root -g root -- secret.conf /etc/myapp/secret.conf
```

- `MODE` 接受 chmod 风格的八进制或符号模式。
- 默认 mode 是可执行的 `0755`，安装配置文件时必须显式 `-m 0644/0600`。
- `-o/-g` 设置失败会使命令失败，常见原因是权限不足或名称无法解析。
- setuid/setgid 位具有安全风险，且 chown、文件系统挂载选项或安全策略可能清除/忽略它们。
- 默认 ACL、SELinux、文件 capabilities 和扩展属性不能仅靠 mode 表解释。

## 7. `-C/--compare`

```bash
install -C -m 0644 -o root -g root -- app.conf /etc/myapp/app.conf
```

`-C` 在无需更新时避免改写，从而保留目标时间戳并减少 IO。但比较逻辑不能完整感知所有部署语义，例如 setgid/default ACL 影响以及未被复制的扩展属性。使用 `-C` 时显式写出期望 owner、group、mode，不要让环境默认值参与判断。

## 8. 备份参数

```bash
install -b --suffix=.bak -m 0644 -- app.conf /etc/myapp/app.conf
```

`--backup=CONTROL` 常见值：

| CONTROL | 含义 |
|---|---|
| `none`、`off` | 不备份 |
| `numbered`、`t` | 数字备份 `.~1~`、`.~2~` |
| `existing`、`nil` | 已有数字备份则继续数字备份，否则简单备份 |
| `simple`、`never` | 简单后缀备份，默认通常 `~` |

未给命令行策略时还会参考 `VERSION_CONTROL`；后缀可由 `-S` 或 `SIMPLE_BACKUP_SUFFIX` 控制。部署脚本应显式写出策略，且备份不等于可靠回滚：权限、外部状态、多文件一致性仍需单独设计。

## 9. 时间、strip 与 SELinux

### 9.1 时间戳

```bash
install -p -m 0644 -- artifact /srv/release/artifact
```

`-p` 保留源 atime/mtime，但 ctime 必然反映目标 inode 变化；birth time 也不保证复制。

### 9.2 strip

```bash
install -s -m 0755 -- server /usr/local/bin/server
```

剥离可减小二进制，但会影响调试、崩溃符号化、签名和可复现构建。更稳妥的流程是在构建阶段生成独立 debug symbols，验证产物后再安装；交叉编译可用 `--strip-program` 指定正确工具链。

### 9.3 SELinux

```bash
install -Z -m 0755 -- server /usr/local/bin/server
install --preserve-context -- source target
```

前者倾向按目标路径默认策略设置，后者保留源上下文。生产部署后用 `ls -Z`、`matchpathcon`、审计日志验证，而不是只看命令成功。

## 10. 不会自动保留的内容

`install` 不是 `cp -a`。除显式支持内容外，不应假定它保留：

- 扩展属性和文件 capabilities。
- ACL。
- 稀疏布局、Reflink 共享关系。
- 硬链接关系。
- birth time。
- 多文件原子性。

若交付要求这些属性，使用适合的归档/同步/软件包工具并写验收检查。

## 11. 原子发布与竞态

直接覆盖生产路径可能让读者看到更新过程中的状态，跨多个文件更不存在整体事务。常见发布模型：

1. 在同一文件系统的临时目录生成完整版本。
2. 校验内容、owner、mode、上下文和依赖。
3. `fsync` 需求由应用和持久性目标决定。
4. 用同文件系统 rename 或版本目录符号链接切换。
5. 保留明确可回滚的旧版本。

`install` 可承担其中的复制和权限设置，但不是整个发布协议。

## 12. 退出状态与排查

`0` 表示所有请求成功，非 `0` 表示至少一个步骤失败。

| 现象 | 检查方向 |
|---|---|
| Permission denied | 父目录搜索/写权限、只读挂载、SELinux、immutable 属性 |
| Operation not permitted | chown、setuid、文件 capabilities、NFS root squash |
| 目标跑进同名目录 | 应使用 `-T` |
| 叶目录权限正确但父目录过宽 | `-D/-d` 中间父目录语义，逐级 stat |
| `-C` 仍更新或未更新 | 显式 mode/owner/group、比较范围、目标属性 |
| strip 后不可调试 | 构建阶段 debug symbols 和 strip 工具链 |
| 服务仍读旧配置 | 应用 reload、Namespace、符号链接、缓存，与复制成功无关 |

## 13. 动手实验

1. 比较默认 mode 与显式 `0644/0750`。
2. 用 `-D` 创建三级父目录，逐级 `stat -c '%a %U:%G %n'`。
3. 制造“目标本应是文件却已是目录”，比较有无 `-T`。
4. 连续运行 `-C`，观察 inode、mtime 和输出。
5. 测试 simple、numbered、existing 三种备份。
6. 对测试 ELF 比较 strip 前后大小及调试信息。
7. 在 SELinux 环境比较 `-Z` 与 `--preserve-context`。

## 14. 掌握标准

- 能写出四种语法并解释 `-D/-d/-t/-T` 的边界。
- 能列出全部参数，并显式控制配置文件和可执行文件 mode。
- 能解释 `-C`、备份和 strip 的生产影响。
- 能说明 install 不保留哪些属性、不提供哪些事务保证。
- 能把它放入可验证、可回滚的发布流程，而不是把单条命令当发布系统。

## 15. 官方参考 {/* #官方参考 */}

- [GNU coreutils 9.11：install invocation](https://www.gnu.org/software/coreutils/manual/html_node/install-invocation.html)
- [GNU coreutils：Backup options](https://www.gnu.org/software/coreutils/manual/html_node/Backup-options.html)
- [Linux capabilities(7)](https://man7.org/linux/man-pages/man7/capabilities.7.html)

上一篇：[`find` 命令详解](./17-find命令详解.md)

下一篇：[`unlink` 命令详解](./19-unlink命令详解.md)
