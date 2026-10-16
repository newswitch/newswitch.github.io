import java.nio.ByteBuffer;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

public class DiagnosticTarget {
    private static final CountDownLatch stop = new CountDownLatch(1);
    private static final ByteBuffer direct = ByteBuffer.allocateDirect(1024 * 1024);
    private static volatile int result;
    private static volatile Object latest;

    public static int work(int value) {
        return value * 31 + 7;
    }

    public static void main(String[] args) throws Exception {
        Thread input = Thread.ofPlatform().daemon().name("diagnostic-input").start(() -> {
            try { System.in.read(); } catch (Exception ignored) { }
            stop.countDown();
        });
        Thread worker = Thread.ofPlatform().name("runtime-worker").start(() -> {
            int sequence = 0;
            try {
                while (stop.getCount() != 0) {
                    result = work(sequence++);
                    latest = new byte[16 * 1024];
                    Thread.sleep(25);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });
        System.out.println("READY pid=" + ProcessHandle.current().pid());
        System.out.flush();
        try {
            stop.await(90, TimeUnit.SECONDS);
        } finally {
            stop.countDown();
            worker.interrupt();
            worker.join(2000);
            direct.putInt(0, result);
        }
        System.out.println("STOPPED");
    }
}
