import java.lang.management.BufferPoolMXBean;
import java.lang.management.ManagementFactory;
import java.nio.ByteBuffer;
import java.lang.ref.Reference;

public class BufferMemoryDemo {
    public static void main(String[] args) {
        ByteBuffer buffer = ByteBuffer.allocateDirect(4 * 1024 * 1024);
        buffer.putInt(0, 42);
        BufferPoolMXBean pool = ManagementFactory
                .getPlatformMXBeans(BufferPoolMXBean.class).stream()
                .filter(p -> p.getName().equals("direct")).findFirst().orElseThrow();
        System.out.println("direct=" + buffer.isDirect());
        System.out.println("capacity=" + buffer.capacity());
        System.out.println("poolCoversBuffer=" + (pool.getTotalCapacity() >= buffer.capacity()));
        System.out.println("value=" + buffer.getInt(0));
        Reference.reachabilityFence(buffer);
    }
}
