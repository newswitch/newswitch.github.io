package demo.internals.testing;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.*;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.*;

public final class ContextCacheDemo {
    public static class Counter { public int value; }
    @Configuration(proxyBeanMethods = false) public static class Config {
        @Bean public Counter counter() { return new Counter(); }
    }
    @ContextConfiguration(classes = Config.class) public static class First {
        @Autowired public Counter counter;
    }
    @ContextConfiguration(classes = Config.class) public static class Second {
        @Autowired public Counter counter;
    }
    public static void main(String[] args) throws Exception {
        var firstManager = new TestContextManager(First.class);
        var secondManager = new TestContextManager(Second.class);
        var first = new First(); var second = new Second();
        try {
            firstManager.prepareTestInstance(first); secondManager.prepareTestInstance(second);
            var before = firstManager.getTestContext().getApplicationContext();
            System.out.println("shared=" + (before == secondManager.getTestContext().getApplicationContext()));
            first.counter.value = 1;
            System.out.println("seenBySecond=" + second.counter.value);
            firstManager.getTestContext().markApplicationContextDirty(DirtiesContext.HierarchyMode.CURRENT_LEVEL);
            var after = secondManager.getTestContext().getApplicationContext();
            System.out.println("rebuilt=" + (before != after));
            System.out.println("fresh=" + after.getBean(Counter.class).value);
        } finally {
            secondManager.getTestContext().markApplicationContextDirty(DirtiesContext.HierarchyMode.CURRENT_LEVEL);
        }
    }
}
