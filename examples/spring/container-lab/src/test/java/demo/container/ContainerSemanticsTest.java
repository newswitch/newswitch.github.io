package demo.container;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.BeansException;
import org.springframework.beans.factory.NoSuchBeanDefinitionException;
import org.springframework.beans.factory.NoUniqueBeanDefinitionException;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.support.DefaultListableBeanFactory;
import org.springframework.beans.factory.support.RootBeanDefinition;
import org.springframework.context.PayloadApplicationEvent;
import org.springframework.context.SmartLifecycle;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Scope;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.context.support.PropertySourcesPlaceholderConfigurer;
import org.springframework.core.env.MapPropertySource;
import demo.container.definitions.DefinitionDemo.QueueSettings;
import demo.container.environment.EnvironmentDemo;
import demo.container.events.EventsDemo;
import demo.container.extensions.ExtensionDemo;
import demo.container.ioc.IocDemo;
import demo.container.lifecycle.LifecycleScopeDemo;
import demo.container.selection.DependencyDemo;
import static org.junit.jupiter.api.Assertions.*;

class ContainerSemanticsTest {
    @Test void manualInjectionAndInputNormalization() {
        var service = new IocDemo.TaskService(task -> "test:" + task);
        assertEquals("test:report", service.submit(" report "));
    }

    @ParameterizedTest @NullAndEmptySource @ValueSource(strings = {" ", "\t"})
    void invalidTaskRejected(String task) {
        var service = new IocDemo.TaskService(value -> value);
        assertThrows(IllegalArgumentException.class, () -> service.submit(task));
    }

    @Test void requiredDependencyRejectedWhenNull() {
        assertThrows(NullPointerException.class, () -> new IocDemo.TaskService(null));
    }

    @Test void missingDependencyFailsRefresh() {
        try (var context = new AnnotationConfigApplicationContext()) {
            context.register(IocDemo.ServiceConfig.class);
            BeansException error = assertThrows(BeansException.class, context::refresh);
            assertInstanceOf(NoSuchBeanDefinitionException.class, rootCause(error));
        }
    }

    @Test void ambiguousDependencyFailsRefresh() {
        try (var context = new AnnotationConfigApplicationContext()) {
            context.register(IocDemo.ServiceConfig.class);
            context.registerBean("left", IocDemo.TaskExecutor.class, () -> task -> task);
            context.registerBean("right", IocDemo.TaskExecutor.class, () -> task -> task);
            BeansException error = assertThrows(BeansException.class, context::refresh);
            assertInstanceOf(NoUniqueBeanDefinitionException.class, rootCause(error));
        }
    }

    @Test void primaryDoesNotRemoveOtherCandidates() {
        try (var context = new AnnotationConfigApplicationContext(DependencyDemo.Config.class)) {
            assertEquals("remote", context.getBean(DependencyDemo.TaskExecutor.class).name());
            assertEquals(2, context.getBeansOfType(DependencyDemo.TaskExecutor.class).size());
        }
    }

    @Test void providerAvailabilityDoesNotSuppressAmbiguity() {
        var factory = new DefaultListableBeanFactory();
        factory.registerSingleton("left", (IocDemo.TaskExecutor) task -> task);
        factory.registerSingleton("right", (IocDemo.TaskExecutor) task -> task);
        var provider = factory.getBeanProvider(IocDemo.TaskExecutor.class);
        assertThrows(NoUniqueBeanDefinitionException.class, provider::getIfAvailable);
        assertNull(provider.getIfUnique());
    }

    @Test void lazyDefinitionAndInstanceAreSeparate() {
        try (var context = new GenericApplicationContext()) {
            var definition = new RootBeanDefinition(QueueSettings.class);
            definition.setLazyInit(true);
            definition.getPropertyValues().add("capacity", 4);
            context.registerBeanDefinition("settings", definition);
            context.refresh();
            assertTrue(context.containsBeanDefinition("settings"));
            assertFalse(context.getBeanFactory().containsSingleton("settings"));
            assertEquals(4, context.getBean(QueueSettings.class).getCapacity());
            assertTrue(context.getBeanFactory().containsSingleton("settings"));
        }
    }

    @Test void eagerDependencyCanTriggerLazyBean() {
        try (var context = new GenericApplicationContext()) {
            var definition = new RootBeanDefinition(QueueSettings.class);
            definition.setLazyInit(true);
            definition.getPropertyValues().add("capacity", 4);
            context.registerBeanDefinition("settings", definition);
            context.registerBean("consumer", Object.class, () -> List.of(context.getBean(QueueSettings.class)));
            context.refresh();
            assertTrue(context.getBeanFactory().containsSingleton("settings"));
        }
    }

