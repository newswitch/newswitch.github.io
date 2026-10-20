package io.newswitch.greeting;

import org.junit.jupiter.api.*;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.FilteredClassLoader;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.context.annotation.*;
import static org.junit.jupiter.api.Assertions.*;

@Timeout(10)
class GreetingAutoConfigurationTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withConfiguration(AutoConfigurations.of(GreetingAutoConfiguration.class));
    @Test void createsDefaultService() {
        runner.run(context -> { assertNull(context.getStartupFailure()); assertEquals("hello, Java", context.getBean(GreetingService.class).greet("Java")); });
    }
    @Test void bindsConfiguredPrefix() {
        runner.withPropertyValues("newswitch.greeting.prefix=hi").run(context -> {
            assertNull(context.getStartupFailure()); assertEquals("hi, Java", context.getBean(GreetingService.class).greet("Java"));
        });
    }
    @Test void disabledFeatureCreatesNoServiceOrProperties() {
        runner.withPropertyValues("newswitch.greeting.enabled=false").run(context -> {
            assertNull(context.getStartupFailure()); assertTrue(context.getBeansOfType(GreetingService.class).isEmpty());
            assertTrue(context.getBeansOfType(GreetingProperties.class).isEmpty());
        });
    }
    @Configuration(proxyBeanMethods = false) static class Custom {
        @Bean GreetingService customGreeting() { return name -> "custom:" + name; }
    }
    @Test void userServiceMakesDefaultBackOff() {
        runner.withUserConfiguration(Custom.class).run(context -> {
            assertNull(context.getStartupFailure()); assertEquals(1, context.getBeansOfType(GreetingService.class).size());
            assertFalse(context.containsBean("greetingService")); assertEquals("custom:Java", context.getBean(GreetingService.class).greet("Java"));
        });
    }
    @Test void missingApiPreventsConfiguration() {
        runner.withClassLoader(new FilteredClassLoader(GreetingService.class)).run(context -> {
            assertNull(context.getStartupFailure()); assertFalse(context.containsBean("greetingService"));
        });
    }
    @Test void blankPrefixFailsBindingValidation() {
        runner.withPropertyValues("newswitch.greeting.prefix=").run(context -> assertNotNull(context.getStartupFailure()));
    }
}
