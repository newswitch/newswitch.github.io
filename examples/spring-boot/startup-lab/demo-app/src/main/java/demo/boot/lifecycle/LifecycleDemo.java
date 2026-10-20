package demo.boot.lifecycle;

import org.springframework.boot.*;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.availability.*;
import org.springframework.boot.context.event.*;
import org.springframework.boot.web.server.servlet.context.ServletWebServerInitializedEvent;
import org.springframework.context.annotation.*;
import org.springframework.core.annotation.Order;
import java.util.*;

public final class LifecycleDemo {
    public static class Trace { public final List<String> stages = new ArrayList<>(); }
    @SpringBootConfiguration @EnableAutoConfiguration
    public static class Config {
        @Bean @Order(1) public ApplicationRunner applicationRunner(Trace trace) {
            return args -> trace.stages.add("applicationRunner");
        }
        @Bean @Order(2) public CommandLineRunner commandLineRunner(Trace trace) {
            return args -> trace.stages.add("commandLineRunner");
        }
    }
    public static org.springframework.context.ConfigurableApplicationContext start(Trace trace, String... args) {
        var app = new SpringApplication(Config.class);
        app.addInitializers(context -> context.getBeanFactory().registerSingleton("trace", trace));
        app.addListeners(event -> {
            String stage = switch (event) {
                case ApplicationStartingEvent ignored -> "starting";
                case ApplicationEnvironmentPreparedEvent ignored -> "environment";
                case ApplicationContextInitializedEvent ignored -> "contextInitialized";
                case ApplicationPreparedEvent ignored -> "prepared";
                case ServletWebServerInitializedEvent ignored -> "webServer";
                case ApplicationStartedEvent ignored -> "started";
                case ApplicationReadyEvent ignored -> "ready";
                default -> null;
            };
            if (stage != null) trace.stages.add(stage);
        });
        return app.run(args);
    }
    public static void main(String[] args) {
        var trace = new Trace();
        try (var context = start(trace, args)) {
            System.out.println("stages=" + String.join(",", trace.stages));
            System.out.println("readiness=" + context.getBean(ApplicationAvailability.class).getReadinessState());
        }
    }
}
