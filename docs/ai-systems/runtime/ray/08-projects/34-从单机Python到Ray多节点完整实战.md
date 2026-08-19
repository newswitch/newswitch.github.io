---
title: "从单机 Python 到 Ray 多节点完整实战"
sidebar_label: "34. 从单机 Python 到 Ray 多节点"
sidebar_position: 34
description: "把一个单机批处理程序逐步改造为具备有界并发、Actor 状态、容错、数据落盘和多节点验收的 Ray 应用。"
tags: [Ray, Python, 多节点, Task, Actor, 实战]
---

# 从单机 Python 到 Ray 多节点完整实战

本项目处理一批文本文件，计算摘要统计并写入结果。重点不是算法，而是用同一业务逐步建立分布式边界。

## 1. 目标与完成标准

- 本地模式与多节点使用同一份代码；
- 并发有上限，不一次创建无限 ObjectRef；
- 单文件失败可重试，输出幂等；
- Worker 不依赖 Driver 本地私有路径；
- 能从 State CLI 定位 Task、Actor 和 Node；
- 节点退出后任务能够恢复或明确失败。

## 2. 单机基线

```python title="baseline.py"
from pathlib import Path
import hashlib
import json

def process(path: str) -> dict:
    text = Path(path).read_text(encoding="utf-8")
    return {
        "path": path,
        "chars": len(text),
        "lines": text.count("\n") + 1,
        "sha256": hashlib.sha256(text.encode()).hexdigest(),
    }

results = [process(str(path)) for path in Path("data").glob("*.txt")]
Path("output.json").write_text(json.dumps(results), encoding="utf-8")
```

先记录文件数、总字节、耗时和结果哈希，这些是分布式版本的正确性基线。

## 3. 把纯函数变成 Task

```python title="pipeline.py"
from pathlib import Path
import hashlib
import json
import ray

@ray.remote(max_retries=2, retry_exceptions=True, num_cpus=1)
def process(uri: str) -> dict:
    # 示例用共享挂载；生产可替换为对象存储客户端。
    text = Path(uri).read_text(encoding="utf-8")
    return {
        "uri": uri,
        "chars": len(text),
        "lines": text.count("\n") + 1,
        "sha256": hashlib.sha256(text.encode()).hexdigest(),
    }

@ray.remote(num_cpus=0)
class Progress:
    def __init__(self):
        self.ok = 0
        self.failed = 0

    def add(self, ok: bool):
        if ok:
            self.ok += 1
        else:
            self.failed += 1

    def snapshot(self):
        return {"ok": self.ok, "failed": self.failed}

def run(uris: list[str], max_in_flight: int = 64) -> list[dict]:
    progress = Progress.remote()
    waiting: list = []
    output: list[dict] = []

    for uri in uris:
        waiting.append(process.remote(uri))
        if len(waiting) >= max_in_flight:
            ready, waiting = ray.wait(waiting, num_returns=16)
            for ref in ready:
                try:
                    output.append(ray.get(ref))
                    progress.add.remote(True)
                except Exception:
                    progress.add.remote(False)
                    raise

    while waiting:
        ready, waiting = ray.wait(waiting, num_returns=min(16, len(waiting)))
        output.extend(ray.get(ready))
        for _ in ready:
            progress.add.remote(True)

    print(ray.get(progress.snapshot.remote()))
    return output

if __name__ == "__main__":
    ray.init(address="auto")
    files = sorted(str(path) for path in Path("/data/input").glob("*.txt"))
    result = run(files)
    tmp = Path("/data/output/result.json.tmp")
    final = Path("/data/output/result.json")
    tmp.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    tmp.replace(final)
```

## 4. 为什么这样改

- Task 输入是 URI/路径，不把全部文本先拉到 Driver；
- `ray.wait()` 限制在途任务和 Object Store 压力；
- Actor 仅保存小状态，不保存所有结果；
- 临时文件后原子替换，让重试不会留下半份输出；
- 远程函数保持纯计算，便于重执行。

## 5. 本地验证

```bash
ray start --head --num-cpus=4
python pipeline.py
ray summary tasks
ray list actors --detail
ray memory
```

对比单机与 Ray 输出：文件集合、每项哈希、汇总数和最终结果哈希必须一致。

## 6. 多节点准备

Head：

```bash
ray start --head --node-ip-address=10.0.0.10 --port=6379 --num-cpus=2
```

Worker：

```bash
ray start --address=10.0.0.10:6379 --node-ip-address=10.0.0.11 --num-cpus=8
```

所有节点必须可读 `/data/input` 与 `/data/output`。更推荐把 URI 换成 S3/OSS 等对象存储，避免误把 Head 本地目录当共享目录。

## 7. 作为 Ray Job 提交

```bash
ray job submit \
  --address=http://10.0.0.10:8265 \
  --runtime-env-json='{"working_dir":"."}' \
  -- python pipeline.py
```

生产中 `working_dir` 应来自固定制品或镜像，Jobs API 只允许 CI/平台管理身份访问。

## 8. 故障实验

1. 运行中停止一个 Worker；
2. 观察 Node DEAD、Task 重试与对象重建；
3. 注入一个无法解码的文件；
4. 填满输出目录并确认原子提交失败；
5. 把 `max_in_flight` 提高到危险值，对比 Object Store 和吞吐拐点；
6. 重复运行，确认输出一致且无重复副作用。

## 9. 扩展方向

- 输入规模很大时使用 Ray Data；
- 每个 Task 需要复用昂贵模型时改成长生命周期 Actor；
- 多租户时加自定义资源和 Job 配额；
- Kubernetes 上用 RayJob 声明集群和作业生命周期；
- 将结果清单、版本与质量检查纳入制品元数据。

## 10. 验收清单

- [ ] 单机与多节点结果一致；
- [ ] 最大在途 Task 可配置；
- [ ] 数据路径对所有 Worker 可达；
- [ ] 输出提交幂等且原子；
- [ ] Worker 掉线实验通过；
- [ ] 能用 ID 链定位失败 Task 的节点和日志。

下一篇：[KubeRay 分布式训练完整实战](./35-KubeRay分布式训练完整实战.md)。

## 11. 官方资料 {/* #官方资料 */}

- [Ray Jobs](https://docs.ray.io/en/latest/cluster/running-applications/job-submission/index.html)
- [Ray Task fault tolerance](https://docs.ray.io/en/latest/ray-core/fault_tolerance/tasks.html)
