import java.time.Duration;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.ReentrantLock;

public class LockDemo {
    static final class Gate {
        private final ReentrantLock lock = new ReentrantLock();
        private final Condition opened = lock.newCondition();
        private boolean open;

        void awaitOpen() throws InterruptedException {
            lock.lockInterruptibly();
            try {
                while (!open) opened.await();
            } finally {
                lock.unlock();
            }
        }

        void open() {
            lock.lock();
            try {
                open = true;
                opened.signalAll();
            } finally {
                lock.unlock();
            }
        }
    }

    public static void main(String[] args) throws Exception {
        var gate = new Gate();
        var passed = new AtomicBoolean();
        Thread waiter = Thread.ofPlatform().start(() -> {
            try {
                gate.awaitOpen();
                passed.set(true);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
        });
        try {
            gate.open();
            if (!waiter.join(Duration.ofSeconds(5))) {
                throw new IllegalStateException("gate timed out");
            }
        } finally {
            waiter.interrupt();
            if (!waiter.join(Duration.ofSeconds(5))) {
                throw new IllegalStateException("waiter did not stop");
            }
        }
        System.out.println("passed=" + passed.get());
        var permits = new Semaphore(2);
        boolean acquired = permits.tryAcquire(2);
        if (!acquired) throw new IllegalStateException("expected two permits");
        try {
            System.out.println("third=" + permits.tryAcquire());
        } finally {
            permits.release(2);
        }
        System.out.println("available=" + permits.availablePermits());
    }
}
