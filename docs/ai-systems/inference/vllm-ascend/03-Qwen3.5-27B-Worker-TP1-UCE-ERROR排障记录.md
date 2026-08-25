---
title: "Qwen3.5-27B 启动时 WorkerTP1 报 UCE ERROR 的排障记录"
sidebar_label: "03. WorkerTP1 UCE ERROR 排障记录"
sidebar_position: 3
description: "从 vLLM-Ascend 启动阶段的 UCE ERROR 出发，区分设备故障、版本不兼容、异步报错、图编译与 Norm-Quant 融合问题。"
tags: [vLLM-Ascend, Qwen3.5, 昇腾910B, UCE, torch-npu, NPU Graph, 故障排查]
---

# Qwen3.5-27B 启动时 WorkerTP1 报 UCE ERROR 的排障记录

一次 vLLM-Ascend 服务启动在 `profile_run` 阶段失败。最显眼的异常是 `BackendCompilerFailed`、`npu_add_rms_norm` 和 `UCE ERROR`，随后 EngineCore 不断报告共享内存广播块不可用。

这类日志容易被误判成“编译慢”“HCCL 卡住”或“NPU 内存不足”。本次记录从调用链、失败设备和异步执行语义出发，建立可以重复执行的定位流程。

:::caution 当前状态
本文记录的是**排查中的间歇性事故**。首次启动失败后执行重启，相同服务已经能够成功启动。现有日志足以确定首次失败阶段和故障设备，但还不足以在“设备硬件 UCE”与“软件版本、异步执行或图融合路径触发/暴露 UCE”之间做最终选择。只有完成受控复现、物理卡 A/B、同步重跑和编译路径二分，才能写最终根因。
:::

## 1. 现象与环境

已知运行时环境变量如下：

```bash
PYTORCH_NPU_ALLOC_CONF=expandable_segments:True
HCCL_BUFFSIZE=512
OMP_PROC_BIND=false
OMP_NUM_THREADS=1
TASK_QUEUE_ENABLE=1
HCCL_OP_EXPANSION_MODE=AIV
```

实际启动命令为：

```bash
python3 -m vllm.entrypoints.openai.api_server \
  --model /workdir/Qwen3.5-27B \
  --served-model-name Qwen3.5-27B \
  --host 0.0.0.0 \
  --port 8000 \
  --tensor-parallel-size 2 \
  --dtype bfloat16 \
  --gpu-memory-utilization 0.85 \
  --max-model-len 32768 \
  --max-num-seqs 64 \
  --reasoning-parser qwen3 \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --default-chat-template-kwargs '{"enable_thinking": false}' \
  --additional-config '{"enable_weight_nz_layout": true}'
```

日志中的核心片段可以压缩为：

```text
Worker_TP1 / PID 59
  → determine_available_memory
  → profile_run
  → _dummy_run
  → qwen3_5.py: forward
  → VllmBackend / torch._dynamo / torch._inductor
  → norm_quant_fusion_pass.py: AddRMSNormDynamicQuantPattern
  → torch.ops.npu.npu_add_rms_norm
  → BackendCompilerFailed
  → RuntimeError: UCE ERROR
  → Device:1, RankID:-1, ERR00100 PTA call acl api failed

Worker_TP0
  → enable_npugraph_ex is enabled

EngineCore
  → No available shared memory broadcast block found in 60 seconds
```

这段日志没有出现 NPU OOM，也没有出现 HCCL 集合通信超时。不能仅凭当前片段把问题归因于 HBM 不足或 HCCL。

## 2. 模型身份与启动参数复核

最初环境说明中的“Qwen2.5-27B”是名称记录错误。模型路径、服务名和调用栈现在形成一致证据：

```text
/workdir/Qwen3.5-27B
/vllm-workspace/vllm/vllm/model_executor/models/qwen3_5.py
```

本次排查对象确定为 **Qwen3.5-27B**。仍需读取实际模型目录的 `config.json`，确认权重是否量化以及 vLLM 最终识别的架构：

```bash
export MODEL_PATH=/path/to/model

python - "$MODEL_PATH" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1]) / "config.json"
config = json.loads(path.read_text(encoding="utf-8"))
for key in (
    "model_type",
    "architectures",
    "torch_dtype",
    "quantization_config",
):
    print(f"{key}: {config.get(key)}")
PY
```

官方文档给出的 Qwen3.5-27B 最低 vLLM-Ascend 版本是 `v0.17.0rc1`；模型、量化制品、镜像和软件版本必须放在同一个兼容矩阵中核对。

### 2.1 这条命令能排除什么

- `--tensor-parallel-size 2` 与日志中的 `Worker_TP0/TP1` 一致；
- `--dtype bfloat16` 表示计算 dtype 选择 BF16，但不能代替对模型量化配置的检查；
- `--reasoning-parser`、`--tool-call-parser` 和 Chat Template 参数作用于请求解析与输出格式，不会解释启动 `profile_run` 阶段的 UCE；
- `--max-model-len 32768`、`--max-num-seqs 64` 和 `--gpu-memory-utilization 0.85` 会影响 HBM/KV 与画像负载，但当前日志没有 OOM，不能先把它归为容量问题；
- 没有显式 `--compilation-config` 不代表没有图优化，日志已经证明当前版本默认启用了 `npugraph_ex`。

### 2.2 `enable_weight_nz_layout` 需要核对版本

`enable_weight_nz_layout` 出现在较早版本或特定量化模型的部署样例中，用于将量化权重转换为 NZ 布局。当前 vLLM-Ascend 主线配置已经使用整数型 `weight_nz_mode`：

