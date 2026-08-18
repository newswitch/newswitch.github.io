---
title: "模型驱动网络与 gNMI"
sidebar_label: "04. 模型驱动网络与 gNMI"
sidebar_position: 4
description: "分清数据模型与传输协议，掌握 YANG、NETCONF、RESTCONF、gNMI 的能力发现、读写和订阅语义。"
tags: [YANG, NETCONF, RESTCONF, gNMI, OpenConfig]
---

# 模型驱动网络与 gNMI

CLI 是面向人的文本界面，模型驱动接口让程序按明确的 Schema 读取和修改数据。它减少文本解析，但不会自动消除厂商差异、事务风险和错误意图。

## 1. 先分清模型与协议

| 层次 | 技术 | 作用 |
|---|---|---|
| 数据模型语言 | YANG | 定义层级、类型、约束和操作 |
| 通用/厂商模型 | OpenConfig、IETF、Native Model | 定义接口、BGP、QoS 等具体路径 |
| 管理协议 | NETCONF、RESTCONF、gNMI | 读取、修改、订阅模型数据 |
| 编码 | XML、JSON、Protobuf | 在线路上传输数据 |
| 传输/安全 | SSH、HTTPS、gRPC/TLS | 建立受保护会话 |

YANG 不是协议，gNMI 也不是数据模型。

## 2. YANG 的核心结构

示意：

```yang
container interfaces {
  list interface {
    key "name";
    leaf name {
      type string;
    }
    container config {
      leaf enabled {
        type boolean;
      }
    }
    container state {
      config false;
      leaf oper-status {
        type enumeration {
          enum UP;
          enum DOWN;
        }
      }
    }
  }
}
```

要理解：

- `container` 是层级容器；
- `list` 是带 Key 的重复条目；
- `leaf` 是具体值；
- `config false` 表示只读运行状态；
- `must/when` 等约束表达跨字段规则；
- Module、Namespace 和 Revision 决定模型身份。

## 3. 能力发现比猜路径可靠

连接设备后先确认：

- 支持哪些模型及 Revision；
- 支持哪个 Datastore；
- 是否支持 Candidate、Confirmed Commit；
- gNMI 支持哪些编码和模型；
- 某路径是配置、状态还是两者；
- Replace、Update、Delete 的实际语义。

不同设备即使声称支持 OpenConfig，也可能只实现部分路径。

## 4. NETCONF

NETCONF 通常基于 SSH，使用 RPC 操作 Datastore。

重要操作：

| 操作 | 用途 |
|---|---|
| `<get>` | 获取配置和运行状态 |
| `<get-config>` | 获取指定 Datastore 配置 |
| `<edit-config>` | 修改配置 |
| `<validate>` | 校验候选配置 |
| `<commit>` | 提交 Candidate |
| `<lock>` / `<unlock>` | 避免并发修改 |

理想安全流程：

```text
lock candidate
→ edit-config
→ validate
→ commit confirmed
→ 运行状态验证
→ confirm commit
→ unlock
```

具体设备是否支持这些 Capability 必须在 `<hello>` 能力交换中确认。

## 5. RESTCONF

RESTCONF 使用 HTTP 方法访问 YANG 建模的数据，常见 JSON 编码：

```text
GET    读取
POST   创建
PUT    替换
PATCH  部分修改
DELETE 删除
```

注意 PUT/PATCH 的差异、ETag/并发控制、HTTP 状态码和厂商支持范围。把 `200 OK` 当作业务状态成功同样不够，还需读取运行状态验证。

## 6. gNMI：Get、Set、Subscribe

gNMI 基于 gRPC，核心 RPC：

- Capabilities：发现版本、模型和编码；
- Get：读取快照；
- Set：Delete、Replace、Update；
- Subscribe：流式订阅状态。

路径示意：

```text
/interfaces/interface[name=Ethernet1]/state/counters/in-octets
/network-instances/network-instance[name=default]/protocols/...
```

### 6.1 Subscribe 模式 {/* #subscribe-模式 */}

| 模式 | 适合场景 |
|---|---|
| ONCE | 获取一次完整快照后结束 |
| POLL | 客户端触发每次快照 |
| STREAM | 持续接收更新 |

STREAM 订阅中的 Sample、On-Change 等行为取决于服务端支持。采集系统要处理断线重连、重复、时间戳、乱序和初始同步。

### 6.2 Set 的风险 {/* #set-的风险 */}

`replace` 可能覆盖路径下未在请求中声明的子树；`update` 通常合并更新；`delete` 删除路径。实际语义需要通过实验设备和官方实现文档验证。

## 7. 配置与状态不能混为一谈

例如：

```text
/interfaces/interface[name=Ethernet1]/config/enabled = true
/interfaces/interface[name=Ethernet1]/state/oper-status = DOWN
```

配置期望启用，不代表链路已经 Up。自动化验收必须读取 State 路径。

## 8. gNMI 只读实验

使用支持 gNMI 的实验设备或模拟器：

1. 调用 Capabilities，保存模型和编码清单；
2. Get 接口 Config 与 State；
3. Subscribe 接口计数器；
4. 断开接口，观察状态事件和时间戳；
5. 断开采集器网络，验证重连与数据缺口；
6. 比较 CLI、gNMI Config、gNMI State 的差异。

进入写操作前，先在隔离实验环境验证 Update、Replace、Delete 的边界。

## 9. 生产检查清单

- 双向 TLS/SSH Host Key 是否校验；
- 模型 Revision 是否锁定和兼容；
- 路径与字段类型是否经过 Schema 校验；
- 是否拥有 Candidate、Lock 和事务能力；
- 多设备变更并非天然原子，如何补偿；
- 订阅断线和背压如何处理；
- 高频指标的基数、带宽和保留成本；
- 原始数据与处理结果如何关联审计。

## 10. 掌握标准

你应能根据需求选择：

- 用 NETCONF Candidate 做安全配置提交；
- 用 RESTCONF 集成普通 HTTP 系统；
- 用 gNMI Get/Subscribe 获取结构化状态；
- 用 OpenConfig 降低跨厂商差异，必要时回退到 Native Model；

并能解释模型支持不完整、Replace 误覆盖和状态验证缺失会造成什么风险。

## 11. 参考资料 {/* #参考资料 */}

- [RFC 7950：YANG 1.1](https://www.rfc-editor.org/rfc/rfc7950)
- [RFC 6241：NETCONF](https://www.rfc-editor.org/rfc/rfc6241)
- [RFC 8040：RESTCONF](https://www.rfc-editor.org/rfc/rfc8040)
- [OpenConfig gNMI Specification](https://openconfig.net/docs/gnmi/gnmi-specification/)
