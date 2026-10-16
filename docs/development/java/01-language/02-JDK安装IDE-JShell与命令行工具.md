---
title: "JDK 安装、IDE、JShell 与命令行工具"
sidebar_label: "02. JDK 安装与开发工具"
sidebar_position: 2
description: "在 Windows 和 Linux 建立隔离的 JDK 25 环境，核对 PATH、JAVA_HOME、IDE 与 Maven，并完成编译运行和 JShell 验收。"
tags: [Java, JDK25, 安装, JShell, 开发环境]
---

# JDK 安装、IDE、JShell 与命令行工具

Java 环境最常见的困惑是机器上装了一个版本，而终端、IDE 和 Maven 分别使用其他版本。可靠的安装结果应能说明当前执行的程序在哪里、属于哪个 JDK，以及构建目标是什么。

本篇用可解压的 JDK 25 建立实验环境，先在当前终端生效。发行版可以选择符合所需支持和许可条件的 OpenJDK 发行版；以下路径只是示例，以解压后的实际目录为准。

## 1. 选择包并保留版本信息

下载时核对操作系统、CPU 架构、JDK 主版本和补丁版本。Windows x64 包与 Linux aarch64 包不能互换；JRE 和 JDK 的工具集合也不同。

从发行方官方站点取得压缩包和对应校验值，比较本地摘要。校验值应来自发行方公布的位置，不能用自己计算的摘要再与自己比较。

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath .\jdk25.zip
```

```bash
sha256sum jdk25.tar.gz
```

摘要具体内容取决于下载文件，本篇不提供一个适用于所有发行版的固定值。解压到用户拥有的独立目录后，再配置环境。

## 2. Windows PowerShell

假设实际 JDK 根目录为 `C:\Tools\jdk-25`，其中直接包含 `bin\java.exe`。

```powershell
$env:JAVA_HOME = 'C:\Tools\jdk-25'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
Get-Command java,javac,jshell | Select-Object Name,Source
java -version
javac -version
```

示例输出省略补丁和构建细节：

```text
Name       Source
----       ------
java.exe   C:\Tools\jdk-25\bin\java.exe
javac.exe  C:\Tools\jdk-25\bin\javac.exe
jshell.exe C:\Tools\jdk-25\bin\jshell.exe