```text
0 = 禁用 NZ
1 = 只对量化权重启用，当前默认值
2 = 对 BF16/FP16 也启用
```

先检查目标镜像中的源码究竟识别哪个键：

```bash
python - <<'PY'
import vllm_ascend.ascend_config as ascend_config

print(ascend_config.__file__)
PY

grep -R -n -E \
  'enable_weight_nz_layout|weight_nz_mode' \
  /vllm-workspace/vllm-ascend/vllm_ascend 2>/dev/null
```

如果只找到 `weight_nz_mode`，旧键可能已经不生效；如果当前确实是 BF16 权重，基线测试也没有必要强行打开“量化权重 NZ”开关。第一次配置二分应只去掉这一项：

```bash
--additional-config '{}'
```

不要直接把它改成 `"weight_nz_mode": true`。在 Python/JSON 中 `true` 可被当成整数 `1`，实际含义是“只对量化权重启用”，容易造成配置含义误判。应显式写 `0`、`1` 或 `2`，并以目标版本文档为准。

## 3. 调用链说明了什么

### 3.1 故障发生在启动画像阶段

`determine_available_memory()` 会执行 `profile_run()`，用虚拟请求跑一次模型，以估算可用于 KV Cache 的 HBM。此时还没有正常对外提供推理流量。

```text
Worker 初始化
  → 权重与执行器准备
  → profile_run / dummy_run
  → 图捕获、编译或融合模式注册
  → 估算剩余 HBM
  → 创建 KV Cache
```

因此这不是“某个用户请求把服务打崩”，而是副本在 Ready 之前就失败。

### 3.2 当前堆栈落在 Norm-Quant 融合路径

vLLM-Ascend 的 `fuse_norm_quant` 会识别 RMSNorm 与量化的组合，尝试将其替换为融合执行路径，减少中间张量读写。日志停在：

```text
AddRMSNormDynamicQuantPattern
  → npu_add_rms_norm
  → UCE ERROR
```

`enable_npugraph_ex is enabled` 也说明当前启用了 Ascend 图编译优化。这个证据使“图编译/融合与当前版本栈不兼容”成为重要分支，但它还不能证明 `npu_add_rms_norm` 就是最早出错的算子。

另外，堆栈位于 Pattern 注册和 `make_fx` 跟踪期间，只能证明编译器正在构造 Norm-Quant 融合匹配模式。即使模型权重最终是 BF16，这一融合模式也可能在初始化时被注册；因此不能反过来用这条堆栈证明模型一定加载了量化权重。

### 3.3 异步执行会让 Python 堆栈发生偏移

当前设置了 `TASK_QUEUE_ENABLE=1`，算子下发和设备执行可能是异步的。前一个算子在设备侧失败，错误可能到后续同步点或队列检查时才被抛出，于是 Python 堆栈看起来停在 `npu_add_rms_norm`。

torch-npu 的错误处理代码也明确提示：异步调用时堆栈可能不准确，需要设置 `ASCEND_LAUNCH_BLOCKING=1` 获取更准确的位置。因此第一次诊断重跑应使用：

```bash
export ASCEND_LAUNCH_BLOCKING=1
export TASK_QUEUE_ENABLE=0
```

这组设置用于定位，不是生产性能配置。诊断结束后要恢复并重新压测。

### 3.4 共享内存提示是后果

`Worker_TP1` 已经异常退出或无法继续响应，`Worker_TP0` 与 EngineCore 仍在等待多进程广播资源，于是每 60 秒打印：

```text
No available shared memory broadcast block found ...
```

这条信息描述的是“其他进程等不到 TP1”，不是最早根因。继续调大共享内存等待时间不会修复 UCE。

## 4. 当前可以下的结论

| 结论 | 置信度 | 证据 |
| --- | --- | --- |
| 服务在启动画像/编译阶段失败 | 高 | `profile_run → _dummy_run → VllmBackend` |
| 最先报告异常的是 TP1 对应的逻辑 Device 1 | 高 | `Worker_TP1`、`Device:1` |
| 当前进程遇到了 UCE 类设备错误 | 高 | `RuntimeError: UCE ERROR` |
| 当前启用了 npugraph_ex 和 Norm-Quant 融合路径 | 高 | 启用日志与 `norm_quant_fusion_pass.py` |
| 共享内存广播告警是 TP1 异常后的连锁反应 | 高 | 时间顺序晚于 UCE |
| `npu_add_rms_norm` 一定是最早失败算子 | 中低 | 异步下发可能让堆栈偏移 |
| Device 1 一定存在永久硬件故障 | 中 | 必须看 health/ECC/RAS，并做物理卡 A/B |
| HCCL 或网络是根因 | 低 | 当前无 HCCL 超时，报错时 `RankID:-1` |
| NPU OOM 是根因 | 低 | 当前日志无内存分配失败或 OOM |

## 5. 环境变量逐项解释

| 变量 | 作用 | 与本次故障的关系 |
| --- | --- | --- |
| `PYTORCH_NPU_ALLOC_CONF=expandable_segments:True` | 让 NPU 缓存分配器使用可扩展段，主要缓解内存碎片 | 当前没有 OOM 证据，不是首要根因 |
| `HCCL_BUFFSIZE=512` | 设置 HCCL 集合通信缓冲区大小，单位为 MB | 会占用额外资源，但当前失败不是 HCCL 调用错误 |
| `OMP_PROC_BIND=false` | 不强制绑定 OpenMP 线程 | 影响 CPU/NUMA 与性能，不会直接解释 UCE |
| `OMP_NUM_THREADS=1` | 每个 OpenMP 区域使用一个线程 | 可能影响 CPU 性能，不会直接解释设备 UCE |
| `TASK_QUEUE_ENABLE=1` | 启用异步算子下发队列 | 可能使异常延后抛出，诊断时应暂时关闭 |
| `HCCL_OP_EXPANSION_MODE=AIV` | 由 AI Vector Core 侧编排/执行部分通信算法 | 是性能选项；没有 HCCL 证据时不应先围绕它调参 |

