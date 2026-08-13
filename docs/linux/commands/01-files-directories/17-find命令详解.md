---
title: find 命令详解：遍历、测试、表达式、执行与安全删除
sidebar_position: 17
description: 系统讲解 GNU findutils 4.10 find 的命令行选项、全部测试与动作、运算符、printf 指令、符号链接、NUL 安全处理、性能优化和生产删除边界。
tags: [Linux, find, GNU findutils, 文件查找, SRE]
---

# `find` 命令详解：遍历、测试、表达式、执行与安全删除

`find` 不是“文件名搜索框”，而是一台遍历目录树、对每个对象计算布尔表达式并执行动作的解释器。掌握它的关键不是背几个例子，而是理解四类元素：全局选项、测试、动作和运算符。

## 1. 命令档案

| 项目 | 内容 |
|---|---|
| 实现 | GNU findutils |
| 文档基线 | GNU findutils 4.10.0 |
| 软件包 | `findutils` |
| 安全级别 | 默认 `[R]`；`-exec` 为 `[W]`；`-delete` 为 `[D]` |
| 主要对象 | 起点、目录树、目录项、inode 元数据、表达式和动作 |

```bash
type -a find
find --version
find --help
```

BusyBox、BSD/macOS 与 GNU 在 `-printf`、`-delete`、`-files0-from`、正则类型等方面不同，脚本不能默认跨平台等价。

## 2. 完整语法与求值模型

```text
find [-H] [-L] [-P] [-D DEBUGOPTS] [-OLEVEL] [STARTING-POINT...] [EXPRESSION]
```

- 未给起点时使用 `.`。
- 未给表达式时使用 `-print`。
- 对每个访问到的对象，从左到右计算表达式。
- 相邻元素默认是 `-and`，并采用短路求值。
- 如果表达式包含 `-prune`、`-quit` 以外的动作，不再自动附加 `-print`。

```bash
find /srv -type f -name '*.log' -print
```

可读为：“从 `/srv` 遍历；对象是普通文件，并且 basename 匹配 `*.log` 时，打印它。”

## 3. 命令行级选项

这些选项位于起点之前。

| 参数 | 作用 |
|---|---|
| `-P` | 不跟随符号链接；默认模式，`-xtype` 有特殊语义 |
| `-L` | 遍历时跟随符号链接；会改变属性测试对象，并隐含 `-noleaf` |
| `-H` | 只跟随命令行起点及命令行引用文件中的符号链接 |
| `-D DEBUGOPTS` | 输出调试信息；可用值以本机 `find -D help` 为准 |
| `-O0` | 当前等价于 `-O1` |
| `-O1` | 默认优化；优先执行仅依赖名称的测试 |
| `-O2` | 再把 `-type/-xtype` 等低成本测试提前 |
| `-O3` | 按成本和估算成功率进一步重排无副作用测试 |
| `--help` | 显示帮助并退出 |
| `--version`、`-version` | 显示版本并退出 |

GNU 手册记录的 `-D` 值包括 `tree`、`stat`、`opt`、`rates`、`all`、`help`；调试值的兼容性不保证，必须查询当前版本。

```bash
find -D tree -O2 /srv -type f -name '*.log' -print
```

优化不会相对重排具有副作用的谓词，但复杂表达式仍应自己写清括号和动作位置。

## 4. 起点与 `-files0-from`

名称以 `-` 开头时，`--` 不能可靠解决起点与表达式的语法歧义。使用绝对路径或 `./`：

```bash
find ./-cache -maxdepth 0 -print
```

GNU 4.9 起支持：

```text
-files0-from FILE
```

它从 `FILE` 读取 NUL 分隔起点；`-` 表示标准输入。不能同时给命令行起点；输入为空时不会默认搜索 `.`；`-files0-from -` 不能与 `-ok/-okdir` 同用。

```bash
printf '%s\0' './a path' './-strange' |
find -files0-from - -maxdepth 0 -type f -print0
```

## 5. 全局与位置选项全集

