package demo.tasks;

public class App {
    public static void main(String[] args) {
        if (args.length != 2) {
            throw new IllegalArgumentException("usage: task-cli <capacity> <active>");
        }
        int capacity = Integer.parseInt(args[0]);
        int active = Integer.parseInt(args[1]);
        System.out.println("remaining=" + TaskQuota.remaining(capacity, active));
    }
}
