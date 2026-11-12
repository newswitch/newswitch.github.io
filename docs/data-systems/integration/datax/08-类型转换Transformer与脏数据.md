---
title: "DataX 类型转换、Transformer 与脏数据"
sidebar_label: "08. 类型转换、Transformer 与脏数据"
sidebar_position: 8
description: "沿Reader、Column、Transformer和Writer追踪金额精度、前导零、NULL、编码与时区，解释过滤、转换错误和脏数据阈值的区别。"
tags: [DataX, 数据类型, Transformer, 数据质量, Decimal]
---

# DataX 类型转换、Transformer 与脏数据

一次同步可能没有报错，却把 `0007` 写成 `7`、把 NULL 写成空字符串，或者把 UTC 时间当作本地时间。错误往往不在“网络传输丢字节”，而在两端对同一个值采用了不同的解释。

## 1. 沿字段走一遍类型路径

```text
数据库或文件中的表示
→ Reader 的读取方法
→ DataX Column 类型与内部值
→ 可选 Transformer
→ Writer 取值与 JDBC/文件编码
→ 目标字段类型、约束和时区
```

每一跳都可能转换。检查正确性要看方法与目标类型，不能只看 DataX 类型名称或源表 DDL。

| 业务对象 | 合适的契约示例 | 应检查的损坏 |
|---|---|---|
| 客户编号 `0007` | 字符串，保留前导零 | 被当整数读取 |
| 金额 `10.10` | 明确精度与 scale 的十进制 | 经过二进制浮点后舍入 |
| 未知金额 | NULL | 被替成 0 或空字符串 |
| 业务时间 | 明确时区与精度 | 重复做时区转换、毫秒截断 |
| 二进制内容 | 明确 Bytes/编码方案 | 按文本字符集转码 |

## 2. DoubleColumn 不等于已经丢失十进制精度

固定基线的 `DoubleColumn` 可以保存字符串表示，并提供 `asBigDecimal()`。因此不能仅看到 `DOUBLE` 名称，就断言所有 DECIMAL 已经变成 IEEE 754 double。

真正需要核对的是：Reader 是否调用了浮点读取方法，Transformer 是否调用 `asDouble()`，Writer 是否使用精确十进制绑定，以及目标列是否有足够精度。

随文离线校验使用 Python `Decimal`，不使用 `float` 计算金额。四行数据的非空金额是 `10.10 + 20.20 + 0.00 = 30.30`；NULL 保持未知，不当成一个业务上真实存在的零值。

## 3. NULL、空字符串和文本 NULL 标记

CSV 没有数据库意义上的原生 NULL。本系列约定文本 `\N` 代表 NULL，并在 JSON 中写成 `"\\N"`；空字符串与 NULL 是两个不同值。

如果业务确实允许真实字符串 `\N`，这套简单约定就存在冲突，应选择无歧义的编码或格式。Writer 的列类型转换成功，并不证明语义没有混淆。

同时检查字符集、换行与转义：UTF-8 文件中包含的分隔符、引号和多行字段，需要两端一致的解析规则。不要用 `cut -d,` 作为通用 CSV 校验器。

## 4. 时区需要端到端一致

源端 DATETIME、TIMESTAMP、JDBC 会话时区、JVM 默认时区、DataX 日期格式和目标字段类型共同决定结果。固定 Core 配置中有默认时区配置，但不能把某个默认值当成所有连接的时区承诺。

本系列订单文本约定 `updated_at` 是 UTC 的 `YYYY-MM-DD HH:MM:SS`，为了简化实验用字符串传递；这是一项数据契约，不表示字符串能自动解决时区问题。若源字段是本地时间，应先明确转换点，再构造时间窗口。

还要查看连接器追加的 JDBC 参数。固定基线的共享 MySQL 路径会追加 `zeroDateTimeBehavior=convertToNull` 等选项，零日期可能被解释为 NULL，而不是原样保留或直接报错。最终连接参数与数据契约应一起审查。

测试应覆盖日界线、夏令时、NULL、零日期和小数秒精度。只测试一个正午时间很难暴露偏移问题。

## 5. Transformer 是逐条记录处理

下面是放到 `job.content[0]` 中的转换片段：

```json
{
  "transformer": [
    {"name": "dx_substr", "parameter": {"columnIndex": 1, "paras": ["0", "4"]}}
  ]
}
```

它表达对第二列执行子串处理，不自动成为跨行去重或 Join。先对字段长度、NULL 和业务标识做测试；把长客户编号统一裁成四位，可能制造业务键碰撞。

尤其注意 `dx_filter`：满足过滤条件的行会被过滤，不是“保留满足条件的行”。主动过滤与解析失败产生的脏行也不是同一类计数。转换造成的过滤应有单独验收依据，不能用“失败数为零”掩盖记录被排除。

## 6. 脏数据阈值不是修复机制

脏数据可能来自非法类型、字段越界或目标约束。放宽阈值可以允许任务继续，但不会让坏行变成正确行；失败原始值还可能包含个人信息，应限制错误日志访问。

条数阈值覆盖比例阈值的行为见[配置优先级](./04-任务JSON启动参数与配置优先级.md)。运行失败后，还要识别已经提交的正常行，不能只修改阈值后无条件整批追加。

## 7. 练习与答案

**问题一：内部类型叫 DoubleColumn，金额必然已经变成 double 吗？**

答案：不必然。固定实现支持十进制字符串与 BigDecimal，必须检查实际的读取、转换和绑定方法。

**问题二：把 NULL 金额改成零后，金额求和没变，为什么仍可能是错误？**

答案：缺失信息和真实零金额的业务含义不同，NULL 数量与后续计算逻辑已经改变。

**问题三：`dx_filter` 匹配到一个字段时，这行会被保留吗？**

答案：该过滤器的匹配条件表示过滤该行，不要照搬 SQL WHERE 的直觉。

**问题四：转换失败阈值设得很大，是否提高了同步正确率？**

答案：没有。它只是改变任务何时失败，可能让更多坏行被跳过；正确率仍取决于修复、隔离和验收。

参考：[DoubleColumn](https://github.com/alibaba/DataX/blob/80ec23d5c5328eb90ca364d2749e92dfaf44541e/common/src/main/java/com/alibaba/datax/common/element/DoubleColumn.java)、[Transformer](https://github.com/alibaba/DataX/blob/80ec23d5c5328eb90ca364d2749e92dfaf44541e/transformer/doc/transformer.md)、[JDBC 参数追加](https://github.com/alibaba/DataX/blob/80ec23d5c5328eb90ca364d2749e92dfaf44541e/plugin-rdbms-util/src/main/java/com/alibaba/datax/plugin/rdbms/util/DataBaseType.java)。
