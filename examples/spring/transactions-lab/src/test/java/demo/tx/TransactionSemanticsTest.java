package demo.tx;

import java.io.IOException;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.aopalliance.intercept.MethodInterceptor;
import org.junit.jupiter.api.Test;
import org.springframework.aop.framework.AopConfigException;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.aop.support.AopUtils;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.datasource.DataSourceUtils;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.UnexpectedRollbackException;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.support.TransactionTemplate;
import demo.tx.basics.TransactionDemo;
import demo.tx.boundaries.BoundaryDemo;
import demo.tx.chain.AdviceChainDemo;
import demo.tx.completion.CompletionDemo;
import demo.tx.isolation.IsolationDemo;
import demo.tx.propagation.PropagationDemo;
import demo.tx.proxy.ProxyDemo;
import demo.tx.support.LabDatabase;
import demo.tx.support.TxInfrastructure;
import static org.junit.jupiter.api.Assertions.*;

class TransactionSemanticsTest {
    static Object proxy(Object target, boolean classProxy, List<String> log) {
        var factory = new ProxyFactory(target);
        factory.setProxyTargetClass(classProxy);
        factory.addAdvice((MethodInterceptor) invocation -> {
            log.add("advice:" + invocation.getMethod().getName());
            return invocation.proceed();
        });
        return factory.getProxy();
    }

    @Test void jdkProxyExposesInterfaceNotImplementation() {
        List<String> log = new ArrayList<>();
        Object value = proxy(new ProxyDemo.TaskService(log), false, log);
        assertTrue(AopUtils.isJdkDynamicProxy(value));
        assertInstanceOf(ProxyDemo.Task.class, value);
        assertFalse(value instanceof ProxyDemo.TaskService);
    }

    @Test void cglibProxyIsAssignableToTargetClass() {
        List<String> log = new ArrayList<>();
        Object value = proxy(new ProxyDemo.TaskService(log), true, log);
        assertTrue(AopUtils.isCglibProxy(value));
        assertInstanceOf(ProxyDemo.TaskService.class, value);
    }

    @Test void selfInvocationBypassesBothProxyKinds() {
        for (boolean classProxy : new boolean[] {false, true}) {
            List<String> log = new ArrayList<>();
            ((ProxyDemo.Task) proxy(new ProxyDemo.TaskService(log), classProxy, log)).outer();
            assertEquals(List.of("advice:outer", "target:outer", "target:inner"), log);
        }
    }

    public static final class FinalService { public String value() { return "fixed"; } }
    @Test void finalClassCannotBeClassProxied() {
        assertThrows(AopConfigException.class, () -> proxy(new FinalService(), true, new ArrayList<>()));
    }

    public static class FinalMethodService { public final String value() { return "fixed"; } }
    @Test void finalMethodDoesNotRunAdvice() {
        List<String> log = new ArrayList<>();
        var value = (FinalMethodService) proxy(new FinalMethodService(), true, log);
        assertEquals("fixed", value.value());
        assertTrue(log.isEmpty());
    }

    @Test void orderedAroundAdviceReturnsInsideOut() {
        try (var context = new AnnotationConfigApplicationContext(AdviceChainDemo.Config.class)) {
            assertEquals("done", context.getBean(AdviceChainDemo.TaskService.class).run(false));
            assertEquals(List.of("outer:before", "inner:before", "target", "inner:return", "inner:finally", "outer:return", "outer:finally"),
                    context.getBean(AdviceChainDemo.Log.class).events);
        }
    }

    @Test void orderedAroundAdvicePreservesFailure() {
        try (var context = new AnnotationConfigApplicationContext(AdviceChainDemo.Config.class)) {
            assertThrows(IllegalStateException.class, () -> context.getBean(AdviceChainDemo.TaskService.class).run(true));
            assertEquals(List.of("outer:before", "inner:before", "target", "inner:throw", "inner:finally", "outer:throw", "outer:finally"),
                    context.getBean(AdviceChainDemo.Log.class).events);
        }
    }

