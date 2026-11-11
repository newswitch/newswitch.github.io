import java.util.Arrays;
import java.util.HashSet;
import java.util.Objects;

public class EqualityDemo {
    static final class TaskId {
        private final String value;

        TaskId(String value) {
            this.value = Objects.requireNonNull(value);
        }

        @Override
        public boolean equals(Object other) {
            return this == other
                    || other instanceof TaskId id && value.equals(id.value);
        }

        @Override
        public int hashCode() {
            return value.hashCode();
        }

        @Override
        public String toString() {
            return "TaskId[" + value + "]";
        }
    }

    public static void main(String[] args) {
        TaskId a = new TaskId("daily");
        TaskId b = new TaskId("daily");
        var ids = new HashSet<TaskId>();
        ids.add(a);
        ids.add(b);
        System.out.println("same=" + (a == b));
        System.out.println("equal=" + a.equals(b));
        System.out.println("sameHash=" + (a.hashCode() == b.hashCode()));
        System.out.println("unique=" + ids.size());
        System.out.println("lookup=" + ids.contains(new TaskId("daily")));
        System.out.println("arrayEqual=" + Arrays.equals(new int[]{1}, new int[]{1}));
        System.out.println("nullEqual=" + Objects.equals(null, null));
    }
}
