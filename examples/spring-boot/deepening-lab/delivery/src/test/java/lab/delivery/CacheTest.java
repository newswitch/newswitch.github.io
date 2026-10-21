package lab.delivery;

import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class CacheTest {
    @SuppressWarnings("unchecked")
    @Test void hitSkipsOrigin() {
        var redis=mock(StringRedisTemplate.class); ValueOperations<String,String> values=mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values); when(values.get("lab:task:v1:alpha:t1")).thenReturn("cached");
        assertEquals("cached",new TaskCache(redis).get("alpha","t1",()->{throw new AssertionError("origin called");}));
    }
    @Test void tenantChangesKeyAndInvalidDelimiterIsRejected() {
        var cache=new TaskCache(mock(StringRedisTemplate.class));
        assertNotEquals(cache.key("alpha","t1"),cache.key("beta","t1"));
        assertThrows(IllegalArgumentException.class,()->cache.key("alpha:beta","t1"));
    }
    @Test void unavailableCacheHasBoundedFallback() throws Exception {
        var redis=mock(StringRedisTemplate.class);
        when(redis.opsForValue()).thenThrow(new RedisConnectionFailureException("isolated failure"));
        var cache=new TaskCache(redis); var entered=new CountDownLatch(4); var release=new CountDownLatch(1);
        try(var pool=Executors.newFixedThreadPool(4)) {
            var results=new java.util.ArrayList<Future<String>>();
            for(int i=0;i<4;i++) results.add(pool.submit(()->cache.get("alpha","t1",()->{
                entered.countDown(); try { if(!release.await(3,TimeUnit.SECONDS)) throw new IllegalStateException("timeout"); }
                catch(InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
                return "db";
            })));
            try { assertTrue(entered.await(2,TimeUnit.SECONDS)); assertThrows(IllegalStateException.class,()->cache.get("alpha","t1",()->"extra")); }
            finally { release.countDown(); }
            for(var result:results) assertEquals("db",result.get(3,TimeUnit.SECONDS));
        }
    }
}
