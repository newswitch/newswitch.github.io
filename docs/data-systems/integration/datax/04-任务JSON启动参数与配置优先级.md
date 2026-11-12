---
title: "DataX 任务 JSON、启动参数与配置优先级"
sidebar_label: "04. 任务 JSON、启动参数与配置优先级"
sidebar_position: 4
description: "解释DataX配置树、核心配置与插件参数，逐项说明启动器长短选项、模板替换、JVM参数、限速与错误阈值的优先关系。"
tags: [DataX, 参数, JSON, JVM, 配置]
---

# DataX 任务 JSON、启动参数与配置优先级

DataX 的配置需要区分三层：Python 启动器的命令选项、框架的 Job/Core 配置、Reader/Writer 的插件参数。三个层次可能都使用“并发”“速度”之类的词，但不能随意互换路径。

## 1. 从配置树找到参数归属

```text
任务根对象
├── common                       可选的共享类型转换配置
├── core                         可选的框架覆盖项
└── job
    ├── setting
    │   ├── speed                Job 级并发或限速
    │   └── errorLimit           脏数据阈值
    └── content[0]
        ├── reader.name / parameter
        ├── writer.name / parameter
        └── transformer          可选的记录转换链
```

本系列使用单个 Reader/Writer 配对。不要把 `content` 的数组外形理解为一个任意多源 Join 引擎。查看当前运行包的模板与 Engine/JobContainer 实现后再扩展用法。

`conf/core.json` 提供框架默认值，任务可以覆盖支持的框架项；插件参数只对相应插件有意义。例如 `batchSize` 放进 `job.setting`，不会因此变成 MysqlWriter 的批量大小。共享日期转换的时区路径是 `common.column.timeZone`，不要误放进插件的任意同名字段。

## 2. 一个不连接数据库的完整任务

下面的任务使用固定值生成记录，并写入终端，适合检查框架能否运行。只在无敏感数据的实验中使用打印型 Writer。

```json
{
  "job": {
    "setting": {
      "speed": {"channel": 1},
      "errorLimit": {"record": 0}
    },
    "content": [
      {
        "reader": {
          "name": "streamreader",
          "parameter": {
            "sliceRecordCount": 3,
            "column": [
              {"type": "long", "value": "7"},
              {"type": "string", "value": "datax-check"}
            ]
          }
        },
        "writer": {
          "name": "streamwriter",
          "parameter": {"print": true, "encoding": "UTF-8"}
        }
      }
    ]
  }
}
```

当切分产生一个 Task 时，这里预期读取三条，不是三种不同主键的业务记录。`sliceRecordCount` 是每个切片的记录数；改变并发后不能不检查 Task 数就仍断言总数为三。

## 3. 启动器的长短选项

以下依据固定源码基线的 `getOptionParser()`，不是商业平台 UI 参数列表。

| 选项 | 作用 | 使用注意 |
|---|---|---|
| `-h, --help` | 展示启动器帮助 | 不证明 JVM 或数据库可用 |
| `-j, --jvm` | 在默认 JVM 参数后追加参数 | 核对最终 JVM 命令，尤其是重复堆参数 |
| `-m, --mode` | 指定模式，默认 `standalone` | 其他名字不等于已有完整分布式服务 |
| `--jobid` | 传递作业标识，默认 `-1` | 不能代替外部批次状态与防重复执行 |
| `-p, --params` | 传递 `-D名称=值`，用于 `${名称}` 替换等 | 不自动读取同名环境变量，不用于传密码 |
| `-r, --reader` | 指定要查看模板的 Reader | 与 `-w` 配对查看模板 |
| `-w, --writer` | 指定要查看模板的 Writer | 模板输出含说明文字 |
| `-d, --debug` | 打开远程调试路径 | 会引入调试监听，不在生产公网启用 |
| `--loglevel` | 传递日志级别属性，默认 `info` | `debug` 可能增加敏感配置与数据暴露 |

普通同步还需一个任务路径。不要把任意用户输入拼进启动器参数；启动器会构造 shell 命令，任务与命令参数应来自受控配置。

## 4. 参数替换不是 SQL 参数绑定

```bash
python3 /opt/datax/bin/datax.py \
  -p"-Dbatch_label=orders_20261101" \
  /work/jobs/orders.json
```

这是由可信调度配置传递的字符串替换，不是 JDBC PreparedStatement 的查询参数。表名、筛选 SQL、时间范围和路径必须先按数据契约验证。

环境变量本身不会自动展开到每个 JSON 字段。随文的 `render_job.py` 先解析模板 JSON，再逐个替换字符串，最后重新序列化，避免密码中的引号或反斜线破坏 JSON。它拒绝缺失变量和覆盖现有输出，不打印密码。

## 5. 两个需要牢记的优先关系

第一，`job.setting.speed.byte/record` 为正时，框架会根据总预算与每通道预算计算通道数；这时不能再把 `speed.channel` 当作另一个独立硬上限。详见[并发与限速](./10-并发限速背压与容量分析.md)。

第二，`errorLimit.record` 与 `errorLimit.percentage` 不是同时生效的双阈值。在固定基线的 `ErrorRecordChecker` 中，只要设置了条数限制，比例限制就被清空。`{"record": 0}` 表示不允许脏数据；把它与 `percentage: 0.02` 一起写，不会获得“允许百分之二”的效果。

条数限制在运行中检查，比例限制在收尾时检查。这些判断不撤销已提交批次，也不会把被跳过的脏行自动修正。

## 6. 配置审查顺序

先用 JSON 解析器检查格式，再核对插件名与字段路径，接着检查变量替换结果、列顺序和批次范围。最后到测试环境验证 TLS、SQL、目标约束与失败重跑。

JSON 的布尔值使用 `true/false`，数值不要全部写成字符串；不要把数据库口令写在 `-p` 或命令历史中。审核与运行日志都要限制访问。

## 7. 练习与答案

**问题一：`errorLimit.record=0` 和 `percentage=0.02` 同时配置，允许百分之二脏数据吗？**

答案：不允许。条数限制优先，比例限制不再生效，捕获到脏数据会触发条数检查失败。

**问题二：Shell 中设置 `SOURCE_PASSWORD` 后，JSON 里的 `${SOURCE_PASSWORD}` 必然自动展开吗？**

答案：不是。需要明确的渲染或参数传递机制；本系列使用受控渲染器，不通过命令行传密码。

**问题三：给 `--jvm` 传入 `-Xmx2g`，是否等于删除了默认堆参数？**

答案：没有。启动器采取追加方式，应检查实际 JVM 对重复参数的处理和最终生效值。

**问题四：模板生成命令的全部标准输出可以直接作为 JSON 文件吗？**

答案：不可以。输出中还有参考链接与使用说明，应提取、审查真正的 JSON，或者使用随文独立模板。

参考：[启动器实现](https://github.com/alibaba/DataX/blob/80ec23d5c5328eb90ca364d2749e92dfaf44541e/core/src/main/bin/datax.py)、[默认 Core 配置](https://github.com/alibaba/DataX/blob/80ec23d5c5328eb90ca364d2749e92dfaf44541e/core/src/main/conf/core.json)、[ErrorRecordChecker](https://github.com/alibaba/DataX/blob/80ec23d5c5328eb90ca364d2749e92dfaf44541e/core/src/main/java/com/alibaba/datax/core/util/ErrorRecordChecker.java)。
