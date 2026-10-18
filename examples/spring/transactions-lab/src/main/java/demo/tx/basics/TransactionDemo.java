package demo.tx.basics;

import java.sql.Connection;
import java.sql.SQLException;
import demo.tx.support.LabDatabase;
import demo.tx.support.TxInfrastructure;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.datasource.DataSourceUtils;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;

public class TransactionDemo {
    public record Evidence(boolean active, boolean sameConnection, boolean autoCommit) { }
    public static class Ledger {
        private final LabDatabase database;
        public Ledger(LabDatabase database) { this.database = database; }
        @Transactional public Evidence write(int id, boolean fail) throws SQLException {
            Connection first = DataSourceUtils.getConnection(database.dataSource());
            Connection second = DataSourceUtils.getConnection(database.dataSource());
            try {
                Evidence evidence = new Evidence(TransactionSynchronizationManager.isActualTransactionActive(),
                        first == second, first.getAutoCommit());
                database.insert(id, "entry-" + id);
                if (fail) throw new IllegalStateException("cancel entry");
                return evidence;
            } finally {
                DataSourceUtils.releaseConnection(second, database.dataSource());
                DataSourceUtils.releaseConnection(first, database.dataSource());
            }
        }
    }
    @Configuration(proxyBeanMethods = false) @Import(TxInfrastructure.class)
    public static class Config {
        @Bean Ledger ledger(LabDatabase database) { return new Ledger(database); }
    }
    public static void main(String[] args) throws Exception {
        try (var context = new AnnotationConfigApplicationContext(Config.class)) {
            LabDatabase database = context.getBean(LabDatabase.class);
            Ledger ledger = context.getBean(Ledger.class);
            Evidence evidence = ledger.write(1, false);
            System.out.println("active=" + evidence.active());
            System.out.println("sameConnection=" + evidence.sameConnection());
            System.out.println("autoCommit=" + evidence.autoCommit());
            System.out.println("afterCommit=" + database.count());
            try { ledger.write(2, true); } catch (IllegalStateException expected) { }
            System.out.println("afterRollback=" + database.count());
            System.out.println("resourceAfter=" + TransactionSynchronizationManager.hasResource(database.dataSource()));
        }
    }
}