java version "25..."
javac 25...
```

`JAVA_HOME` 指向 JDK 根，不应包含 `bin`。把 bin 放到 PATH 前面，是让这次终端优先找到该版本。Java 启动器本身不会因为 JAVA_HOME 改了就自动绕开 PATH；Maven 等工具则可能使用 JAVA_HOME 查找 Java。

上述修改只作用于当前 PowerShell 和它启动的子进程。需要长期生效时再在用户环境变量中设置，并重新打开终端；已经运行的 IDE 不会自动获得新环境。

路径包含空格时，直接调用使用调用运算符：

```powershell
& 'C:\Program Files\Java\jdk-25\bin\java.exe' -version
```

## 3. Linux

假设实际路径是 `/opt/jdks/jdk-25`，并已由相应用户安装和赋予读取执行权限。

```bash
export JAVA_HOME=/opt/jdks/jdk-25
export PATH="$JAVA_HOME/bin:$PATH"
hash -r
command -v java
command -v javac
java -version
javac -version
```

示例路径：

```text
/opt/jdks/jdk-25/bin/java
/opt/jdks/jdk-25/bin/javac
```

发行版软件包和 alternatives 也可以管理 Java，但切换全局默认可能影响其他应用。实验中可以直接用绝对路径，服务则在 systemd 或容器中显式指定运行时。

当结果不符合预期，先查看：

```bash
type -a java
readlink -f "$(command -v java)"
```

`type` 检查别名、函数与多个候选，`readlink` 检查符号链接的实际目标。Shell 缓存、别名和 PATH 顺序都可能影响命令解析。

## 4. 完成一次真实编译

保存[前一篇的 Hello.java](./01-Java技术栈与程序执行路径.md)，在它所在目录执行：

```bash
javac -encoding UTF-8 --release 25 -d out Hello.java
java -cp out Hello Infra
```

必须看到：

```text
Hello, Infra
```

这比仅执行 `java -version` 多验证了编译器、目标版本、文件编码和 Classpath。Windows/Linux 可以使用相同的 Java 命令；命令行中多个 Classpath 项的分隔符则分别是 `;` 和 `:`。

## 5. JShell 用来做什么

输入 `jshell` 进入交互环境，再逐条输入：

```java
int waiting = 3;
waiting + 2
System.out.println("ready=" + waiting);
```

输出中的临时变量编号会因会话不同而变化，但表达式值应为 5，最后一行为：

```text
ready=3
```

常用命令：

| 命令 | 作用 |
| --- | --- |
| `/help` | 查询交互命令和用法 |
| `/list` | 查看已经提交的片段 |
| `/vars` | 查看变量 |
| `/reset` | 重置交互状态 |
| `/exit` | 结束会话 |

JShell 可以探索表达式和 API，但它允许片段逐步提交，状态也会累积。要验证完整源文件、包和构建，仍应使用 javac 或 Maven。

## 6. IDE 中需要分别检查的设置

IDE 可以选择 IntelliJ IDEA、Eclipse 或配置好 Java 扩展的编辑器。建立普通 Java 工程后核对：

| 设置 | 影响 |
| --- | --- |
| Project SDK | 工程分析和默认工具链 |
| Language level | 编辑器允许的语言规则 |
| Run configuration JRE/JDK | 点击运行时的实际 JVM |
| Maven runner/importer JDK | 导入依赖和构建时的 JVM |
| 编译 release 目标 | 输出 Class 版本和可用 API |

选择 JDK 25 不代表自动启用 Preview，也不代表 Maven 的配置被覆盖。把工程交给另一台机器时，应由工程配置表达目标，IDE 设置不能成为唯一事实来源。

## 7. 工具地图

| 工具 | 先认识的用途 |
| --- | --- |
| `java` | 运行类、JAR 或源文件模式 |
| `javac` | 编译并检查源码 |
| `javap` | 查看 Class 和字节码 |
| `jar` | 归档和查看 JAR 内容 |
| `javadoc` | 从公开接口注释生成 API 文档 |
| `jcmd`、`jstack`、`jstat` | 后续观察运行进程、线程与运行时指标 |
| `jshell` | 交互实验 |

## 8. 常见错误

| 现象 | 原因与检查 |
| --- | --- |
| java 有，javac 没有 | 可能只有运行时，或 PATH 指向其他目录 |
| `release version 25 not supported` | 正在使用不支持目标 25 的编译器 |
| IDE 能运行，终端不能运行 | 比较 JDK、工作目录、依赖和 Classpath |
| Maven 显示 Java 8 | 查看 `mvn -version` 与 JAVA_HOME，不只看终端 java |
| Linux 报 `Exec format error` | 核对操作系统和架构是否匹配 |
| 中文乱码 | 区分源文件编码、运行时 I/O 编码与终端显示编码 |

## 9. 练习与答案

### 9.1 JAVA_HOME 正确，但 java -version 仍是 8，怎么办

先查看 `Get-Command java` 或 `type -a java`。PATH、别名或 Shell 函数可能命中旧程序。调整当前终端的路径或使用 JDK 25 的绝对路径，再检查 javac 和 Maven。

### 9.2 能否仅安装 IDE 而不确认 JDK

不能把 IDE 自身的运行时视作工程工具链已经配置完成。IDE 可能自带运行环境，工程、运行任务和构建工具仍可使用不同 JDK。

### 9.3 JShell 算式正确，为什么还要保存完整文件验证

片段实验没有覆盖完整编译单元、文件名、包、依赖和构建结果。完整程序还必须验证入口与 Classpath。

## 10. 资料

- [JDK 25 安装指南](https://docs.oracle.com/en/java/javase/25/install/overview-jdk-installation.html)
- [JShell 指南](https://docs.oracle.com/en/java/javase/25/jshell/introduction-jshell.html)
- [开发工具文档](https://docs.oracle.com/en/java/javase/25/docs/specs/man/index.html)
- [下一篇：变量与类型](./03-变量类型转换溢出与装箱.md)
