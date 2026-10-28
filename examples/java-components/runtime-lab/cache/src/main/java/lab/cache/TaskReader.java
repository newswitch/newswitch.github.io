package lab.cache;

import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

@Service
public class TaskReader {
    private final TaskStore store;
    public TaskReader(TaskStore store) { this.store = store; }
    @Cacheable(cacheNames = "tasks-v1", key = "#p0", sync = true)
    public TaskStore.View read(long id) { return store.load(id); }
    @CacheEvict(cacheNames = "tasks-v1", key = "#p0")
    public void rename(long id, String title) { store.put(id, title); }
    // Used to observe proxy bypass, not a recommended application call pattern.
    public TaskStore.View readThroughSelf(long id) { return read(id); }
}
