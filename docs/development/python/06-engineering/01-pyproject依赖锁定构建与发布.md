---
title: "pyproject、依赖锁定、构建与发布"
sidebar_label: "01. pyproject、依赖锁定、构建与发布"
sidebar_position: 1
description: "理解项目声明、运行依赖、构建依赖、锁文件与 wheel，建立可重建的交付边界。"
tags: [Python, CPython, 工程实践]
---

# pyproject、依赖锁定、构建与发布

源码仓库、开发环境和发布产物不是同一件东西。可交付项目需要明确支持哪个解释器、依赖怎样解析、通过什么入口运行，以及部署时是否还会临时编译。

## 1. 最小可安装项目

推荐将源码放在 `src/` 下，避免测试仅因为当前目录刚好可导入而通过。项目至少包含 pyproject、源包与测试；包入口通过 `[project.scripts]` 声明，库导入保持无副作用。

```toml
[build-system]
requires = ["setuptools>=80"]
build-backend = "setuptools.build_meta"

[project]
name = "lesson-jobs"
version = "0.1.0"
requires-python = ">=3.14"
dependencies = []

[project.scripts]
lesson-jobs = "lesson_jobs.cli:main"

[tool.setuptools.packages.find]
where = ["src"]
```

版本范围用于表达兼容性，不是最终锁文件。上面的构建依赖范围适合解释结构；要求严格可重建时，还需控制实际构建依赖、来源与产物。

## 2. 构建与安装

在独立环境安装本系列固定的构建工具后，使用 `python -m build` 生成 sdist 与 wheel，再在另一个干净环境安装 wheel 并测试入口。不要只测试 editable 模式。

wheel 是可安装分发物；带原生扩展时与 Python ABI、OS、架构有关。容器镜像也需要固定基础镜像与依赖，不能因为“包版本固定”就忽略系统库。

## 3. 版本与依赖图

直接依赖只是图的入口，间接依赖同样影响行为。锁定应记录完整解析结果及适用平台，必要时校验哈希。`pip freeze` 描述当前环境，不自动证明这些依赖都是项目需要，也不一定构成跨平台通用锁。

依赖升级要通过单元、集成和实际入口测试；声明兼容范围过宽会让新安装悄悄进入未经验证组合。不要在启动服务时执行无版本 install。

## 4. 验证产物入口

```python title="engineering_package.py"
from importlib.metadata import version
from packaging.version import Version

def main():
    installed = Version(version("httpx"))
    print("httpx baseline:", installed == Version("0.28.1"))
    print("compatible major:", installed.major == 0)

if __name__ == "__main__":
    main()
```

```text title="engineering_package.out"
httpx baseline: True
compatible major: True
```

示例在本系列依赖环境核对实际分发版本，不把导入成功当成版本正确。版本相符也只是必要条件，不能替代行为测试。

## 5. 发布安全

构建与发布凭证分离，避免在日志、wheel 或镜像层写入令牌。审查包来源、构建钩子与安装步骤；可安装第三方包本身就具有执行代码的信任边界。

回滚要保留上一份已验证产物与数据库兼容策略，而不是临时重新解析旧版本范围。

## 6. 练习与答案

### 6.1 requirements 只固定 FastAPI，整个环境就固定了吗？

答案：没有。间接依赖、解释器与平台仍会变化，需要记录完整兼容组合并验证。

### 6.2 editable 测试通过，wheel 一定包含所有资源吗？

答案：不能保证。可编辑安装可能直接使用源码目录，应在干净环境安装真正产物验证模块、资源与入口。

### 6.3 freeze 能直接当所有平台的通用锁吗？

答案：不能。它反映当前环境，原生包、条件依赖和平台解析结果可能不同。

## 7. 参考资料

- [pyproject 规范](https://packaging.python.org/en/latest/specifications/pyproject-toml/)
- [构建与分发](https://packaging.python.org/en/latest/tutorials/packaging-projects/)
- [build](https://build.pypa.io/en/stable/)
