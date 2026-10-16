# JVM 与诊断示例

对应 `docs/development/java/04-jvm/`、`06-diagnostics/` 的 11 个完整 Java 程序。采用 JDK 25 正式 API，不开启 Preview。

| 程序 | 验证目标 |
| --- | --- |
| BytecodeDemo | Class 版本、描述符、算术与返回指令 |
| InitializationDemo | 常量读取、加载与初始化的先后 |
| BufferMemoryDemo | Direct Buffer 与 BufferPool 统计 |
| ReferenceDemo | 显式 clear/enqueue，不依赖 GC 时机 |
| GcWorkload | 有界分配、G1/ZGC 日志和输出一致性 |
| JitDemo | 解释/JIT 的正确性与编译事件 |
| CpuBudgetDemo | JVM 可见处理器数量覆盖 |
| StartupDemo | AppCDS 与 JDK 25 AOT 缓存生成、加载 |
| DiagnosticTarget | 有限生命周期的 Attach、NMT、JFR 目标 |
| RecordingDemo | 自定义 JFR 事件录制与读取 |
| LockEvidenceDemo | 受控 BLOCKED 状态与锁拥有者 |

在仓库根目录执行：

```powershell
node scripts/verify-java-runtime.mjs --check-sources
node scripts/verify-java-runtime.mjs --java-home 'C:/path/to/jdk-25'
```

脚本在忽略的 `.java-article-checks/java-runtime-check-*` 中编译并运行，所有子命令有超时；最多同时保留一个自己的诊断 JVM，结束时先通知它正常退出，必要时才终止该已知子进程。不会搜索并关闭其他 Java 进程，不监听网络端口，不修改系统或集群配置。

自动验证不故意制造 OOM、不采集用户业务进程的 heap dump。日志、归档、JFR 和编译产物在校验后清理，不提交到 Git。Linux cgroups、第三方 native profiler 和 Arthas 操作需在相应受控环境另行验证；不以 Windows 上的 JDK 工具测试替代这些结果。

脚本给 JFR 显式设置本次工作区中的临时 repository，避免本机默认中文临时路径在所测 JDK 25.0.4 下产生空录制；具体对照与边界见 JFR 文章。需要 Attach 时应在具备相应本地权限的环境执行。

本组 Windows/JDK 25.0.4 的 AOT 简化创建流程还遇到了含中文 JDK 安装路径导致子 JVM 创建失败的现象，完整实验使用英文路径 JDK。脚本会要求最终缓存确实存在且能以 `AOTMode=on` 加载，不只检查训练退出码；详见 CDS/AOT 文章。

文章中的完整源代码与本目录保持逐字一致。调整示例时两处同步，再重新验证；耗时、地址、PID 和 GC 次数不作固定断言。
