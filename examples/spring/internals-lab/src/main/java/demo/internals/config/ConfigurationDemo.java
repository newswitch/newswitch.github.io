package demo.internals.config;

import org.springframework.beans.factory.support.*;
import org.springframework.context.annotation.*;
import org.springframework.core.type.AnnotationMetadata;
import org.springframework.core.type.AnnotatedTypeMetadata;
import java.lang.annotation.*;

public final class ConfigurationDemo {
    @Retention(RetentionPolicy.RUNTIME) @Target(ElementType.TYPE)
    @Import({ModeSelector.class, MarkerRegistrar.class})
    public @interface EnableGreeting { boolean upper() default false; }
    public static class ModeSelector implements ImportSelector {
        @Override public String[] selectImports(AnnotationMetadata metadata) {
            var attributes = metadata.getAnnotationAttributes(EnableGreeting.class.getName());
            return new String[]{Boolean.TRUE.equals(attributes.get("upper"))
                    ? Upper.class.getName() : Plain.class.getName()};
        }
    }
    public static class Marker {}
    public static class MarkerRegistrar implements ImportBeanDefinitionRegistrar {
        @Override public void registerBeanDefinitions(AnnotationMetadata metadata, BeanDefinitionRegistry registry) {
            registry.registerBeanDefinition("marker", new RootBeanDefinition(Marker.class));
        }
    }
    public static class Enabled implements Condition {
        @Override public boolean matches(ConditionContext context, AnnotatedTypeMetadata metadata) {
            return context.getEnvironment().getProperty("feature.enabled", Boolean.class, true);
        }
    }
    public record Greeting(String text) {}
    @Configuration(proxyBeanMethods = false) @Conditional(Enabled.class)
    public static class Upper { @Bean public Greeting greeting() { return new Greeting("HELLO"); } }
    @Configuration(proxyBeanMethods = false) @Conditional(Enabled.class)
    public static class Plain { @Bean public Greeting greeting() { return new Greeting("hello"); } }
    @Configuration(proxyBeanMethods = false) @EnableGreeting(upper = true)
    public static class EnabledConfig {}
    public static class Token {}
    public record Holder(Token token) {}
    @Configuration public static class Full {
        @Bean public Token token() { return new Token(); }
        @Bean public Holder holder() { return new Holder(token()); }
    }
    @Configuration(proxyBeanMethods = false) public static class Lite {
        @Bean public Token token() { return new Token(); }
        @Bean public Holder holder() { return new Holder(token()); }
    }
    public static boolean sameToken(Class<?> config) {
        try (var context = new AnnotationConfigApplicationContext(config)) {
            return context.getBean(Token.class) == context.getBean(Holder.class).token();
        }
    }
    public static void main(String[] args) {
        try (var context = new AnnotationConfigApplicationContext(EnabledConfig.class)) {
            System.out.println("greeting=" + context.getBean(Greeting.class).text());
            System.out.println("marker=" + context.containsBean("marker"));
        }
        System.out.println("fullSame=" + sameToken(Full.class));
        System.out.println("liteSame=" + sameToken(Lite.class));
    }
}
