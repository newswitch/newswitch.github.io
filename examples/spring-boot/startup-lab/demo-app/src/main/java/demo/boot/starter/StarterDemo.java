package demo.boot.starter;

import io.newswitch.greeting.*;
import org.springframework.boot.*;
import org.springframework.boot.autoconfigure.EnableAutoConfiguration;
import org.springframework.boot.builder.SpringApplicationBuilder;

public final class StarterDemo {
    @SpringBootConfiguration @EnableAutoConfiguration public static class Consumer {}
    public static void main(String[] args) {
        try (var context = new SpringApplicationBuilder(Consumer.class).web(WebApplicationType.NONE)
                .run("--newswitch.greeting.prefix=welcome")) {
            System.out.println("greeting=" + context.getBean(GreetingService.class).greet("Spring"));
            System.out.println("autoConfigCount=" + context.getBeansOfType(GreetingAutoConfiguration.class).size());
            System.out.println("serviceCount=" + context.getBeansOfType(GreetingService.class).size());
        }
    }
}
