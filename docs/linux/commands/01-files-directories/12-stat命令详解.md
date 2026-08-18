---
title: "stat 命令详解：inode、权限、时间戳、设备与文件系统格式化"
sidebar_label: "12. stat 命令详解：inode、权限、时间戳、设备与文件系统格式化"
sidebar_position: 12
description: "完整讲解 GNU coreutils stat 的全部参数、文件与文件系统输出、所有格式化指令、符号链接、缓存模式、inode、块数与生产脚本用法。"
tags: [Linux, stat, GNU coreutils, inode, 文件系统]
---

# stat 命令详解：inode、权限、时间戳、设备与文件系统格式化

`stat` 直接报告文件 inode 元数据或所在文件系统状态。与 `ls -l` 相比，它更适合精确诊断和结构化脚本，但输出仍受实现、文件系统、缓存和时间精度影响。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 命令 | `stat` |
| 实现 | GNU coreutils |
| 文档基线 | GNU coreutils 9.11 |
| 软件包 | `coreutils` |
| 安全级别 | `[R]` 只读；强制刷新远端属性可能触发网络访问或自动挂载 |
| 主要对象 | inode 元数据、符号链接、设备号、挂载点和文件系统统计 |

```bash
type -a stat
env stat --version
env stat --help
```

使用 `env stat` 可以绕开同名 Alias、Function 或 Builtin，确保调用 `PATH` 中的外部 GNU 程序。

## 2. 完整语法

```text
stat [OPTION]... FILE...
```

默认报告每个 FILE 的详细文件状态。使用 `-f` 改为报告 FILE 所在文件系统。

## 3. GNU coreutils 9.11 全部参数

| 短参数 | 长参数 | 是否带值 | 作用 |
|---|---|---:|---|
| `-L` | `--dereference` | 否 | 参数是符号链接时报告链接目标 |
| `-f` | `--file-system` | 否 | 报告所在文件系统而不是文件；隐含 `-L` |
| 无 | `--cached=MODE` | 是 | 选择 `always`、`never`、`default` 属性缓存策略 |
| `-c FORMAT` | `--format=FORMAT` | 是 | 使用自定义格式，每个操作数自动追加换行 |
| 无 | `--printf=FORMAT` | 是 | 自定义格式并解释反斜杠转义，不自动追加换行 |
| `-t` | `--terse` | 否 | 使用简洁的机器可读风格默认输出 |
| 无 | `--help` | 否 | 显示帮助并退出 |
| 无 | `--version` | 否 | 显示版本并退出 |

这就是 GNU coreutils 9.11 `stat` 的完整选项集合。

## 4. 默认文件输出

```bash
stat -- file
```

常见字段：

| 字段 | 含义 |
|---|---|
| File | 文件名，符号链接还显示目标字符串 |
| Size | 逻辑字节数 |
| Blocks | 已分配块数，通常按 512 字节单位报告 |
| IO Block | 建议 IO 块大小，不等于文件系统基本块或设备扇区 |
| File type | 普通文件、目录、链接、设备、FIFO、Socket 等 |
| Device | 文件所在设备号 |
| Inode | inode 编号，只在对应文件系统内有意义 |
| Links | 硬链接计数 |
| Access | 八进制和符号权限 |
| Uid/Gid | 数字 ID 与解析后的名称 |
| Context | 构建和系统支持时的安全上下文 |
| Access/Modify/Change/Birth | atime、mtime、ctime、创建时间 |

## 5. 文件格式化指令全集

`-c/--format` 和 `--printf` 在“文件模式”支持以下指令。

### 5.1 权限、类型和身份

| 指令 | 含义 |
|---|---|
| `%a` | 八进制权限位 |
| `%A` | 人类可读的文件类型和权限 |
| `%f` | 原始 mode，十六进制 |
| `%F` | 人类可读文件类型 |
| `%u` | owner UID |
| `%U` | owner 名称；无法解析时显示数字 |
| `%g` | group GID |
| `%G` | group 名称；无法解析时显示数字 |
| `%C` | SELinux 安全上下文字符串；需系统支持 |

### 5.2 大小、块、inode 与链接

| 指令 | 含义 |
|---|---|
| `%s` | 逻辑大小，字节 |
| `%b` | 已分配块数 |
| `%B` | `%b` 每个块的字节数 |
| `%o` | 最佳 IO 传输大小提示 |
| `%i` | inode 编号 |
| `%h` | 硬链接计数 |

真实分配近似为 `%b * %B`，但压缩、共享块、快照和文件系统实现仍可能让“物理占用”更复杂。

### 5.3 名称、设备与挂载

| 指令 | 含义 |
|---|---|
| `%n` | 文件名 |
| `%N` | 引用后的文件名；符号链接包含目标 |
| `%m` | 挂载点 |
| `%d` | 文件所在设备号，十进制 |
| `%D` | 文件所在设备号，十六进制 |
| `%Hd` | 文件所在设备号的 major，十进制 |
| `%Ld` | 文件所在设备号的 minor，十进制 |
| `%r` | 设备文件所代表设备的类型号，十进制 |
| `%R` | 设备文件所代表设备的类型号，十六进制 |
| `%Hr` | 代表设备的 major，十进制 |
| `%Lr` | 代表设备的 minor，十进制 |
| `%t` | 代表设备的 major，十六进制 |
| `%T` | 代表设备的 minor，十六进制 |

