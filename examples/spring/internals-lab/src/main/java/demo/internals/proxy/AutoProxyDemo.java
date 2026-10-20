package demo.internals.proxy;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.*;
import org.springframework.aop.support.AopUtils;
import org.springframework.context.annotation.*;
import java.util.*;

public final class AutoProxyDemo {
    public static class Trace { public final List<String> events = new ArrayList<>(); }
    public interface Operations { String inner(); String outer(); void fail(); }
    public static class Work implements Operations {
        private final Trace trace;
        public Work(Trace trace) { this.trace = trace; }
        @Override public String inner() { trace.events.add("target:inner"); return "ok"; }
        @Override public String outer() { trace.events.add("target:outer"); return inner(); }
        @Override public void fail() { trace.events.add("target:fail"); throw new IllegalStateException("failed"); }
    }
    public static class Plain {}
    @Aspect public static class Around {
        private final Trace trace;
        public Around(Trace trace) { this.trace = trace; }
        @org.aspectj.lang.annotation.Around("execution(* demo.internals.proxy.AutoProxyDemo.Work.*(..))")
        public Object invoke(ProceedingJoinPoint call) throws Throwable {
            String method = call.getSignature().getName();
            trace.events.add("before:" + method);
            try { return call.proceed(); } finally { trace.events.add("after:" + method); }
        }
    }
    @Configuration(proxyBeanMethods = false) @EnableAspectJAutoProxy(proxyTargetClass = false)
    public static class Config {
        @Bean public Trace trace() { return new Trace(); }
        @Bean public Operations work(Trace trace) { return new Work(trace); }
        @Bean public Around around(Trace trace) { return new Around(trace); }
        @Bean public Plain plain() { return new Plain(); }
    }
    public static void main(String[] args) {
        try (var context = new AnnotationConfigApplicationContext(Config.class)) {
            var work = context.getBean(Operations.class); var trace = context.getBean(Trace.class);
            System.out.println("jdkProxy=" + AopUtils.isJdkDynamicProxy(work));
            work.inner(); System.out.println("external=" + String.join(",", trace.events));
            trace.events.clear(); work.outer();
            System.out.println("selfCall=" + String.join(",", trace.events));
            System.out.println("plainProxy=" + AopUtils.isAopProxy(context.getBean(Plain.class)));
        }
    }
}
