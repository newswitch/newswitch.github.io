package demo.internals;

import demo.internals.config.ConfigurationDemo;
import demo.internals.creation.CreationDemo;
import demo.internals.mvc.MvcPathDemo;
import demo.internals.proxy.AutoProxyDemo;
import demo.internals.refresh.RefreshDemo;
import demo.internals.testing.ContextCacheDemo;
import demo.internals.transaction.TransactionPathDemo;
import org.junit.jupiter.api.*;
import org.springframework.aop.support.AopUtils;
import org.springframework.beans.BeansException;
import org.springframework.beans.factory.*;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.*;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.core.env.MapPropertySource;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.*;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import tools.jackson.databind.json.JsonMapper;
import javax.sql.DataSource;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

@Timeout(10)
class SourceSemanticsTest {
    @Nested class RefreshTests {
        @Test void refreshStagesPrecedeInitializationAndEvent() {
            var events = new ArrayList<String>();
            try (var context = new RefreshDemo.TracingContext(events)) {
                context.addBeanFactoryPostProcessor(factory -> events.add("factoryProcessor"));
                context.registerBean("resource", RefreshDemo.Resource.class, () -> new RefreshDemo.Resource(events));
                context.addApplicationListener(event -> { if (event instanceof ContextRefreshedEvent) events.add("refreshedEvent"); });
                context.refresh();
                assertEquals(List.of("factoryHook", "factoryProcessor", "onRefresh", "instantiate", "construct", "init", "refreshedEvent"), events);
            }
            assertEquals("destroy", events.getLast());
        }
        @Test void nonLazySingletonAppearsDuringRefresh() {
            try (var context = new AnnotationConfigApplicationContext()) {
                context.registerBean("item", Object.class, Object::new);
                assertFalse(context.getDefaultListableBeanFactory().containsSingleton("item"));
                context.refresh();
                assertTrue(context.getDefaultListableBeanFactory().containsSingleton("item"));
                assertSame(context.getBean("item"), context.getBean("item"));
            }
        }
        @Test void lazySingletonWaitsForDemand() {
            var count = new AtomicInteger();
            try (var context = new AnnotationConfigApplicationContext()) {
                context.registerBean("lazy", Object.class, () -> { count.incrementAndGet(); return new Object(); }, definition -> definition.setLazyInit(true));
                context.refresh(); assertEquals(0, count.get()); context.getBean("lazy"); assertEquals(1, count.get());
            }
        }
        @Test void failureDestroysAlreadyCreatedManagedResource() {
            var events = new ArrayList<String>();
            try (var context = new AnnotationConfigApplicationContext()) {
                context.registerBean("resource", RefreshDemo.Resource.class, () -> new RefreshDemo.Resource(events));
                context.registerBean("bad", Object.class, () -> { throw new IllegalStateException("bad bean"); });
                assertThrows(BeansException.class, context::refresh);
                assertEquals(List.of("construct", "init", "destroy"), events);
            }
        }
        @Test void failureCancelsActiveState() {
            try (var context = new AnnotationConfigApplicationContext()) {
                context.registerBean("bad", Object.class, () -> { throw new IllegalStateException("bad bean"); });
                assertThrows(BeansException.class, context::refresh); assertFalse(context.isActive());
            }
        }
        @Test void genericContextCannotRefreshTwice() {
            try (var context = new AnnotationConfigApplicationContext()) {
                context.refresh(); assertThrows(IllegalStateException.class, context::refresh);
            }
        }
    }
    private static AnnotationConfigApplicationContext fieldCycle(boolean allowed) {
        var context = new AnnotationConfigApplicationContext();
        context.getDefaultListableBeanFactory().setAllowCircularReferences(allowed);
        context.registerBean("a", CreationDemo.A.class); context.registerBean("b", CreationDemo.B.class);
        return context;
    }
    public static class ProviderA {
        final ObjectProvider<ProviderB> provider;
        public ProviderA(ObjectProvider<ProviderB> provider) { this.provider = provider; }
    }
    public static class ProviderB {
        final ProviderA a;
        public ProviderB(ProviderA a) { this.a = a; }
    }
    @Nested class CreationTests {
        @Test void fieldCycleReusesSameExposedObject() {
            try (var context = fieldCycle(true)) {
                context.refresh(); assertSame(context.getBean(CreationDemo.A.class), context.getBean(CreationDemo.B.class).a);
            }
        }
        @Test void earlyReferenceCanBeNotReady() {
            try (var context = fieldCycle(true)) {
                context.refresh(); assertFalse(context.getBean(CreationDemo.B.class).sawReady);
                assertTrue(context.getBean(CreationDemo.A.class).ready);
            }
        }
        @Test void constructorCycleHasNoEarlyInstance() {
            try (var context = new AnnotationConfigApplicationContext()) {
                context.registerBean(CreationDemo.ConstructorA.class); context.registerBean(CreationDemo.ConstructorB.class);
                var error = assertThrows(BeansException.class, context::refresh);
                assertTrue(CreationDemo.causedBy(error, BeanCurrentlyInCreationException.class));
            }
        }
        @Test void disabledCircularReferencesRejectFieldCycle() {
            try (var context = fieldCycle(false)) { assertThrows(BeansException.class, context::refresh); }
        }
        @Test void prototypeCycleDoesNotUseSingletonEarlyCache() {
            try (var context = new AnnotationConfigApplicationContext()) {
                context.registerBean("a", CreationDemo.A.class, definition -> definition.setScope("prototype"));
                context.registerBean("b", CreationDemo.B.class, definition -> definition.setScope("prototype"));
                context.refresh(); assertThrows(BeansException.class, () -> context.getBean("a"));
            }
        }
        @Test void providerDefersActualDependencyLookup() {
            try (var context = new AnnotationConfigApplicationContext()) {
                context.getDefaultListableBeanFactory().setAllowCircularReferences(false);
                context.registerBean(ProviderA.class); context.registerBean(ProviderB.class); context.refresh();
                var a = context.getBean(ProviderA.class); assertSame(a, a.provider.getObject().a);
            }
        }
    }
    @Configuration(proxyBeanMethods = false) @ConfigurationDemo.EnableGreeting
    static class PlainConfig {}
    @Configuration(proxyBeanMethods = false) static class ParameterConfig {
        @Bean public ConfigurationDemo.Token token() { return new ConfigurationDemo.Token(); }
        @Bean public ConfigurationDemo.Holder holder(ConfigurationDemo.Token token) { return new ConfigurationDemo.Holder(token); }
    }
    @Nested class ConfigurationTests {
        @Test void selectorReadsEnableAnnotation() {
            try (var context = new AnnotationConfigApplicationContext(ConfigurationDemo.EnabledConfig.class)) {
                assertEquals("HELLO", context.getBean(ConfigurationDemo.Greeting.class).text());
            }
        }
        @Test void selectorCanChooseDifferentImportedConfiguration() {
            try (var context = new AnnotationConfigApplicationContext(PlainConfig.class)) {
                assertEquals("hello", context.getBean(ConfigurationDemo.Greeting.class).text());
            }
        }
        @Test void registrarAddsNamedDefinition() {
            try (var context = new AnnotationConfigApplicationContext(ConfigurationDemo.EnabledConfig.class)) {
                assertTrue(context.containsBeanDefinition("marker"));
                assertInstanceOf(ConfigurationDemo.Marker.class, context.getBean("marker"));
            }
        }
        @Test void falseConditionExcludesGreetingDefinition() {
            try (var context = new AnnotationConfigApplicationContext()) {
                context.getEnvironment().getPropertySources().addFirst(new MapPropertySource("test", Map.of("feature.enabled", false)));
                context.register(ConfigurationDemo.EnabledConfig.class); context.refresh();
                assertFalse(context.containsBean("greeting")); assertTrue(context.containsBean("marker"));
            }
        }
        @Test void fullConfigurationInterceptsFactoryMethodCall() { assertTrue(ConfigurationDemo.sameToken(ConfigurationDemo.Full.class)); }
        @Test void liteDirectCallDiffersButParameterInjectionIsStable() {
            assertFalse(ConfigurationDemo.sameToken(ConfigurationDemo.Lite.class));
            assertTrue(ConfigurationDemo.sameToken(ParameterConfig.class));
        }
    }
    @Nested class ProxyTests {
        @Test void containerExposesInterfaceProxyForMatchingBean() {
            try (var context = new AnnotationConfigApplicationContext(AutoProxyDemo.Config.class)) {
                var bean = context.getBean(AutoProxyDemo.Operations.class);
                assertTrue(AopUtils.isJdkDynamicProxy(bean)); assertEquals(AutoProxyDemo.Work.class, AopUtils.getTargetClass(bean));
            }
        }
        @Test void externalMethodHasOwnChain() {
            try (var context = new AnnotationConfigApplicationContext(AutoProxyDemo.Config.class)) {
                assertEquals("ok", context.getBean(AutoProxyDemo.Operations.class).inner());
                assertEquals(List.of("before:inner", "target:inner", "after:inner"), context.getBean(AutoProxyDemo.Trace.class).events);
            }
        }
        @Test void selfInvocationDoesNotReenterProxy() {
            try (var context = new AnnotationConfigApplicationContext(AutoProxyDemo.Config.class)) {
                context.getBean(AutoProxyDemo.Operations.class).outer();
                assertEquals(List.of("before:outer", "target:outer", "target:inner", "after:outer"), context.getBean(AutoProxyDemo.Trace.class).events);
            }
        }
        @Test void unmatchedBeanIsNotWrapped() {
            try (var context = new AnnotationConfigApplicationContext(AutoProxyDemo.Config.class)) {
                assertFalse(AopUtils.isAopProxy(context.getBean(AutoProxyDemo.Plain.class)));
            }
        }
        @Test void exceptionUnwindsFinallyAdvice() {
            try (var context = new AnnotationConfigApplicationContext(AutoProxyDemo.Config.class)) {
                assertThrows(IllegalStateException.class, () -> context.getBean(AutoProxyDemo.Operations.class).fail());
                assertEquals(List.of("before:fail", "target:fail", "after:fail"), context.getBean(AutoProxyDemo.Trace.class).events);
            }
        }
    }
    @Nested class TransactionTests {
        @Test void normalResultCommitsRealRows() {
            try (var context = new AnnotationConfigApplicationContext(TransactionPathDemo.Config.class)) {
                context.getBean(TransactionPathDemo.Work.class).write("ok", false);
                assertEquals(List.of("ok"), context.getBean(JdbcTemplate.class).queryForList("select entry_name from entries", String.class));
                assertEquals(List.of("begin", "body:true", "commit", "cleanup"), context.getBean(TransactionPathDemo.Trace.class).events);
            }
        }
        @Test void runtimeExceptionRollsBackRealRows() {
            try (var context = new AnnotationConfigApplicationContext(TransactionPathDemo.Config.class)) {
                assertThrows(IllegalStateException.class, () -> context.getBean(TransactionPathDemo.Work.class).write("bad", true));
                assertEquals(0, context.getBean(JdbcTemplate.class).queryForObject("select count(*) from entries", Integer.class));
                assertEquals(List.of("begin", "body:true", "rollback", "cleanup"), context.getBean(TransactionPathDemo.Trace.class).events);
            }
        }
        @Test void commitUnbindsConnectionAndState() {
            try (var context = new AnnotationConfigApplicationContext(TransactionPathDemo.Config.class)) {
                context.getBean(TransactionPathDemo.Work.class).write("ok", false);
                assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
                assertFalse(TransactionSynchronizationManager.hasResource(context.getBean(DataSource.class)));
            }
        }
        @Test void rollbackUnbindsConnectionAndState() {
            try (var context = new AnnotationConfigApplicationContext(TransactionPathDemo.Config.class)) {
                assertThrows(IllegalStateException.class, () -> context.getBean(TransactionPathDemo.Work.class).write("bad", true));
                assertFalse(TransactionSynchronizationManager.isActualTransactionActive());
                assertFalse(TransactionSynchronizationManager.hasResource(context.getBean(DataSource.class)));
            }
        }
        @Test void ordinaryDefaultCheckedExceptionCanStillCommit() {
            try (var context = new AnnotationConfigApplicationContext(TransactionPathDemo.Config.class)) {
                assertThrows(Exception.class, () -> context.getBean(TransactionPathDemo.Work.class).checked());
                assertEquals(List.of("checked"), context.getBean(JdbcTemplate.class).queryForList("select entry_name from entries", String.class));
            }
        }
        @Test void failedCallDoesNotPoisonNextTransaction() {
            try (var context = new AnnotationConfigApplicationContext(TransactionPathDemo.Config.class)) {
                var work = context.getBean(TransactionPathDemo.Work.class);
                assertThrows(IllegalStateException.class, () -> work.write("bad", true)); work.write("next", false);
                assertEquals(List.of("next"), context.getBean(JdbcTemplate.class).queryForList("select entry_name from entries", String.class));
            }
        }
    }
    @Nested class MvcTests {
        @Test void jsonIsActuallyDecodedAndEncoded() throws Exception {
            try (var fixture = new MvcPathDemo.Fixture()) {
                var response = fixture.mvc.perform(post("/notes/7").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"text\":\"hello\"}")).andReturn().getResponse();
                var json = JsonMapper.builder().build().readTree(response.getContentAsString());
                assertEquals(200, response.getStatus()); assertEquals(7, json.get("id").asInt()); assertEquals("HELLO", json.get("text").asText());
            }
        }
        @Test void bodyWritePrecedesPostHandle() throws Exception {
            try (var fixture = new MvcPathDemo.Fixture()) {
                fixture.mvc.perform(post("/notes/7").contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"hello\"}"));
                assertEquals(List.of("pre", "decode:before", "decode:after", "controller", "encode:before", "post", "complete"),
                        fixture.context.getBean(MvcPathDemo.Trace.class).events);
            }
        }
        @Test void invalidJsonUsesExceptionResponseWithoutController() throws Exception {
            try (var fixture = new MvcPathDemo.Fixture()) {
                var response = fixture.mvc.perform(post("/notes/7").contentType(MediaType.APPLICATION_JSON).content("{"))
                        .andReturn().getResponse();
                assertEquals(400, response.getStatus());
                assertEquals(List.of("pre", "decode:before", "exception", "encode:before", "complete"), fixture.context.getBean(MvcPathDemo.Trace.class).events);
            }
        }
        @Test void pathConversionFailureDoesNotEnterController() throws Exception {
            try (var fixture = new MvcPathDemo.Fixture()) {
                var response = fixture.mvc.perform(post("/notes/abc").contentType(MediaType.APPLICATION_JSON).content("{\"text\":\"hello\"}"))
                        .andReturn().getResponse();
                assertEquals(400, response.getStatus()); assertFalse(fixture.context.getBean(MvcPathDemo.Trace.class).events.contains("controller"));
            }
        }
        @Test void methodMismatchIs405() throws Exception {
            try (var fixture = new MvcPathDemo.Fixture()) { assertEquals(405, fixture.mvc.perform(get("/notes/7")).andReturn().getResponse().getStatus()); }
        }
        @Test void mediaMismatchIs415() throws Exception {
            try (var fixture = new MvcPathDemo.Fixture()) {
                assertEquals(415, fixture.mvc.perform(post("/notes/7").contentType(MediaType.TEXT_PLAIN).content("hello")).andReturn().getResponse().getStatus());
            }
        }
        @Test void unacceptableOutputIs406() throws Exception {
            try (var fixture = new MvcPathDemo.Fixture()) {
                assertEquals(406, fixture.mvc.perform(post("/notes/7").contentType(MediaType.APPLICATION_JSON)
                        .accept(MediaType.TEXT_PLAIN).content("{\"text\":\"hello\"}")).andReturn().getResponse().getStatus());
            }
        }
    }
    @ContextConfiguration(classes = ContextCacheDemo.Config.class) @ActiveProfiles("other")
    static class OtherProfile {}
    private static void dirty(TestContextManager manager) {
        manager.getTestContext().markApplicationContextDirty(DirtiesContext.HierarchyMode.CURRENT_LEVEL);
    }
    @Nested class CacheTests {
        @Test void equalConfigurationsShareStateAcrossTestClasses() throws Exception {
            var first = new TestContextManager(ContextCacheDemo.First.class); var second = new TestContextManager(ContextCacheDemo.Second.class);
            try {
                var one = new ContextCacheDemo.First(); var two = new ContextCacheDemo.Second();
                first.prepareTestInstance(one); second.prepareTestInstance(two);
                assertSame(first.getTestContext().getApplicationContext(), second.getTestContext().getApplicationContext());
                one.counter.value = 9; assertEquals(9, two.counter.value);
            } finally { dirty(first); }
        }
        @Test void dirtyClosesCachedContextButDoesNotRewriteOldReference() {
            var manager = new TestContextManager(ContextCacheDemo.First.class);
            try {
                var before = manager.getTestContext().getApplicationContext(); var old = before.getBean(ContextCacheDemo.Counter.class); old.value = 9;
                dirty(manager); var after = manager.getTestContext().getApplicationContext();
                assertNotSame(before, after); assertFalse(((ConfigurableApplicationContext) before).isActive());
                assertEquals(0, after.getBean(ContextCacheDemo.Counter.class).value); assertEquals(9, old.value);
            } finally { dirty(manager); }
        }
        @Test void profileDifferenceCreatesDifferentCacheEntry() {
            var first = new TestContextManager(ContextCacheDemo.First.class); var other = new TestContextManager(OtherProfile.class);
            try { assertNotSame(first.getTestContext().getApplicationContext(), other.getTestContext().getApplicationContext()); }
            finally { try { dirty(first); } finally { dirty(other); } }
        }
    }
}
