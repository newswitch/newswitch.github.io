package demo.boot.conditions;

import io.newswitch.greeting.*;
import org.springframework.boot.*;
import org.springframework.boot.autoconfigure.*;
import org.springframework.boot.autoconfigure.condition.ConditionEvaluationReport;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.*;

public final class AutoConfigDemo {
    @SpringBootConfiguration @EnableAutoConfiguration public static class Defaults {}
    @Configuration(proxyBeanMethods = false) public static class Custom {
        @Bean public GreetingService customGreeting() { return name -> "custom:" + name; }
    }
    public static ConfigurableApplicationContext start(Class<?> extra, String... args) {
        var builder = new SpringApplicationBuilder(Defaults.class).web(WebApplicationType.NONE);
        if (extra != null) builder.sources(extra);
        return builder.run(args);
    }
    public static boolean defaultMatches(ConfigurableApplicationContext context) {
        var outcomes = ConditionEvaluationReport.get(context.getBeanFactory()).getConditionAndOutcomesBySource()
                .get(GreetingAutoConfiguration.class.getName() + "#greetingService");
        return outcomes != null && outcomes.isFullMatch();
    }
    public static void main(String[] args) {
        try (var context = start(null)) {
            System.out.println("default=" + context.getBean(GreetingService.class).greet("Spring"));
            System.out.println("defaultMatch=" + defaultMatches(context));
        }
        try (var context = start(Custom.class)) {
            System.out.println("custom=" + context.getBean(GreetingService.class).greet("Spring"));
            System.out.println("defaultMatch=" + defaultMatches(context));
        }
        try (var context = start(null, "--newswitch.greeting.enabled=false")) {
            System.out.println("disabledCount=" + context.getBeansOfType(GreetingService.class).size());
        }
    }
}
