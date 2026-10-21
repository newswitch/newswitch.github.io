---
title: "MyBatis 与 JPA 的 SQL、事务和缓存对照实验"
sidebar_label: "07. MyBatis 与 JPA 对照实验"
sidebar_position: 7
description: "运行完整 Boot 工程，以 SQL 次数和数据库状态验证 MyBatis 缓存、Hibernate 脏检查、N+1、懒加载、批量更新与乐观锁。"
tags: [SpringBoot, MyBatis, Hibernate, JPA, 集成测试]
---

# MyBatis 与 JPA 的 SQL、事务和缓存对照实验

理解数据访问框架，不只要能写 Mapper 或 Repository，还要能预测：这段代码会发几条 SQL、使用哪个事务、对象为什么仍是旧值、冲突发生在哪一步。本文用同一工程里的两组独立表观察这些问题，不把两种框架混写成一套业务持久化方案。

## 1. 工程与运行方式

完整源码位于 [deepening-lab/persistence](https://github.com/newswitch/newswitch.github.io/tree/main/examples/spring-boot/deepening-lab/persistence)。固定基线为 JDK 25、Boot 4.1.1、MyBatis Starter 4.0.0；Hibernate 和 H2 由 Boot BOM 管理。MyBatis 的 4.0 系列支持 Boot 4，不能给 Boot 4 随意拼上 Boot 3 的 Starter。[兼容关系](https://mybatis.org/spring-boot-starter/mybatis-spring-boot-autoconfigure/)

在仓库根目录执行，先确认 `java -version` 和 `mvn -version` 使用 JDK 25：

```bash
mvn -B -ntp -f examples/spring-boot/deepening-lab/pom.xml -pl persistence verify
```

实验没有 HTTP 端口，也不需要安装数据库。测试创建 H2 内存库并在上下文关闭时释放。15 项测试在该版本组合下通过，汇总输出为：

```text
Tests run: 15, Failures: 0, Errors: 0, Skipped: 0
BUILD SUCCESS
```

H2 足以观察本实验的事务参与、对象生命周期和 SQL 条数；实际 MySQL/PostgreSQL 的锁、隔离、执行计划、分页和错误码仍应在相同数据库版本上验证。`create-drop` 仅适合这种可丢弃数据库。

## 2. 先看代码的职责

| 文件 | 观察对象 | 为什么这样设计 |
| --- | --- | --- |
| `TaskMapper.java` | 明确 SQL、参数绑定、租户和受影响行数 | 不让实体状态隐藏 SQL 条件 |
| `CachedMapper.java` | 单独开启的 namespace 二级缓存 | 将缓存命中与数据库新值分开观察 |
| `SqlCounter.java` | MyBatis StatementHandler 的 prepare 次数 | 不依赖人工数日志 |
| `OwnerEntity.java`、`JobEntity.java` | LAZY 关联和 `@Version` | 建立 N+1 与版本竞争 |
| `PersistenceTest.java` | 事务、读取、修改、异常和最终状态 | 把推断变成可失败断言 |

MyBatis 表是 `my_task`；JPA 使用 `jpa_job` 与 `jpa_owner`。测试每次重建种子数据并清空相关缓存、计数，避免上一条测试改变下一条结论。计数器只供单线程隔离实验，不适合直接当生产请求级 SQL 指标。

## 3. MyBatis 一级缓存到底缓存什么

`firstLevelCacheUsesOnePrepareInOneTransaction` 在一个 Spring 事务中，用同一 Mapper、同一租户和 ID 查询两次，断言 prepare 次数为 1。`noSharedFirstLevelCacheOutsideTransaction` 则在事务外调用两次，断言为 2。

两者差异不是“Spring Bean 是不是单例”，而是 SqlSession 的生命周期：

```text
同一线程的 Spring 事务
→ SqlSessionTemplate 获取事务关联的 SqlSession
→ 相同缓存键再次查询
→ Executor 本地缓存可返回已有结果

没有包围两次调用的事务
→ 每次 Mapper 调用分别获取并关闭 Session
→ 不能共用上一调用的一级缓存
```

配置为 `local-cache-scope=SESSION`，并未将所有查询神奇地永久缓存。语句参数、分页边界和 SQL 等参与缓存键；写操作、clearCache、提交/回滚等又会改变缓存生命周期。[MyBatis Session 与缓存](https://mybatis.org/mybatis-3/java-api.html)

`mapperWriteClearsFirstLevelCache` 按“查询 → 更新 → 查询”执行，prepare 共 3 次，最后读到更新值。更新语句不是只改数据库而完全不碰当前 Session 的缓存。

## 4. 二级缓存命中为什么可能返回旧值

`CachedMapper` 显式启用 namespace 缓存。测试先通过它读取并结束事务，让结果进入二级缓存，再由 JdbcTemplate 修改同一行，最后从 CachedMapper 读取。其结果仍为旧值，而普通 TaskMapper 读取到新值。

```text
CachedMapper 查询 before → 事务结束 → namespace 缓存保存 before
JdbcTemplate 更新 external → 不经过该 namespace 的失效机制
CachedMapper 再查询 → 命中 before
TaskMapper 查询 → 数据库返回 external
```

这个实验反驳的不是“缓存没有用”，而是“只要启用二级缓存就自动维护跨写路径一致性”。不同 namespace、其他实例、批处理脚本和其他应用都可能绕过失效。强一致业务状态应先明确所有写入路径，不能只测一个 Mapper 内部的更新。

实验返回不可变字符串并采用 `readWrite=false`，避免可变对象共享污染结果；生产若缓存可变对象，还要考虑复制/序列化语义和内存占用。

## 5. 更新 0 行不是 SQL 执行失败

TaskMapper 的更新条件包含租户、ID 和期望版本：

```sql
UPDATE my_task
SET name = ?, version = version + 1
WHERE tenant = ? AND id = ? AND version = ?;
```

第一次按 version=0 更新，影响 1 行；再用旧版本更新，影响 0 行。这通常没有 SQL 异常，却需要业务返回冲突或重新判断。只检查“Mapper 没抛异常”会把丢失更新误判为成功。

参数绑定实验把类似 SQL 的字符串作为租户传入，结果是找不到记录，不是扩大读取范围。它验证的是 `#{...}` 绑定值，不能据此允许 `${...}` 接受任意排序、表名或用户片段。

## 6. JPA 脏检查、flush 和提交

`managedIdentityAndDirtyChecking` 在一个持久化上下文里两次 find 同一主键，返回同一对象；修改 name 而不调用 Repository.save，提交时仍产生更新。原因是持久化上下文跟踪受管实体，flush 比较状态并生成 SQL。

`flushCanStillRollback` 则修改、显式 flush，然后把事务设为 rollback-only。统计里确实出现一次实体 UPDATE，事务结束后数据库仍是旧值。

这两个证据必须一起读：**对象改变不等于已经提交；SQL 已执行也不等于事务不能回滚。** SQL 日志里的 UPDATE 本身不能当作“其他事务已可见”的证据。测试通过事务结束后的独立查询检查最终值。

工程中的 MyBatis、JdbcTemplate 与 JPA 使用同一 DataSource；Spring 的 JpaTransactionManager 可向相应 JDBC 访问暴露事务连接。这只是同一关系数据库的本地事务，不会把两个不同数据源或 Redis 也包含进去。[JPA 与 JDBC 事务参与](https://docs.spring.io/spring-framework/reference/data-access/orm/jpa.html)

## 7. 亲自测出 N+1，而不是只认关键词

种子数据是 3 个任务，各自关联不同 owner。关闭二级缓存和批量抓取后：

| 查询方式 | 遍历 owner.name 后的 prepare 次数 | 来源 |
| --- | --- | --- |
| `select j from JobEntity j` | 4 | 1 次任务查询 + 3 次 LAZY owner 查询 |
| `select j from JobEntity j join fetch j.owner` | 1 | 关联数据随本次查询一起加载 |

断言来自 Hibernate Statistics 的 `getPrepareStatementCount()`，不是用响应快慢反推 SQL 数。数据只有一个 owner、上下文已有 owner、批量抓取或缓存开启，结果都可能变化，因此必须说明种子和上下文条件。

这里 fetch 的是 to-one 关联。不要把结果直接推广到“集合 fetch join + 分页”：集合连接会展开多行，分页语义、去重和内存消耗需要单独验证。列表接口常更适合 DTO 投影或先分页 ID、再批量加载。

## 8. 另外三个容易误判的边界

### 8.1 上下文关闭后访问 LAZY

`lazyOutsideContextFails` 在事务内拿出任务，事务结束后才访问 owner.name，得到 LazyInitializationException。修复是事务内明确加载并转换 DTO，而不是为了让 JSON 序列化成功就将全部关联改 EAGER。

### 8.2 两个 EntityManager 同时修改

两个独立事务先读到同一版本；A 修改并提交；B 再 flush 时由于 `@Version` 条件失败抛出 OptimisticLockException。冲突发生在 SQL/flush 边界，不一定在调用实体 setter 时。

重试必须重新读、重新判断业务状态。取消任务、扣库存和转账不能共享一个“冲突就盲目重试”的通用规则。

### 8.3 批量更新绕过受管对象

`bulkUpdateLeavesManagedInstanceStale` 先 find，再执行 JPQL 批量 UPDATE。数据库已变，原对象仍保留旧字段；clear 后重新 find 才读到新值。批量语句还可能绕过逐实体的版本推进和回调，不能将它视为一连串普通实体操作。

## 9. 如何迁移到真实数据库

先用迁移工具建立 schema，再将 H2 驱动和 URL 换为目标数据库；保留行为断言，增加锁等待、事务隔离、连接失效和索引计划测试。不要把测试里的清表、create-drop 配置带到业务库。

判断框架选择时，先看 SQL 形状、对象模型、事务边界和团队维护方式。MyBatis 让复杂 SQL 更显式，JPA 提供对象工作单元；两者都不能替代索引、隔离级别和并发正确性设计。

## 10. 练习与答案

### 10.1 同一事务重复查询只发一次 SQL，能证明数据库没有变化吗

不能。它可能只是 Session 或持久化上下文命中。需要明确隔离级别和缓存机制，必要时刷新/清理后重新查询，并在独立事务验证可见性。

### 10.2 N+1 实验为何要给三个任务安排不同 owner

若共享一个 owner，一级缓存可能复用同一实体，不能稳定得到 1+3 次查询。种子数据必须真正覆盖多个尚未加载的关联对象。

### 10.3 看到 UPDATE 日志后最终值仍未改变，最先核对什么

先核对同一事务是否回滚、是否带 rollback-only、受影响行数，以及查询是否来自旧上下文。不要直接归因于数据库“丢数据”。

## 11. 关联与参考

- [MyBatis 的执行与缓存](./03-MyBatis映射SqlSession执行与缓存.md)
- [JPA 实体状态与懒加载](./04-JPA实体状态脏检查懒加载与N加一.md)
- [Hibernate ORM 用户指南](https://docs.jboss.org/hibernate/orm/current/userguide/html_single/Hibernate_User_Guide.html)
