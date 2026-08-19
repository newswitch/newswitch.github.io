---
title: "Runtime Env 依赖、代码与环境分发"
sidebar_label: "10. Runtime Env 依赖、代码与环境分发"
sidebar_position: 10
description: "理解 Ray Runtime Env 的 working_dir、py_modules、pip、Conda、uv、环境变量和镜像边界，建立可复现、安全的依赖分发流程。"
tags: [Ray, Runtime Env, Python, 依赖管理, 容器, 供应链安全]
---

# Runtime Env 依赖、代码与环境分发

Driver 能导入一个模块，不代表远端 Worker 也能导入。多节点 Ray 要同时解决代码、Python 包、本地文件、环境变量、
系统动态库和设备运行时的一致性。Runtime Env 可以动态准备部分依赖，但生产环境通常仍应以不可变镜像作为基础。

## 1. 四层环境

```text
节点/容器基础环境
├─ OS、glibc、驱动、CUDA/CANN、系统库
├─ Python与Ray
│
Runtime Env
├─ working_dir、py_modules
├─ pip / conda / uv
└─ env_vars
│
Job/Task/Actor配置
├─ 参数、资源、Namespace
└─业务配置引用
│
Secret系统
└─短期凭证、证书、Token
```

Runtime Env 不应承担 GPU 驱动、内核模块、RDMA、系统服务和大型基础镜像的安装。Secret 也不应打进代码包或镜像层。

## 2. 最小 Runtime Env

```python
import ray

runtime_env = {
    "pip": ["emoji==<PINNED_VERSION>"],
    "env_vars": {"APP_ENV": "lab"},
}

ray.init(runtime_env=runtime_env)

@ray.remote
def render() -> str:
    import os
    import emoji
    return emoji.emojize(f"{os.environ['APP_ENV']} :thumbs_up:")

print(ray.get(render.remote()))
```

实际实验必须替换占位版本并保存完整依赖解析结果。不要在文章或生产配置中把浮动最新版当作可复现基线。

## 3. `working_dir`

`working_dir` 将项目工作目录提供给 Job 的 Worker：

```python
ray.init(
    address="auto",
    runtime_env={
        "working_dir": ".",
        "excludes": [".git/", ".venv/", "data/", "models/"],
    },
)
```

适合分发：

- Python 源码；
- 小型配置模板；
- `requirements.txt` 或项目元数据；
- 测试所需的小型静态文件。

不适合分发：

- 大模型权重；
- 大型数据集；
- 虚拟环境目录；
- `.git` 全历史；
- 密钥和生产凭证；
- 节点本地动态库。

本地目录和归档大小限制、支持的远端 URI 类型会随版本变化，应以目标版本 API 为准。

## 4. `py_modules`

开发本地库时，可以显式分发模块：

```python
import ray
import my_project

ray.init(
    address="auto",
    runtime_env={"py_modules": [my_project]},
)
```

这适合快速迭代，不应替代正式打包、版本、Wheel 校验和制品仓库。生产建议构建 Wheel 或镜像，并记录源码 Revision。

## 5. pip 依赖

```python
runtime_env = {
    "working_dir": ".",
    "pip": {
        "packages": ["requests==<PINNED_VERSION>"],
        "pip_check": True,
    },
}
```

具体字典字段以目标版本为准。复杂索引、Hash 和平台 Wheel 更适合使用固定的 Requirements 文件：

```text
--index-url https://<trusted-index>/simple
--require-hashes
package-a==1.2.3 --hash=sha256:<digest>
```

不要把仓库密码直接写进 Runtime Env、日志或 Git。使用短期凭证和受控 Secret 注入，并限制 Worker 的出站网络。

## 6. Conda 与 uv

Runtime Env 可以描述 Conda，较新版本也可能提供 uv/可执行环境集成。选择时考虑：