    @Test void lifecycleCallbacksHaveObservedOrder() {
        LifecycleScopeDemo.Trace trace;
        try (var context = new AnnotationConfigApplicationContext(LifecycleScopeDemo.Config.class)) {
            trace = context.getBean(LifecycleScopeDemo.Trace.class);
            assertEquals(List.of("construct", "inject", "aware", "postConstruct", "afterPropertiesSet", "customInit"), trace.events);
            trace.events.clear();
        }
        assertEquals(List.of("preDestroy", "destroy", "customDestroy"), trace.events);
    }

    @Test void prototypeNeedsItsOwnCloser() {
        LifecycleScopeDemo.TemporaryResource first;
        LifecycleScopeDemo.TemporaryResource second;
        try (var context = new AnnotationConfigApplicationContext(LifecycleScopeDemo.Config.class)) {
            first = context.getBean(LifecycleScopeDemo.TemporaryResource.class);
            second = context.getBean(LifecycleScopeDemo.TemporaryResource.class);
            assertNotSame(first, second);
            assertSame(context.getBean(LifecycleScopeDemo.ManagedResource.class), context.getBean(LifecycleScopeDemo.ManagedResource.class));
        }
        try (first; second) {
            assertFalse(first.isClosed());
            assertFalse(second.isClosed());
        }
        assertTrue(first.isClosed());
        assertTrue(second.isClosed());
    }

    public static class Token { }
    public record Holder(Token initial, ObjectProvider<Token> provider) { }
    @Configuration(proxyBeanMethods = false)
    public static class PrototypeConfig {
        @Bean @Scope("prototype") Token token() { return new Token(); }
        @Bean Holder holder(Token token, ObjectProvider<Token> provider) { return new Holder(token, provider); }
    }
    @Test void prototypeInjectedIntoSingletonIsNotRepeatedAutomatically() {
        try (var context = new AnnotationConfigApplicationContext(PrototypeConfig.class)) {
            Holder holder = context.getBean(Holder.class);
            assertSame(holder, context.getBean(Holder.class));
            assertSame(holder.initial(), context.getBean(Holder.class).initial());
            assertNotSame(holder.provider().getObject(), holder.provider().getObject());
        }
    }

    @Test void factoryAndProcessedProductAreDifferent() {
        try (var context = new AnnotationConfigApplicationContext(ExtensionDemo.Config.class)) {
            Object product = context.getBean("greeting");
            assertInstanceOf(ExtensionDemo.Greeting.class, product);
            assertInstanceOf(ExtensionDemo.GreetingFactory.class, context.getBean("&greeting"));
            assertSame(product, context.getBean("greeting"));
            assertEquals("[factory]", ((ExtensionDemo.Greeting) product).value());
        }
    }

    @Test void definitionProcessorChangesPropertyBeforeCreation() {
        try (var context = new AnnotationConfigApplicationContext(ExtensionDemo.Config.class)) {
            assertEquals("changed", context.getBean(ExtensionDemo.Settings.class).getLabel());
        }
    }

    public static class Dependency { }
    public static class NeedsInjection { @Autowired public Dependency dependency; }
    @Test void bareFactoryDoesNotAutomaticallyRegisterAnnotationProcessors() {
        var factory = new DefaultListableBeanFactory();
        factory.registerBeanDefinition("dependency", new RootBeanDefinition(Dependency.class));
        factory.registerBeanDefinition("consumer", new RootBeanDefinition(NeedsInjection.class));
        assertNull(factory.getBean(NeedsInjection.class).dependency);
        factory.destroySingletons();
    }

