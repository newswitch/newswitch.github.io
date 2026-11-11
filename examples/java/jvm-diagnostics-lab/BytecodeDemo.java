public class BytecodeDemo {
    static int total(int price, int count) {
        int result = price * count;
        return result + 2;
    }

    public static void main(String[] args) {
        System.out.println(total(7, 3));
    }
}