这些选项写在表达式中，但影响整体遍历。位置选项可能只影响其后的测试，应尽量放在表达式前部。

| 选项 | 作用 |
|---|---|
| `-depth` | 先处理目录内容，再处理目录本身 |
| `-d` | `-depth` 的兼容同义词 |
| `-daystart` | `-amin/-atime/-cmin/-ctime/-mmin/-mtime` 从今天开始而非当前时刻计算 |
| `-follow` | 跟随符号链接，类似 `-L`；位置相关，优先用起始处 `-L` |
| `-regextype TYPE` | 选择其后 `-regex/-iregex` 的语法 |
| `-warn` | 启用警告 |
| `-nowarn` | 关闭警告 |
| `-ignore_readdir_race` | 忽略目录读取后文件消失导致的部分错误；会影响 `-delete` 真值 |
| `-noignore_readdir_race` | 关闭上述行为 |
| `-maxdepth N` | 最多下降 N 层；起点为 0 |
| `-mindepth N` | N 层之前不应用测试和动作，但仍遍历 |
| `-mount` | 不下降到其他文件系统 |
| `-xdev` | `-mount` 的同义词 |
| `-noleaf` | 禁用基于 Unix 目录链接计数的 leaf 优化 |
| `-files0-from FILE` | 读取 NUL 分隔起点 |

`-xdev` 按设备/文件系统边界判断，不等于“只在一个业务目录”；bind mount、overlay 和网络文件系统要结合 `findmnt` 验证。

## 6. 数字参数统一规则

很多测试接受 `n`：

| 写法 | 含义 |
|---|---|
| `n` | 恰好 n |
| `+n` | 大于 n |
| `-n` | 小于 n |

不要把 `-mtime -1` 理解成“一天前”。它表示按 24 小时桶取整后小于 1，通常是最近 24 小时内；分钟级边界使用 `-mmin` 更直观。

## 7. 名称与路径测试

| 测试 | 作用 |
|---|---|
| `-name PATTERN` | basename 匹配 Shell glob |
| `-iname PATTERN` | 忽略大小写的 `-name` |
| `-path PATTERN` | 从起点开始的完整已遍历名称匹配 glob |
| `-wholename PATTERN` | `-path` 同义词 |
| `-ipath PATTERN` | 忽略大小写的 `-path` |
| `-iwholename PATTERN` | `-ipath` 同义词 |
| `-regex REGEX` | 整个已遍历名称匹配正则，不是局部搜索 |
| `-iregex REGEX` | 忽略大小写的 `-regex` |
| `-lname PATTERN` | 符号链接保存的目标字符串匹配 glob |
| `-ilname PATTERN` | 忽略大小写的 `-lname` |

模式必须引用，防止 Shell 提前展开：

```bash
find . -type f -name '*.log' -print
find . -path '*/.git/*' -prune -o -type f -print
find . -regextype posix-extended -regex '.*/[0-9]{8}\.log' -print
```

GNU 正则类型包括 `findutils-default`、`emacs`、`gnu-awk`、`grep`、`posix-awk`、`awk`、`posix-basic`、`posix-egrep`、`egrep`、`posix-extended`；可用集合应以本机手册为准。

## 8. 时间测试全集

| 测试 | 比较对象 |
|---|---|
| `-amin N`、`-atime N` | 访问时间，单位分钟/24 小时 |
| `-cmin N`、`-ctime N` | inode 状态变更时间，单位分钟/24 小时 |
| `-mmin N`、`-mtime N` | 内容修改时间，单位分钟/24 小时 |
| `-anewer REF` | atime 比参考文件 mtime 新 |
| `-cnewer REF` | ctime 比参考文件 mtime 新 |
| `-newer REF` | mtime 比参考文件 mtime 新 |
| `-newerXY REF` | 当前文件的 X 时间比参考来源 Y 新 |
| `-used N` | ctime 之后第 N 个 24 小时区间访问过 |