    @Test void adviceCanSkipTargetWhenProceedIsOmitted() {
        var log = new AdviceChainDemo.Log();
        var factory = new ProxyFactory(new AdviceChainDemo.TaskService(log));
        factory.addAdvice((MethodInterceptor) invocation -> "cached");
        assertEquals("cached", ((AdviceChainDemo.TaskService) factory.getProxy()).run(false));
        assertTrue(log.events.isEmpty());
    }

    @Test void callingProceedTwiceRepeatsPureTarget() {
        var log = new AdviceChainDemo.Log();
        var factory = new ProxyFactory(new AdviceChainDemo.TaskService(log));
        factory.addAdvice((MethodInterceptor) invocation -> { invocation.proceed(); return invocation.proceed(); });
        assertEquals("done", ((AdviceChainDemo.TaskService) factory.getProxy()).run(false));
        assertEquals(List.of("target", "target"), log.events);
    }

    @Test void jdbcTransactionBindsConnectionAndCommits() throws Exception {
        try (var context = new AnnotationConfigApplicationContext(TransactionDemo.Config.class)) {
            var evidence = context.getBean(TransactionDemo.Ledger.class).write(1, false);
            assertTrue(evidence.active()); assertTrue(evidence.sameConnection()); assertFalse(evidence.autoCommit());
            assertEquals(1, context.getBean(LabDatabase.class).count());
        }
    }

    @Test void runtimeFailureRollsBackAndUnbindsResource() {
        try (var context = new AnnotationConfigApplicationContext(TransactionDemo.Config.class)) {
            var database = context.getBean(LabDatabase.class);
            assertThrows(IllegalStateException.class, () -> context.getBean(TransactionDemo.Ledger.class).write(1, true));
            assertEquals(0, database.count());
            assertFalse(TransactionSynchronizationManager.hasResource(database.dataSource()));
        }
    }

    @Test void rawDataSourceConnectionCanEscapeSpringRollback() throws Exception {
        try (var database = new LabDatabase()) {
            new TransactionTemplate(database.manager()).executeWithoutResult(status -> {
                try (Connection raw = database.dataSource().getConnection(); var statement = raw.prepareStatement("insert into entries values(1, 'raw')")) {
                    assertTrue(raw.getAutoCommit()); statement.executeUpdate();
                } catch (SQLException error) { throw new IllegalStateException(error); }
                status.setRollbackOnly();
            });
            assertEquals(List.of("raw"), database.labels());
        }
    }

    @Test void requiredCaughtFailureStillCausesUnexpectedRollback() {
        try (var context = new AnnotationConfigApplicationContext(PropagationDemo.Config.class)) {
            assertThrows(UnexpectedRollbackException.class, () -> context.getBean(PropagationDemo.Outer.class).required());
            assertEquals(0, context.getBean(LabDatabase.class).count());
        }
    }

    @Test void requiresNewCommitSurvivesOuterRollback() {
        try (var context = new AnnotationConfigApplicationContext(PropagationDemo.Config.class)) {
            assertThrows(IllegalStateException.class, () -> context.getBean(PropagationDemo.Outer.class).independent());
            assertEquals(List.of("inner"), context.getBean(LabDatabase.class).labels());
        }
    }

    @Test void nestedFailureRollsBackToSavepointOnly() {
        try (var context = new AnnotationConfigApplicationContext(PropagationDemo.Config.class)) {
            context.getBean(PropagationDemo.Outer.class).nested();
            assertEquals(List.of("outer"), context.getBean(LabDatabase.class).labels());
        }
    }

    static TransactionTemplate template(LabDatabase database, int propagation) {
        var template = new TransactionTemplate(database.manager());
        template.setPropagationBehavior(propagation);
        return template;
    }
    @Test void nestedSuccessStillDependsOnOuterCommit() throws Exception {
        try (var database = new LabDatabase()) {
            new TransactionTemplate(database.manager()).executeWithoutResult(outer -> {
                database.insert(1, "outer");
                template(database, TransactionDefinition.PROPAGATION_NESTED).executeWithoutResult(inner -> database.insert(2, "inner"));
                outer.setRollbackOnly();
            });
            assertEquals(0, database.count());
        }
    }

