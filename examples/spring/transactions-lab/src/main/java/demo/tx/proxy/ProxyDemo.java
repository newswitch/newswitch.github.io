package demo.tx.proxy;

import java.util.ArrayList;
import java.util.List;
import org.aopalliance.intercept.MethodInterceptor;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.aop.support.AopUtils;

public class ProxyDemo {
    public interface Task { void outer(); void inner(); }
    public static class TaskService implements Task {
        private final List<String> log;
        public TaskService(List<String> log) { this.log = log; }
        public void outer() { log.add("target:outer"); inner(); }
        public void inner() { log.add("target:inner"); }
    }
    public static void main(String[] args) {
        for (boolean classProxy : new boolean[] {false, true}) {
            List<String> log = new ArrayList<>();
            ProxyFactory factory = new ProxyFactory(new TaskService(log));
            factory.setProxyTargetClass(classProxy);
            factory.addAdvice((MethodInterceptor) invocation -> {
                log.add("advice:" + invocation.getMethod().getName());
                return invocation.proceed();
            });
            Task proxy = (Task) factory.getProxy();
            proxy.outer();
            String kind = classProxy ? "cglib" : "jdk";
            System.out.println(kind + "=" + String.join(",", log));
            System.out.println(kind + "Type=" + (classProxy ? AopUtils.isCglibProxy(proxy) : AopUtils.isJdkDynamicProxy(proxy)));
        }
    }
}
