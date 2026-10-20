package demo.internals.transaction;

import org.h2.jdbcx.JdbcConnectionPool;
import org.springframework.context.annotation.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.transaction.annotation.*;
import org.springframework.transaction.support.*;
import javax.sql.DataSource;
import java.util.*;

public final class TransactionPathDemo {
    public static class Trace { public final List<String> events = new ArrayList<>(); }
    public static class Manager extends DataSourceTransactionManager {
        private final Trace trace;
        public Manager(DataSource dataSource, Trace trace) { super(dataSource); this.trace = trace; }
        @Override protected void doBegin(Object transaction, org.springframework.transaction.TransactionDefinition definition) {
            super.doBegin(transaction, definition); trace.events.add("begin");
        }
        @Override protected void doCommit(DefaultTransactionStatus status) {
            super.doCommit(status); trace.events.add("commit");
        }
        @Override protected void doRollback(DefaultTransactionStatus status) {
            super.doRollback(status); trace.events.add("rollback");
        }
        @Override protected void doCleanupAfterCompletion(Object transaction) {
            try { super.doCleanupAfterCompletion(transaction); } finally { trace.events.add("cleanup"); }
        }
    }
    public static class Work {
        private final JdbcTemplate jdbc; private final Trace trace;
        public Work(JdbcTemplate jdbc, Trace trace) { this.jdbc = jdbc; this.trace = trace; }
        @Transactional public void write(String name, boolean fail) {
            trace.events.add("body:" + TransactionSynchronizationManager.isActualTransactionActive());
            jdbc.update("insert into entries(entry_name) values (?)", name);
            if (fail) throw new IllegalStateException("failed");
        }
        @Transactional public void checked() throws Exception {
            jdbc.update("insert into entries(entry_name) values (?)", "checked");
            throw new Exception("checked failure");
        }
    }
    @Configuration(proxyBeanMethods = false) @EnableTransactionManagement
    public static class Config {
        @Bean public Trace trace() { return new Trace(); }
        @Bean(destroyMethod = "dispose") public JdbcConnectionPool dataSource() {
            var pool = JdbcConnectionPool.create("jdbc:h2:mem:source-tx;DB_CLOSE_DELAY=0;LOCK_TIMEOUT=500", "sa", "");
            pool.setMaxConnections(4); return pool;
        }
        @Bean public JdbcTemplate jdbc(DataSource dataSource) {
            var jdbc = new JdbcTemplate(dataSource);
            jdbc.execute("create table entries(entry_name varchar(40))"); return jdbc;
        }
        @Bean public Manager transactionManager(DataSource dataSource, Trace trace) { return new Manager(dataSource, trace); }
        @Bean public Work work(JdbcTemplate jdbc, Trace trace) { return new Work(jdbc, trace); }
    }
    public static void main(String[] args) {
        try (var context = new AnnotationConfigApplicationContext(Config.class)) {
            var work = context.getBean(Work.class); var trace = context.getBean(Trace.class);
            work.write("ok", false); System.out.println("commit=" + String.join(",", trace.events));
            trace.events.clear();
            try { work.write("failed", true); } catch (IllegalStateException expected) { }
            System.out.println("rollback=" + String.join(",", trace.events));
            System.out.println("rows=" + context.getBean(JdbcTemplate.class).queryForList("select entry_name from entries", String.class));
            System.out.println("afterCallActive=" + TransactionSynchronizationManager.isActualTransactionActive());
            System.out.println("boundConnection=" + TransactionSynchronizationManager.hasResource(context.getBean(DataSource.class)));
        }
    }
}
