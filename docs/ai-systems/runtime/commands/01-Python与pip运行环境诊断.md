---
title: "Python 与 pip 运行环境诊断"
sidebar_position: 1
description: "系统掌握 Python 解释器发现、模块导入路径、pip 包元数据、依赖一致性、Wheel 兼容性与离线取证。"
tags: [Python, pip, PyTorch, CUDA, 依赖, 故障排查]
---

# Python 与 pip 运行环境诊断

AI 服务中最危险的误判之一，是看到 `pip list` 里有某个包，就认定运行进程一定使用它。`pip` 命令可能属于另一个解释器，Notebook 内核、systemd、容器入口和交互 Shell 也可能拥有不同的 `PATH` 与 `sys.path`。生产排障统一使用 `python -m pip`，把 pip 明确绑定到目标解释器。

## 1. 解释器身份 `[R]`

```bash
type -a python python3 pip
command -v python
readlink -f "$(command -v python)"
python -VV
python -c 'import sys,platform; print(sys.executable); print(sys.prefix); print(sys.base_prefix); print(platform.platform())'
python -m pip --version
```

关键字段：

- `sys.executable`：当前解释器文件。
- `sys.prefix`：当前环境前缀；虚拟环境中通常不同于 `sys.base_prefix`。
- `pip --version`：同时显示 pip 版本、安装路径和关联 Python 版本。
- 进程现场应读取 `/proc/<pid>/exe`、`cmdline` 和 `environ`，不能用当前 Shell 代替在线进程。

```bash
readlink -f /proc/<pid>/exe
tr '\0' ' ' </proc/<pid>/cmdline
tr '\0' '\n' </proc/<pid>/environ | grep -E '^(PATH|PYTHONPATH|VIRTUAL_ENV|CONDA_PREFIX|LD_LIBRARY_PATH)='
```

## 2. 模块到底从哪里导入 `[R]`

```bash
python -m site
python -c 'import sys; print("\n".join(sys.path))'
python -c 'import importlib.util; print(importlib.util.find_spec("torch"))'
python -c 'import torch; print(torch.__file__); print(torch.__version__); print(torch.version.cuda)'
python -X importtime -c 'import torch' 2>import-time.txt
```

`PYTHONPATH`、当前目录下同名文件、`.pth` 文件、editable install 都可能改变导入结果。若出现 `AttributeError: module ... has no attribute ...`，先检查是否被 `torch.py`、`vllm.py` 等本地文件遮蔽。

## 3. pip 查询命令 `[R]`

| 命令 | 用途 | 关键参数 |
|---|---|---|
| `pip list` | 列出已安装发行包 | `--outdated`、`--format=json`、`--path` |
| `pip show` | 查看版本、位置、依赖方 | `-f/--files` |
| `pip freeze` | 输出固定版本清单 | `--all`、`--exclude-editable`、`--path` |
| `pip check` | 验证依赖声明是否满足 | 无参数，退出码可用于 CI |
| `pip inspect` | 输出稳定结构的环境 JSON | `--local`、`--user`、`--path` |
| `pip debug` | 查看解释器与 Wheel 标签 | `--verbose`、`--platform`、`--python-version`、`--abi` |
| `pip index versions` | 查询索引可用版本 | `--index-url`、`--pre` |
| `pip cache` | 查询与管理缓存 | `dir`、`info`、`list`、`remove`、`purge` |
| `pip config` | 查询配置来源 | `list`、`debug`、`get`、`set`、`unset` |

```bash
python -m pip list --format=json > packages.json
python -m pip show -f torch
python -m pip check
python -m pip inspect > pip-inspect.json
python -m pip debug --verbose
python -m pip config debug
```

`pip debug` 的输出属于诊断接口，字段可能变化；自动化资产清单优先使用 `pip inspect` 的 JSON，并检查其 `version` 字段。

## 4. 安装、解析与离线制品 `[W]`

