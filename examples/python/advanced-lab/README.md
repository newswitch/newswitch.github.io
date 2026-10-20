# Python advanced lab

对应 Python 对象模型、标准库、并发、运行时与工程五个专题，共 26 个文章源文件。
以常规 GIL-enabled CPython 3.14.8 验证，网络示例只使用 MockTransport。

从仓库根目录创建独立 venv，安装
`examples/fastapi/framework-lab/requirements.lock`；该教学环境包含 HTTPX、
packaging、pytest 等工具，不修改系统 Python。进入本目录后可运行：

```bash
python objects_instance.py
python concurrency_processes.py
python concurrency_async.py
python runtime_memory.py
python -m pytest -q test_contract.py
```

其他与文章同名的脚本同样直接运行，每个示例应使用新进程比较输出。
多进程示例需要普通脚本入口，不在 Notebook 临时单元里复制执行。
IO 示例只在自己的临时目录中操作，不接触真实业务数据。

仓库级验证：

```bash
node scripts/verify-python-framework-series.mjs
node scripts/verify-python-framework-series.mjs --python /absolute/path/to/python
```

第二条要求已经安装固定依赖的 CPython 3.14 环境。
包构建示例位于相邻的 `package-lab/`，应在独立临时副本构建 wheel，
再在另一干净环境安装验证，不把 build、dist 与 egg-info 提交。
