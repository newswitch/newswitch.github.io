package demo.app;

import demo.model.TaskCounter;

public class Main {
    public static void main(String[] args) {
        TaskCounter first = new TaskCounter("first");
        TaskCounter second = new TaskCounter("second");
        first.submit();
        final int[] values = {1};
        values[0] = 2;
        System.out.println("created=" + TaskCounter.created());
        System.out.println(first.name() + "=" + first.submitted());
        System.out.println(second.name() + "=" + second.submitted());
        System.out.println("finalElement=" + values[0]);
    }
}
