public class TypeDemo {
    public static void main(String[] args) {
        int days = 30;
        long wrong = days * 24 * 60 * 60 * 1000;
        long correct = days * 24L * 60 * 60 * 1000;
        System.out.println("wrong=" + wrong);
        System.out.println("correct=" + correct);
        System.out.println("narrow=" + (byte) 130);
        System.out.println("fraction=" + (5 / 2));
        System.out.println("floating=" + (0.1 + 0.2));

        int[] first = {3};
        int[] second = first;
        second[0] = 9;
        System.out.println("shared=" + first[0]);

        Integer missing = null;
        try {
            int value = missing;
            System.out.println(value);
        } catch (NullPointerException expected) {
            System.out.println("unboxing=null");
        }
    }
}
