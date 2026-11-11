import java.util.ArrayDeque;
import java.util.Comparator;
import java.util.PriorityQueue;

public class QueueDemo {
    record Job(String name, int priority, long sequence) {}

    public static void main(String[] args) {
        var fifo = new ArrayDeque<String>();
        fifo.addLast("a");
        fifo.addLast("b");
        System.out.println("fifo=" + fifo.pollFirst() + "," + fifo.pollFirst());
        System.out.println("empty=" + fifo.pollFirst());
        fifo.push("a");
        fifo.push("b");
        System.out.println("stack=" + fifo.pop() + "," + fifo.pop());

        var jobs = new PriorityQueue<Job>(Comparator.comparingInt(Job::priority)
                .thenComparingLong(Job::sequence));
        jobs.offer(new Job("normal", 5, 1));
        jobs.offer(new Job("urgent-first", 1, 2));
        jobs.offer(new Job("urgent-second", 1, 3));
        while (!jobs.isEmpty()) {
            System.out.println("next=" + jobs.poll().name());
        }
    }
}
