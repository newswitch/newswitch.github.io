import java.lang.ref.Reference;
import java.lang.ref.ReferenceQueue;
import java.lang.ref.WeakReference;

public class ReferenceDemo {
    public static void main(String[] args) {
        Object value = new Object();
        ReferenceQueue<Object> queue = new ReferenceQueue<>();
        WeakReference<Object> weak = new WeakReference<>(value, queue);
        System.out.println("same=" + (weak.get() == value));
        weak.clear();
        System.out.println("cleared=" + (weak.get() == null));
        System.out.println("manuallyEnqueued=" + weak.enqueue());
        System.out.println("queueContainsReference=" + (queue.poll() == weak));
        Reference.reachabilityFence(value);
    }
}
