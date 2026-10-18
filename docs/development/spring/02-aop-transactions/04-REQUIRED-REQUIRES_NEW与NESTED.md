---
title: "事务传播、独立事务与保存点"
sidebar_label: "04. 事务传播、独立事务与保存点"
sidebar_position: 4
description: "比较共享物理事务、独立事务与保存点，实测 rollback-only、UnexpectedRollbackException、内层独立提交和局部回滚。"
tags: [Spring, 事务传播, REQUIRED, REQUIRES_NEW, NESTED]
---

# 事务传播、独立事务与保存点

传播行为回答“进入一个事务方法时，如何处理当前已有事务”，不是决定数据库隔离级别。两个带事务注解的方法可以共用同一个物理事务，也可以获得独立事务，或者通过保存点表达局部回滚。

必须同时区分逻辑方法边界和实际资源边界。

## 1. 三种机制的区别

| 传播 | 已有事务时的行为 | 内层失败的典型影响 |
| --- | --- | --- |
| REQUIRED | 加入已有物理事务，形成自己的逻辑事务范围 | 可标记共享事务 rollback-only |
| REQUIRES_NEW | 挂起外层事务关联，为内层建立独立物理事务 | 内层可独立提交/回滚，外层结果不自动撤销它 |
| NESTED | 在支持的已有事务中使用保存点 | 可回到保存点，外层继续；最终仍依赖外层提交 |

没有已有事务时，这三种常见使用路径都会建立事务。NESTED 的保存点支持由管理器、驱动与资源决定，不应把 JDBC 行为无条件推广到 JPA/JTA。[传播语义](https://docs.spring.io/spring-framework/reference/data-access/transaction/declarative/tx-propagation.html)

## 2. 为什么捕获 REQUIRED 的异常仍可能整体回滚

```text
外层开始事务
→ 内层通过代理加入同一事务
→ 内层抛运行时异常，参与者标记 rollback-only
→ 外层捕获异常并正常返回
→ 外层尝试提交，实际不能提交
→ UnexpectedRollbackException
```

catch 改变的是 Java 异常传播，不会自动清除资源协调中已经存在的回滚标记。异常名中的 unexpected 是对外层“以为正常提交”的调用预期而言，不意味着数据库随机丢数据。

## 3. 用独立协作者避免自调用干扰

使用[公共数据库支持类](./03-事务管理器连接与提交回滚.md)，创建以下主类：

```java title="src/main/java/demo/tx/propagation/PropagationDemo.java"
package demo.tx.propagation;

import demo.tx.support.LabDatabase;
import demo.tx.support.TxInfrastructure;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.UnexpectedRollbackException;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

public class PropagationDemo {
    public static class Inner {
        private final LabDatabase database;
        public Inner(LabDatabase database) { this.database = database; }
        @Transactional public void required() {
            database.insert(2, "inner"); throw new IllegalStateException("inner failed");
        }
        @Transactional(propagation = Propagation.REQUIRES_NEW) public void independent() {
            database.insert(2, "inner");
        }
        @Transactional(propagation = Propagation.NESTED) public void nested() {
            database.insert(2, "inner"); throw new IllegalStateException("inner failed");
        }
    }
    public static class Outer {
        private final LabDatabase database;
        private final Inner inner;
        public Outer(LabDatabase database, Inner inner) { this.database = database; this.inner = inner; }
        @Transactional public void required() {
            database.insert(1, "outer");
            try { inner.required(); } catch (IllegalStateException expected) { }
        }
        @Transactional public void independent() {
            database.insert(1, "outer");
            inner.independent();
            throw new IllegalStateException("outer failed");
        }
        @Transactional public void nested() {
            database.insert(1, "outer");
            try { inner.nested(); } catch (IllegalStateException expected) { }
        }
    }
    @Configuration(proxyBeanMethods = false) @Import(TxInfrastructure.class)
    public static class Config {
        @Bean Inner inner(LabDatabase database) { return new Inner(database); }
        @Bean Outer outer(LabDatabase database, Inner inner) { return new Outer(database, inner); }
    }
    public static void main(String[] args) {
        try (var context = new AnnotationConfigApplicationContext(Config.class)) {
            LabDatabase database = context.getBean(LabDatabase.class);
            Outer outer = context.getBean(Outer.class);
            boolean unexpectedRollback = false;
            try { outer.required(); } catch (UnexpectedRollbackException expected) { unexpectedRollback = true; }
            System.out.println("requiredRollback=" + unexpectedRollback);
            System.out.println("requiredRows=" + database.labels());
            database.clear();
            try { outer.independent(); } catch (IllegalStateException expected) { }
            System.out.println("requiresNewRows=" + database.labels());
            database.clear();
            outer.nested();
            System.out.println("nestedRows=" + database.labels());
        }
    }
}
```

编译并运行 `demo.tx.propagation.PropagationDemo`：

```text title="expected-output"
requiredRollback=true
requiredRows=[]
requiresNewRows=[inner]
nestedRows=[outer]
```

三段调用之间清理数据，避免把前一段提交误当成本段结果。内层方法由另一个 Bean 的代理接收，所以传播配置确实被执行。

## 4. REQUIRES_NEW 不是免费隔离

外层的连接和锁可能仍被保留，只是资源关联被挂起。内层通常需要另一份连接；并发外层都占住连接再等待内层取连接时，可能耗尽池资源。

因此不能把 REQUIRES_NEW 当成“解决所有事务异常”的默认补丁。评估连接池容量、并发深度与超时；如果内层还访问外层已锁住的同一行，独立事务也可能互相等待。

本例内外写入不同主键，专门避免用数据锁等待掩盖传播结果。

## 5. NESTED 提交不等于独立持久化

保存点让内层回滚可撤销一段变化，但内层正常结束并没有获得独立于外层的最终提交。外层最后回滚时，之前内层保留的变化也可能被整体撤销。

它也不是把所有其他资源和外部调用都纳入保存点。JDBC 保存点不能撤销已发送邮件、MQ 消息或任意 Java 对象状态。

## 6. 其他传播及属性冲突

SUPPORTS 可在存在事务时参与，不存在时按无事务语义执行；MANDATORY 要求已有事务；NOT_SUPPORTED 挂起事务执行；NEVER 拒绝已有事务。选择应对应调用契约，而不是为了消除异常随意切换。

REQUIRED 加入已有事务时，隔离、超时、只读等通常由已有物理事务条件决定，不是内层注解重新设置一遍数据库状态。可用 validateExistingTransaction 等配置加强不兼容属性校验；需要新物理属性时，必须明确相应资源边界。

## 7. 练习与答案

### 7.1 外层捕获了异常，为什么调用方仍收到 UnexpectedRollbackException

内层事务拦截器已经给共享事务留下回滚标记。外层普通 catch 不撤销它，最终不能兑现正常提交的预期。

### 7.2 REQUIRES_NEW 的记录会被外层回滚撤销吗

若内层已经独立提交，不会因为外层 JDBC 回滚自动撤销。本例保留 inner；但业务补偿和外键等约束还需独立设计。

### 7.3 NESTED 和 REQUIRES_NEW 是否都必须额外占一份物理连接

本篇支持保存点的单 DataSource JDBC 情形下，NESTED 在原事务连接上使用保存点；REQUIRES_NEW 需要独立事务资源。其他管理器须核对支持情况。

## 8. 继续阅读

- [隔离级别、数据库锁与并发控制](./05-隔离级别数据库锁与并发控制.md)
- [自调用、异常与线程事务边界](./06-自调用异常与线程事务边界.md)
