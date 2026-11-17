# Temporal 测试示例

对应 `docs/automation/temporal/08-测试时间跳跃与故障注入.md`。

Python 3.11+，固定 `temporalio==1.36.1`。使用标准库 unittest，不依赖 pytest。

```bash
python -m venv .venv
# 激活该环境后，在本目录执行
python -m pip install -r requirements.txt
python -m unittest -v test_activity
```

这 4 个测试调用真实 SDK 的 ActivityEnvironment，不启动 Server/Worker，不执行网络或数据库变更，也不验证 Server 重试、Heartbeat RPC 节流和持久性。

```bash
python -m unittest -v test_workflow
```

这 4 个测试会启动临时 V1 time-skipping test server，并连接 Worker。首次运行可能下载二进制；离线环境通过 `TEMPORAL_TEST_SERVER` 指向已验收的可执行文件，记录版本及 SHA256。确认 OS/CPU 架构受支持后再运行，不要把 ARM 缺少测试二进制当成 Workflow 错误。V1 是旧式测试服务器，功能不等同生产服务；SDK 1.36.1 的逐 Workflow V2 API 仍为实验接口，不用于本示例。

每个用例独享测试环境，关闭 Worker 后 shutdown；V1 虚拟时间为环境共享，不能让并行用例相互跳时。代码只处理 `change-001` 这类合成标识，不接生产凭据、不修改基础设施。

CI 还应对整组测试设置墙钟超时；虚拟 Timer 不是网络故障、Workflow Task 持续失败或清理卡住时的运行器超时保障。

Workflow 测试覆盖过期不执行、临近截止的 Signal、三次 Activity 尝试、不可重试失败、已完成 History 回放。Activity mock 的调用记录不是生产业务副作用账本；Worker 内存状态不能替代持久化幂等键。

若测试失败，保留异常、SDK/测试服务器版本、Task Queue、Workflow/Run ID 和合成 History。不要为恢复测试删除生产 Namespace、关闭 Workflow sandbox 或清理未知服务进程。
