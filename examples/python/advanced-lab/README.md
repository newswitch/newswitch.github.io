# Python advanced lab

对应 Python 对象模型、标准库、并发、运行时与工程专题的小实验，另含描述符、
类型正反检查、竞态对照与持久化 CLI 的深化实验。
以常规 GIL-enabled CPython 3.14.8 验证，网络示例只使用 MockTransport。

从仓库根目录创建独立 venv，安装
`examples/fastapi/deepening.lock`；该教学环境包含 HTTPX、类型检查、
pytest 与异步测试工具，不修改系统 Python。进入本目录后可运行：

```bash
python objects_instance.py
python concurrency_processes.py
python concurrency_async.py
python runtime_memory.py
python -m pytest -q test_contract.py
python descriptor_detail.py
python race_detail.py
python -m mypy --strict --no-incremental typing_good.py
python -m pytest -q test_deepening.py test_study_tasks.py
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
