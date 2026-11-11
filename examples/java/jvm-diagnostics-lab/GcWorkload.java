import java.util.Arrays;

public class GcWorkload {
    private static volatile Object sink;

    public static void main(String[] args) {
        byte[][] retained = new byte[16][];
        for (int i = 0; i < 4096; i++) {
            byte[] block = new byte[64 * 1024];
            Arrays.fill(block, (byte) i);
            retained[i % retained.length] = block;
            sink = block;
        }
        System.out.println("allocatedMiB=256");
        System.out.println("retainedBlocks=" + retained.length);
        System.out.println("lastByte=" + retained[15][0]);
    }
}