这些变量有的来自特定模型的性能样例，不能被当成所有 A2/A3、CANN 与模型组合的通用模板。首先恢复目标模型对应版本的官方基线，再做一次只改变一个变量的实验。

## 6. 第一阶段：先保护现场和隔离故障域

### 6.1 不要连续自动重启

如果 UCE 来自设备健康问题，连续拉起同一个 TP 副本只会反复触碰同一设备并覆盖关键日志。生产环境应先：

1. 摘除整个 TP 副本，不只摘 TP1；
2. 停止在该节点继续调度新实例；
3. 保存容器日志、主机日志、设备健康和版本信息；
4. 记录逻辑 Device 1 对应的物理 Device ID、Chip ID、槽位和序列号；
5. 再进入维护窗口做单卡验证。

### 6.2 查询设备健康、ECC 与 RAS

先执行 `npu-smi info` 获取目标机器真实的 Device ID 与 Chip ID，再替换占位符：

```bash
npu-smi info
npu-smi info -t health -i DEVICE_ID -c CHIP_ID
npu-smi info -t ecc -i DEVICE_ID
```

不同 Atlas 产品和驱动版本支持的 `-t` 子命令不同，应先查看：

```bash
npu-smi info -h
```

同时对齐事故时间查看内核与设备日志：

```bash
journalctl -k --since "2026-08-20 13:45:00" --until "2026-08-20 14:05:00"
dmesg -T | grep -Ei 'npu|davinci|hbm|ecc|uce|ras|hardware|error'
```

华为故障处理文档建议用 `npu-smi info -t health` 查询最近的 RAS 事件，并在黑匣子日志中检查同一时间、同一 Device 的 `Hardware Error`。如果 health、ECC 或 RAS 异常，不应直接将设备重新投入生产；先采集厂商要求的诊断包，再按产品手册处置或联系技术支持。

### 6.3 重启成功带来的新证据

同一服务重启后成功，只能证明故障**不是每次启动都必现**，不能证明问题已经消失。还必须记录“重启”发生在哪一层：

| 重启动作 | 可以清理的状态 | 对定位的意义 |
| --- | --- | --- |
| 只重启 API/Engine 进程 | Python 进程、Worker、编译器和进程内缓存 | 更关注竞态、编译缓存、异步队列和进程状态 |
| 重启容器 | 进程、容器文件系统中的临时缓存和共享内存 | 还需区分容器缓存、挂载缓存和宿主机设备状态 |
| 复位 NPU | 设备执行上下文与部分设备状态 | 设备或驱动瞬时状态的可能性提高 |
| 重启操作系统 | 驱动、内核、设备和进程状态 | 无法再用“重启后成功”区分软件与硬件瞬时故障 |
| 断电重启 | 最完整的硬件状态重置 | 若之后复发，应重点保全硬件事件并联系支持 |

如果执行过整机重启，要额外保存上一启动周期的内核日志：

```bash
journalctl -k -b -1
```

`journalctl` 未持久化时，上一次启动的证据可能已经丢失。生产节点应提前配置日志持久化和远端采集。

### 6.4 有限轮次的受控冷启动复现

可以重复启动，但应满足四条约束：

1. 最多执行约定轮数，例如 10 轮，不做无限循环；
2. 每轮使用完全相同的物理卡映射、环境变量、模型和参数；
3. 每轮保存完整日志与启动前后 `npu-smi`；
4. 一旦出现 `UCE ERROR`、`ERR00100`、设备 health/ECC/RAS 异常或未知卡死，立即停止，不再自动重启。

下面脚本在服务成功通过 `/health` 后主动停止，再进入下一轮；遇到 UCE 或非预期超时立即保留现场并退出。应在已摘流的维护环境执行，确认 `/workdir` 有足够空间并且没有其他实例占用 8000 端口。

