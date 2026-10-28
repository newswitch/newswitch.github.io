package lab.cache;

import java.util.NoSuchElementException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.stereotype.Component;

@Component
public class TaskStore {
    private final ConcurrentHashMap<Long, View> data = new ConcurrentHashMap<>();
    private final AtomicInteger reads = new AtomicInteger();
    public View load(long id) {
        reads.incrementAndGet(); var found = data.get(id);
        if (found == null) throw new NoSuchElementException("task absent");
        return found;
    }
    public void put(long id, String title) { data.put(id, new View(id, title)); }
    public int loads() { return reads.get(); }
    public void reset() { data.clear(); reads.set(0); }
    public record View(long id, String title) {}
}
