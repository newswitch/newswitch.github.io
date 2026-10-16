import java.util.List;
import java.util.Locale;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.function.Supplier;

public class LambdaDemo {
    record Task(String title, int priority) {}

    static long count(List<Task> tasks, Predicate<Task> rule) {
        long result = 0;
        for (Task task : tasks) {
            if (rule.test(task)) result++;
        }
        return result;
    }

    public static void main(String[] args) {
        int threshold = 2;
        Predicate<Task> urgent = task -> task.priority() <= threshold;
        var tasks = List.of(new Task("backup", 1), new Task("report", 5));
        System.out.println("urgent=" + count(tasks, urgent));
        Function<Task, String> title = Task::title;
        Function<Task, String> upper = title.andThen(value -> value.toUpperCase(Locale.ROOT));
        System.out.println("mapped=" + upper.apply(tasks.getFirst()));
        int[] calls = {0};
        Supplier<Integer> lazy = () -> ++calls[0];
        System.out.println("before=" + calls[0]);
        System.out.println("first=" + lazy.get());
        System.out.println("second=" + lazy.get());
        Predicate<Task> named = task -> task.title().startsWith("back");
        System.out.println("combined=" + urgent.and(named).test(tasks.getFirst()));
    }
}
