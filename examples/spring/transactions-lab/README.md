# Spring AOP 与事务实验

对应 `docs/development/spring/02-aop-transactions/` 的七篇文章。固定 JDK 25、Maven 3.9.14、Spring Framework 7.0.9、AspectJ 1.9.25、H2 2.4.240、JUnit 6.0.3，不使用 Spring Boot 或编织 agent。

每个数据库使用唯一名字的嵌入式 H2 内存实例，只在本进程内存在；没有外部数据库地址，不启动 H2 TCP 服务。支持类保留一个连接防止内存库提前消失，关闭上下文后释放。它不是生产连接池，也不验证数据文件掉电持久性。

## 编译和运行

```bash
mvn clean verify dependency:copy-dependencies -DincludeScope=runtime
```

PowerShell 示例：

```powershell
java -cp "target/classes;target/dependency/*" demo.tx.proxy.ProxyDemo
```

Linux/macOS 使用 `target/classes:target/dependency/*`。其他主类：

- `demo.tx.chain.AdviceChainDemo`
- `demo.tx.basics.TransactionDemo`
- `demo.tx.propagation.PropagationDemo`
- `demo.tx.isolation.IsolationDemo`
- `demo.tx.boundaries.BoundaryDemo`
- `demo.tx.completion.CompletionDemo`

锁竞争设置短等待及查询超时；新线程实验在 finally 中关闭执行器并等待退出。所有可关闭连接、Statement 和 ResultSet 具有关闭边界，不访问已有业务进程。

## 仓库校验

```powershell
node scripts/verify-spring-transactions.mjs --check-sources
node scripts/verify-spring-transactions.mjs --java-home 'C:/Java/jdk-25' --maven-home 'C:/Tools/apache-maven-3.9.14'
```

可选 `--maven-repo` 使用可信已有缓存。脚本检查十个文章源码文件与本工程一致，在忽略目录中运行测试，并为每个主类运行三次独立 JVM，比对文章结果及依赖版本。成功后删除本次临时工程，失败时打印并保留路径供诊断，依赖缓存不在清理范围。

40 次测试覆盖代理类型和自调用、切面顺序、连接绑定、原始连接绕过、提交与回滚、传播与保存点、隔离冲突、锁等待、版本更新、异常规则、线程、事务事件和 Outbox 本地原子性。它不把 H2 的锁实现当成 MySQL/PostgreSQL 兼容性证明，也不声称已实现消息投递器或端到端 exactly-once。
