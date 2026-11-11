public class DispatchDemo {
    interface TaskExecutor {
        String execute(String title);
    }

    static final class LocalExecutor implements TaskExecutor {
        @Override
        public String execute(String title) {
            return "local:" + title;
        }
    }

    static final class DryRunExecutor implements TaskExecutor {
        @Override
        public String execute(String title) {
            return "dry-run:" + title;
        }
    }

    static final class TaskService {
        private final TaskExecutor executor;

        TaskService(TaskExecutor executor) {
            this.executor = java.util.Objects.requireNonNull(executor);
        }

        String submit(String title) {
            if (title == null || title.isBlank()) {
                throw new IllegalArgumentException("title is required");
            }
            return executor.execute(title);
        }
    }

    static String describe(TaskExecutor executor) {
        return "interface";
    }

    static String describe(LocalExecutor executor) {
        return "local-class";
    }

    public static void main(String[] args) {
        TaskExecutor executor = new LocalExecutor();
        TaskService local = new TaskService(executor);
        TaskService dryRun = new TaskService(new DryRunExecutor());
        System.out.println(local.submit("backup"));
        System.out.println(dryRun.submit("backup"));
        System.out.println("overload=" + describe(executor));
        System.out.println("actual=" + executor.getClass().getSimpleName());
    }
}
