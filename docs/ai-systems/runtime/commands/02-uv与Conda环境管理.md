---
title: "uv 与 Conda 环境管理"
sidebar_position: 2
description: "掌握 uv 与 Conda 的解释器、环境、依赖锁定、导出复现、缓存和诊断命令，并理解两者的职责边界。"
tags: [uv, Conda, Python, 环境管理, 依赖锁定, AI Infra]
---

# uv 与 Conda 环境管理

`uv` 适合围绕 Python 项目、`pyproject.toml` 和锁文件进行快速解析与复现；Conda 同时管理 Python、原生库和虚拟包，常用于 CUDA、科学计算与多语言依赖环境。AI 运维不应在同一个前缀里让两套解析器无规则地反复修改依赖。

## 1. 先识别当前环境 `[R]`

```bash
uv --version
uv python find
uv python list --only-installed
uv cache dir

conda --version
conda info
conda info --envs
conda list
conda config --show-sources
```

同时检查：

```bash
python -c 'import sys; print(sys.executable, sys.prefix, sys.base_prefix)'
env | grep -E '^(VIRTUAL_ENV|CONDA_PREFIX|CONDA_DEFAULT_ENV|UV_PROJECT_ENVIRONMENT)='
```

## 2. uv 对象模型与命令

| 对象 | 命令 | 作用 |
|---|---|---|
| Python | `uv python list/install/find/pin/uninstall` | 发现、安装和固定解释器 |
| 项目 | `uv init/add/remove/lock/sync/run/tree` | 管理 `pyproject.toml`、`uv.lock` 与项目环境 |
| 临时工具 | `uvx`、`uv tool run/install/list/uninstall` | 隔离运行 CLI，避免污染业务环境 |
| pip 兼容接口 | `uv pip install/compile/sync/list/check/tree` | 处理 requirements 工作流 |
| 缓存 | `uv cache dir/info/clean/prune` | 查询或清理缓存 |
| 凭据 | `uv auth login/logout/token` | 管理索引HTTP凭据，令牌优先从 stdin 输入 |

### 项目复现 `[W]`

```bash
uv python pin 3.12
uv lock --check
uv sync --frozen
uv run python -VV
uv tree
```

关键参数：

- `--frozen`：不更新锁文件，锁文件与项目不一致时失败。
- `--locked`：要求锁文件已是最新状态，否则失败。
- `--no-dev`、`--only-group`、`--group`：控制依赖组。
- `--no-install-project`：只装依赖，不安装当前项目，适合镜像分层。
- `--offline`：禁止网络；前提是缓存和制品完整。
- `--python`：显式指定解释器，避免自动发现错误版本。
- `--refresh`、`--reinstall`、`--upgrade`：会改变解析或制品选择，必须通过锁文件审计。

### requirements 工作流 `[W]`

```bash
uv pip compile pyproject.toml -o requirements.lock
uv pip sync requirements.lock
uv pip check
uv pip tree
```

不要混淆 `uv sync` 与 `uv pip sync`：前者围绕 uv 项目与 `uv.lock`，后者把目标环境同步到 requirements 文件。

## 3. Conda 对象模型与命令

| 任务 | 命令 |
|---|---|
| 查询环境 | `conda info --envs`、`conda env list` |
| 创建/删除 | `conda create -n NAME ...`、`conda env remove -n NAME` |
| 非交互执行 | `conda run -n NAME COMMAND` |
| 包查询 | `conda list`、`conda search`、`conda repoquery` |
| 安装/升级/删除 | `conda install/update/remove` |
| 导出/复现 | `conda export`、`conda env export/create/update` |
| 配置 | `conda config --show-sources`、`--show`、`--set`、`--add` |
| 健康与清理 | `conda doctor`、`conda clean` |

### 可复现环境 `[W]`

```bash
conda create -n train python=3.12 --dry-run --json
conda create -n train python=3.12 -y
conda run -n train python -VV
conda list -n train --explicit > explicit-linux-64.txt
conda env export -n train --from-history > environment.yml
```

两种导出服务不同目标：

- `--explicit`：记录精确制品URL，最接近同平台逐字节复现，但跨平台能力差。
- `--from-history`：只记录显式请求，更适合跨平台重新求解，但结果可能变化。

### 关键参数族

| 参数 | 含义 |
|---|---|
| `-n/--name`、`-p/--prefix` | 按名称或绝对前缀定位环境，脚本优先显式指定 |
| `-c/--channel`、`--override-channels` | 控制通道与优先级，避免隐式混入公共源 |
| `--strict-channel-priority`（配置项） | 降低不同通道ABI组合风险 |
| `--dry-run --json` | 输出计划供自动化分析 |
| `--freeze-installed` | 尽量保留已安装版本，不等同于完全锁定 |
| `--no-deps` | 绕过依赖，不适合作为冲突修复常规手段 |
| `--force-reinstall` | 重装制品，先保存清单与显式导出 |
| `-y/--yes` | 非交互确认，只有计划已经评审时使用 |

## 4. uv、Conda 与 pip 如何配合

推荐只选一个环境所有者：

```text
方案 A：uv 管 Python 与项目依赖
uv python + uv lock + uv sync

方案 B：Conda 管原生依赖与 Python，pip/uv pip 只补 Conda 不提供的 Python 包
conda create → conda install → python -m pip install
```

若必须在 Conda 环境中使用 pip：先完成 Conda 安装，最后执行 pip；保存 `conda list --explicit` 和 `pip inspect`；之后不要再用 Conda 大规模求解覆盖 pip 安装的文件。

## 5. 缓存与磁盘治理 `[R/D]`

```bash
uv cache dir
uv cache info
uv cache prune --dry-run

conda clean --all --dry-run
conda clean --tarballs --packages --dry-run
```

清缓存不会修复已经损坏的目标环境，反而可能删除离线复现所需制品。共享缓存、硬链接和正在构建的镜像场景必须先确认引用关系。

## 6. 排障矩阵

| 现象 | 证据与处理 |
|---|---|
| `uv sync` 改动大量版本 | `uv lock --check`、查看锁文件 diff，禁止无意使用 `--upgrade` |
| Conda 求解慢或冲突 | 固定通道、严格优先级、缩小约束，读取 `--json` 计划 |
| 进入环境后 Python 未变化 | 检查 shell hook；自动化改用 `conda run -n` |
| 节点之间环境不一致 | 对比锁文件哈希、解释器、`pip inspect`、Conda explicit 清单 |
| 离线环境缺包 | 在同平台提前下载所有 Wheel/Conda 制品并验证哈希 |
| CUDA 包与驱动不匹配 | 区分 Conda/PyPI 的用户态 CUDA 库与宿主机驱动 |

## 掌握标准

能选择明确的环境所有者；能在不更新锁文件的情况下复现项目；能解释精确导出与历史导出的差异；能在变更前查看求解计划；能安全治理缓存而不破坏离线恢复能力。

## 官方资料

- [uv CLI reference](https://docs.astral.sh/uv/reference/cli/)
- [Conda commands](https://docs.conda.io/projects/conda/en/stable/commands/commands.html)
