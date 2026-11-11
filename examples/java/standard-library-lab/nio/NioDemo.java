import java.io.EOFException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;

public class NioDemo {
    public static void main(String[] args) throws Exception {
        ByteBuffer data = ByteBuffer.allocate(8).order(ByteOrder.BIG_ENDIAN);
        data.putInt(42).putInt(7);
        System.out.println("writtenPosition=" + data.position());
        data.flip();
        System.out.println("readable=" + data.remaining());
        Path file = Files.createTempFile("java-nio-demo-", ".bin");
        try {
            try (var channel = FileChannel.open(file,
                    StandardOpenOption.READ, StandardOpenOption.WRITE)) {
                while (data.hasRemaining()) {
                    channel.write(data);
                }
                channel.force(true);
                channel.position(0);
                data.clear();
                while (data.hasRemaining()) {
                    if (channel.read(data) == -1) {
                        throw new EOFException("incomplete record");
                    }
                }
                data.flip();
                System.out.println("values=" + data.getInt() + "," + data.getInt());
                System.out.println("remaining=" + data.remaining());
            }
        } finally {
            Files.deleteIfExists(file);
        }
        ByteBuffer partial = ByteBuffer.allocate(8);
        partial.put(new byte[]{10, 20, 30}).flip();
        partial.get();
        partial.compact();
        System.out.println("retained=" + partial.position());
        System.out.println("space=" + partial.remaining());
    }
}
