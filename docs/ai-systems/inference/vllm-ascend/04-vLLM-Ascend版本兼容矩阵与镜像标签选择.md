---
title: "vLLM-Ascend 版本兼容矩阵与镜像标签选择"
sidebar_label: "04. 版本兼容矩阵与镜像标签"
sidebar_position: 4
description: "读懂 vLLM-Ascend 镜像标签，建立驱动、固件、CANN、PyTorch、torch-npu、vLLM 与插件的完整兼容坐标。"
tags: [vLLM-Ascend, 镜像, 版本兼容, CANN, torch-npu]
---

# vLLM-Ascend 版本兼容矩阵与镜像标签选择

在昇腾环境中，镜像“能够拉取”不等于“能够运行”，模型“启动成功一次”也不能证明版本组合正确。vLLM-Ascend 的运行结果由一整条软件栈共同决定：

```text
服务器型号与 NPU 型号
→ NPU 固件与宿主机驱动
→ 容器内 CANN / NNAL
→ PyTorch / torch-npu
→ upstream vLLM / vLLM-Ascend
→ 模型架构、量化格式与启用特性
```

生产环境应把这一整行当作不可拆分的兼容单元。

## 1. 先读懂镜像标签

以这个标签为例：

```text
quay.io/ascend/vllm-ascend:v0.22.1rc1-a3
│                       │          │  └─ 硬件变体：Atlas A3
│                       │          └──── 第 1 个候选发布版本
│                       └─────────────── 插件版本，与对应 vLLM 发布线匹配
└────────────────────────────────────── 镜像仓库与项目名
```

`v0.22.1rc1`遵循预发布版本语义：它是`0.22.1`发布线的第一个 Release Candidate，不等同于最终正式版。`-a3`是容器构建的硬件变体后缀，不是“第三个补丁版本”。

常见标签含义如下，实际可用集合必须查看目标版本的安装文档：

| 标签形态 | 典型含义 |
| --- | --- |
| `vX.Y.Z` | Atlas A2 的 Ubuntu 基线镜像 |
| `vX.Y.Z-openeuler` | Atlas A2 的 openEuler 用户态镜像 |
| `vX.Y.Z-a3` | Atlas A3 的 Ubuntu 镜像 |
| `vX.Y.Z-a3-openeuler` | Atlas A3 的 openEuler 镜像 |
| `vX.Y.Z-310p` | Atlas 300I DUO/310P 变体 |
| `vX.Y.Z-950dt` | Ascend 950DT 变体 |

因此，**Atlas 800I A2 + 910B 通常选择不带`-a3`的A2标签**。麒麟宿主机也不意味着镜像标签必须包含`kylin`；宿主机驱动与容器用户态通过设备和驱动库挂载协作，仍需单独验证内核、glibc、容器运行时和厂商支持边界。

## 2. 为什么不能只对齐两个包

vLLM-Ascend 与 upstream vLLM 使用匹配版本号，但二者下面还有 PyTorch、torch-npu 和 CANN。例如某一条官方发布矩阵会明确给出：

```text
vLLM-Ascend release
↔ vLLM release
↔ Python range
↔ PyTorch / torch-npu
↔ CANN
↔ Triton Ascend / NNAL（若该版本使用）
```

以下组合都属于高风险混装：

- 只升级`vllm`，保留旧`vllm-ascend`；
- 使用主分支插件配PyPI正式版vLLM；
- 容器CANN比宿主机驱动能够支持的版本更新；
- PyTorch与torch-npu不是官方配套版本；
- 在A2上使用`-a3`镜像，或者反过来；
- 量化权重由另一条工具链生成，却直接在当前插件加载；
- 用`latest`重新拉取后得到不同镜像内容。

## 3. 六个必须固定的版本坐标

在Pod内采集用户态版本：

```bash
python - <<'PY'
import torch
import torch_npu
import vllm
import vllm_ascend

print("torch:", torch.__version__)
print("torch_npu:", torch_npu.__version__)
print("vllm:", vllm.__version__)
print("vllm_ascend:", vllm_ascend.__version__)
PY

cat /usr/local/Ascend/ascend-toolkit/latest/version.cfg 2>/dev/null
pip freeze | grep -Ei 'torch|vllm|triton|transformers'
```

在节点侧采集设备和驱动：

```bash
npu-smi info
cat /usr/local/Ascend/driver/version.info 2>/dev/null
uname -a
cat /etc/os-release
```

在Kubernetes侧固定镜像内容：

```bash
kubectl get pod -n ai-inference qwen-0 \
  -o jsonpath='{range .status.containerStatuses[*]}{.name}{"\t"}{.imageID}{"\n"}{end}'
```

`imageID`中的Digest比可变Tag更可靠。生产清单应写成：

```yaml
image: quay.io/ascend/vllm-ascend@sha256:<经过验收的摘要>
```

