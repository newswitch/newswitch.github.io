package demo.tx.completion;

import java.util.ArrayList;
import java.util.List;
import demo.tx.support.LabDatabase;
import demo.tx.support.TxInfrastructure;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

public class CompletionDemo {
    public record Completed(int id) { }
    public static class EventLog { public final List<String> events = new ArrayList<>(); }
    public static class AuditWriter {
        private final LabDatabase database;
        public AuditWriter(LabDatabase database) { this.database = database; }
        @Transactional(propagation = Propagation.REQUIRES_NEW)
        public void write(int id) { database.insert(100 + id, "audit"); }
    }
    public static class Listener {
        private final EventLog log;
        private final AuditWriter writer;
        public Listener(EventLog log, AuditWriter writer) { this.log = log; this.writer = writer; }
        @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
        public void committed(Completed event) {
            log.events.add("afterCommit:" + event.id());
            writer.write(event.id());
        }
    }
    @Configuration(proxyBeanMethods = false) @Import(TxInfrastructure.class)
    public static class Config {
        @Bean EventLog eventLog() { return new EventLog(); }
        @Bean AuditWriter auditWriter(LabDatabase database) { return new AuditWriter(database); }
        @Bean Listener listener(EventLog log, AuditWriter writer) { return new Listener(log, writer); }
    }
    public static void main(String[] args) {
        try (var context = new AnnotationConfigApplicationContext(Config.class)) {
            LabDatabase database = context.getBean(LabDatabase.class);
            EventLog log = context.getBean(EventLog.class);
            TransactionTemplate template = new TransactionTemplate(database.manager());
            template.executeWithoutResult(status -> {
                database.insert(1, "order"); context.publishEvent(new Completed(1));
            });
            System.out.println("committedRows=" + database.labels());
            System.out.println("committedEvents=" + log.events);
            database.clear(); log.events.clear();
            template.executeWithoutResult(status -> {
                database.insert(2, "order"); context.publishEvent(new Completed(2)); status.setRollbackOnly();
            });
            System.out.println("rollbackRows=" + database.labels());
            System.out.println("rollbackEvents=" + log.events);
            context.publishEvent(new Completed(3));
            System.out.println("outsideEvents=" + log.events);
            database.jdbc().execute("create table outbox(id int primary key, state varchar(16))");
            template.executeWithoutResult(status -> {
                database.insert(4, "order"); database.jdbc().update("insert into outbox values(4, 'NEW')");
            });
            System.out.println("outboxRows=" + database.jdbc().queryForObject("select count(*) from outbox", Integer.class));
            System.out.println("orderRows=" + database.count());
        }
    }
}
