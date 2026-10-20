package demo.boot.properties;

import org.springframework.boot.*;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.core.env.ConfigurableEnvironment;

public final class PropertyDemo {
    @SpringBootConfiguration @EnableAutoConfiguration @EnableConfigurationProperties(ClientProperties.class)
    public static class Config {}
    public static ConfigurableApplicationContext start(String... args) {
        return new SpringApplicationBuilder(Config.class).web(WebApplicationType.NONE)
                .properties("lab.client.timeout=10s").run(args);
    }
    public static String source(ConfigurableEnvironment environment, String key) {
        for (var propertySource : environment.getPropertySources()) {
            if (!propertySource.getName().equals("configurationProperties") && propertySource.containsProperty(key))
                return propertySource.getName();
        }
        return "missing";
    }
    public static void main(String[] args) {
        try (var context = start("--spring.profiles.active=dev", "--lab.client.timeout=750ms", "--lab.client.max-in-flight=4")) {
            var properties = context.getBean(ClientProperties.class);
            System.out.println("profiles=" + String.join(",", context.getEnvironment().getActiveProfiles()));
            System.out.println("timeoutMs=" + properties.timeout().toMillis());
            System.out.println("maxInFlight=" + properties.maxInFlight());
            System.out.println("source=" + source(context.getEnvironment(), "lab.client.timeout"));
        }
    }
}
