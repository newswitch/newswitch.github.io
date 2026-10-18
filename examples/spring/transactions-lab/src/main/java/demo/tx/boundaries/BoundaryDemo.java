package demo.tx.boundaries;

import java.io.IOException;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import demo.tx.support.LabDatabase;
import demo.tx.support.TxInfrastructure;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronizationManager;

public class BoundaryDemo {
    public static class Service {
        private final LabDatabase database;
        public Service(LabDatabase database) { this.database = database; }
        @Transactional public boolean probe() { return TransactionSynchronizationManager.isActualTransactionActive(); }
        public boolean selfProbe() { return probe(); }
        @Transactional public boolean threadProbe() throws Exception {
            var executor = Executors.newSingleThreadExecutor();
            try {
                return executor.submit(TransactionSynchronizationManager::isActualTransactionActive).get(3, TimeUnit.SECONDS);
            } finally {
                executor.shutdownNow();
                if (!executor.awaitTermination(3, TimeUnit.SECONDS)) throw new IllegalStateException("worker did not stop");
            }
        }
        @Transactional public void checkedDefault() throws IOException {
            database.insert(1, "checked"); throw new IOException("checked failure");
        }
        @Transactional(rollbackFor = IOException.class) public void checkedRollback() throws IOException {
            database.insert(2, "checked"); throw new IOException("checked failure");
        }
        @Transactional public void swallowed() {
            database.insert(3, "swallowed");
            try { throw new IllegalStateException("local failure"); } catch (IllegalStateException expected) { }
        }
    }
    @Configuration(proxyBeanMethods = false) @Import(TxInfrastructure.class)
    public static class Config {
        @Bean Service service(LabDatabase database) { return new Service(database); }
    }
    public static void main(String[] args) throws Exception {
        try (var context = new AnnotationConfigApplicationContext(Config.class)) {
            LabDatabase database = context.getBean(LabDatabase.class);
            Service service = context.getBean(Service.class);
            System.out.println("proxy=" + service.probe());
            System.out.println("self=" + service.selfProbe());
            System.out.println("manual=" + new Service(database).probe());
            System.out.println("thread=" + service.threadProbe());
            try { service.checkedDefault(); } catch (IOException expected) { }
            System.out.println("checkedDefaultRows=" + database.count());
            database.clear();
            try { service.checkedRollback(); } catch (IOException expected) { }
            System.out.println("checkedRollbackRows=" + database.count());
            service.swallowed();
            System.out.println("swallowedRows=" + database.count());
            System.out.println("resourceAfter=" + TransactionSynchronizationManager.hasResource(database.dataSource()));
        }
    }
}
