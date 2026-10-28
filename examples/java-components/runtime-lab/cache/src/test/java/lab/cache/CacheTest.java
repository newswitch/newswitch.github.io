package lab.cache;

import com.github.benmanes.caffeine.cache.Caffeine;
import java.time.Duration;
import java.util.NoSuchElementException;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.cache.CacheManager;
import org.springframework.cache.caffeine.CaffeineCacheManager;
import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
class CacheTest {
    @Autowired TaskStore store;
    @Autowired TaskReader reader;
    @Autowired CacheManager manager;
    @BeforeEach void reset() { manager.getCache("tasks-v1").clear(); store.reset(); store.put(1L, "first"); store.put(2L, "other"); }
    @Test void proxyReadsHitCaffeine() {
        assertInstanceOf(CaffeineCacheManager.class, manager);
        assertEquals(reader.read(1L), reader.read(1L)); assertEquals(1, store.loads());
    }
    @Test void evictionReloadsChangedValue() {
        reader.read(1L); reader.rename(1L, "second");
        assertEquals("second", reader.read(1L).title()); assertEquals(2, store.loads());
    }
    @Test void selfInvocationBypassesAdvice() {
        reader.readThroughSelf(1L); reader.readThroughSelf(1L); assertEquals(2, store.loads());
    }
    @Test void differentKeysRemainDistinct() {
        assertNotEquals(reader.read(1L), reader.read(2L)); assertEquals(2, store.loads());
    }
    @Test void failedLoadDoesNotCacheAResult() {
        assertThrows(NoSuchElementException.class, () -> reader.read(3L)); store.put(3L, "later");
        assertEquals("later", reader.read(3L).title()); assertEquals(2, store.loads());
    }
    @Test void expiryUsesControlledTickerWithoutSleeping() {
        var now = new AtomicLong(); var cache = Caffeine.newBuilder().ticker(now::get).expireAfterWrite(Duration.ofSeconds(5)).build();
        cache.put("k", "v"); now.set(Duration.ofSeconds(4).toNanos()); assertEquals("v", cache.getIfPresent("k"));
        now.set(Duration.ofSeconds(6).toNanos()); assertNull(cache.getIfPresent("k"));
    }
    @Test void boundedCachePerformsSizeMaintenance() {
        var cache = Caffeine.newBuilder().maximumSize(2).build(); for (int i = 0; i < 20; i++) cache.put(i, i);
        cache.cleanUp(); assertTrue(cache.estimatedSize() <= 2);
    }
    @Test void nativeSameKeyLoadsCoalesce() throws Exception {
        var cache = Caffeine.newBuilder().build(); var calls = new AtomicInteger();
        var loading = new CountDownLatch(1); var release = new CountDownLatch(1); var start = new CountDownLatch(1);
        var pool = Executors.newFixedThreadPool(4);
        try {
            var futures = new java.util.ArrayList<Future<Object>>();
            for (int i = 0; i < 4; i++) futures.add(pool.submit(() -> {
                assertTrue(start.await(3, TimeUnit.SECONDS));
                return cache.get("k", key -> {
                    calls.incrementAndGet(); loading.countDown();
                    try { if (!release.await(3, TimeUnit.SECONDS)) throw new IllegalStateException("release timed out"); }
                    catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IllegalStateException(error); }
                    return "v";
                });
            }));
            start.countDown(); assertTrue(loading.await(3, TimeUnit.SECONDS)); release.countDown();
            for (var future : futures) assertEquals("v", future.get(5, TimeUnit.SECONDS));
            assertEquals(1, calls.get());
        } finally { release.countDown(); start.countDown(); pool.shutdownNow(); assertTrue(pool.awaitTermination(5, TimeUnit.SECONDS)); }
    }
}
