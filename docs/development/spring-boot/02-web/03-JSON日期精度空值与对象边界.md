---
title: "JSON、日期、精度、空值与对象边界"
sidebar_label: "03. JSON 与数据契约"
sidebar_position: 3
description: "解释 Jackson 3 消息转换，区分时间点、本地时间、十进制与前端精度，以及缺失字段、null 和实体循环引用。"
tags: [SpringBoot, Jackson, JSON, 数据契约]
---

# JSON、日期、精度、空值与对象边界

Java 类型正确，不代表传到另一种语言后仍表达同一件事。日期可能丢失时区，大整数可能在浏览器中失真，实体关系可能让一次简单查询变成几十条 SQL。JSON 是服务之间的契约，不是对象内存的直接快照。

## 1. HTTP 字节怎样成为对象

MVC 根据 Content-Type、目标类型和消息转换器选择读取方式，再由 Jackson 构造 DTO。响应时根据可接受媒体类型和返回类型选择写出方式。路径/查询参数的 ConversionService 不等于 JSON Mapper。

Boot 4 默认采用 Jackson 3，数据绑定包为 `tools.jackson.databind`；Jackson 注解仍有 `com.fasterxml.jackson.annotation` 的使用场景。复制旧版本的 Mapper 定制前，先确认依赖树与 API。[Boot JSON 集成](https://docs.spring.io/spring-boot/reference/features/json.html)

## 2. 时间点与墙上时间不能混用

| 业务含义 | 建议表达 | 关键边界 |
| --- | --- | --- |
| 事件发生时刻 | `Instant`，如 `2026-10-20T08:00:00Z` | 可跨时区比较 |
| 带偏移的输入 | `OffsetDateTime` | 偏移不等于完整地区时区规则 |
| 每天当地 09:00 执行 | 本地时间 + `ZoneId` | 夏令时可能使时间不存在或重复 |
| 出生日期 | `LocalDate` | 不应强行附加 UTC 时间点 |

`LocalDateTime` 没有时区，不能独立说明全球唯一时刻。数据库列、JDBC 转换、服务端时区和 JSON 格式要一起验证。单一 Jackson 时区配置不能给所有无时区类型补齐业务语义。

## 3. 金额与 ID 的精度

金额通常使用 `BigDecimal`，并明确货币、scale 和舍入规则；不能先用 double 计算再转换，希望消除已引入的误差。JSON number 不要求所有客户端使用任意精度十进制，前端仍可能按浮点数处理。

超过 JavaScript 安全整数范围的 ID 应采用字符串契约，或明确使用大整数解析。UUID 适合作为字符串，但不能因为“难猜”就替代权限检查。

```json
{
  "id": "9007199254740993",
  "amount": "123.40",
  "currency": "CNY",
  "createdAt": "2026-10-20T08:00:00Z"
}
```

这是把 ID 和金额编码为字符串的一种协议选择，不是所有接口必须照搬的标准；需要校验、文档和消费者共同支持。

## 4. 缺失、null 与默认值

创建请求没有 name，与 `"name":null` 都可以被非空约束拒绝；更新却可能需要区分“保持原值”和“清空字段”。普通 nullable DTO 往往无法表达三态，需要显式 patch 模型、字段存在性或补丁协议。

忽略 null 会改变字段是否存在，不是无影响的美化配置。新增枚举值也可能让旧消费者反序列化失败；兼容测试要包含未知字段/枚举、缺字段、null、边界数字和时间偏移。

## 5. 为什么不要返回 JPA 实体图

`Order.customer.orders` 双向关系可能递归；懒加载属性可能在序列化时查询，也可能因上下文关闭而失败。忽略某字段只能解决部分输出问题，不能替代明确查询和 DTO 映射。

先在服务事务内用投影、fetch join 或批量读取确定数据，再映射有限 DTO；响应层不应暗中决定数据库访问量。见 [JPA 与 N+1](../03-data/04-JPA实体状态脏检查懒加载与N加一.md)。

## 6. 验证契约

注入 Boot 配置的 Mapper 做测试，避免测试 new 出来的 Mapper 与线上不同。断言字段类型、存在性和精确字符串，不比较字段输出顺序。再用 MVC 测试确认消息转换器与 Content-Type。

`service-lab` 用 Boot 的 `JsonMapper` 生成请求并验证响应；金额、时区和三态更新是扩展练习，不宣称工程已经实现所有协议。

## 7. 练习与答案

### 7.1 所有时间都保存成字符串可以解决时区问题吗

不能。字符串可能没有偏移或统一解析规则。先定义业务语义，再选择能无歧义表示它的类型和格式。

### 7.2 关闭循环引用就不会 N+1 了吗

不会。避免递归与减少查询是不同问题，剩余关联仍可能逐条触发查询，必须观察实际 SQL。

### 7.3 金额从 number 改成 string 算兼容变更吗

通常不算。消费者可能依赖数值类型，需版本策略、契约测试或过渡字段，不能静默改变。

## 8. 关联阅读

- [BigDecimal 与 java.time](../../java/02-standard-library/10-BigDecimal与java-time.md)
- [分页、并发与幂等](./04-分页并发更新状态机与幂等.md)