`X` 可为 `a`、`B`、`c`、`m`；`Y` 可为 `a`、`B`、`c`、`m`、`t`。`t` 时 `REF` 是日期字符串。Birth time `B` 受内核和文件系统支持限制；不支持时可能报错或永不匹配。

```bash
find /var/log -type f -mmin +30 -print
find /data -type f -newermt '2026-08-11 00:00:00 +08:00' -print
find /data -type f ! -newer /tmp/checkpoint -print
```

`-newermt` 是 `-newerXY` 中 `X=m,Y=t` 的写法。生产脚本应显式时区，例如设置 `TZ=UTC` 或在日期中写偏移。

## 9. 类型、大小、链接与 inode

### 9.1 类型

```text
-type C
-xtype C
```

`C`：`b` 块设备、`c` 字符设备、`d` 目录、`p` FIFO、`f` 普通文件、`l` 符号链接、`s` Socket、`D` door（支持平台）。GNU 还允许逗号连接类型，例如 `-type f,l`。

`-type` 检查当前链接策略下的对象；`-xtype` 通常检查另一侧，适合寻找悬空链接：

```bash
find . -xtype l -print
```

### 9.2 大小

| 测试 | 作用 |
|---|---|
| `-size N` | 默认按 512 字节块向上取整 |
| `-size Nc` | 字节 |
| `-size Nw` | 2 字节字 |
| `-size Nb` | 512 字节块 |
| `-size Nk` | KiB |
| `-size NM` | MiB |
| `-size NG` | GiB |
| `-empty` | 普通文件大小为 0，或目录无条目 |

```bash
find /data -type f -size +10G -printf '%s\t%p\n'
```

`-size` 看逻辑长度，不等于实际分配空间；稀疏文件、压缩和 Reflink 应结合 `stat`、`du`。

### 9.3 inode 与链接

| 测试 | 作用 |
|---|---|
| `-inum N` | inode 编号为 N |
| `-links N` | 硬链接计数为 N |
| `-samefile FILE` | 与 FILE 具有相同 device+inode |

```bash
find /same/filesystem -xdev -samefile ./known -print
```

## 10. 所有者、权限与文件系统测试

| 测试 | 作用 |
|---|---|
| `-uid N`、`-gid N` | 数字 UID/GID |
| `-user NAME`、`-group NAME` | 用户/组名或可接受的数字 ID |
| `-nouser`、`-nogroup` | UID/GID 无法解析到名称 |
| `-perm MODE` | 权限位与 MODE 完全相等 |
| `-perm -MODE` | MODE 中所有位都已设置 |
| `-perm /MODE` | MODE 中任意一位已设置 |
| `-readable`、`-writable`、`-executable` | 当前用户通过 `access(2)` 判断可执行相应操作 |
| `-fstype TYPE` | 所在文件系统类型匹配 |
| `-context PATTERN` | SELinux 上下文匹配 glob；需构建和系统支持 |

```bash
find /srv -type f -perm -0002 -print
find /srv -type f -perm /6000 -ls
find /home -nouser -o -nogroup
```

`-perm` 只看 mode bits；`-readable` 等考虑当前访问检查，但 ACL、NFS 服务端、只读挂载和竞态仍会让“测试后操作”失败。

## 11. 真值、运算符和优先级

从高到低：

1. `( EXPR )`
2. `! EXPR`、`-not EXPR`
3. 相邻表达式、`-a`、`-and`
4. `-o`、`-or`
5. `,`

另有 `-true` 和 `-false`。

Shell 中括号要引用或转义：

```bash
find . \( -name '*.log' -o -name '*.out' \) -type f -print
```

经典错误：

```bash
find . -name '*.log' -o -name '*.out' -print
```

由于 `-and` 优先于 `-or`，匹配 `.log` 的左支为真后短路，未必执行 `-print`。必须加括号。

逗号 `EXPR1 , EXPR2` 总会计算两侧并返回右侧真值，适合一次遍历执行两个独立动作，但删除、剪枝等副作用仍会相互影响。

## 12. 输出动作全集