    @Test void requiresNewUsesOtherConnectionAndRestoresOuter() throws Exception {
        try (var database = new LabDatabase()) {
            new TransactionTemplate(database.manager()).executeWithoutResult(status -> {
                Connection outer = DataSourceUtils.getConnection(database.dataSource());
                try {
                    template(database, TransactionDefinition.PROPAGATION_REQUIRES_NEW).executeWithoutResult(innerStatus -> {
                        Connection inner = DataSourceUtils.getConnection(database.dataSource());
                        try { assertNotSame(outer, inner); } finally { DataSourceUtils.releaseConnection(inner, database.dataSource()); }
                    });
                    Connection restored = DataSourceUtils.getConnection(database.dataSource());
                    try { assertSame(outer, restored); } finally { DataSourceUtils.releaseConnection(restored, database.dataSource()); }
                } finally { DataSourceUtils.releaseConnection(outer, database.dataSource()); }
            });
        }
    }

    @Test void nestedUsesSameConnection() throws Exception {
        try (var database = new LabDatabase()) {
            new TransactionTemplate(database.manager()).executeWithoutResult(status -> {
                Connection outer = DataSourceUtils.getConnection(database.dataSource());
                try {
                    template(database, TransactionDefinition.PROPAGATION_NESTED).executeWithoutResult(innerStatus -> {
                        Connection inner = DataSourceUtils.getConnection(database.dataSource());
                        try { assertSame(outer, inner); } finally { DataSourceUtils.releaseConnection(inner, database.dataSource()); }
                    });
                } finally { DataSourceUtils.releaseConnection(outer, database.dataSource()); }
            });
        }
    }

    @Test void readCommittedCanObserveNewCommit() throws Exception {
        try (var database = new LabDatabase()) {
            database.insert(1, "v1");
            assertEquals("v1->v2", IsolationDemo.readTwice(database, Connection.TRANSACTION_READ_COMMITTED));
        }
    }

    @Test void repeatableReadKeepsObservedVersionInThisH2Schedule() throws Exception {
        try (var database = new LabDatabase()) {
            database.insert(1, "v1");
            assertEquals("v1->v1", IsolationDemo.readTwice(database, Connection.TRANSACTION_REPEATABLE_READ));
        }
    }

    @Test void competingUpdateHasBoundedLockWait() throws Exception {
        try (var database = new LabDatabase()) {
            database.insert(1, "v1");
            assertTrue(IsolationDemo.lockTimesOut(database));
            assertEquals(List.of("v1"), database.labels());
        }
    }

    @Test void conditionalUpdateRejectsStaleVersionAndInsufficientStock() throws Exception {
        try (var database = new LabDatabase()) {
            database.jdbc().execute("create table stock(id int primary key, available int, version int)");
            database.jdbc().update("insert into stock values(1, 1, 0)");
            String sql = "update stock set available=available-1, version=version+1 where id=1 and version=? and available>0";
            assertEquals(1, database.jdbc().update(sql, 0));
            assertEquals(0, database.jdbc().update(sql, 0));
            assertEquals(0, database.jdbc().update(sql, 1));
            assertEquals(0, database.jdbc().queryForObject("select available from stock", Integer.class));
        }
    }

    @Test void requiredDoesNotReconfigureExistingIsolationByDefault() throws Exception {
        try (var database = new LabDatabase()) {
            var outer = new TransactionTemplate(database.manager()); outer.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
            var inner = new TransactionTemplate(database.manager()); inner.setIsolationLevel(TransactionDefinition.ISOLATION_SERIALIZABLE);
            outer.executeWithoutResult(status -> inner.executeWithoutResult(ignored -> {
                Connection connection = DataSourceUtils.getConnection(database.dataSource());
                try { assertEquals(Connection.TRANSACTION_READ_COMMITTED, connection.getTransactionIsolation()); }
                catch (SQLException error) { throw new IllegalStateException(error); }
                finally { DataSourceUtils.releaseConnection(connection, database.dataSource()); }
            }));
        }
    }

