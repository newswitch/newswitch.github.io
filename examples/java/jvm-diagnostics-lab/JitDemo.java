public class JitDemo {
    static int score(int value) {
        return value * 31 + 7;
    }

    public static void main(String[] args) {
        long sum = 0;
        for (int i = 0; i < 1_000_000; i++) {
            sum += score(i);
        }
        System.out.println("sum=" + sum);
    }
}
