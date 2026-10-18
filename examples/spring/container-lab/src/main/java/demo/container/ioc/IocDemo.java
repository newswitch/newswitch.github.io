package demo.container.ioc;

import java.util.Objects;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;

public class IocDemo {
    public interface TaskExecutor { String execute(String task); }

    public static final class TaskService {
        private final TaskExecutor executor;
        public TaskService(TaskExecutor executor) {
            this.executor = Objects.requireNonNull(executor);
        }
        public String submit(String task) {
            if (task == null || task.isBlank()) throw new IllegalArgumentException("task required");
            return executor.execute(task.strip());
        }
    }

    @Configuration(proxyBeanMethods = false)
    public static class ServiceConfig {
        @Bean TaskService taskService(TaskExecutor executor) { return new TaskService(executor); }
    }
    @Configuration(proxyBeanMethods = false)
    @Import(ServiceConfig.class)
    public static class LocalConfig {
        @Bean TaskExecutor executor() { return task -> "local:" + task; }
    }
    @Configuration(proxyBeanMethods = false)
    @Import(ServiceConfig.class)
    public static class RemoteConfig {
        @Bean TaskExecutor executor() { return task -> "remote:" + task; }
    }

    public static void main(String[] args) {
        TaskService manual = new TaskService(task -> "local:" + task);
        System.out.println("manual=" + manual.submit(" report "));
        try (var context = new AnnotationConfigApplicationContext(LocalConfig.class)) {
            System.out.println("managed=" + context.getBean(TaskService.class).submit("report"));
        }
        try (var context = new AnnotationConfigApplicationContext(RemoteConfig.class)) {
            System.out.println("swapped=" + context.getBean(TaskService.class).submit("report"));
        }
    }
}
