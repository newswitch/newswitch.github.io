package demo.container.events;

import java.util.ArrayList;
import java.util.List;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.context.SmartLifecycle;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.event.ContextClosedEvent;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.context.event.EventListener;

public class EventsDemo {
    public record TaskAccepted(int id) { }
    public static class EventLog { public final List<String> events = new ArrayList<>(); }
    public static class Handler {
        private final EventLog log;
        public Thread taskThread;
        public Handler(EventLog log) { this.log = log; }
        @EventListener public void refreshed(ContextRefreshedEvent event) { log.events.add("context:refreshed"); }
        @EventListener public void closed(ContextClosedEvent event) { log.events.add("context:closed"); }
        @EventListener public void accepted(TaskAccepted event) {
            taskThread = Thread.currentThread();
            log.events.add("event:" + event.id());
        }
    }
    public static class Worker implements SmartLifecycle, DisposableBean {
        private final EventLog log;
        private boolean running;
        public Worker(EventLog log) { this.log = log; }
        public void start() { running = true; log.events.add("worker:start"); }
        public void stop() { running = false; log.events.add("worker:stop"); }
        public void stop(Runnable callback) {
            try { stop(); } finally { callback.run(); }
        }
        public boolean isRunning() { return running; }
        public boolean isAutoStartup() { return true; }
        public int getPhase() { return 100; }
        public void destroy() { log.events.add("worker:destroy"); }
    }
    @Configuration(proxyBeanMethods = false)
    public static class Config {
        @Bean EventLog eventLog() { return new EventLog(); }
        @Bean Handler handler(EventLog log) { return new Handler(log); }
        @Bean Worker worker(EventLog log) { return new Worker(log); }
    }

    public static void main(String[] args) {
        EventLog log;
        try (var context = new AnnotationConfigApplicationContext(Config.class)) {
            log = context.getBean(EventLog.class);
            System.out.println("startup=" + String.join(",", log.events));
            log.events.clear();
            log.events.add("before");
            context.publishEvent(new TaskAccepted(7));
            log.events.add("after");
            System.out.println("publish=" + String.join(",", log.events));
            System.out.println("listenerOnCaller=" + (context.getBean(Handler.class).taskThread == Thread.currentThread()));
            log.events.clear();
        }
        System.out.println("shutdown=" + String.join(",", log.events));
    }
}
