package demo.tasks;

public final class TaskQuota {
    private TaskQuota() {
    }

    public static int remaining(int capacity, int active) {
        if (capacity < 0 || active < 0 || active > capacity) {
            throw new IllegalArgumentException("require 0 <= active <= capacity");
        }
        return capacity - active;
    }
}