    static AnnotationConfigApplicationContext environment(Map<String, Object> properties, String... profiles) {
        var context = new AnnotationConfigApplicationContext();
        context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("test", properties));
        context.getEnvironment().setActiveProfiles(profiles);
        context.register(EnvironmentDemo.Config.class);
        return context;
    }
    static Map<String, Object> properties(String capacity) {
        return new HashMap<>(Map.of("task.capacity", capacity, "task.name", "test", "feature.audit", "false"));
    }

    @Test void propertyOverrideProfileAndConditionAreIndependent() {
        try (var context = environment(properties("23"), "prod")) {
            context.refresh();
            assertEquals(new EnvironmentDemo.Settings("test", 23), context.getBean(EnvironmentDemo.Settings.class));
            assertEquals("prod", context.getBean(EnvironmentDemo.Transport.class).name());
            assertFalse(context.containsBean("auditMarker"));
        }
    }

    @ParameterizedTest @ValueSource(strings = {"0", "-1", "not-a-number"})
    void invalidCapacityStopsRefresh(String capacity) {
        try (var context = environment(properties(capacity), "prod")) {
            assertThrows(BeansException.class, context::refresh);
        }
    }

    @Test void twoActiveProfilesCanCreateAmbiguousCandidates() {
        try (var context = environment(properties("8"), "prod", "dev")) {
            context.refresh();
            assertThrows(NoUniqueBeanDefinitionException.class, () -> context.getBean(EnvironmentDemo.Transport.class));
        }
    }

    @Test void changingPropertySourceDoesNotRewriteExistingRecord() {
        Map<String, Object> properties = properties("16");
        try (var context = environment(properties, "prod")) {
            context.refresh();
            var settings = context.getBean(EnvironmentDemo.Settings.class);
            properties.put("task.capacity", "32");
            assertEquals(32, context.getEnvironment().getProperty("task.capacity", Integer.class));
            assertEquals(16, settings.capacity());
        }
    }

    @Configuration(proxyBeanMethods = false)
    public static class RequiredPropertyConfig {
        @Bean static PropertySourcesPlaceholderConfigurer placeholders() { return new PropertySourcesPlaceholderConfigurer(); }
        @Bean String required(@Value("${learning.container.required.unset}") String value) { return value; }
    }
    @Test void unresolvedRequiredPlaceholderFailsRefresh() {
        try (var context = new AnnotationConfigApplicationContext()) {
            context.register(RequiredPropertyConfig.class);
            assertThrows(BeansException.class, context::refresh);
        }
    }

    @Test void defaultEventListenerRunsSynchronously() {
        try (var context = new AnnotationConfigApplicationContext(EventsDemo.Config.class)) {
            var log = context.getBean(EventsDemo.EventLog.class);
            log.events.clear();
            log.events.add("before");
            context.publishEvent(new EventsDemo.TaskAccepted(7));
            log.events.add("after");
            assertEquals(List.of("before", "event:7", "after"), log.events);
            assertSame(Thread.currentThread(), context.getBean(EventsDemo.Handler.class).taskThread);
        }
    }

    @Test void synchronousListenerFailureCanPropagate() {
        try (var context = new AnnotationConfigApplicationContext()) {
            context.addApplicationListener(event -> {
                if (event instanceof PayloadApplicationEvent<?> payload && payload.getPayload() instanceof EventsDemo.TaskAccepted)
                    throw new IllegalStateException("listener failed");
            });
            context.register(EventsDemo.Config.class);
            context.refresh();
            assertThrows(IllegalStateException.class, () -> context.publishEvent(new EventsDemo.TaskAccepted(7)));
        }
    }

    public static class Probe implements SmartLifecycle {
        final String name;
        final int phase;
        final List<String> log;
        boolean running;
        Probe(String name, int phase, List<String> log) { this.name = name; this.phase = phase; this.log = log; }
        public void start() { running = true; log.add(name + ":start"); }
        public void stop() { running = false; log.add(name + ":stop"); }
        public void stop(Runnable callback) { try { stop(); } finally { callback.run(); } }
        public boolean isRunning() { return running; }
        public int getPhase() { return phase; }
    }
    @Test void lifecyclePhasesReverseDuringStop() {
        List<String> log = new ArrayList<>();
        try (var context = new GenericApplicationContext()) {
            context.registerBean("high", Probe.class, () -> new Probe("high", 100, log));
            context.registerBean("low", Probe.class, () -> new Probe("low", 0, log));
            context.refresh();
            assertEquals(List.of("low:start", "high:start"), log);
            log.clear();
        }
        assertEquals(List.of("high:stop", "low:stop"), log);
    }

    @Test void closeEventPrecedesStopAndDestroy() {
        EventsDemo.EventLog log;
        try (var context = new AnnotationConfigApplicationContext(EventsDemo.Config.class)) {
            log = context.getBean(EventsDemo.EventLog.class);
            log.events.clear();
        }
        assertEquals(List.of("context:closed", "worker:stop", "worker:destroy"), log.events);
    }

    static Throwable rootCause(Throwable error) {
        while (error.getCause() != null) error = error.getCause();
        return error;
    }
}
