import java.lang.management.ManagementFactory;
import java.lang.management.ThreadInfo;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public class LockEvidenceDemo {
    public static void main(String[] args) throws Exception {
        Object lock = new Object();
        CountDownLatch entered = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        Thread holder = Thread.ofPlatform().name("lock-holder").start(() -> {
            synchronized (lock) {
                entered.countDown();
                try { release.await(); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            }
        });
        Thread waiter = null;
        try {
            if (!entered.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("holder timeout");
            waiter = Thread.ofPlatform().name("lock-waiter").start(() -> {
                synchronized (lock) { /* acquire after holder leaves */ }
            });
            var bean = ManagementFactory.getThreadMXBean();
            ThreadInfo info = null;
            long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
            while (System.nanoTime() < deadline) {
                info = bean.getThreadInfo(waiter.threadId());
                if (info != null && info.getThreadState() == Thread.State.BLOCKED) break;
                Thread.sleep(5);
            }
            if (info == null || info.getThreadState() != Thread.State.BLOCKED)
                throw new IllegalStateException("blocked state not observed");
            System.out.println("blocked=" + (info.getThreadState() == Thread.State.BLOCKED));
            System.out.println("owner=" + info.getLockOwnerName());
        } finally {
            release.countDown();
            holder.join(5000);
            if (waiter != null) waiter.join(5000);
        }
        if (holder.isAlive() || (waiter != null && waiter.isAlive()))
            throw new IllegalStateException("threads did not stop");
        System.out.println("result=done");
    }
}
