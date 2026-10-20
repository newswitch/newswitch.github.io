---
title: "MyBatis 的 Mapper、SqlSession、执行与缓存"
sidebar_label: "03. MyBatis 执行与缓存"
sidebar_position: 3
description: "沿 Mapper 代理、SqlSessionTemplate、Executor 与 JDBC 分析 SQL，解释参数绑定、事务参与和两级缓存边界。"
tags: [SpringBoot, MyBatis, SQL, 缓存]
---

# MyBatis 的 Mapper、SqlSession、执行与缓存

MyBatis 把接口方法和 SQL 映射起来，不像 JPA 那样依赖脏检查生成所有更新。SQL、映射、受影响行数和事务仍由应用负责。

## 1. 版本与接入

[官方兼容表](https://mybatis.org/spring-boot-starter/mybatis-spring-boot-autoconfigure/)区分 Starter 4.0、3.0 等系列。Boot 4 选择明确支持它的系列，不把 Boot 3 Starter 原样带入。坐标 `org.mybatis.spring.boot:mybatis-spring-boot-starter` 的版本要单独锁定并验证，不能假定全部由 Boot BOM 管理。

本文分析 Boot 4 集成；任务服务实际采用 JdbcTemplate，下面 Mapper 是等价实现节选，不宣称所有第三方版本均已联调。

## 2. 一次查询的内部路径

官方兼容表给出的 4.0.0 可作为固定候选，先在独立工程验证，不覆盖 Boot 管理的 Spring 模块：

```xml
<dependency>
  <groupId>org.mybatis.spring.boot</groupId>
  <artifactId>mybatis-spring-boot-starter</artifactId>
  <version>4.0.0</version>
</dependency>
```

配置数据源后，在接口使用 `@Mapper`，或配置类用 `@MapperScan("你的Mapper包")`。XML 方式还需确认 mapper-locations、namespace 与方法 ID 对应；两种方式最终都映射为 MappedStatement。

```mermaid
flowchart TD
    A[Mapper 接口] --> B[MapperProxy / MapperMethod]
    B --> C[SqlSessionTemplate]
    C --> D[事务关联 SqlSession]
    D --> E[Executor]
    E --> F[MappedStatement / BoundSql]
    F --> G[StatementHandler / ParameterHandler]
    G --> H[JDBC 与结果映射]
```

SqlSessionTemplate 协调事务中的 Session；原生 DefaultSqlSession 不能当线程安全单例共享。Spring 管理事务时，不要手动 Session commit/rollback 制造另一套边界。

## 3. 映射与参数

```java
@Mapper
public interface TaskMapper {
    @Select("SELECT id,name,status,version FROM task WHERE tenant=#{tenant} AND id=#{id}")
    TaskRow find(@Param("tenant") String tenant, @Param("id") String id);

    @Update("UPDATE task SET status='CANCELLED',version=version+1 " +
        "WHERE tenant=#{tenant} AND id=#{id} AND version=#{version} AND status='NEW'")
    int cancel(@Param("tenant") String tenant, @Param("id") String id,
        @Param("version") long version);
}
```

需要 MyBatis 注解导入与 TaskRow。井号形式绑定值，美元符号形式进行文本替换，不应用于直接接受的用户值。表名和排序字段应来自白名单。XML foreach、if、choose 解决 SQL 组合，不自动保证逻辑正确。

别名、驼峰配置、构造器和 null 都影响映射。先用简单返回模型验证；嵌套 select 也可能产生 N+1。

## 4. 缓存在哪

一级缓存关联 SqlSession，行为受配置、语句和事务影响。Spring 同事务可能复用 Session，跨事务不应期待共享一级缓存。

二级缓存按 namespace 等机制组织，需要显式理解失效。其他应用、其他 namespace 或直接 SQL 改库时，不一定及时失效。命中不等于跨进程一致性，更不是幂等保证。

批量 Executor 改变实际执行与错误暴露时机。方法返回不等于批量 SQL 已提交，要检查 flush、提交及真实结果。

## 5. 同模型对照验证

用任务表验证零行映射、重复键、更新 0/1 行、事务回滚、两次查询是否真的发 SQL、外部更新后的缓存。受控打开 SQL 日志，统计条数，不泄露参数。

找不到 Mapper 时先查扫描范围和 Bean 定义，再查依赖和数据源；不要随意叠注解掩盖扫描错误。

## 6. 练习与答案

### 6.1 接口没有实现类为何能注入

扫描器注册工厂 Bean 并创建代理，代理找到 MappedStatement 执行，并非 Java 自动补写实现。

### 6.2 MyBatis 还需要事务吗

需要，多条 SQL 原子性来自数据库事务及正确参与。

### 6.3 二级缓存能保证实时订单状态吗

不能普遍保证，需考虑跨实例与其他写路径的失效，对强一致状态慎用。

## 7. 深入阅读

- [MyBatis Java API](https://mybatis.org/mybatis-3/java-api.html)
- [MyBatis-Spring 事务](https://mybatis.org/spring/transactions.html)
