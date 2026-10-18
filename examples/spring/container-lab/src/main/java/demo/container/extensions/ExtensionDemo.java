package demo.container.extensions;

import org.springframework.beans.factory.FactoryBean;
import org.springframework.beans.factory.config.BeanFactoryPostProcessor;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

public class ExtensionDemo {
    public interface Greeting { String value(); }
    public static class Settings {
        private String label = "original";
        public String getLabel() { return label; }
        public void setLabel(String label) { this.label = label; }
    }
    public static class GreetingFactory implements FactoryBean<Greeting> {
        public Greeting getObject() { return () -> "factory"; }
        public Class<?> getObjectType() { return Greeting.class; }
        public boolean isSingleton() { return true; }
    }
    @Configuration(proxyBeanMethods = false)
    public static class Config {
        @Bean Settings settings() { return new Settings(); }
        @Bean GreetingFactory greeting() { return new GreetingFactory(); }
        @Bean static BeanFactoryPostProcessor definitions() {
            return factory -> factory.getBeanDefinition("settings")
                    .getPropertyValues().add("label", "changed");
        }
        @Bean static BeanPostProcessor decorator() {
            return new BeanPostProcessor() {
                @Override public Object postProcessAfterInitialization(Object bean, String name) {
                    if (bean instanceof Greeting greeting) {
                        return (Greeting) () -> "[" + greeting.value() + "]";
                    }
                    return bean;
                }
            };
        }
    }
    public static void main(String[] args) {
        try (var context = new AnnotationConfigApplicationContext(Config.class)) {
            System.out.println("definition=" + context.getBean(Settings.class).getLabel());
            Greeting product = context.getBean("greeting", Greeting.class);
            System.out.println("product=" + product.value());
            System.out.println("productSame=" + (product == context.getBean("greeting")));
            System.out.println("factory=" + (context.getBean("&greeting") instanceof GreetingFactory));
        }
    }
}