- Ray 和 Python 版本兼容；
- 创建环境的冷启动时间；
- 每个 Node 的缓存空间；
- 私有索引认证；
- C/C++ 动态库；
- 架构和 GPU Wheel；
- 离线构建与供应链审计。

同一个 Runtime Env 不应同时混用多个互相竞争的 Python 环境管理策略。目标版本允许的组合必须通过最小实验验证。

## 7. `env_vars`

```python
runtime_env = {
    "env_vars": {
        "APP_LOG_LEVEL": "INFO",
        "TOKENIZERS_PARALLELISM": "false",
    }
}
```

环境变量适合非敏感、进程级配置。注意：

- 字符串化和继承规则；
- Job、Task、Actor 不同 Scope 的合并/覆盖；
- Worker 启动后修改是否生效；
- 多线程库和 GPU 库常在 Import 时读取变量；
- 日志和 State API 可能泄露配置。

API Key、云凭证和私钥优先通过平台 Secret 机制传递，并限制读取范围。

## 8. Job、Task 与 Actor Scope

Runtime Env 可以在 Job 级设置，也可以对 Task/Actor 设置：

```python
@ray.remote(runtime_env={"env_vars": {"WORKLOAD": "encoder"}})
def encode(item):
    ...

special_ref = encode.options(
    runtime_env={"pip": ["special-package==<PINNED_VERSION>"]}
).remote(item)
```

层级合并、覆盖限制和字段兼容性必须按目标版本核对。不要让每个 Task 创建独一无二的环境，否则会导致安装风暴、
缓存碎片和长尾。

## 9. 缓存与冷启动

Runtime Env 会在节点准备并缓存。首次使用的路径可能包括：

```text
打包本地目录
→ 上传/获取制品
→ 节点下载
→ 创建Python环境
→ 安装依赖
→ 启动Worker
→ 执行Task/Actor
```

Actor 长时间 PENDING 或启动慢，可能不是资源不足，而是 Runtime Env 正在安装或失败。需要观察 Runtime Env 日志、
网络、磁盘、索引响应和缓存容量。

环境哈希应稳定。把时间戳、随机生成文件或大型日志放进 `working_dir` 会导致每次提交都成为新环境。

## 10. 生产环境优先不可变镜像

| 依赖 | 推荐载体 |
| --- | --- |
| OS、Python、Ray | 基础镜像 |
| CUDA/CANN 用户态库 | 与驱动兼容的受控镜像 |
| PyTorch、vLLM、大型 Wheel | 镜像构建阶段 |
| 高频变更的小型业务代码 | Wheel、`working_dir` 或远端归档 |
| 非敏感运行参数 | ConfigMap/参数/环境变量 |
| 密钥和证书 | Secret 管理系统 |
| 模型权重 | 模型仓库、对象存储、PVC 或节点缓存 |

动态 pip 安装会把软件仓库可用性引入任务启动路径。生产 KubeRay 集群通常把稳定大依赖烘焙进固定 Digest 镜像，
Runtime Env 只分发小而频繁变化的应用层。

## 11. KubeRay 中的环境边界

KubeRay Worker Group 定义 Pod 镜像、资源、Volume、Security Context 和环境变量；Ray Runtime Env 在已经运行的
Pod 内准备应用环境。

```text
RayCluster YAML
→ 创建Head/Worker Pod
→ 容器镜像启动Ray
→ Ray Job提交Runtime Env
→ 目标节点准备环境
→ Worker执行代码
```

如果 Pod 无法启动，先排 Kubernetes 镜像、挂载和权限；如果 Pod/Node 已 Ready 而 Actor 卡在环境准备，再排
Runtime Env。

## 12. 本地路径与共享路径

`/models/demo` 在 Driver 存在，不代表每个 Worker Node 都存在。路径必须明确属于：

- Runtime Env 分发目录；
- 镜像内路径；
- 每节点预热缓存；
- Kubernetes PVC；
- NFS/CephFS；
- 对象存储 URI。

