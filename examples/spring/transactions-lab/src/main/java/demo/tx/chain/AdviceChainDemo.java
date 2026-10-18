package demo.tx.chain;

import java.util.ArrayList;
import java.util.List;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.EnableAspectJAutoProxy;
import org.springframework.core.annotation.Order;

public class AdviceChainDemo {
    public static class Log { public final List<String> events = new ArrayList<>(); }
    public static class TaskService {
        private final Log log;
        public TaskService(Log log) { this.log = log; }
        public String run(boolean fail) {
            log.events.add("target");
            if (fail) throw new IllegalStateException("task failed");
            return "done";
        }
    }
    public static Object invoke(String name, Log log, ProceedingJoinPoint point) throws Throwable {
        log.events.add(name + ":before");
        try {
            Object result = point.proceed();
            log.events.add(name + ":return");
            return result;
        } catch (Throwable error) {
            log.events.add(name + ":throw");
            throw error;
        } finally {
            log.events.add(name + ":finally");
        }
    }
    @Aspect @Order(10)
    public static class OuterAspect {
        private final Log log;
        public OuterAspect(Log log) { this.log = log; }
        @Around("execution(* demo.tx.chain.AdviceChainDemo.TaskService.run(..))")
        public Object around(ProceedingJoinPoint point) throws Throwable { return invoke("outer", log, point); }
    }
    @Aspect @Order(20)
    public static class InnerAspect {
        private final Log log;
        public InnerAspect(Log log) { this.log = log; }
        @Around("execution(* demo.tx.chain.AdviceChainDemo.TaskService.run(..))")
        public Object around(ProceedingJoinPoint point) throws Throwable { return invoke("inner", log, point); }
    }
    @Configuration(proxyBeanMethods = false) @EnableAspectJAutoProxy
    public static class Config {
        @Bean Log log() { return new Log(); }
        @Bean TaskService taskService(Log log) { return new TaskService(log); }
        @Bean OuterAspect outer(Log log) { return new OuterAspect(log); }
        @Bean InnerAspect inner(Log log) { return new InnerAspect(log); }
    }
    public static void main(String[] args) {
        try (var context = new AnnotationConfigApplicationContext(Config.class)) {
            Log log = context.getBean(Log.class);
            TaskService service = context.getBean(TaskService.class);
            service.run(false);
            System.out.println("success=" + String.join(",", log.events));
            log.events.clear();
            try { service.run(true); } catch (IllegalStateException expected) { }
            System.out.println("failure=" + String.join(",", log.events));
        }
    }
}
