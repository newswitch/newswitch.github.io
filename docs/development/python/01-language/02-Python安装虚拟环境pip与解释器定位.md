---
title: "Python 安装、虚拟环境、pip 与解释器定位"
sidebar_label: "02. 安装、虚拟环境与 pip"
sidebar_position: 2
description: "在 Windows 与 Linux 上定位解释器、创建隔离环境并核对 pip 安装目标，理解虚拟环境的能力与边界。"
tags: [Python, venv, pip, 依赖管理, Windows, Linux]
---

# Python 安装、虚拟环境、pip 与解释器定位

`ModuleNotFoundError` 不一定意味着“没有安装”。更常见的情况是：给解释器 A 安装了包，却让解释器 B 运行程序。环境配置首先要解决身份问题，再解决依赖问题。

## 1. 安装什么，选择哪个版本

本系列基于常规 CPython 3.14，示例以 3.14.8 验证。它是明确的基线，不表示永远是最新版本，也不表示所有第三方扩展都支持它。学习标准库与部署特定框架时，要分别核对版本支持范围。

Windows 从 [Python 官方下载页](https://www.python.org/downloads/windows/)选择对应架构。新 Python Install Manager 与传统 `py.exe` Launcher 并非同一个程序，网上的 `py install` 命令不能直接套到旧 Launcher；先看 `py --help`。3.14 的传统安装器仍可用，嵌入式包则主要面向应用嵌入，不是常规 pip/venv 学习环境。

Linux 可以使用发行版包管理器提供的受支持版本，或在独立路径安装需要的解释器。不同发行版可能把 `venv`、pip 拆成独立软件包。不要替换 `/usr/bin/python3`、删除系统 Python，也不要通过 `sudo pip install` 修改系统工具的依赖。

生产环境应同时记录大版本、修订版本、平台架构与构建类型。只说“装了 Python 3”不足以重现环境。

## 2. 先确定 Shell 找到了谁

Windows PowerShell：

```powershell
Get-Command python -All
where.exe python
python --version
python -c "import sys; print(sys.executable); print(sys.version)"
```

Linux/macOS Shell：

```bash
command -v python3
type -a python3
python3 --version
python3 -c "import sys; print(sys.executable); print(sys.version)"
```

`where.exe` 用于查找可执行文件，PowerShell 的 `where` 可能是其他命令的别名。Windows 的应用执行别名、IDE 所选解释器与终端 PATH 也可能指向不同位置。

示意输出：

```text
C:\Python314\python.exe
3.14.8 (...具体编译信息依安装包而异...)
```

路径并非安装建议或固定结果。排障时以 `sys.executable` 为准，记录它再继续。

## 3. 创建环境：先绑定解释器，再安装包

下面的 `python` 或 `python3` 必须先确认是目标解释器。Windows：

```powershell
mkdir python-study
cd python-study
python -m venv .venv
.\.venv\Scripts\python.exe -m pip --version
.\.venv\Scripts\python.exe -m pip check
```

Linux/macOS：

```bash
mkdir python-study
cd python-study
python3 -m venv .venv
.venv/bin/python -m pip --version
.venv/bin/python -m pip check
```

干净环境的 `pip check` 通常输出 `No broken requirements found.`。它检查已安装分发包声明的依赖是否满足，不会证明业务正确、没有漏洞或依赖完整锁定。

`python -m pip` 表示用这个 Python 去加载 pip，避免单独 `pip` 命令指向另一个安装目录。指定虚拟环境解释器的完整路径，比依赖 Shell 是否激活更明确。

## 4. 激活不是启动另一个隔离操作系统

Windows 激活命令是 `.\.venv\Scripts\Activate.ps1`；Linux/macOS 是 `source .venv/bin/activate`。激活主要调整当前 Shell 的 PATH 等环境，让 `python` 更容易指向虚拟环境。

激活不是运行所必需的。PowerShell 策略阻止激活时，仍可以直接使用 `.\.venv\Scripts\python.exe`，不需要为此降低整台机器的脚本安全策略。

| 能力 | venv 是否提供 |
| --- | --- |
| 独立的第三方包安装位置 | 默认提供 |
| 与基础解释器关联的运行入口 | 提供 |
| 文件、网络、权限隔离 | 不提供 |
| CPU、内存限制 | 不提供 |
| 依赖版本锁定与漏洞审计 | 不自动提供 |

默认环境不继承基础环境的第三方 `site-packages`；`--system-site-packages` 会改变这个边界。虚拟环境通常复用基础解释器和标准库的一部分，不是复制一套操作系统。

## 5. 用程序确认隔离状态

在上一节创建的目录保存：

```python title="environment_demo.py"
from pathlib import Path
import sys

def main():
    print("python:", ".".join(map(str, sys.version_info[:2])))
    print("venv:", sys.prefix != sys.base_prefix)
    print("executable exists:", Path(sys.executable).is_file())
    print("prefix exists:", Path(sys.prefix).is_dir())

if __name__ == "__main__":
    main()
```

使用虚拟环境解释器运行，3.14 环境中的输出：

```text title="environment_demo.out"
python: 3.14
venv: True
executable exists: True
prefix exists: True
```

`sys.prefix` 是当前环境前缀，`sys.base_prefix` 指向基础安装。判断相等与否，比只看终端前面的 `(.venv)` 更可靠。

安装具体包时，命令形态是 `虚拟环境解释器 -m pip install 包名==已核对版本`。不要把“最新”当作可重现版本约束，也不要从不明镜像安装同名包；pip 的分发包名与 Python 的导入名未必相同。

## 6. 四类环境故障

| 现象 | 优先核对 | 处理方向 |
| --- | --- | --- |
| 安装成功但不能 import | `sys.executable`、`-m pip --version` | 在运行解释器对应的环境安装 |
| 环境里没有 pip | 是否使用嵌入包、venv 是否创建完整 | 使用常规受支持安装，按发行版安装 venv 支持 |
| 出现 externally-managed-environment | 是否正操作系统 Python | 创建 venv，不默认绕过保护 |
| ImportError/DLL load failed | Python/扩展版本、CPU 架构、原生依赖 | 检查 wheel 与 ABI；不等同于包完全不存在 |

`pip show 包名` 可以查看分发包的版本与位置。若导入了意外文件，再检查 `module.__file__`；当前目录中的 `json.py`、`typing.py` 可能遮蔽标准库。

不要复制 `.venv` 到另一台机器当交付物。解释器路径、脚本入口和原生扩展可能绑定本机环境；通常应该记录依赖与解释器约束，然后重新创建环境。

## 7. 练习与答案

### 7.1 不激活环境，能用它安装和运行吗？

答案：能。Windows 使用 `.\.venv\Scripts\python.exe`，Linux 使用 `.venv/bin/python`。在后面加 `-m pip` 安装，在后面加脚本路径运行，目标明确且不依赖激活状态。

### 7.2 venv 能阻止脚本误删用户文件吗？

答案：不能。脚本仍拥有进程用户的文件权限。安全隔离需要权限控制、容器或其他机制；包隔离不能替代安全边界。

### 7.3 pip check 通过，是否证明环境可重现？

答案：不能。它只检查当前已安装依赖的声明关系。还需要明确解释器、平台、完整依赖版本与来源，必要时记录哈希和可重复的构建方式。

## 8. 参考资料

- [Python 3.14 Windows 安装说明](https://docs.python.org/3.14/using/windows.html)
- [venv](https://docs.python.org/3.14/library/venv.html)
- [pip 用户指南](https://pip.pypa.io/en/stable/user_guide/)
- [外部管理环境规范](https://packaging.python.org/en/latest/specifications/externally-managed-environments/)
