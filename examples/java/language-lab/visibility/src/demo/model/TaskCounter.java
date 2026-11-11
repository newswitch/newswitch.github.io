package demo.model;

public final class TaskCounter {
    public static final int DEFAULT_LIMIT = 10;
    private static int created;
    private final String name;
    private int submitted;

    public TaskCounter(String name) {
        this.name = name;
        created++;
    }

    public void submit() {
        submitted++;
    }

    public int submitted() {
        return submitted;
    }

    public String name() {
        return name;
    }

    public static int created() {
        return created;
    }
}
