package demo.internals;

import demo.internals.testing.ContextCacheDemo.Counter;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.*;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import static org.junit.jupiter.api.Assertions.*;

@Timeout(10)
@SpringJUnitConfig(SpringIntegrationTest.Config.class)
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_EACH_TEST_METHOD)
class SpringIntegrationTest {
    @Configuration(proxyBeanMethods = false) static class Config {
        @Bean public Counter counter() { return new Counter(); }
    }
    @Autowired Counter counter;
    @Test void firstIndependentState() { assertNotNull(counter); assertEquals(0, counter.value); counter.value = 11; }
    @Test void secondIndependentState() { assertEquals(0, counter.value); counter.value = 22; }
    @Test void thirdIndependentState() { assertEquals(0, counter.value); counter.value = 33; }
}
