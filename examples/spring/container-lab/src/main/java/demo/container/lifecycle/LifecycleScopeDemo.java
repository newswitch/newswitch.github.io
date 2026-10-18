package demo.container.lifecycle;

import java.util.ArrayList;
import java.util.List;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.BeanNameAware;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.InitializingBean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Scope;

public class LifecycleScopeDemo {
    public static class Trace { public final List<String> events = new ArrayList<>(); }
    public static class ManagedResource implements BeanNameAware, InitializingBean, DisposableBean {
        private final Trace trace;
        public ManagedResource(Trace trace) { this.trace = trace; trace.events.add("construct"); }
        @Autowired public void injected(Trace trace) { trace.events.add("inject"); }
        public void setBeanName(String name) { trace.events.add("aware"); }
        @PostConstruct public void prepare() { trace.events.add("postConstruct"); }
        public void afterPropertiesSet() { trace.events.add("afterPropertiesSet"); }
        public void customInit() { trace.events.add("customInit"); }
        @PreDestroy public void release() { trace.events.add("preDestroy"); }
        public void destroy() { trace.events.add("destroy"); }
        public void customDestroy() { trace.events.add("customDestroy"); }
    }
    public static class TemporaryResource implements AutoCloseable {
        private boolean closed;
        public boolean isClosed() { return closed; }
        public void close() { closed = true; }
    }
    @Configuration(proxyBeanMethods = false)
    public static class Config {
        @Bean Trace trace() { return new Trace(); }
        @Bean(initMethod = "customInit", destroyMethod = "customDestroy")
        ManagedResource resource(Trace trace) { return new ManagedResource(trace); }
        @Bean @Scope("prototype")
        TemporaryResource temporaryResource() { return new TemporaryResource(); }
    }

    public static void main(String[] args) {
        Trace trace;
        TemporaryResource first = null;
        TemporaryResource second = null;
        try {
            try (var context = new AnnotationConfigApplicationContext(Config.class)) {
                trace = context.getBean(Trace.class);
                System.out.println("initialized=" + String.join(",", trace.events));
                System.out.println("singletonSame=" + (context.getBean(ManagedResource.class) == context.getBean(ManagedResource.class)));
                first = context.getBean(TemporaryResource.class);
                second = context.getBean(TemporaryResource.class);
                System.out.println("prototypeDifferent=" + (first != second));
                trace.events.clear();
            }
            System.out.println("destroyed=" + String.join(",", trace.events));
            System.out.println("prototypeClosedByContext=" + first.isClosed());
        } finally {
            if (first != null) first.close();
            if (second != null) second.close();
        }
        System.out.println("manuallyClosed=" + (first.isClosed() && second.isClosed()));
    }
}