```bash
#!/usr/bin/env bash
set -u

MAX_ROUNDS=10
START_TIMEOUT_SECONDS=600
REPRO_ROOT="/workdir/vllm-uce-repro-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$REPRO_ROOT"

export PYTORCH_NPU_ALLOC_CONF=expandable_segments:True
export HCCL_BUFFSIZE=512
export OMP_PROC_BIND=false
export OMP_NUM_THREADS=1
export TASK_QUEUE_ENABLE=1
export HCCL_OP_EXPANSION_MODE=AIV

cmd=(
  python3 -m vllm.entrypoints.openai.api_server
  --model /workdir/Qwen3.5-27B
  --served-model-name Qwen3.5-27B
  --host 0.0.0.0
  --port 8000
  --tensor-parallel-size 2
  --dtype bfloat16
  --gpu-memory-utilization 0.85
  --max-model-len 32768
  --max-num-seqs 64
  --reasoning-parser qwen3
  --enable-auto-tool-choice
  --tool-call-parser qwen3_coder
  --default-chat-template-kwargs '{"enable_thinking": false}'
  --additional-config '{"enable_weight_nz_layout": true}'
)

stop_process() {
  local pid="$1"
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 30); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
  fi
  if kill -0 "$pid" 2>/dev/null; then
    kill -KILL "$pid" 2>/dev/null || true
  fi
  wait "$pid" 2>/dev/null || true
}

for round in $(seq 1 "$MAX_ROUNDS"); do
  round_dir="$REPRO_ROOT/round-$(printf '%02d' "$round")"
  mkdir -p "$round_dir"

  date --iso-8601=seconds >"$round_dir/start-time.txt"
  env | sort >"$round_dir/environment.txt"
  npu-smi info >"$round_dir/npu-before.txt" 2>&1 || true

  "${cmd[@]}" >"$round_dir/server.log" 2>&1 &
  server_pid=$!
  echo "$server_pid" >"$round_dir/server.pid"
  ready=0
  uce=0

  for _ in $(seq 1 $((START_TIMEOUT_SECONDS / 2))); do
    if grep -qE 'UCE ERROR|ERR00100 PTA call acl api failed' \
      "$round_dir/server.log"; then
      uce=1
      break
    fi

    if curl -fsS http://127.0.0.1:8000/health \
      >"$round_dir/health-response.txt" 2>&1; then
      ready=1
      break
    fi

    kill -0 "$server_pid" 2>/dev/null || break
    sleep 2
  done

  date --iso-8601=seconds >"$round_dir/end-time.txt"
  npu-smi info >"$round_dir/npu-after.txt" 2>&1 || true
  dmesg -T | tail -n 2000 >"$round_dir/dmesg-tail.txt" 2>&1 || true

  if [ "$uce" -eq 1 ]; then
    echo "UCE reproduced in round $round; stop and preserve $round_dir"
    stop_process "$server_pid"
    break
  fi

  if [ "$ready" -ne 1 ]; then
    echo "Round $round did not become ready; stop and inspect $round_dir"
    stop_process "$server_pid"
    break
  fi

  echo "Round $round became ready"
  stop_process "$server_pid"
  sleep 5
done

echo "Evidence directory: $REPRO_ROOT"
```

脚本只负责建立“同一条件下是否复发”的证据。不要在这一阶段同时设置 `ASCEND_LAUNCH_BLOCKING=1`、关闭图模式或修改容量参数，否则复现条件已经改变。

### 6.5 首次复发后的立即动作

脚本检测到 UCE 后不要立刻开始下一轮。先执行并保存：

```bash
npu-smi info
npu-smi info -t health -i DEVICE_ID -c CHIP_ID
npu-smi info -t ecc -i DEVICE_ID
journalctl -k --since "故障前十分钟" --until "故障后十分钟"
```

同时复制目标轮次的 `server.log`、容器日志、设备/黑匣子日志和镜像版本。然后再进入第二组实验：设置 `ASCEND_LAUNCH_BLOCKING=1`、`TASK_QUEUE_ENABLE=0`，使用同一物理卡重跑，以确定真正的首个失败算子。

## 7. Kubernetes 910B 集群专项排查

910B 在 Kubernetes 中属于昇腾 NPU 资源。故障链路比裸机多了调度、Device Plugin、容器 Runtime 和 Pod 生命周期：

```text
Deployment / StatefulSet / KServe
  → Pod UID 与调度节点
  → Ascend Device Plugin 分配物理 NPU
  → Ascend Runtime 注入设备与驱动库
  → 容器内逻辑 Device 0/1
  → vLLM-Ascend Worker_TP0/TP1
  → torch-npu / CANN / 物理 910B
```

Kubernetes 排查的第一目标不是继续删 Pod，而是回答：失败 Pod 和成功 Pod 是否使用了同一节点、同一组物理 NPU、同一镜像与同一配置。

### 7.1 先区分容器重启与 Pod 重建

```bash
export NS=实际命名空间
export POD=当前Pod名
export CONTAINER=实际容器名

kubectl get pod -n "$NS" "$POD" -o wide
kubectl get pod -n "$NS" "$POD" \
  -o jsonpath='{.metadata.uid}{"\n"}{.spec.nodeName}{"\n"}'
kubectl get pod -n "$NS" "$POD" \
  -o jsonpath='{range .status.containerStatuses[*]}{.name}{" restartCount="}{.restartCount}{" current="}{.state}{" last="}{.lastState}{"\n"}{end}'
```

| 变化 | 含义 |
| --- | --- |
| Pod UID 不变、`restartCount` 增加 | 同一个 Pod 内的容器重启，通常仍属于同一次设备分配 |
| Pod 名或 UID 改变、Node 不变 | 控制器创建了新 Pod，可能重新分配了不同物理卡 |
| Pod UID 与 Node 都改变 | 节点、驱动、固件和物理卡全部变了，不能称为同环境复测 |
| Pod 一直不变但应用子进程重建 | kubelet 看不到应用内部 Worker 重启，需要看容器内进程和 vLLM 日志 |

因此，“删除 Pod 后新 Pod 成功”首先要比较旧、新 Pod 的 UID、Node 和设备注解。若成功 Pod 已经换卡或换节点，原节点/原卡的嫌疑反而更高。

### 7.2 给当前成功 Pod 建立基线证据包

在再次重启前先保存成功现场：

