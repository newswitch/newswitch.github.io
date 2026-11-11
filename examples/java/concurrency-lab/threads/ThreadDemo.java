import java.time.Duration;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public class ThreadDemo {
    public static void main(String[] args) throws Exception {
        var entered = new CountDownLatch(1);
        var blocker = new CountDownLatch(1);
        var restored = new AtomicBoolean();
        Thread worker = Thread.ofPlatform().name("task-worker").unstarted(() -> {
            entered.countDown();
            try {
                blocker.await();
            } catch (InterruptedException expected) {
                Thread.currentThread().interrupt();
                restored.set(Thread.currentThread().isInterrupted());
            }
        });
        System.out.println("before=" + worker.getState());
        worker.start();
        try {
            if (!entered.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("worker did not enter");
            }
            worker.interrupt();
        } finally {
            worker.interrupt();
            if (!worker.join(Duration.ofSeconds(5))) {
                throw new IllegalStateException("worker did not terminate");
            }
        }
        System.out.println("after=" + worker.getState());
        System.out.println("restored=" + restored.get());
        System.out.println("mainInterrupted=" + Thread.currentThread().isInterrupted());
    }
}
