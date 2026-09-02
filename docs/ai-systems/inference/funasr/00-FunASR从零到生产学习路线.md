---
title: "FunASR 从零到生产学习路线"
sidebar_label: "00. FunASR 学习路线"
sidebar_position: 0
description: "从音频基础、VAD、ASR、标点与ITN，到离线、流式、两遍识别、容器部署、容量规划和故障排查系统学习FunASR。"
tags: [FunASR, ASR, 语音识别, 流式识别, Kubernetes, AI Infra]
---

# FunASR 从零到生产学习路线

FunASR是语音识别工具包和模型服务技术栈，不是大语言模型推理引擎。它面对的输入是音频波形，核心问题是语音活动检测、声学/语音识别、流式状态、标点恢复、时间戳、热词和文本规范化，而vLLM主要解决Token序列的批处理、KV Cache和自回归解码。

学习FunASR时，不能只做到“命令启动成功”。还要能解释一段音频进入服务后经过了哪些组件、为什么在线结果会被两遍识别修正、如何测首个临时结果延迟和实时率，以及故障究竟发生在音频、协议、模型、设备还是服务层。

## 1. 模块边界

本模块覆盖：

- 音频采样率、采样位深、声道、编码和分帧；
- VAD、ASR、标点恢复、ITN、时间戳和热词的职责；
- 离线、在线流式和两遍识别的执行链路；
- Python API、OpenAI兼容API、WebSocket和Runtime部署路径；
- Docker与Kubernetes生产部署；
- 并发、实时率、首个临时结果、最终结果和显存的容量模型；
- 模型下载、音频格式、流式状态、OOM、延迟和准确率排障。

本模块不深入语音模型训练算法、数据标注和声学理论推导。目标是能够部署、理解运行链路、建立监控并完成生产排障。

## 2. 阅读顺序

| 顺序 | 文章 | 学完能回答什么 |
| --- | --- | --- |
| 1 | [组件、模型与完整识别链路](./01-FunASR组件模型与离线流式两遍识别链路.md) | 一段音频怎样变成带标点的文本？ |
| 2 | [Python、Docker与Kubernetes部署](./02-FunASR-Python-Docker与Kubernetes部署.md) | 离线API、HTTP上传和流式服务分别怎样部署？ |
| 3 | [性能、容量、可观测性与故障排查](./03-FunASR性能容量可观测性与故障排查.md) | 如何测RTF、并发、首结果延迟并定位空结果、卡顿和OOM？ |

## 3. 先记住完整数据路径

```text
客户端音频
  → 解码/重采样/单声道转换
  → VAD切分语音段
  → ASR生成文本或在线临时文本
  → 时间戳对齐
  → 标点恢复
  → ITN文本规范化
  → 聚合结果并返回
```

流式与两遍识别还要维护会话状态：

```text
连续音频Chunk
  → 在线模型输出低延迟临时结果
  → 服务保存Encoder/Decoder上下文
  → VAD检测句尾
  → 离线模型重识别整段
  → 返回修正后的最终结果
```

所以“WebSocket已经连接”只证明协议层建立连接；“不断收到临时文字”也不证明最终纠错模型、标点和ITN都工作正常。

## 4. 三种运行方式怎样选择

| 方式 | 适合场景 | 主要指标 |
| --- | --- | --- |
| 离线识别 | 录音转写、文件批处理、归档分析 | RTF、吞吐、最终准确率 |
| 在线流式 | 实时字幕、语音交互 | 首个临时结果、稳定增量延迟 |
| 两遍识别 | 既要求实时反馈，又要求句尾质量 | 在线延迟、句尾修正延迟、最终准确率 |

OpenAI兼容的音频转写接口适合HTTP文件上传；真正的连续流式识别通常使用WebSocket或Runtime协议。不要因为两个接口都返回文本，就把它们当成相同的数据路径。

## 5. 版本矩阵

上线时至少固定：

```text
FunASR版本
模型名称与模型revision
模型来源与缓存路径
Python/PyTorch/torchaudio版本
CPU或CUDA设备、驱动与CUDA版本
容器镜像digest
API/Runtime类型与协议版本
音频采样率、编码和声道约束
```

“昨天还能启动，今天下载后不能启动”经常不是服务代码变化，而是模型revision、依赖包或缓存内容没有固定。

## 6. 学完后的能力标准

你应能独立回答：

1. VAD、ASR、PUNC和ITN分别解决什么问题，能否任意调换顺序？
2. 离线、在线和两遍识别的延迟与准确率怎样权衡？
3. 为什么16 kHz PCM服务收到44.1 kHz双声道MP3后可能空结果或变慢？
4. `chunk_size`、look-back和`chunk_interval`影响什么？
5. 为什么GPU利用率低不一定代表FunASR服务没有瓶颈？
6. 怎样区分模型下载慢、模型加载慢、首个请求预热慢和单次推理慢？
7. 如何设计健康检查，避免“端口已监听但模型还没准备好”？
8. 如何用RTF和音频时长估算单实例并发上限？
9. 为什么WebSocket连接数不能直接等同于正在推理的并发数？
10. 怎样验证热词、时间戳、标点和ITN没有在升级后静默失效？

## 7. 官方资料

- [FunASR项目与快速开始](https://github.com/modelscope/FunASR/blob/main/README.md)
- [FunASR Runtime快速开始](https://github.com/modelscope/FunASR/blob/main/runtime/quick_start.md)
- [FunASR部署方式矩阵](https://github.com/modelscope/FunASR/blob/main/docs/deployment_matrix.md)
- [FunASR故障排查](https://github.com/modelscope/FunASR/blob/main/docs/troubleshooting.md)

下一篇：[FunASR组件、模型与离线/流式/两遍识别链路](./01-FunASR组件模型与离线流式两遍识别链路.md)。