| 动作 | 作用 |
|---|---|
| `-print` | 打印名称并换行 |
| `-print0` | 打印名称并以 NUL 结束 |
| `-printf FORMAT` | 自定义格式，不自动换行 |
| `-fprint FILE` | 将 `-print` 写入文件 |
| `-fprint0 FILE` | 将 `-print0` 写入文件 |
| `-fprintf FILE FORMAT` | 将格式化结果写入文件 |
| `-ls` | 类似 `ls -dils` 的引用安全格式 |
| `-fls FILE` | 将 `-ls` 写入文件 |

对于机器消费的任意文件名，优先 `-print0`。`-print` 适合人读，不适合 `for x in $(find ...)`。

### 12.1 `-printf` 指令全集

| 类别 | 指令 |
|---|---|
| 名称 | `%p` 已遍历名称，`%f` basename，`%h` dirname，`%P` 去掉起点前缀，`%H` 对应起点 |
| 所有者 | `%u/%U` 用户名/UID，`%g/%G` 组名/GID |
| 大小 | `%s` 字节，`%b` 512 字节块数，`%k` KiB 块数，`%S` 稀疏度 |
| 位置 | `%d` 深度，`%D` 设备号，`%F` 文件系统类型 |
| 时间 | `%a/%Ak` atime，`%c/%Ck` ctime，`%t/%Tk` mtime，`%Bk` birth time；`k` 是时间格式字符 |
| 其他元数据 | `%i` inode，`%n` 链接数，`%m` 八进制权限，`%M` 符号权限，`%l` 链接目标，`%y` 类型，`%Y` 解引用后类型，`%Z` SELinux 上下文 |
| 字面量 | `%%` 百分号 |

时间 `k` 支持 `@`（Epoch 秒及小数）和大多数 `strftime` 字段。Birth time 不可用时 `%B` 可能为空。

常用转义：`\a`、`\b`、`\c`（停止当前格式输出）、`\f`、`\n`、`\r`、`\t`、`\v`、`\\`、`\0NNN`；未识别转义和末尾 `%` 的行为不应依赖。

```bash
find /data -type f -printf '%D:%i\t%s\t%TY-%Tm-%TdT%TH:%TM:%TS%Tz\t%p\0'
```

## 13. 执行动作全集

| 动作 | 行为 |
|---|---|
| `-exec COMMAND {} \;` | 每个匹配对象执行一次，从启动 find 的目录运行 |
| `-exec COMMAND {} +` | 尽量批量追加多个名称，减少进程数；`{}` 必须在末尾附近 |
| `-execdir COMMAND {} \;` | 在匹配对象所在子目录执行一次 |
| `-execdir COMMAND {} +` | 在各子目录内批量执行 |
| `-ok COMMAND {} \;` | 每个对象询问后执行 |
| `-okdir COMMAND {} \;` | 在对象所在目录询问后执行 |

```bash
find /srv -type f -name '*.log' -exec gzip -- {} +
find /srv -type f -execdir sh -c 'for f do printf "%s\n" "$f"; done' sh {} +
```

`-execdir` 可降低某些路径替换风险，但要求安全的 `PATH`，不能包含空项或相对目录。`-exec sh -c '...'` 时用固定占位参数占 `$0`，文件列表从 `$1` 开始。

任何“先找后操作”都可能遭遇目录项竞态。对攻击者可写目录，不要把 `find` 当安全文件事务引擎。

## 14. `-prune`、`-quit` 与 `-delete`

| 动作 | 作用 |
|---|---|
| `-prune` | 不下降当前目录；在 `-depth` 下无效 |
| `-quit` | 立即停止，已构造的 `-exec ... +` 批次会执行 |
| `-delete` | 删除当前对象；自动启用 `-depth`，成功返回真 |

排除目录模板：

```bash
find . -path './.git' -prune -o -type f -print
```

安全删除必须先用完全相同的起点、链接策略、深度和测试预览：

```bash
find /srv/cache -xdev -mindepth 1 -type f -mtime +30 -print
# 人工核对后才将最后的 -print 改成 -delete
find /srv/cache -xdev -mindepth 1 -type f -mtime +30 -delete
```