Tag用于人类识别发布线，Digest用于保证部署内容不可漂移。

## 4. 建立环境清单

每个可复现实例至少保存：

| 坐标 | 示例字段 | 证据位置 |
| --- | --- | --- |
| 服务器 | Atlas 800I A2、CPU、NUMA | 资产系统、硬件命令 |
| NPU | 910B具体型号、固件 | `npu-smi`、固件清单 |
| 宿主机 | 麒麟版本、内核、驱动 | 节点巡检 |
| 容器 | 镜像Tag与Digest | Pod status |
| AI栈 | CANN、torch、torch-npu、vLLM、插件 | 容器内命令 |
| 模型 | Repo/Revision、Tokenizer、Chat Template | 制品清单 |
| 执行特性 | TP、dtype、量化、Graph、Additional Config | 启动清单 |

建议将其保存为机器可读清单：

```yaml
hardware: atlas-800i-a2
accelerator: ascend-910b
host_os: kylin-<release>
driver: <version>
firmware: <version>
cann: <version>
python: <version>
torch: <version>
torch_npu: <version>
vllm: <version>
vllm_ascend: <version>
image_digest: sha256:<digest>
model_revision: <commit-or-hash>
```

## 5. 选镜像的正确顺序

1. 确认服务器属于A2、A3、310P还是其他硬件线。
2. 在vLLM-Ascend官方支持矩阵确认该硬件受支持。
3. 根据模型Feature Matrix确认模型、dtype、量化和并行功能。
4. 从同一发布矩阵选择vLLM、插件、torch、torch-npu和CANN。
5. 确认宿主机驱动能够支持容器内CANN。
6. 拉取候选Tag，记录Digest，并在非生产节点验收。
7. 验收通过后固定Digest，再进入灰度。

不能倒过来先挑“看起来最新”的镜像，再试图让现有驱动适配它。

## 6. RC版本能不能用于生产

RC不是绝对不能使用，但需要明确承担的工作：

- 为何必须使用RC：模型或特性只有该版本支持；
- 已知问题和未支持特性；
- 完整的长稳、精度、容量和故障注入报告；
- 固定镜像Digest和软件包清单；
- 保留上一个已知稳定版本及一键回滚清单；
- 升级期间禁止同时改变模型、量化和主要参数。

如果没有明确业务收益，正式发布版本通常比RC更适合作为长期基线。

## 7. 升级实验不能只做Smoke Test

最小升级验收矩阵：

| 维度 | 必测内容 |
| --- | --- |
| 启动 | 冷启动、缓存存在、缓存清空、所有TP Rank |
| 接口 | Chat、Completions、流式、停止、工具调用 |
| 模型 | 短输入、长输入、边界上下文、异常输入 |
| 精度 | 固定样本、确定性配置、关键任务回归 |
| 性能 | TTFT、TPOT、吞吐、HBM、NPU利用率 |
| 稳定性 | 持续压测、并发波动、取消请求、Pod重启 |
| 故障 | Rank失败、节点故障、HCCL异常、模型盘抖动 |
| 回滚 | 旧Digest、旧参数、旧模型制品能否恢复 |

升级时只改变一个坐标。若同时更换CANN、插件、量化权重和Graph配置，即使失败也无法确定责任层。

## 8. 常见错误判断

| 错误判断 | 正确做法 |
| --- | --- |
| `-a3`是“更高级”的镜像 | 它是A3硬件变体，不适用于A2 |
| 麒麟宿主机只能运行麒麟镜像 | 分别验证内核驱动边界与容器用户态，不按名称猜测 |
| Tag相同所以镜像一定相同 | 生产固定Digest |
| vLLM和插件同版本就够了 | 选择官方矩阵的完整一行 |
| 启动成功说明兼容 | 还要验证长稳、性能、精度和故障恢复 |
| 重启恢复说明版本没有问题 | 偶发初始化竞态、设备健康和缓存差异仍需证据 |

## 9. 验收题

1. `v0.22.1rc1-a3`中的`rc1`和`a3`分别表示什么？
2. Atlas 800I A2为什么通常不选择`-a3`镜像？
3. Tag与Digest分别解决什么问题？
4. 为什么必须把CANN、torch-npu和驱动加入版本矩阵？
5. RC进入生产前至少需要哪些补偿控制？

## 10. 官方资料

- [vLLM-Ascend Versioning Policy](https://docs.vllm.ai/projects/ascend/en/main/community/versioning_policy.html)
- [vLLM-Ascend Installation](https://docs.vllm.ai/projects/ascend/en/latest/installation.html)
- [Supported Models](https://docs.vllm.ai/projects/ascend/en/latest/user_guide/support_matrix/supported_models.html)
- [Supported Features](https://docs.vllm.ai/projects/ascend/en/latest/user_guide/support_matrix/supported_features.html)
