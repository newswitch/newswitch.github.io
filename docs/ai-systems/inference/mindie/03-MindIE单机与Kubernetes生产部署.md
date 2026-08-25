---
title: "MindIE 单机与 Kubernetes 生产部署"
sidebar_label: "03. 单机与 Kubernetes 生产部署"
sidebar_position: 3
description: "从版本和模型制品准备开始，完成MindIE单机基线、Kubernetes设备注入、探针、服务暴露和生产验收。"
tags: [MindIE, Kubernetes, Ascend 910B, 部署, 生产验收]
---

# MindIE 单机与 Kubernetes 生产部署

生产部署不是把`config.json`挂进容器后看到端口监听。完整交付至少包含：

```text
版本兼容
→ 模型制品完整
→ NPU与HCCL可用
→ MindIE Server Ready
→ 请求契约正确
→ 性能和容量达标
→ 探针、摘流、监控与回滚可用
```

本文以MindIE 2.3配置结构解释方法。字段名和支持范围必须以目标安装包同版本文档与随包样例为准。

## 1. 先选择部署形态

| 形态 | 用途 | 主要优点 | 主要限制 |
| --- | --- | --- | --- |
| 裸机/单容器 | 首次验证、性能基线 | 路径短、排障简单 | 缺少调度与自动恢复 |
| Kubernetes单机实例 | 生产单节点模型服务 | 发布、摘流、资源治理 | 依赖Device Plugin与存储 |
| Kubernetes多机实例 | 单机放不下的大模型 | 扩展模型容量 | Rank、HCCL和故障面增加 |
| MindIE Motor/PD | 大规模P/D调度 | 分离资源、统一调度与RAS | 架构复杂，需单独容量模型 |

正确顺序是先跑通单机基线，再容器化和上Kubernetes，最后评估多机或PD。否则无法区分模型、镜像、Kubernetes与网络问题。

## 2. 兼容栈

部署清单至少记录：

```text
Atlas服务器/NPU型号
宿主机OS、内核、驱动、固件
CANN
MindIE / MindIE Service / MindIE LLM
ATB Models或目标Modeling后端
Python/PyTorch/torch-npu（目标路径使用时）
模型Revision、Tokenizer、量化格式
镜像Tag与Digest
```

MindIE版本、CANN和ATB Models不能从不同文档版本任意拼装。先按安装指南完成配套，再开始模型调参。

## 3. 模型制品准备

模型目录不能只检查“文件存在”。建议生成Manifest：

```text
模型名称与Revision
config.json摘要
Tokenizer文件摘要
权重分片列表、大小与SHA256
量化配置与转换工具版本
Chat Template
MindIE模型适配配置
```

所有Rank必须读取同一不可变制品。共享存储中的半成品、符号链接漂移和覆盖更新会造成各节点加载结果不一致。

## 4. 单机基线

先使用最小配置：

- 单模型；
- 最小可行`worldSize`；
- BF16或官方教程明确支持的格式；
- 保守上下文和并发；
- 不开启高级PD、Prefix Pool或动态调度；
- 日志输出到stdout和持久目录。

配置主线：

```text
ServerConfig：监听、协议、TLS、连接与超时
BackendConfig：后端、NPU和Tokenizer进程
ModelDeployConfig：上下文和模型实例
ModelConfig：权重、worldSize、npuDeviceIds、KV内存
ScheduleConfig：Prefill/Decode Batch与Token预算
LogConfig：运行、操作与日志轮转
```

启动后至少验证：

```bash
curl -s http://127.0.0.1:<port>/health
curl -s http://127.0.0.1:<port>/v1/models
```

实际健康路径和协议以目标版本配置为准。

## 5. Kubernetes资源链

```text
Ascend Device Plugin
→ Node上报NPU扩展资源
→ Pod limits申请整卡
→ Kubelet调用Allocate
→ 设备文件和驱动库进入容器
→ MindIE根据容器可见逻辑ID初始化
```

