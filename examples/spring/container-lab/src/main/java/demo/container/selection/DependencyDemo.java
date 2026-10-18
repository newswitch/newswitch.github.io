package demo.container.selection;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Primary;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

public class DependencyDemo {
    public interface TaskExecutor {
        String name();
        default String execute(String task) { return name() + ":" + task; }
    }
    public interface OptionalReporter { }

    @Component("localExecutor") @Order(20)
    public static class LocalExecutor implements TaskExecutor {
        public String name() { return "local"; }
    }
    @Component("remoteExecutor") @Primary @Order(10)
    public static class RemoteExecutor implements TaskExecutor {
        public String name() { return "remote"; }
    }
    @Component
    public static class Dispatcher {
        final TaskExecutor selected;
        final TaskExecutor local;
        final List<TaskExecutor> all;
        final Map<String, TaskExecutor> named;
        final ObjectProvider<OptionalReporter> reporter;
        public Dispatcher(TaskExecutor selected,
                          @Qualifier("localExecutor") TaskExecutor local,
                          List<TaskExecutor> all, Map<String, TaskExecutor> named,
                          ObjectProvider<OptionalReporter> reporter) {
            this.selected = selected; this.local = local;
            this.all = all; this.named = named; this.reporter = reporter;
        }
    }
    @Configuration(proxyBeanMethods = false)
    @ComponentScan(basePackageClasses = DependencyDemo.class)
    public static class Config { }

    public static void main(String[] args) {
        try (var context = new AnnotationConfigApplicationContext(Config.class)) {
            Dispatcher d = context.getBean(Dispatcher.class);
            System.out.println("primary=" + d.selected.execute("job"));
            System.out.println("qualified=" + d.local.execute("job"));
            System.out.println("ordered=" + d.all.stream().map(TaskExecutor::name).collect(Collectors.joining(",")));
            System.out.println("names=" + d.named.keySet().stream().sorted().collect(Collectors.joining(",")));
            System.out.println("missing=" + (d.reporter.getIfAvailable() == null));
        }
    }
}
