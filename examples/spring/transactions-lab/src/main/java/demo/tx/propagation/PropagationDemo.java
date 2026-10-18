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