    @Test void validatingExistingTransactionRejectsIsolationMismatch() throws Exception {
        try (var database = new LabDatabase()) {
            database.manager().setValidateExistingTransaction(true);
            var outer = new TransactionTemplate(database.manager()); outer.setIsolationLevel(TransactionDefinition.ISOLATION_READ_COMMITTED);
            var inner = new TransactionTemplate(database.manager()); inner.setIsolationLevel(TransactionDefinition.ISOLATION_SERIALIZABLE);
            assertThrows(IllegalTransactionStateException.class, () -> outer.executeWithoutResult(status -> inner.executeWithoutResult(ignored -> {})));
        }
    }

    @Test void selfInvocationAndManualConstructionDoNotCreateTransaction() {
        try (var context = new AnnotationConfigApplicationContext(BoundaryDemo.Config.class)) {
            var service = context.getBean(BoundaryDemo.Service.class);
            assertTrue(service.probe()); assertFalse(service.selfProbe());
            assertFalse(new BoundaryDemo.Service(context.getBean(LabDatabase.class)).probe());
        }
    }

    @Test void checkedExceptionCommitsUnderDefaultRule() {
        try (var context = new AnnotationConfigApplicationContext(BoundaryDemo.Config.class)) {
            assertThrows(IOException.class, () -> context.getBean(BoundaryDemo.Service.class).checkedDefault());
            assertEquals(1, context.getBean(LabDatabase.class).count());
        }
    }

    @Test void explicitCheckedExceptionRuleRollsBack() {
        try (var context = new AnnotationConfigApplicationContext(BoundaryDemo.Config.class)) {
            assertThrows(IOException.class, () -> context.getBean(BoundaryDemo.Service.class).checkedRollback());
            assertEquals(0, context.getBean(LabDatabase.class).count());
        }
    }

    @Test void swallowedLocalExceptionAppearsAsNormalReturn() {
        try (var context = new AnnotationConfigApplicationContext(BoundaryDemo.Config.class)) {
            context.getBean(BoundaryDemo.Service.class).swallowed();
            assertEquals(1, context.getBean(LabDatabase.class).count());
        }
    }

    @Test void newThreadDoesNotInheritJdbcTransaction() throws Exception {
        try (var context = new AnnotationConfigApplicationContext(BoundaryDemo.Config.class)) {
            assertFalse(context.getBean(BoundaryDemo.Service.class).threadProbe());
            assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
        }
    }

    @Test void otherThreadCanEnterItsOwnProxyTransaction() throws Exception {
        try (var context = new AnnotationConfigApplicationContext(BoundaryDemo.Config.class)) {
            var executor = Executors.newSingleThreadExecutor();
            try { assertTrue(executor.submit(() -> context.getBean(BoundaryDemo.Service.class).probe()).get(3, TimeUnit.SECONDS)); }
            finally { executor.shutdownNow(); assertTrue(executor.awaitTermination(3, TimeUnit.SECONDS)); }
        }
    }

    @Test void afterCommitEventWritesIndependentAudit() {
        try (var context = new AnnotationConfigApplicationContext(CompletionDemo.Config.class)) {
            var database = context.getBean(LabDatabase.class);
            new TransactionTemplate(database.manager()).executeWithoutResult(status -> {
                database.insert(1, "order"); context.publishEvent(new CompletionDemo.Completed(1));
            });
            assertEquals(List.of("order", "audit"), database.labels());
            assertEquals(List.of("afterCommit:1"), context.getBean(CompletionDemo.EventLog.class).events);
        }
    }

    @Test void afterCommitEventIsSkippedOnRollback() {
        try (var context = new AnnotationConfigApplicationContext(CompletionDemo.Config.class)) {
            var database = context.getBean(LabDatabase.class);
            new TransactionTemplate(database.manager()).executeWithoutResult(status -> {
                database.insert(1, "order"); context.publishEvent(new CompletionDemo.Completed(1)); status.setRollbackOnly();
            });
            assertEquals(0, database.count());
            assertTrue(context.getBean(CompletionDemo.EventLog.class).events.isEmpty());
        }
    }