共享路径还要验证 UID/GID、只读权限、挂载一致性、元数据性能和故障域。不要把路径字符串相同当作内容相同。

## 13. 动态库与 GPU 环境

pip 成功不代表 CUDA/NCCL/CANN 动态库正确。检查：

```bash
python -c "import ray; print(ray.__version__)"
python -c "import torch; print(torch.__version__, torch.version.cuda)"
python -c "import torch; print(torch.cuda.is_available())"
nvidia-smi
```

必要时结合 `ldd`、`LD_LIBRARY_PATH` 和容器挂载诊断。动态库问题应在基础镜像和节点运行时解决，不要让每个
Task 临时下载系统库。

## 14. 安全边界

- Runtime Env 能分发并执行代码，只允许可信用户提交；
- 禁止不受控公网包源和未校验制品；
- 使用 Hash、签名、SBOM 和漏洞扫描；
- Worker ServiceAccount 使用最小权限；
- 限制出站网络和元数据服务访问；
- 不在 `working_dir`、日志或 Dashboard 中暴露 Secret；
- 多租户高风险场景优先使用独立集群或强隔离边界。

Namespace 和 Python 虚拟环境都不是安全沙箱。

## 15. 常见故障

| 现象 | 首要检查 |
| --- | --- |
| `ModuleNotFoundError` | 模块是否在镜像、`working_dir`、`py_modules` 或 pip 环境 |
| Runtime Env 创建超时 | 包源、DNS、代理、Wheel、磁盘和并发安装 |
| 本地成功远端失败 | CPU 架构、Python、系统库、环境变量和路径 |
| 每次提交都冷启动 | 环境内容是否变化、缓存是否被清理、容量是否不足 |
| GPU 包 Import 失败 | 驱动/用户态库/PyTorch Wheel/设备挂载兼容 |
| Head 成功 Worker 失败 | Worker 镜像或网络不同、私有仓库凭证缺失 |
| 工作目录过大 | `.git`、数据、模型、日志和虚拟环境未排除 |

## 16. 发布验收

- [ ] Python、Ray 与业务依赖完整锁定；
- [ ] 镜像使用 Digest，源码和模型使用 Revision；
- [ ] `working_dir` 排除了数据、模型、虚拟环境、Git 历史和 Secret；
- [ ] 所有 Worker Group 使用兼容架构和基础环境；
- [ ] 私有依赖认证不出现在代码与日志；
- [ ] 冷缓存和热缓存启动时间都已测量；
- [ ] 动态库和 GPU/NPU 在目标节点验证；
- [ ] Runtime Env 创建失败有日志、告警和回退；
- [ ] 升级和回滚能恢复到上一镜像与依赖集合。

## 17. 掌握标准

- 能区分基础镜像、Runtime Env、业务配置和 Secret；
- 能选择 `working_dir`、`py_modules`、pip/Conda/uv 和环境变量；
- 能解释 Job 与 Task/Actor Scope；
- 能定位依赖安装、路径、动态库和设备运行时问题；
- 能设计不依赖生产时公网安装的发布流程；
- 能用版本、Hash、Digest 和 Revision 重现一个 Ray Job。

下一阶段：[Ray 学习路线：多节点集群](../00-Ray学习路线.md#5-第三阶段多节点集群)。

## 18. 官方资料 {/* #官方资料 */}

- [Environment Dependencies](https://docs.ray.io/en/latest/ray-core/handling-dependencies.html)
- [RuntimeEnv API](https://docs.ray.io/en/latest/ray-core/api/doc/ray.runtime_env.RuntimeEnv.html)
- [Runtime Environment Reference](https://docs.ray.io/en/latest/ray-core/api/runtime-env.html)
- [Ray Job Submission](https://docs.ray.io/en/latest/cluster/running-applications/job-submission/index.html)
- [KubeRay Documentation](https://docs.ray.io/en/latest/cluster/kubernetes/index.html)