```bash
export EVIDENCE_DIR="./qwen35-uce-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$EVIDENCE_DIR"

kubectl get pod -n "$NS" "$POD" -o yaml \
  >"$EVIDENCE_DIR/pod.yaml"
kubectl describe pod -n "$NS" "$POD" \
  >"$EVIDENCE_DIR/pod-describe.txt"
kubectl logs -n "$NS" "$POD" -c "$CONTAINER" --timestamps \
  >"$EVIDENCE_DIR/current.log" 2>&1
kubectl logs -n "$NS" "$POD" -c "$CONTAINER" --previous --timestamps \
  >"$EVIDENCE_DIR/previous.log" 2>&1 || true

POD_UID=$(kubectl get pod -n "$NS" "$POD" -o jsonpath='{.metadata.uid}')
kubectl get events -n "$NS" \
  --field-selector "involvedObject.uid=$POD_UID" \
  --sort-by=.lastTimestamp \
  >"$EVIDENCE_DIR/events.txt"

kubectl exec -n "$NS" "$POD" -c "$CONTAINER" -- env \
  >"$EVIDENCE_DIR/container-env.txt"
kubectl exec -n "$NS" "$POD" -c "$CONTAINER" -- npu-smi info \
  >"$EVIDENCE_DIR/container-npu-smi.txt" 2>&1 || true
kubectl exec -n "$NS" "$POD" -c "$CONTAINER" -- sh -c \
  'ls -l /dev/davinci* 2>/dev/null; df -h /dev/shm; mount | grep -E "shm|Ascend|driver"' \
  >"$EVIDENCE_DIR/container-devices-mounts.txt" 2>&1 || true
```

`pod.yaml` 可能包含内部地址、挂载名称和配置引用，证据包需要限制访问并在对外提交前脱敏。

### 7.3 映射 TP1 到物理 NPU

容器内 `Device:1` 是逻辑设备 1，不等于宿主机物理 Device 1。收集下面三类信息后才能建立映射：

```bash
kubectl get pod -n "$NS" "$POD" -o json | \
  jq '{uid:.metadata.uid,node:.spec.nodeName,annotations:.metadata.annotations}'

kubectl exec -n "$NS" "$POD" -c "$CONTAINER" -- sh -c \
  'env | grep -Ei "ASCEND|NPU|HCCL|RANK"; npu-smi info'

kubectl describe pod -n "$NS" "$POD"
```

重点检查：

- Pod 请求的资源键和数量，例如 `huawei.com/Ascend910: 2` 或目标集群实际使用的 `huawei.com/npu: 2`；
- Pod annotations 中是否记录 `Ascend910-X` 设备列表；
- Runtime 注入的可见设备变量；
- `/dev/davinci*` 设备文件；
- 容器内逻辑卡数量是否等于 TP=2；
- 是否人为设置了 `ASCEND_RT_VISIBLE_DEVICES`，与 Device Plugin 分配发生二次过滤。

不要仅凭 `Worker_TP1 / Device:1` 就去维护宿主机 1 号卡，也不要在业务 YAML 中手工指定可见卡来绕过 Device Plugin。

### 7.4 检查节点资源和 Ascend Device Plugin

```bash
export NODE=$(kubectl get pod -n "$NS" "$POD" -o jsonpath='{.spec.nodeName}')

kubectl get node "$NODE" -o wide
kubectl describe node "$NODE"
kubectl get node "$NODE" -o json | \
  jq '.status.capacity,.status.allocatable'

kubectl get configmap -n kube-system \
  "mindx-dl-deviceinfo-$NODE" -o yaml

kubectl get pods -n kube-system -o wide | \
  grep -Ei 'ascend.*device|device.*plugin|npu.*exporter'
```

在 `mindx-dl-deviceinfo-<node>` 中重点查：

```text
huawei.com/Ascend910-Fault
huawei.com/Ascend910-Unhealthy
huawei.com/Ascend910-Recovering
huawei.com/Ascend910-NetworkUnhealthy
ManuallySeparateNPU
UpgradeFaultReason
```

不同 MindCluster/Device Plugin 版本的字段可能变化；较新版本中可用卡字段还可能由 Volcano 维护，但 Fault/Unhealthy 信息仍是重要证据。保存 ConfigMap 和 Device Plugin 日志后再进行恢复操作：

```bash
kubectl logs -n kube-system DEVICE_PLUGIN_POD \
  --since=30m --timestamps \
  >"$EVIDENCE_DIR/device-plugin.log"
```

不要手工编辑 `mindx-dl-deviceinfo-*`，也不要在没有完成 health/RAS 验收前添加 Recover Label；这会破坏故障现场，并可能让不稳定设备重新进入资源池。

### 7.5 到宿主机检查真实设备

优先使用现有节点运维通道。没有 SSH 时，可以在审批和维护窗口使用高权限节点调试容器：

```bash
kubectl debug node/"$NODE" -it \
  --image=内部批准的节点诊断镜像@sha256:固定摘要 \
  --profile=sysadmin
```

节点调试容器通常把宿主机根目录挂载到 `/host`，实际行为以集群版本为准。进入宿主机环境后采集：

```bash
chroot /host
npu-smi info
npu-smi info -h
npu-smi info -t health -i DEVICE_ID -c CHIP_ID
npu-smi info -t ecc -i DEVICE_ID
journalctl -k --since "故障前十分钟" --until "故障后十分钟"
journalctl -u kubelet --since "故障前十分钟" --until "故障后十分钟"
```

`--profile=sysadmin` 权限很高，只能使用经过审核的镜像和账号。若集群不允许节点调试，应由节点运维人员在宿主机执行等价的只读取证。

### 7.6 用一次性 Job 复现，不让控制器覆盖现场

不要反复 `rollout restart` 生产 Deployment。建议从生产工作负载复制镜像、命令、环境、模型 PVC、RuntimeClass、ServiceAccount、资源限制和安全上下文，创建专用 Job：

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: qwen35-uce-attempt-001
  namespace: ai-diagnostics