风险边界：

- `-delete` 隐含 `-depth`，所以与 `-prune` 组合通常达不到预期。
- 删除非空目录会失败；更早删除子项后目录可能变空。
- `-L`、挂载边界、起点为空变量和错误括号都可能扩大范围。
- 删除期间并发创建/重命名会改变结果。
- `-ignore_readdir_race` 会改变部分“对象已消失”场景的错误和真值。

## 15. 性能与大规模目录树

1. 用更窄的起点，不要习惯从 `/` 扫描。
2. 用 `-xdev` 避免进入不需要的网络/容器挂载。
3. 把便宜且选择性强的名称、类型测试写清楚，再考虑 `-O2/-O3`。
4. `-exec ... +` 比 `\;` 少大量进程启动。
5. `-printf` 可一次输出需要的元数据，减少后续逐文件 `stat`。
6. `-D stat/rates/tree` 用于验证假设，不要在生产长期开启。
7. 海量单目录的瓶颈通常是目录遍历和元数据 IO，不是 `find` 语法本身。

## 16. 故障排查

| 现象 | 检查方向 |
|---|---|
| 没有结果 | 起点、引用模式、权限、`-mindepth`、时间桶、链接策略 |
| 输出范围过大 | `-o` 优先级、缺少括号、Shell 提前展开 |
| `Permission denied` | 父目录搜索权限、ACL、SELinux、NFS 身份映射 |
| 循环警告 | `-L` 跟随链接形成环 |
| 同名文件漏掉 | `-name` 只看 basename；大小写和 locale |
| 删除目录失败 | 非空、`-delete` 深度顺序、并发创建、权限 |
| 查找很慢 | 网络挂载、automount、元数据冷缓存、起点过宽、逐文件 exec |
| 脚本破坏含空格名称 | 改用 `-print0`、`-files0-from`、`-exec ... +` |

退出状态 `0` 表示遍历和处理总体成功，不表示“找到了至少一个匹配”。若要判断是否存在，可使用 `-print -quit` 并检查输出，或在执行动作中显式传回状态。

## 17. 动手实验

1. 建立含普通文件、目录、链接、悬空链接、FIFO 和 Socket 的测试树。
2. 画出三个不同表达式的运算树，再用 `-D tree` 验证。
3. 比较 `-P/-H/-L` 下 `-type` 和 `-xtype`。
4. 对带空格、换行和前导 `-` 的名称验证 `-print0` 与 `-files0-from`。
5. 比较 `-mtime 0`、`-mtime -1`、`-mmin` 和 `-newermt`。
6. 对稀疏文件比较 `-size`、`%s/%b/%S`。
7. 比较 `-exec ... \;`、`-exec ... +` 和 `-execdir ... +` 的进程数与工作目录。
8. 只在临时目录完成“预览后 `-delete`”实验，并制造并发变化观察结果。

## 18. 掌握标准

- 能把任意 `find` 命令拆成起点、选项、测试、动作、运算符。
- 能列出 GNU `find` 的测试与动作全集，并知道如何查询版本差异。
- 能正确解释 `-and/-or` 优先级和短路。
- 能使用 NUL 协议处理任意文件名。
- 能选择链接策略、挂载边界、深度和时间语义。
- 能先证明选择集合，再评估 `-exec/-delete` 的竞态和回滚边界。

## 官方参考

- [GNU findutils 4.10：find manual](https://www.gnu.org/software/findutils/find)
- [GNU findutils：Primary Index](https://www.gnu.org/software/findutils/manual/html_node/find_html/Primary-Index.html)
- [GNU findutils：Security Considerations](https://www.gnu.org/software/findutils/manual/html_node/find_html/Security-Considerations-for-find.html)
- [Linux path_resolution(7)](https://man7.org/linux/man-pages/man7/path_resolution.7.html)

上一篇：[`dirname` 命令详解](./16-dirname命令详解.md)

下一篇：[`install` 命令详解](./18-install命令详解.md)
