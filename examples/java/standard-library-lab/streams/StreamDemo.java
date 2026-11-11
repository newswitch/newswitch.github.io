import java.util.List;
import java.util.Optional;
import java.util.TreeMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

public class StreamDemo {
    record Task(String owner, int priority) {}

    public static void main(String[] args) {
        var tasks = List.of(new Task("alice", 1), new Task("bob", 5), new Task("alice", 2));
        var visited = new AtomicInteger();
        var pipeline = tasks.stream().filter(task -> {
            visited.incrementAndGet();
            return task.priority() <= 2;
        });
        System.out.println("before=" + visited.get());
        List<Task> urgent = pipeline.toList();
        System.out.println("visited=" + visited.get());
        var counts = urgent.stream().collect(Collectors.groupingBy(
                Task::owner, TreeMap::new, Collectors.counting()));
        System.out.println("counts=" + counts);
        int total = tasks.stream().mapToInt(Task::priority).sum();
        System.out.println("priorityTotal=" + total);

        var fallbackCalls = new AtomicInteger();
        String owner = Optional.of("alice").orElseGet(() -> {
            fallbackCalls.incrementAndGet();
            return "unknown";
        });
        System.out.println("owner=" + owner);
        System.out.println("fallbackCalls=" + fallbackCalls.get());
        System.out.println("missing=" + Optional.<String>empty().map(String::length).orElse(0));
    }
}