spec:
  backoffLimit: 0
  template:
    metadata:
      labels:
        app: qwen35-uce-repro
        attempt: "001"
    spec:
      restartPolicy: Never
      activeDeadlineSeconds: 1200
      nodeSelector:
        kubernetes.io/hostname: SUSPECT_NODE
      containers:
        - name: vllm
          image: REGISTRY/VLLM_ASCEND_IMAGE@sha256:IMAGE_DIGEST
          terminationMessagePolicy: FallbackToLogsOnError
          env:
            - name: PYTORCH_NPU_ALLOC_CONF
              value: expandable_segments:True
            - name: HCCL_BUFFSIZE
              value: "512"
            - name: OMP_PROC_BIND
              value: "false"
            - name: OMP_NUM_THREADS
              value: "1"
            - name: TASK_QUEUE_ENABLE
              value: "1"
            - name: HCCL_OP_EXPANSION_MODE
              value: AIV
          command: ["python3", "-m", "vllm.entrypoints.openai.api_server"]
          args:
            - --model
            - /workdir/Qwen3.5-27B
            - --served-model-name
            - Qwen3.5-27B
            - --host
            - 0.0.0.0
            - --port
            - "8000"
            - --tensor-parallel-size
            - "2"
            - --dtype
            - bfloat16
            - --gpu-memory-utilization
            - "0.85"
            - --max-model-len
            - "32768"
            - --max-num-seqs
            - "64"
            - --reasoning-parser
            - qwen3
            - --enable-auto-tool-choice
            - --tool-call-parser
            - qwen3_coder
            - --default-chat-template-kwargs
            - '{"enable_thinking": false}'
            - --additional-config
            - '{"enable_weight_nz_layout": true}'
          resources:
            requests:
              huawei.com/Ascend910: "2"
            limits:
              huawei.com/Ascend910: "2"
          volumeMounts:
            - name: model
              mountPath: /workdir/Qwen3.5-27B
              readOnly: true
      volumes:
        - name: model
          persistentVolumeClaim:
            claimName: MODEL_PVC
```

模板中的资源键、命名空间、节点、镜像、PVC、RuntimeClass、安全上下文、容忍和亲和性必须从当前集群实际配置补齐。不要照抄示例资源名。每轮使用新 Job 名，并记录实际分配的物理卡：

```bash
kubectl apply -f qwen35-uce-attempt-001.yaml
kubectl get pod -n ai-diagnostics -l attempt=001 -o wide -w
kubectl logs -n ai-diagnostics -l attempt=001 \
  --all-containers --prefix --timestamps -f
```

Job 使用 `restartPolicy: Never`、`backoffLimit: 0`，失败后 Pod 对象和日志不会被 Job 自动重试覆盖。首次出现 UCE 后停止创建下一轮，立即完成 Pod、Device Plugin 和宿主机三层取证。

### 7.7 Kubernetes 场景的判定矩阵

| 失败分布 | 优先方向 |
| --- | --- |
| 同一镜像只在同一物理 NPU 失败 | 物理卡、HBM/ECC/RAS、固件 |
| 同节点多张卡随机失败，其他节点正常 | 节点驱动、固件、供电、主机或节点级 CANN Runtime |
| 所有节点在相同图编译位置失败 | vLLM/vLLM-Ascend/torch-npu/CANN/模型组合 |
| 新 Pod 换节点后成功 | 原节点或原卡嫌疑提高，不能当成软件已修复 |
| Device Plugin 同时上报 Fault/Unhealthy | 先按设备故障隔离和厂商流程处理 |
| Pod 为 OOMKilled/137，但应用还打印 UCE | 同时存在容器内存问题；必须按时间线确定哪个先发生 |
| 只在 TP=2 失败，单卡均正常 | 可见卡映射、HCCL、HCCS/PCIe、CPU/NUMA 与多进程路径 |
| 关闭图或 Norm-Quant 融合后跨节点都稳定 | 图编译/融合兼容问题，设备故障概率下降 |

## 8. 第二阶段：冻结完整版本和配置

只记录“某个 vLLM-Ascend 镜像”不够。必须采集：

```bash
python - <<'PY'
from importlib.metadata import PackageNotFoundError, version

for package in (
    "vllm",
    "vllm-ascend",
    "torch",
    "torch-npu",
    "transformers",
):
    try:
        print(f"{package}={version(package)}")
    except PackageNotFoundError:
        print(f"{package}=NOT_INSTALLED")
PY

python --version
cat /usr/local/Ascend/driver/version.info 2>/dev/null
cat /usr/local/Ascend/firmware/version.info 2>/dev/null
find /usr/local/Ascend -maxdepth 3 \
  \( -name 'version.info' -o -name '*install.info' \) -print
```

还要保存：

- 服务器型号与 A2/A3 系列；
- 宿主机 OS 与内核版本；
- 容器镜像 tag 和 digest；
- CANN、固件、驱动、PyTorch、torch-npu、vLLM、vLLM-Ascend；
- 模型目录、revision、权重格式、量化配置；
- 完整启动命令和全部环境变量；
- 每个 TP Rank 到物理 NPU 的映射。

如果环境仍是 Atlas 800I A2，镜像不能使用 `-a3` 后缀。例如官方 `v0.22.1rc1` 镜像中，无后缀版本对应 A2，`-a3` 对应 A3；麒麟/openEuler 系环境还要核对镜像的 OS 变体。镜像系列错误必须先纠正，再讨论算子问题。

## 9. 第三阶段：判断故障是否跟随物理卡

### 9.1 先做最小 NPU 冒烟测试

在已摘流的维护环境中，分别将健康候选卡和原 Device 1 映射为容器内逻辑卡 0，运行同一程序。先保存设备映射，避免把容器逻辑 ID 当成物理 ID。

```bash
export ASCEND_RT_VISIBLE_DEVICES=PHYSICAL_DEVICE_ID
export ASCEND_LAUNCH_BLOCKING=1
export TASK_QUEUE_ENABLE=0