    @Test void transactionalEventWithoutTransactionHasNoDefaultFallback() {
        try (var context = new AnnotationConfigApplicationContext(CompletionDemo.Config.class)) {
            context.publishEvent(new CompletionDemo.Completed(1));
            assertTrue(context.getBean(CompletionDemo.EventLog.class).events.isEmpty());
            assertEquals(0, context.getBean(LabDatabase.class).count());
        }
    }

    static void outboxTable(LabDatabase database) {
        database.jdbc().execute("create table outbox(id int primary key, state varchar(16))");
    }
    @Test void outboxAndBusinessRowsRollbackTogether() throws Exception {
        try (var database = new LabDatabase()) {
            outboxTable(database);
            assertThrows(IllegalStateException.class, () -> new TransactionTemplate(database.manager()).executeWithoutResult(status -> {
                database.insert(1, "order"); database.jdbc().update("insert into outbox values(1, 'NEW')");
                throw new IllegalStateException("cancel");
            }));
            assertEquals(0, database.count());
            assertEquals(0, database.jdbc().queryForObject("select count(*) from outbox", Integer.class));
        }
    }

    @Test void outboxAndBusinessRowsCommitTogether() throws Exception {
        try (var database = new LabDatabase()) {
            outboxTable(database);
            new TransactionTemplate(database.manager()).executeWithoutResult(status -> {
                database.insert(1, "order"); database.jdbc().update("insert into outbox values(1, 'NEW')");
            });
            assertEquals(1, database.count());
            assertEquals(1, database.jdbc().queryForObject("select count(*) from outbox", Integer.class));
        }
    }

    @Test void afterCommitFailureCannotUndoCommittedData() throws Exception {
        try (var database = new LabDatabase()) {
            assertThrows(IllegalStateException.class, () -> new TransactionTemplate(database.manager()).executeWithoutResult(status -> {
                database.insert(1, "committed");
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    public void afterCommit() { throw new IllegalStateException("notification failed"); }
                });
            }));
            assertEquals(List.of("committed"), database.labels());
        }
    }

    @Test void templateCanRollbackWithoutThrowingBusinessException() throws Exception {
        try (var database = new LabDatabase()) {
            new TransactionTemplate(database.manager()).executeWithoutResult(status -> { database.insert(1, "cancelled"); status.setRollbackOnly(); });
            assertEquals(0, database.count());
        }
    }

    public static class RuleService {
        private final LabDatabase database;
        public RuleService(LabDatabase database) { this.database = database; }
        @Transactional(noRollbackFor = IllegalArgumentException.class)
        public void acceptedFailure() { database.insert(1, "kept"); throw new IllegalArgumentException("expected rule"); }
    }
    @Configuration(proxyBeanMethods = false) @Import(TxInfrastructure.class)
    public static class RuleConfig { @Bean RuleService rules(LabDatabase database) { return new RuleService(database); } }
    @Test void explicitNoRollbackRuleCanOverrideRuntimeDefault() {
        try (var context = new AnnotationConfigApplicationContext(RuleConfig.class)) {
            assertThrows(IllegalArgumentException.class, () -> context.getBean(RuleService.class).acceptedFailure());
            assertEquals(List.of("kept"), context.getBean(LabDatabase.class).labels());
        }
    }

    @Test void mandatoryRejectsMissingTransaction() throws Exception {
        try (var database = new LabDatabase()) {
            assertThrows(IllegalTransactionStateException.class, () -> template(database, TransactionDefinition.PROPAGATION_MANDATORY).executeWithoutResult(status -> {}));
        }
    }

    @Test void neverRejectsExistingTransaction() throws Exception {
        try (var database = new LabDatabase()) {
            assertThrows(IllegalTransactionStateException.class, () -> new TransactionTemplate(database.manager()).executeWithoutResult(status ->
                    template(database, TransactionDefinition.PROPAGATION_NEVER).executeWithoutResult(ignored -> {})));
        }
    }
}
