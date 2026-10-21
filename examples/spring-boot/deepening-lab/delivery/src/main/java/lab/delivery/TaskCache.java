package lab.delivery;

import java.time.Duration;
import java.util.concurrent.Semaphore;
import java.util.function.Supplier;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

@Service
public class TaskCache {
    private final StringRedisTemplate redis;
    private final Semaphore originLimit=new Semaphore(4);
    public TaskCache(StringRedisTemplate redis) { this.redis=redis; }
    public String key(String tenant,String id) {
        if (!tenant.matches("[a-z0-9_-]{1,40}") || !id.matches("[a-zA-Z0-9_-]{1,80}"))
            throw new IllegalArgumentException("invalid cache key component");
        return "lab:task:v1:"+tenant+":"+id;
    }
    public String get(String tenant,String id,Supplier<String> origin) {
        String key=key(tenant,id);
        try { String cached=redis.opsForValue().get(key); if (cached!=null) return cached; }
        catch (DataAccessException unavailable) { /* Bounded origin fallback, not unlimited bypass. */ }
        if (!originLimit.tryAcquire()) throw new IllegalStateException("origin capacity exhausted");
        try {
            String loaded=origin.get();
            if (loaded!=null) {
                try { redis.opsForValue().set(key,loaded,Duration.ofSeconds(30)); }
                catch (DataAccessException unavailable) { /* The database read can still succeed. */ }
            }
            return loaded;
        } finally { originLimit.release(); }
    }
    // Call after a successful database commit; failure must trigger a durable retry in real write paths.
    public void evict(String tenant,String id) { redis.delete(key(tenant,id)); }
}
