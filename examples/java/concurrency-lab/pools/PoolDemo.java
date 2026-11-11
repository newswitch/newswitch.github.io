import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

public class PoolDemo {
    public static void main(String[] args) throws Exception {
        var entered = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        var pool = new ThreadPoolExecutor(1, 1, 0, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(1), new ThreadPoolExecutor.AbortPolicy());
        try {
            var first = pool.submit(() -> {
                entered.countDown();
                release.await();
                return 7;
            });
            if (!entered.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("first task did not enter");
            }
            var second = pool.submit(() -> 21);
            System.out.println("queued=" + pool.getQueue().size());
            try {
                pool.execute(() -> {});
                throw new IllegalStateException("expected rejection");
            } catch (RejectedExecutionException expected) {
                System.out.println("rejected=true");
            }
            release.countDown();
            System.out.println("first=" + first.get(5, TimeUnit.SECONDS));
            System.out.println("second=" + second.get(5, TimeUnit.SECONDS));
        } finally {
            release.countDown();
            pool.shutdown();
            if (!pool.awaitTermination(5, TimeUnit.SECONDS)) {
                pool.shutdownNow();
                if (!pool.awaitTermination(5, TimeUnit.SECONDS)) {
                    throw new IllegalStateException("pool did not terminate");
                }
            }
        }
        System.out.println("terminated=" + pool.isTerminated());
    }
}
