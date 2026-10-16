import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

public class ModelDemo {
    enum State { READY, DONE }

    sealed interface SubmitResult permits Accepted, Rejected {}
    record Accepted(long id) implements SubmitResult {}
    record Rejected(String reason) implements SubmitResult {}

    record Task(String title, List<String> labels) {
        Task {
            title = Objects.requireNonNull(title).strip();
            if (title.isEmpty()) {
                throw new IllegalArgumentException("empty title");
            }
            labels = List.copyOf(labels);
        }
    }

    static String describe(SubmitResult result) {
        return switch (result) {
            case Accepted(long id) -> "accepted:" + id;
            case Rejected(String reason) -> "rejected:" + reason;
        };
    }

    public static void main(String[] args) {
        var labels = new ArrayList<>(List.of("daily"));
        Task task = new Task(" backup ", labels);
        labels.add("external");
        System.out.println("title=" + task.title());
        System.out.println("labels=" + task.labels());
        System.out.println("equal=" + task.equals(new Task("backup", List.of("daily"))));
        System.out.println(describe(new Accepted(7)));
        System.out.println(describe(new Rejected("quota")));
        System.out.println("state=" + State.valueOf("READY"));
    }
}