`%r/%R/%Hr/%Lr/%t/%T` 主要对块设备和字符设备有定义；普通文件不要把它们误解为所在磁盘。

### 5.4 时间

| 指令 | 含义 |
|---|---|
| `%x` | 人类可读 atime |
| `%X` | atime，Unix Epoch 秒 |
| `%y` | 人类可读 mtime |
| `%Y` | mtime，Unix Epoch 秒 |
| `%z` | 人类可读 ctime |
| `%Z` | ctime，Unix Epoch 秒 |
| `%w` | 人类可读 birth time；未知显示 `-` |
| `%W` | birth time Epoch 秒；未知显示 `0` |

Epoch 指令可指定小数精度：

```bash
stat -c 'mtime_s=%Y mtime_ms=%.3Y mtime_ns=%.Y' file
```

截断多余精度时向负无穷方向处理。目标文件系统可能无法保存纳秒级时间。

## 6. 文件系统格式化指令全集

使用 `-f/--file-system` 后，FORMAT 采用另一套含义：

| 指令 | 含义 |
|---|---|
| `%a` | 普通用户可用空闲块数 |
| `%b` | 总数据块数 |
| `%c` | 总 inode/file node 数 |
| `%d` | 空闲 inode/file node 数 |
| `%f` | 空闲块数 |
| `%i` | 文件系统 ID，十六进制 |
| `%l` | 最大文件名长度 |
| `%n` | 给定文件名 |
| `%s` | 最佳传输块大小 |
| `%S` | 基本块大小，用于块计数 |
| `%t` | 文件系统类型，十六进制 |
| `%T` | 人类可读文件系统类型 |

示例：

```bash
stat -f -c 'name=%n type=%T blocks=%b free=%f avail=%a block=%S' /data
```

`%a` 和 `%f` 可能不同，因为文件系统可为特权用户保留块。容量监控还应使用 `df`、配额和存储系统指标。

## 7. `--format` 与 `--printf`

```bash
stat --format='%d:%i:%n' file1 file2
```

每个 FILE 自动输出换行。

```bash
stat --printf='%d:%i:%n\0' file1 file2
```

`--printf`：

- 不自动追加换行。
- 解释 `\n`、`\t`、`\\`、八进制等反斜杠转义。
- 可使用 NUL 分隔，适合特殊文件名。

脚本处理多个路径时，不要使用冒号、空格或换行作为唯一分隔而又允许文件名包含它们；使用 NUL 或结构化程序接口。

## 8. 格式宽度、标志与精度

基本语法：

```text
%[FLAGS][WIDTH][.PRECISION]DIRECTIVE
```

常见 flags：

| 标志 | 作用 |
|---|---|
| `#` | 数值使用替代形式，例如八进制前缀 |
| `0` | 数字以 0 填充 |
| `-` | 左对齐 |
| `+` | 显示正负号 |
| 空格 | 正数前留空格 |

```bash
stat -c 'mode=%#03a uid=%-8u size=%12s' file
```

字符串精度可限制输出宽度；时间 Epoch 精度控制小数位。对日志字段使用固定格式前，要考虑数值超出宽度和文件名任意字符。

## 9. `%N` 与引用风格

`%N` 的文件名引用受 `QUOTING_STYLE` 影响。常见值：

```text
literal
shell
shell-always
shell-escape
shell-escape-always
c
c-maybe
escape
clocale
locale
```

```bash
QUOTING_STYLE=shell-escape-always stat -c '%N' -- "$file"
```

显示可复制引用适合人工诊断；机器传输仍优先 `--printf='%n\0'`。

## 10. 符号链接：默认与 `-L`

```bash
ln -s target link

stat -- link
stat -L -- link
```

- 默认：报告链接 inode、链接本身大小和时间。
- `-L`：报告目标对象。
- `-f` 隐含 `-L`，因为报告的是目标所在文件系统。

并排比较：

```bash
stat -c 'link inode=%i type=%F size=%s name=%N' link
stat -Lc 'target inode=%i type=%F size=%s name=%N' link
```

悬空链接默认 `stat` 成功，`stat -L` 因目标不存在而失败。

## 11. `--cached` 与远程文件系统

| MODE | 行为 |
|---|---|
| `default` | 由底层文件系统决定 |
| `always` | 尽量使用已有缓存属性，可能不新鲜 |
| `never` | 请求最新同步属性，也可能触发 automount |

```bash
stat --cached=always /remote/path
stat --cached=never /remote/path
```

在 NFS、CephFS、自动挂载和高延迟元数据系统中：

- `always` 减少网络访问，但可能看到旧属性。
- `never` 更强调新鲜度，可能阻塞、增加服务端压力并触发挂载。
- 选项是请求，具体支持和一致性由内核/文件系统决定。

