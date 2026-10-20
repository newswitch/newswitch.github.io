package demo.internals.refresh;

import org.springframework.beans.factory.*;
import org.springframework.beans.factory.config.ConfigurableListableBeanFactory;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.event.ContextRefreshedEvent;
import java.util.*;

public final class RefreshDemo {
    public static class Resource implements InitializingBean, DisposableBean {
        private final List<String> events;
        public Resource(List<String> events) { this.events = events; events.add("construct"); }
        @Override public void afterPropertiesSet() { events.add("init"); }
        @Override public void destroy() { events.add("destroy"); }
    }
    public static class TracingContext extends AnnotationConfigApplicationContext {
        private final List<String> events;
        public TracingContext(List<String> events) { this.events = events; }
        @Override protected void postProcessBeanFactory(ConfigurableListableBeanFactory factory) {
            events.add("factoryHook"); super.postProcessBeanFactory(factory);
        }
        @Override protected void onRefresh() { events.add("onRefresh"); super.onRefresh(); }
        @Override protected void finishBeanFactoryInitialization(ConfigurableListableBeanFactory factory) {
            events.add("instantiate"); super.finishBeanFactoryInitialization(factory);
        }
    }
    public static void main(String[] args) {
        var events = new ArrayList<String>();
        try (var context = new TracingContext(events)) {
            context.addBeanFactoryPostProcessor(factory -> events.add("factoryProcessor"));
            context.registerBean("resource", Resource.class, () -> new Resource(events));
            context.addApplicationListener(event -> {
                if (event instanceof ContextRefreshedEvent) events.add("refreshedEvent");
            });
            context.refresh();
            System.out.println("phases=" + String.join(",", events));
            System.out.println("active=" + context.isActive());
        }
        System.out.println("last=" + events.getLast());
    }
}
