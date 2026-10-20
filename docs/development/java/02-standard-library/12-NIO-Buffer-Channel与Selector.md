---
title: "NIO、Buffer、Channel、Selector 与内存映射"
sidebar_label: "12. NIO、Buffer、Channel 与 Selector"
sidebar_position: 12
description: "通过可运行二进制文件实验解释 position/limit/capacity、flip/clear/compact、部分读写、就绪事件、直接缓冲和映射生命周期。"
tags: [Java, NIO, ByteBuffer, Channel, Selector, mmap]
---

# NIO、Buffer、Channel、Selector 与内存映射

传统流把读写接口组织为字节或字符流；NIO 进一步把数据容器 Buffer 与传输端点 Channel 分开，并为可选择通道提供事件就绪机制。NIO 不等于所有操作都非阻塞，更不等于自动实现零拷贝。

本篇使用 JDK 25。先看清 Buffer 状态，再理解网络事件循环。

## 1. Buffer 的三个指针

![NIO 的 Selector、事件循环与缓冲区关系](/img/development/nio-selector.svg)

先把“通知就绪”“实际读写”和“业务处理”分开。下文的 Buffer 指针描述数据边界，不表示一次就能收到完整应用请求。

始终满足 `0 <= position <= limit <= capacity`：capacity 是容纳上限，limit 是当前可操作边界，position 是下一个相对读写位置。

```text
allocate(8)       position=0 limit=8 capacity=8
putInt 两次       position=8 limit=8 capacity=8
flip             position=0 limit=8 capacity=8
getInt 一次       position=4 limit=8 capacity=8
clear            position=0 limit=8 capacity=8
```

flip 把“刚写入了多少”变成读取边界；clear 重新允许写满容量，不擦除内容。compact 把尚未读取的数据移到前面，保留半包，再接收后续字节。ByteBuffer 的 get 是从缓冲取数据，Channel.read 则向缓冲写数据，两个视角容易混淆。[ByteBuffer API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/ByteBuffer.html)定义了状态操作。

## 2. 部分读写实验

```java title="NioDemo.java"
import java.io.EOFException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public class NioDemo {
    public static void main(String[] args) throws Exception {
        ByteBuffer data = ByteBuffer.allocate(8).order(ByteOrder.BIG_ENDIAN);
        data.putInt(42).putInt(7);
        System.out.println("writtenPosition=" + data.position());
        data.flip();
        System.out.println("readable=" + data.remaining());
        Path file = Files.createTempFile("java-nio-demo-", ".bin");
        try {
            try (var channel = FileChannel.open(file,
                    StandardOpenOption.READ, StandardOpenOption.WRITE)) {
                while (data.hasRemaining()) {
                    channel.write(data);
                }
                channel.force(true);
                channel.position(0);
                data.clear();
                while (data.hasRemaining()) {
                    if (channel.read(data) == -1) {
                        throw new EOFException("incomplete record");
                    }
                }
                data.flip();
                System.out.println("values=" + data.getInt() + "," + data.getInt());
                System.out.println("remaining=" + data.remaining());
            }
        } finally {
            Files.deleteIfExists(file);
        }
        ByteBuffer partial = ByteBuffer.allocate(8);
        partial.put(new byte[]{10, 20, 30}).flip();
        partial.get();
        partial.compact();
        System.out.println("retained=" + partial.position());
        System.out.println("space=" + partial.remaining());
    }
}
```

```bash
javac -encoding UTF-8 --release 25 -d out NioDemo.java
java -cp out NioDemo
```

```text title="expected-output"
writtenPosition=8
readable=8
values=42,7
remaining=0
retained=2
space=6
```

本例是本地阻塞 FileChannel。循环处理未完成读写；到文件末尾返回 -1，不等于暂时没有数据。缓冲明确选择大端字节序，二进制协议不能依赖开发者机器恰好采用的习惯。

## 3. Selector 管理的是就绪，不是完整消息

SocketChannel 可以设为非阻塞并注册 Selector。可读只表示现在尝试读取可能有进展，read 仍可能返回 0 或 -1；一次事件不能保证完整请求已到达。应用必须积累长度头、半包和未写完的响应。

```text
select 等待 → 取 selected key → 移除已处理 key
           → 检查可连接/可读/可写 → 做有限工作
           → 更新缓冲与 interestOps → 回到等待
```

只有还有待发送数据时才关心 OP_WRITE，长期注册通常会反复立即就绪而空转。事件循环里执行数据库阻塞调用或重计算，会拖住其他连接。FileChannel 不是 SelectableChannel，不能套用这套注册方法。详见 [Selector API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/Selector.html)。

## 4. 堆缓冲、直接缓冲与内存映射

allocate 使用堆缓冲；allocateDirect 可使用堆外内存，部分 I/O 场景可能减少中间复制，但分配释放成本更高，也会消耗进程 Native Memory。直接缓冲不是显存，不是无限容量，ByteBuffer 的对象和实际数据也可能分处不同内存区域。

FileChannel.map 可以映射文件区域，访问时可能触发缺页和实际存储 I/O。传统 MappedByteBuffer 的映射生命周期不等于 FileChannel 的打开周期，关闭通道不保证立即解除映射；Windows 下尤其要注意文件删除或替换。

JDK 25 还提供接收 Arena 的映射重载，返回 MemorySegment，可用 Arena 生命周期管理相应映射。两套 API 不能混为一谈，也不应依赖内部 Unsafe 强制解映射来绕过所有权。相关契约见 [FileChannel API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/channels/FileChannel.html)。

## 5. 零拷贝与持久化的范围

transferTo/transferFrom 可利用平台优化，但实际路径取决于通道、操作系统和加密，返回传输数量也可能少于请求量。称为零拷贝时应明确减少的是哪次 CPU 复制，不能理解为数据不经过内存或设备。

force 与映射缓冲 force 是不同调用点，其保证还取决于本地或远程存储及平台。性能优化前，先验证文件完整性、异常退出与持久化需求，再测吞吐与 CPU。

## 6. 练习与答案

### 6.1 写入三字节后直接 clear 再读取会怎样

读取边界恢复到整个容量，可能读到未写区域或旧内容。应 flip 使 limit 等于有效写入量；clear 不会记录有效数据长度。

### 6.2 非阻塞 write 返回 0，是否立即 while 重试

不能无限忙等。保留未写缓冲，注册需要的可写事件，回到事件循环，同时设置超时与容量上限。

### 6.3 mmap 后文件很大，是否等于一次全读进物理内存

不等于。映射建立虚拟地址关系，实际页面可按需调入；大量访问仍消耗物理内存、页缓存和 I/O，也可能造成缺页延迟。

## 7. 继续阅读

- [Socket、HttpClient、DNS 与 TLS](./13-Socket-HttpClient-DNS与TLS.md)