不要在大目录循环中无评估地对每个文件强制 fresh stat。

## 12. inode、设备号和文件身份

单独 inode 不能跨文件系统唯一标识文件。更合理的组合是：

```bash
stat -c 'device=%d inode=%i links=%h name=%n' file
```

同一文件系统内，`device + inode` 可用于比较两个路径是否指向同一对象：

```bash
test "$(stat -c '%d:%i' a)" = "$(stat -c '%d:%i' b)"
```

但文件删除后 inode 可以复用；长期业务身份还需版本、校验和或应用 ID。

## 13. 挂载点与 bind mount

```bash
stat -c '%m' /path
findmnt -T /path
```

`%m` 与 `df` 的挂载点查找并不完全相同：

- 默认不解引用符号链接。
- 设备节点按自身处理。
- bind mount 可能输出当前别名挂载点，而不是底层初始挂载点。

复杂挂载问题使用 `findmnt` 和 `/proc/<pid>/mountinfo` 交叉验证。

## 14. 大小、块数和稀疏文件

```bash
stat -c 'size=%s blocks=%b block_bytes=%B allocated=%b*%B' sparse-file
du -h sparse-file
ls -lh sparse-file
```

Shell 不会计算字符串中的 `%b*%B`；需要计算时分别读取数值。逻辑大小大、分配块少通常表示稀疏文件，也可能涉及压缩或共享块。

Reflink、快照和去重使单文件“真实独占物理空间”难以由 stat 单独得出。

## 15. 退出状态与竞态

| 状态 | 含义 |
|---:|---|
| `0` | 所有目标查询成功 |
| 非 `0` | 至少一个目标无法访问或参数/格式无效 |

多目标可能部分输出后失败。更重要的是 TOCTOU：

```bash
stat target
# target 在这里可能被替换
some-write-command target
```

`stat` 成功不能保证后续路径仍指向同一 inode。安全程序需要 `openat`、文件描述符和内核原子接口；Shell 脚本只能通过限制目录权限、缩短窗口和重新验证降低风险。

## 16. 常见生产查询

### 16.1 权限与身份

```bash
stat -c 'mode=%a owner=%u:%g inode=%d:%i links=%h name=%N' file
```

### 16.2 时间审计

```bash
TZ=UTC stat -c 'atime=%x%nmtime=%y%nctime=%z%nbirth=%w' file
```

### 16.3 同文件系统判断

```bash
src_dev=$(stat -c %d source) || exit 1
dst_dev=$(stat -c %d destination-parent) || exit 1
test "$src_dev" = "$dst_dev"
```

这有助于预判 `mv` 是否能直接 rename，但实际挂载/覆盖语义仍需结合目标路径。

### 16.4 文件系统能力快照

```bash
stat -f -c 'type=%T id=%i block=%S total=%b free=%f avail=%a inodes=%c free_inodes=%d' /data
```

## 17. 常见错误与排查

| 现象 | 方向 |
|---|---|
| `No such file` | 路径不存在、悬空链接配合 `-L`、Namespace 不同 |
| `Permission denied` | 父目录搜索权限、ACL、安全策略 |
| 查询 NFS 很慢 | 属性缓存、服务端、网络、automount |
| Birth 显示 `-`/`0` | 文件系统或内核不提供创建时间 |
| inode 相同却认为是复制品 | 其实是硬链接 |
| size 大而 blocks 小 | 稀疏文件/压缩/共享块 |
| `%m` 与预期不同 | bind mount、链接解引用和 Namespace |

## 18. 动手实验

1. 对普通文件、目录、符号链接、FIFO、设备分别运行默认 stat。
2. 比较链接默认与 `-L` 的 inode、类型和大小。
3. 创建硬链接，用 `%d:%i:%h` 证明对象关系。
4. 创建稀疏文件，比较 `%s`、`%b`、`du`。
5. 使用 `-c` 和 `--printf` 输出多个含空格/换行名称的文件。
6. 在 NFS/CephFS 测试环境比较 cached 三种模式的延迟与新鲜度。
7. 比较文件模式和 `-f` 文件系统模式中同一格式字母的不同含义。

## 19. 掌握标准

- 能列出 GNU `stat` 的全部参数。
- 能使用文件模式和文件系统模式的全部格式化指令。
- 能区分 size、blocks、IO Block 和文件系统 block。
- 能用 device+inode 识别硬链接，同时理解 inode 复用边界。
- 能解释默认与 `-L`、cached 三种模式。
- 能说明为什么 stat 后再操作仍存在 TOCTOU 竞态。

## 20. 官方参考 {/* #官方参考 */}

- [GNU coreutils 9.11：stat invocation](https://www.gnu.org/software/coreutils/manual/html_node/stat-invocation.html)
- [Linux stat(2)](https://man7.org/linux/man-pages/man2/stat.2.html)
- [Linux inode(7)](https://man7.org/linux/man-pages/man7/inode.7.html)

上一篇：[`ln` 命令详解](./11-ln命令详解.md)

下一篇：[`readlink` 命令详解](./13-readlink命令详解.md)
