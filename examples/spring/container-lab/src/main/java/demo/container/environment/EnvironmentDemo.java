package demo.container.environment;

import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Condition;
import org.springframework.context.annotation.ConditionContext;
import org.springframework.context.annotation.Conditional;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.context.annotation.PropertySource;
import org.springframework.context.support.PropertySourcesPlaceholderConfigurer;
import org.springframework.core.env.MapPropertySource;
import org.springframework.core.type.AnnotatedTypeMetadata;

public class EnvironmentDemo {
    public record Settings(String name, int capacity) {
        public Settings {
            if (capacity < 1) throw new IllegalArgumentException("capacity must be positive");
        }
    }
    public record Transport(String name) { }
    public static class AuditEnabled implements Condition {
        public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
            return context.getEnvironment().getProperty("feature.audit", Boolean.class, false);
        }
    }
    @Configuration(proxyBeanMethods = false)
    @PropertySource("classpath:container.properties")
    public static class Config {
        @Bean static PropertySourcesPlaceholderConfigurer placeholders() {
            return new PropertySourcesPlaceholderConfigurer();
        }
        @Bean Settings settings(@Value("${task.name}") String name,
                                @Value("${task.capacity}") int capacity) {
            return new Settings(name, capacity);
        }
        @Bean @Profile("dev") Transport devTransport() { return new Transport("dev"); }
        @Bean @Profile("prod") Transport prodTransport() { return new Transport("prod"); }
        @Bean @Conditional(AuditEnabled.class) String auditMarker() { return "enabled"; }
    }
    public static void main(String[] args) {
        try (var context = new AnnotationConfigApplicationContext()) {
            context.getEnvironment().getPropertySources().addFirst(
                    new MapPropertySource("experiment", Map.of("task.capacity", "16", "feature.audit", "true")));
            context.getEnvironment().setActiveProfiles("prod");
            context.register(Config.class);
            context.refresh();
            Settings settings = context.getBean(Settings.class);
            System.out.println("name=" + settings.name());
            System.out.println("capacity=" + settings.capacity());
            System.out.println("transport=" + context.getBean(Transport.class).name());
            System.out.println("audit=" + context.containsBean("auditMarker"));
        }
    }
}