资源键不要照抄，应从集群查询：

```bash
kubectl get node <node> -o json | jq '.status.allocatable'
```

示意Pod片段：

```yaml
spec:
  containers:
    - name: mindie
      image: registry.example/mindie@sha256:<digest>
      resources:
        limits:
          huawei.com/Ascend910: "2"
      volumeMounts:
        - name: model
          mountPath: /models/qwen
          readOnly: true
        - name: config
          mountPath: /opt/mindie/conf/config.json
          subPath: config.json
          readOnly: true
```

资源名、MindIE路径和必要挂载必须替换成目标环境真实值。

## 6. `worldSize`与`npuDeviceIds`

单节点服务中需要保证：

```text
worldSize
= 实例实际使用NPU数
= npuDeviceIds中有效设备数量
= Pod申请并注入的设备数量
```

容器内设备可能重新编号为`0..N-1`，配置应基于容器可见逻辑ID，不要直接把宿主机物理ID复制进Pod配置。

多节点模式由Rank Table描述设备和总Rank，单机字段的生效规则会改变，见后续多机文章。

## 7. 探针设计

### 7.1 Startup Probe {/* #startup-probe */}

模型加载、HCCL初始化和Warmup可能需要很久。Startup Probe负责给冷启动足够时间，避免Liveness过早重启。

### 7.2 Readiness Probe {/* #readiness-probe */}

只有模型完成加载、能够处理真实轻量请求且依赖正常时才Ready。Readiness失败用于摘流，不应自动等同于重启。

### 7.3 Liveness Probe {/* #liveness-probe */}

只检测进程是否进入不可恢复死锁。高并发时健康接口变慢不应轻易触发重启风暴。官方Motor部署文档也提示高并发下需要谨慎设置探针超时。

## 8. 服务暴露与安全

- 默认只绑定业务需要的地址；
- 跨公网环境不要无保护监听`0.0.0.0`；
- TLS、鉴权和限流放在明确责任层；
- 指标与管理端口不对公网暴露；
- NetworkPolicy只允许网关、监控和必要控制组件；
- Prompt和Response日志默认脱敏或关闭；
- ConfigMap不保存密钥，Secret按最小权限挂载。

## 9. 模型存储

| 方案 | 适合 | 风险 |
| --- | --- | --- |
| 节点本地盘 | 固定节点、最快冷启动 | 调度受限、需预热和校验 |
| NFS/CephFS | 多节点共享 | Metadata/并发读取、网络故障域 |
| 对象存储下载到本地 | 不可变制品分发 | 下载时间、磁盘容量、启动编排 |
| 镜像内置权重 | 小模型或严格固定 | 镜像巨大、发布慢 |

生产常用“对象存储/共享源→节点缓存→只读挂载”，并以摘要验证完成标记控制启动。

## 10. Ready验收

```text
[ ] 镜像、MindIE、CANN、模型Revision已固定
[ ] Pod申请NPU数与worldSize一致
[ ] 容器内设备与Rank映射已保存
[ ] 模型Manifest校验通过
[ ] 非流式和流式接口通过
[ ] Chat Template、停止和错误契约通过
[ ] Startup/Readiness/Liveness职责分离
[ ] 优雅摘流和终止时间足以完成/取消请求
[ ] TTFT、TPOT、HBM和容量基线通过
[ ] Pod、节点和NPU故障演练通过
[ ] 旧镜像、配置和模型制品可回滚
```

## 11. 官方资料

- [MindIE 2.3安装指南](https://www.hiascend.com/document/detail/zh/mindie/230/envpre/instg/mindie_instg_0001.html)
- [MindIE LLM架构](https://www.hiascend.com/document/detail/zh/mindie/230/LLMframe/llmdev/mindie_llm0001.html)
- [MindIE服务化配置参数](https://www.hiascend.com/document/detail/zh/mindie/230/LLMframe/llmdev/mindie_service0285.html)
