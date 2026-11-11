public class TaskDemo {
    static final class Task {
        private final String title;
        private boolean completed;

        Task(String title) {
            if (title == null || title.isBlank()) {
                throw new IllegalArgumentException("title is required");
            }
            this.title = title;
        }

        String title() {
            return title;
        }

        boolean complete() {
            if (completed) {
                return false;
            }
            completed = true;
            return true;
        }

        boolean isCompleted() {
            return completed;
        }
    }

    public static void main(String[] args) {
        Task first = new Task("backup");
        Task second = new Task("index");
        Task alias = first;
        System.out.println("title=" + first.title());
        System.out.println("firstChange=" + alias.complete());
        System.out.println("secondChange=" + first.complete());
        System.out.println("otherCompleted=" + second.isCompleted());
    }
}
