import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

public class DesignDemo {
    record TaskSnapshot(String title, List<String> labels) {
        TaskSnapshot {
            title = Objects.requireNonNull(title).strip();
            if (title.isEmpty()) {
                throw new IllegalArgumentException("empty title");
            }
            labels = List.copyOf(labels);
        }
    }

    interface TaskStore {
        void save(TaskSnapshot task);
        List<TaskSnapshot> findAll();
    }

    static final class MemoryStore implements TaskStore {
        private final List<TaskSnapshot> tasks = new ArrayList<>();

        public void save(TaskSnapshot task) {
            tasks.add(Objects.requireNonNull(task));
        }

        public List<TaskSnapshot> findAll() {
            return List.copyOf(tasks);
        }
    }

    static final class TaskService {
        private final TaskStore store;

        TaskService(TaskStore store) {
            this.store = Objects.requireNonNull(store);
        }

        void submit(String title, List<String> labels) {
            store.save(new TaskSnapshot(title, labels));
        }
    }

    public static void main(String[] args) {
        var store = new MemoryStore();
        var service = new TaskService(store);
        var labels = new ArrayList<>(List.of("daily"));
        service.submit(" backup ", labels);
        labels.clear();
        List<TaskSnapshot> snapshot = store.findAll();
        service.submit("verify", List.of());
        System.out.println("firstLabels=" + snapshot.getFirst().labels());
        System.out.println("oldSize=" + snapshot.size());
        System.out.println("currentSize=" + store.findAll().size());
        try {
            snapshot.clear();
        } catch (UnsupportedOperationException expected) {
            System.out.println("snapshot=unmodifiable");
        }
    }
}
