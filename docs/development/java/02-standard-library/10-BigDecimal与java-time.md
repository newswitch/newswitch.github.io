---
title: "BigDecimal 与 java.time 的数值和时间语义"
sidebar_label: "10. BigDecimal 与 java.time"
sidebar_position: 10
description: "理解十进制精度、scale、舍入、数值相等，以及 Instant、LocalDateTime、时区、夏令时和可测试时钟。"
tags: [Java, BigDecimal, java.time, 时区]
---

# BigDecimal 与 java.time 的数值和时间语义

金额算对和时间记对，都需要先定义单位与语义。BigDecimal 能表达精确十进制，但不会替业务选择舍入规则；java.time 区分时间点、当地日期时间和时区，但不会自动知道一条记录属于哪个时区。

本篇使用 JDK 25，所有实验采用固定输入，不依赖机器当前时间和默认时区。

## 1. 精度与小数位数

BigDecimal 可以理解为未缩放整数乘以 10 的负 scale 次方。`123.40` 的未缩放整数为 12340，scale 为 2，precision 为有效数字数量 5。scale 不是“最多允许几位小数”，也可能为负。

从字符串创建 `new BigDecimal("0.1")` 可以准确表达该十进制；`new BigDecimal(0.1)` 则准确接收 double 已有的二进制近似值。valueOf(double) 使用不同转换路径，但已经在 double 运算中丢失的信息不会因此恢复。

金额还应携带币种，明确输入精度、计算精度与结算舍入位置。每一步都先舍入和最终只舍入一次，可能产生不同结果。[BigDecimal API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/math/BigDecimal.html)给出了精度与舍入契约。

## 2. 时间类型如何选择

| 类型 | 表达 | 不包含的信息 |
| --- | --- | --- |
| Instant | 时间线上的一个点 | 展示时区 |
| LocalDate | 当地日历日期 | 时刻和时区 |
| LocalDateTime | 当地日期和钟面时间 | 相应时间点需要的偏移或时区 |
| OffsetDateTime | 日期时间加 UTC 偏移 | 地区时区的完整规则 |
| ZonedDateTime | 日期时间与地区时区规则 | 业务自己的工作日规则 |
| Duration / Period | 秒纳秒量 / 日历年月日量 | 二者不能随意互换 |

`2026-01-01T08:00` 没有时区，不能唯一对应一个 Instant。日志跨机器关联通常保存 UTC 时间点；面向用户展示再使用明确 ZoneId。

## 3. 完整实验

```java title="ValueTimeDemo.java"
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;

public class ValueTimeDemo {
    public static void main(String[] args) {
        BigDecimal price = new BigDecimal("19.90");
        BigDecimal total = price.multiply(new BigDecimal("3"));
        System.out.println("total=" + total.toPlainString());
        System.out.println("third=" + BigDecimal.ONE.divide(new BigDecimal("3"), 2, RoundingMode.HALF_UP));
        System.out.println("equals=" + new BigDecimal("1.0").equals(new BigDecimal("1.00")));
        System.out.println("compare=" + new BigDecimal("1.0").compareTo(new BigDecimal("1.00")));

        Instant instant = Instant.parse("2026-01-01T00:00:00Z");
        System.out.println("shanghai=" + instant.atZone(ZoneId.of("Asia/Shanghai")));
        Clock clock = Clock.fixed(instant, ZoneOffset.UTC);
        System.out.println("fixed=" + Instant.now(clock));
        ZonedDateTime before = ZonedDateTime.of(2026, 3, 7, 12, 0, 0, 0,
                ZoneId.of("America/New_York"));
        ZonedDateTime nextDay = before.plusDays(1);
        System.out.println("calendarDayHours=" + Duration.between(before, nextDay).toHours());
        System.out.println("durationHours=" + Duration.between(before, before.plusHours(24)).toHours());
    }
}
```

```bash
javac -encoding UTF-8 --release 25 -d out ValueTimeDemo.java
java -cp out ValueTimeDemo
```

```text title="expected-output"
total=59.70
third=0.33
equals=false
compare=0
shanghai=2026-01-01T08:00+08:00[Asia/Shanghai]
fixed=2026-01-01T00:00:00Z
calendarDayHours=23
durationHours=24
```

示例采用 JDK 25 随附时区规则，纽约该日期跨越夏令时切换。地区规则可能被法律调整，长期系统要维护运行时的时区数据库；不能把所有“明天”都实现为加 24 小时。

## 4. 金额的失败边界

1 除以 3 没有有限十进制表示，不指定可接受精度或舍入的精确除法会抛 ArithmeticException。`RoundingMode.UNNECESSARY` 可以用来要求“此操作不得发生舍入”，违反时直接失败。

BigDecimal 不可变，add/setScale 等返回结果，不会修改原变量。equals 同时考虑数值与 scale，compareTo 比较数值，因此 HashSet 与 TreeSet 可能有不同去重效果。业务要求统一金额表示时，应明确标准 scale 和舍入，而不是随意 stripTrailingZeros 后依赖输出形式。

转换成 int/long 时，普通转换可能截断或溢出；需要严格验证时使用 intValueExact/longValueExact，并处理异常。

## 5. 时区与持续时间的失败边界

夏令时会产生不存在的当地时间或重复时间。把 LocalDateTime 直接 atZone，会按 API 规则处理缺口和重叠；财务或预约系统若要求拒绝歧义，应检查 ZoneRules 的有效偏移并明确选择，不能悄悄采用默认结果。[ZonedDateTime API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/ZonedDateTime.html)解释了这些情况。

DateTimeFormatter 的大小写有语义：月份与分钟、年与基于周的年不能混用。外部协议优先选择明确的 ISO 格式，必要时设置严格解析规则。

测量单进程操作耗时通常用 System.nanoTime 的差值；它不是可跨机器保存的 UTC 时间戳。业务时间通过 Clock 注入，测试可以用 fixed Clock 重现边界，不需要真实等待午夜。

## 6. 练习与答案

### 6.1 金额保留两位就一定正确吗

不一定。币种、计价精度、税额规则和结算阶段不同。必须先定义业务单位及舍入规则，再决定哪里使用两位。

### 6.2 LocalDateTime 能直接用于跨地区排序日志吗

缺少时区时无法唯一映射时间点。保存 Instant 或带明确偏移的时间，再按统一时间线排序。

### 6.3 为什么测试用 Clock 而不是在方法里直接 now

显式依赖可以固定时间、测试过期前后和时区边界，避免测试随运行时间漂移。Clock 解决时间输入，不替代并发同步。

## 7. 继续阅读

- [Clock API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/time/Clock.html)
- [Path、Files 与文件 I/O](./11-Path-Files与文件IO.md)