```bash
python -m pip install --dry-run --report plan.json -r requirements.txt
python -m pip install --require-hashes -r requirements.txt
python -m pip download --dest wheelhouse -r requirements.txt
python -m pip wheel --wheel-dir wheelhouse -r requirements.txt
python -m pip install --no-index --find-links wheelhouse -r requirements.txt
```

重要参数族：

| 参数 | 含义与生产注意事项 |
|---|---|
| `-r/--requirement` | 从需求文件安装，可重复使用 |
| `-c/--constraint` | 约束版本但不主动引入包 |
| `--no-deps` | 不安装依赖，只有镜像构建或精确修复时使用 |
| `--dry-run --report` | 只解析并输出计划，适合变更评审 |
| `--require-hashes` | 要求所有候选制品有哈希，提升供应链可验证性 |
| `--index-url`、`--extra-index-url` | 私有索引认证信息不要写入日志；dependency confusion 场景慎用 extra index |
| `--no-index --find-links` | 只从受控目录安装，适合离线环境 |
| `--only-binary=:all:` | 禁止源码构建，避免线上临时编译产生漂移 |
| `--platform`、`--python-version`、`--implementation`、`--abi` | 为目标平台下载 Wheel，通常与 `--only-binary` 联用 |
| `--force-reinstall` | 即使版本一致也重装；执行前保留环境快照 |
| `--no-cache-dir` | 不使用缓存；不是常规“修复”参数，会增加网络与构建成本 |

## 5. PyTorch/CUDA 最小自检 `[R/A]`

```bash
python - <<'PY'
import os, sys, torch
print("python", sys.executable)
print("torch", torch.__version__, torch.__file__)
print("built_cuda", torch.version.cuda)
print("cuda_available", torch.cuda.is_available())
print("device_count", torch.cuda.device_count())
if torch.cuda.is_available():
    print("device", torch.cuda.get_device_name(0))
    x = torch.ones(1, device="cuda")
    print("tensor", x)
PY
```

创建 CUDA Tensor 会初始化 CUDA Context，属于主动操作；在显存紧张或故障取证节点上先获得维护窗口。`torch.version.cuda` 表示该 PyTorch 构建所针对的 CUDA 版本，不等于宿主机安装了同版本 Toolkit。

## 6. 常见误区与证据

| 现象 | 首要证据 |
|---|---|
| `pip install` 成功但 import 失败 | 比较 `pip --version` 与 `python -m pip --version`，查看 `find_spec` |
| import 到旧代码 | `module.__file__`、`.pth`、editable install、本地同名文件 |
| Wheel 不兼容 | `python -m pip debug --verbose` 中的兼容标签 |
| 依赖冲突 | `pip check`、`pip inspect`、安装时的 resolver 报告 |
| Notebook 与 Shell 结果不同 | Notebook 中输出 `sys.executable`，核对 kernel spec |
| 容器内找不到包 | 核对镜像摘要、容器用户、工作目录与挂载是否覆盖 site-packages |

## 7. 生产取证包

```bash
python -VV
python -m pip --version
python -m pip check
python -m pip inspect
python -c 'import sys; print(sys.executable); print(sys.prefix); print("\n".join(sys.path))'
python -c 'import torch; print(torch.__version__, torch.__file__, torch.version.cuda)'
```

采集输出前清理代理URL、索引令牌和环境变量中的凭据。不要把完整 `pip config debug` 或 `/proc/<pid>/environ` 直接贴进工单。

## 掌握标准

能在不修改环境的前提下证明解释器、模块来源、包元数据和依赖状态；能通过 `--dry-run --report` 评审安装变化；能为离线镜像准备带哈希的 Wheelhouse；能够把 Python 包问题与动态库、驱动问题分层。

## 官方资料

- [pip command reference](https://pip.pypa.io/en/stable/cli/)
- [pip inspect JSON specification](https://pip.pypa.io/en/stable/reference/inspect-report/)
- [Python command line](https://docs.python.org/3/using/cmdline.html)
