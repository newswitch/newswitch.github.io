---
title: "字符串、Unicode、编码与正则表达式"
sidebar_label: "02. 字符串、Unicode、编码与正则"
sidebar_position: 2
description: "区分 UTF-16 代码单元、Unicode 码点和 UTF-8 字节，解释字符串不可变、拼接、规范化、编码边界与正则匹配。"
tags: [Java, String, Unicode, UTF8, 正则]
---

# 字符串、Unicode、编码与正则表达式

字符串有几个“字符”并不是一个只有一种答案的问题。Java 下标面向 UTF-16 代码单元，Unicode 码点和用户看到的字形可能跨越多个代码单元；文件和网络又传输编码后的字节。把这些长度混为一谈，就会出现截断、乱码和协议长度错误。

本篇使用 JDK 25，明确指定 UTF-8，不依赖终端的默认编码。

## 1. 从文字到字节的层次

```text
显示字形 → 一个或多个 Unicode 码点
        → String 的 UTF-16 代码单元索引
        → 按指定字符集编码成 byte[]
```

String.length 返回代码单元数量；char 是一个 UTF-16 代码单元，不能容纳所有 Unicode 码点。补充平面码点需要代理对。组合重音、肤色或连接符序列还可能让多个码点显示为一个字形。

String 的 API 语义是 UTF-16，不等于 JVM 内部一定给每个字符固定分配两个字节。现代 JDK 的紧凑字符串属于实现优化，不能用对象占用量推导网络字节数。[String API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html)说明了索引语义。

## 2. 长度、编码和匹配实验

```java title="TextDemo.java"
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.Arrays;
import java.util.Locale;
import java.util.regex.Pattern;

public class TextDemo {
    public static void main(String[] args) {
        String text = "A\uD83D\uDE00中";
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        System.out.println("units=" + text.length());
        System.out.println("points=" + text.codePointCount(0, text.length()));
        System.out.println("utf8Bytes=" + bytes.length);
        System.out.println("roundTrip=" + text.equals(new String(bytes, StandardCharsets.UTF_8)));
        String decomposed = "e\u0301";
        String composed = "\u00e9";
        System.out.println("rawEqual=" + decomposed.equals(composed));
        System.out.println("normalized=" + Normalizer.normalize(decomposed, Normalizer.Form.NFC).equals(composed));
        var matcher = Pattern.compile("task-(\\d+)").matcher("task-42");
        System.out.println("matches=" + matcher.matches());
        System.out.println("id=" + matcher.group(1));
        System.out.println("split=" + Arrays.toString("a,b,".split(",", -1)));
        System.out.println("lower=" + "READY".toLowerCase(Locale.ROOT));
    }
}
```

```bash
javac -encoding UTF-8 --release 25 -d out TextDemo.java
java -cp out TextDemo
```

```text title="expected-output"
units=4
points=3
utf8Bytes=8
roundTrip=true
rawEqual=false
normalized=true
matches=true
id=42
split=[a, b, ]
lower=ready
```

A 是 1 个 UTF-8 字节，示例表情是 4 个，中是 3 个，共 8 字节。码点为 3 个，而表情占 2 个代码单元，所以 length 为 4。示例用转义表示表情，避免复制过程依赖编辑器字体。

## 3. 字符串不可变与拼接

String 方法不会就地修改原对象，strip、replace、toLowerCase 的结果需要接收。`==` 比较身份，内容用 equals；字符串池可能让某些 `==` 偶然为 true，不能用来定义业务比较。

循环持续拼接大文本时，StringBuilder 便于积累可变内容，再转成 String。它不是线程安全共享容器。少量 `a + b` 不应机械重写，编译器和运行时可以优化表达式，真正成本取决于分配与负载。

## 4. 编码边界为什么必须明确

编码是字符到字节，解码是字节到字符。用 UTF-8 编码却按另一字符集解码，会得到错误文本；重新保存这些错误字符后，未必还保留原字节。

某些便捷转换会用替代字符处理非法序列；协议校验需要拒绝非法输入时，用 CharsetDecoder/CharsetEncoder 配置 `CodingErrorAction.REPORT`。读取文件时指定字符集，HTTP 则遵守协议和 Content-Type，而不是随意猜测。

文本字段按“字节上限”截断时，不能先 substring 固定长度再假设符合 UTF-8 大小；按代码单元截断还可能切断代理对。应根据存储或展示需要选择字节、码点或字素边界。

## 5. 正则的两层转义

正则引擎需要看到 `\d`，Java 源码字符串因此写成 `"\\d"`。matches 匹配整个输入，find 搜索下一个匹配片段；group 只能在匹配成功后读取。

`String.split` 的参数是正则：按字面量点分隔应使用转义或 Pattern.quote；默认还会去掉末尾空字段，保留需给负 limit。`replace` 与 `replaceAll` 也应区分字面量和正则。

重复使用时可复用不可变 Pattern，每次创建独立 Matcher；Matcher 保存匹配状态，不应被多个线程共享。外部可控复杂表达式和无界长输入可能消耗大量 CPU，应限制输入并检查回溯行为。语义见 [Pattern API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/regex/Pattern.html)。

## 6. 练习与答案

### 6.1 length 为 10，UTF-8 就是 10 字节吗

不是。ASCII 情况可能相等，中文、补充平面字符等不同。用实际字符集编码后的 byte[].length 判断字节数。

### 6.2 看起来相同的两个字符串为何不 equals

可能使用不同的 Unicode 组合表示，也可能包含不可见字符。根据业务先检查码点，再决定是否规范化；规范化不是任意删除字符，也不自动解决所有相似字形问题。

### 6.3 协议字段转小写为什么指定 Locale.ROOT

避免受服务器默认区域影响。人类语言展示可能需要具体区域，协议标识通常需要与部署区域无关的规则。

## 7. 继续阅读

- [ArrayList 与 LinkedList](./03-ArrayList与LinkedList结构与选型.md)
- [字符集与解码器](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/nio/charset/CharsetDecoder.html)