python - <<'PY'
import torch
import torch_npu

torch.npu.set_device(0)
x = torch.randn((1024, 1024), device="npu:0", dtype=torch.float16)
y = torch.randn((1024, 1024), device="npu:0", dtype=torch.float16)
z = x @ y
torch.npu.synchronize()
print("device:", torch.npu.current_device())
print("finite:", bool(torch.isfinite(z).all().cpu()))
PY
```

如果基础矩阵乘都在同一物理卡上稳定触发 UCE，而其他卡正常，优先按设备/驱动故障处理，不要继续用 vLLM 参数掩盖。

### 9.2 再单独验证报错算子

基础测试通过后，再执行与日志相同的融合前算子。算子签名可能随 torch-npu 版本变化，先确认目标版本存在该算子：

```bash
python - <<'PY'
import torch
import torch_npu

print(torch.ops.npu.npu_add_rms_norm)
PY
```

维护窗口中可做小张量验证：

```bash
python - <<'PY'
import torch
import torch_npu

torch.npu.set_device(0)
x = torch.randn((128, 4096), device="npu:0", dtype=torch.bfloat16)
residual = torch.randn_like(x)
weight = torch.ones((4096,), device="npu:0", dtype=torch.bfloat16)
output = torch.ops.npu.npu_add_rms_norm(x, residual, weight, 1e-6)
torch.npu.synchronize()
print([tuple(t.shape) for t in output])
PY
```

若目标版本不接受这组 dtype/签名，应以该版本算子文档和模型真实 hidden size 修改，不能把参数错误当成硬件错误。

### 9.3 物理卡 A/B 判定

| 健康候选卡 | 原 Device 1 | 结论方向 |
| --- | --- | --- |
| 通过 | UCE | 故障跟随物理卡，优先设备、HBM/ECC、固件或驱动 |
| UCE | UCE | 共同软件栈、算子、镜像或主机级问题 |
| 都通过 | 都通过 | 继续查 vLLM 图编译、量化、TP 或瞬时设备事件 |
| 结果随机 | 结果随机 | 查温度、供电、PCIe/HCCS、驱动状态与压力相关硬件问题 |

## 10. 第四阶段：二分图编译与融合路径

物理卡健康没有异常后，使用同一模型、同一权重、同一卡和同一启动参数，只改变一项配置。

### 10.1 实验 A：同步重跑原始路径

```bash
export ASCEND_LAUNCH_BLOCKING=1
export TASK_QUEUE_ENABLE=0
```

其他参数不变。保存**第一次**错误前后完整日志。如果首错移动到另一个算子，则原来的 `npu_add_rms_norm` 只是异步错误暴露点。

### 10.2 实验 B：只关闭 Norm-Quant 融合

保留图编译，只关闭当前调用栈命中的融合 Pass：

```bash
vllm serve "$MODEL_PATH" \
  ...原有参数... \
  --additional-config \
  '{"ascend_compilation_config":{"fuse_norm_quant":false}}'
```

如果 B 通过而 A 失败，说明故障与 Norm-Quant 融合路径强相关。此时应核对该版本的已知问题，并用最小复现向 vLLM-Ascend 提交 issue；关闭融合可作为短期绕行，但必须重新做精度和性能测试。

### 10.3 实验 C：只关闭 npugraph_ex

```bash
vllm serve "$MODEL_PATH" \
  ...原有参数... \
  --additional-config \
  '{"ascend_compilation_config":{"enable_npugraph_ex":false}}'
```

如果 B 仍失败、C 通过，范围扩大到 npugraph_ex 后端或其他编译 Pass，不再只怀疑 Norm-Quant。

### 10.4 实验 D：强制 Eager

```bash
vllm serve "$MODEL_PATH" \
  ...原有参数... \
  --enforce-eager
```

如果只有 Eager 能启动，问题位于图捕获/编译/融合路径的概率很高；如果 Eager 仍在同一物理卡触发 UCE，应重新回到设备健康、算子和版本栈。

:::warning 单变量原则
不要一次同时关闭异步队列、图模式、全部融合、量化和 TP。那只能得到“改完后能启动”，无法知道哪个改变真正有效，也无法形成可维护的修复方案。
:::

## 11. TP 与 HCCL 何时才进入排查范围

当前日志不支持“HCCL 是根因”，但若单卡通过、只有 TP=2 或更大时失败，再进入通信分支：

1. 保存每个 Rank 的最早错误，而不是只看 EngineCore 最后的超时；
2. 核对 Rank 到物理卡、NUMA 与 HCCS/RoCE 拓扑；
3. 检查 HCCL Link、Device IP 和错误计数；
4. 使用目标 CANN 配套的 HCCL Test 建立基线；
5. 去掉非模型官方基线要求的 HCCL 调优变量后复测。

`HCCL_BUFFSIZE=512` 和 `HCCL_OP_EXPANSION_MODE=AIV` 是通信性能配置，不是修复所有启动失败的“稳定性开关”。不同 CANN 与模型样例的推荐值可能不同，必须以当前版本文档为准。

## 12. 实验结果矩阵

建议按下表记录，不要靠记忆比较：

| 编号 | 物理卡 | TP | 执行模式 | Norm-Quant 融合 | 结果 | 第一条设备错误 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 健康候选卡 | 1 | 同步 Eager | 不适用 | 待测 | 待填 |
| 2 | 原 Device 1 | 1 | 同步 Eager | 不适用 | 待测 | 待填 |
| 3 | 原卡组 | 原 TP | 同步 Graph | 开 | 待测 | 待填 |
| 4 | 原卡组 | 原 TP | 同步 Graph | 关 | 待测 | 待填 |
| 5 | 原卡组 | 原 TP | npugraph_ex 关 | 关/默认 | 待测 | 待填 |
| 6 | 原卡组 | 原 TP | Eager | 不适用 | 待测 | 待填 |

结果解释：

```text
失败跟随物理卡
  → Device/HBM/ECC/RAS/固件/驱动

