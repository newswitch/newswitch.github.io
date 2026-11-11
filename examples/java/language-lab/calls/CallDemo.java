public class CallDemo {
    static void changeNumber(int value) {
        value = 9;
    }

    static void mutate(int[] values) {
        values[0] = 9;
    }

    static void replace(int[] values) {
        values = new int[] {99};
    }

    static String choose(Object value) {
        return "Object";
    }

    static String choose(String value) {
        return "String";
    }

    static int sum(int... values) {
        int total = 0;
        for (int value : values) {
            total += value;
        }
        return total;
    }

    public static void main(String[] args) {
        int count = 3;
        changeNumber(count);
        int[] shared = {3};
        mutate(shared);
        replace(shared);
        Object text = "task";
        System.out.println("number=" + count);
        System.out.println("array=" + shared[0]);
        System.out.println("overload=" + choose(text));
        System.out.println("sum=" + sum(1, 2, 3));
    }
}
