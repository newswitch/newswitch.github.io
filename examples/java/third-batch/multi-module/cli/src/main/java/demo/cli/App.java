package demo.cli;

import demo.core.TaskQuota;

public class App {
    public static void main(String[] args) {
        if (args.length != 2) throw new IllegalArgumentException("expected capacity and active");
        int remaining = TaskQuota.remaining(Integer.parseInt(args[0]), Integer.parseInt(args[1]));
        System.out.println("remaining=" + remaining);
    }
}