所有卡只在 fuse_norm_quant=true 时失败
  → Norm-Quant Fusion 与版本/模型/量化组合

所有卡只在 Graph 失败
  → npugraph_ex、torch.compile、CANN 编译或其他 Fusion Pass

单卡通过、仅 TP 失败
  → Rank 映射、集合通信、拓扑或多进程路径

Eager 和 Graph 都失败，且所有卡一致
  → 模型制品、算子支持、量化或完整版本栈
```

## 13. 可能的修复与验收

### 13.1 若确认是设备故障

- 摘除物理卡或整个节点；
- 保存 health、ECC、RAS、黑匣子和事故时间；
- 按 Atlas 产品手册执行维护、固件/驱动修复或硬件更换；
- 修复后分别通过基础算子、目标算子、单卡模型、TP 模型和持续压测；
- 没有健康验收前不要只靠重启恢复调度。

### 13.2 若确认是版本兼容

- 选择官方兼容行，不在容器内临时替换单个 `.so`；
- A2/A3 使用对应镜像变体；
- 固定镜像 digest、模型 revision 和量化制品；
- 对升级前后做输出精度、TTFT、TPOT、吞吐与 HBM 回归。

### 13.3 若确认是图融合问题

- 用关闭 `fuse_norm_quant` 或 `npugraph_ex` 作为可逆短期绕行；
- 保留同步模式下的最小复现、完整版本和首错日志；
- 查对应版本 release notes/issue，升级到含修复的版本或回退已验证版本；
- 绕行会改变性能路径，恢复流量前必须重新压测。

### 13.4 恢复标准

至少满足：

1. 所有参与 TP 的物理卡 health 正常，无新增 ECC/RAS/UCE；
2. 同配置连续冷启动多次通过；
3. 单请求、并发、长上下文与流式请求通过；
4. 每个 Rank 的 HBM、利用率和延迟没有持续分化；
5. 观察窗口内无 Worker 退出和共享内存等待；
6. 若关闭优化绕行，精度与性能仍满足服务基线；
7. 版本、镜像 digest、配置和回滚方案已归档。

## 14. 本次事故还缺少的证据

要完成最终根因，还需要补齐：

- 完整启动日志，而不是从 Python 堆栈中部开始的片段；
- 实际模型 `config.json` 和量化配置；
- vLLM 解析完成后的配置日志，确认参数实际值和默认值；
- 服务器型号，确认 A2/A3；
- 镜像 tag 与 digest；
- CANN、驱动、固件、torch、torch-npu、vLLM、vLLM-Ascend 版本；
- Device 1 的 health、ECC、RAS 和事故时段设备日志；
- `ASCEND_LAUNCH_BLOCKING=1`、`TASK_QUEUE_ENABLE=0` 后的第一条错误；
- 物理卡 A/B 与 Eager/Graph/Fusion 二分结果。

在这些证据出现前，最准确的阶段性表述是：

> vLLM-Ascend 在 Qwen3.5 架构模型的启动画像与图编译期间，TP1 对应 Device 1 报告 UCE；错误在 Norm-Quant 融合模式注册期间被观察到。设备健康故障与软件编译/融合兼容问题均待实验排除，EngineCore 的共享内存等待是 Worker 异常后的次生现象。

## 15. 官方资料

- [vLLM-Ascend Qwen3.5-27B 部署与最低版本](https://github.com/vllm-project/vllm-ascend/blob/main/docs/source/tutorials/models/Qwen3.5-27B-Qwen3.6-27B.md)
- [vLLM-Ascend Additional Configuration](https://github.com/vllm-project/vllm-ascend/blob/main/docs/source/user_guide/configuration/additional_config.md)
- [vLLM-Ascend 安装与 A2/A3 镜像对应关系](https://docs.vllm.ai/projects/ascend/en/main/installation.html)
- [vLLM-Ascend 性能变量与 HCCL AIV 说明](https://github.com/vllm-project/vllm-ascend/blob/main/docs/source/developer_guide/performance_and_debug/optimization_and_tuning.md)
- [torch-npu UCE 检查与恢复相关源码](https://github.com/Ascend/pytorch/blob/master/torch_npu/csrc/npu/Module.cpp)
- [华为 CANN 故障处理手册](https://www.hiascend.com/doc_center/source/zh/CANNCommunityEdition/800alpha001/devguide/maintenref/troubleshooting/CANN%208.0.0.alpha001%20%E6%95%85%E9%9A%9C%E5%A4%84%E7%90%86%2001.pdf)
