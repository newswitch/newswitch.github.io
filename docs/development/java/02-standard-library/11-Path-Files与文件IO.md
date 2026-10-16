---
title: "Path、Files 与文件 I/O 的资源和持久化边界"
sidebar_label: "11. Path、Files 与文件 I/O"
sidebar_position: 11
description: "区分字节流与字符流、路径与实际文件、流式与全量读取，以及 flush、关闭、原子移动和落盘保证。"
tags: [Java, Files, Path, IO, 持久化]
---

# Path、Files 与文件 I/O 的资源和持久化边界

把任务写入文件，涉及的不只是一个 write 调用：路径指向哪里、文本使用什么编码、缓冲何时送出、失败后是否留下半份文件，都决定了结果是否可用。

本篇使用 JDK 25。实验只在自己创建的临时目录中读写和删除，不接触已有业务文件。

## 1. 路径、字节与字符

Path 是路径描述，不会因 Path.of 就创建文件。相对路径相对于进程工作目录解析，normalize 只做路径语法规范化，不证明文件存在，也不解析所有符号链接关系。

InputStream/OutputStream 处理字节，Reader/Writer 处理字符；InputStreamReader/OutputStreamWriter 在两者之间按字符集转换。BufferedReader/BufferedWriter 再减少小操作次数，不改变文本编码规则。

```text
String → Writer 的字符编码 → 字节缓冲 → 操作系统文件缓存 → 存储设备
```

flush 把相应 Java 缓冲向下游推进，不等于数据已抵抗断电。close 负责结束资源生命周期，也可能失败。严格持久化还要结合 FileChannel.force、文件系统和设备保证。[Files API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Files.html)区分了读写方法和选项。

## 2. 小文件与大文件的读取方式

readString/readAllBytes 简洁，但会把全部内容放进内存，只适合大小可控输入。大文件使用流式读取，除了限制总大小，还要限制单行长度、结果数量和处理时间；普通 readLine 本身不提供业务行长上限。

Files.lines/list/walk 返回的流需要关闭。一个中间操作返回新 Stream，不意味着底层文件或目录句柄已经释放。使用 try-with-resources 维护所有权。

## 3. 读写与失败清理实验

```java title="FileDemo.java"
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.List;

public class FileDemo {
    public static void main(String[] args) throws Exception {
        Path directory = Files.createTempDirectory("java-file-demo-");
        Path file = directory.resolve("tasks.txt");
        try {
            try (var writer = Files.newBufferedWriter(file, StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE)) {
                writer.write("backup\nverify\n");
            }
            List<String> lines = Files.readAllLines(file, StandardCharsets.UTF_8);
            System.out.println("lines=" + lines);
            try (var stream = Files.lines(file, StandardCharsets.UTF_8)) {
                System.out.println("count=" + stream.count());
            }
            System.out.println("bytes=" + Files.size(file));
            try {
                Files.writeString(file, "unexpected", StandardCharsets.UTF_8,
                        StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
            } catch (java.nio.file.FileAlreadyExistsException expected) {
                System.out.println("overwrite=refused");
            }
        } finally {
            Files.deleteIfExists(file);
            Files.deleteIfExists(directory);
        }
        System.out.println("cleaned=" + Files.notExists(directory));
    }
}
```

```bash
javac -encoding UTF-8 --release 25 -d out FileDemo.java
java -cp out FileDemo
```

```text title="expected-output"
lines=[backup, verify]
count=2
bytes=14
overwrite=refused
cleaned=true
```

示例直接写 `\n`，因此 Windows 与 Linux 的文件字节数一致。CREATE_NEW 把“不覆盖已有文件”交给创建操作，而不是先 exists 再写，避免检查与使用之间的竞争窗口。

## 4. 覆盖、追加与原子发布

writeString 的便捷默认选项可能创建或截断文件，已有重要内容不能无意识覆盖。APPEND 表达追加，但多个写者、字符编码和日志完整性仍要单独设计，不能把一次 write 当作任意平台都原子的事务。

发布配置或快照常用同目录临时文件：完整写入并关闭，再请求 ATOMIC_MOVE 到最终位置。文件系统不支持时会抛 AtomicMoveNotSupportedException；跨文件系统移动尤其不能假设原子。

原子可见与崩溃持久是两件事。ATOMIC_MOVE 下目标已存在的处理也受实现影响，不能把它与 REPLACE_EXISTING 组合就宣称跨平台保证原子覆盖。重要快照需根据平台验证替换行为、同步文件和目录的要求，并保留恢复策略。

## 5. 路径安全与错误诊断

外部文件名要限制在明确根目录内，resolve 后检查路径只是基础，还需考虑符号链接、权限和并发替换。不要把用户输入拼进任意绝对路径，也不要以管理员身份扩大读写权限来掩盖设计问题。

错误应区分不存在、权限不足、磁盘空间不足和句柄占用。Files.exists 返回 false 也可能是无法确定存在性，不能把它作为所有错误的诊断结论。保留 IOException 原因和实际操作阶段更有用。

## 6. 练习与答案

### 6.1 close 成功是否证明断电后文件必然完整

不能。它释放资源并推动相应缓冲，但崩溃持久还取决于强制写出、目录项、文件系统和设备。根据数据重要性选择更强协议，不把便捷 API 当数据库事务。

### 6.2 已经 count 完 Files.lines，为什么还要 close

终止消费不等于 API 保证释放底层资源。try-with-resources 才明确表达释放路径，包括中途异常或短路退出。

### 6.3 读取 20GB 日志能用 readAllLines 吗

不应如此。它还会创建大量字符串与列表元素，内存成本不止文件大小。使用流式处理并限制单条记录和聚合状态。

## 7. 继续阅读

- [Path API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/file/Path.html)
- [NIO、Buffer、Channel 与 Selector](./12-NIO-Buffer-Channel与Selector.md)
