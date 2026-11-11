package demo.tasks;

public class App {
    public static String render(String[] args) {
        if (args.length != 2) {
            throw new IllegalArgumentException("usage: build-lab <capacity> <active>");
        }
        int remaining = TaskQuota.remaining(Integer.parseInt(args[0]), Integer.parseInt(args[1]));
        return "remaining=" + remaining;
    }

    public static void main(String[] args) {
        System.out.println(render(args));
    }
}
