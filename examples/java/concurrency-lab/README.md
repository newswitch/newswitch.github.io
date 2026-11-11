# Java 并发示例

九个独立程序分别演示线程、中断、安全发布、Monitor、Lock、原子类、线程池、Future、上下文与虚拟线程；`checks/` 包含额外协调测试。

从仓库根目录运行只读源码一致性检查：

```bash
node scripts/checks/verify-java-concurrency.mjs --check-sources
```

需要实际编译和运行时，指定 JDK 25：

```powershell
node scripts/checks/verify-java-concurrency.mjs --java-home 'C:/Java/jdk-25'
```

默认每个程序独立运行五次并比较文章输出，再执行协调测试；重复运行不是对所有线程调度的穷尽证明。
