import java.util.ArrayList;
import java.util.List;

public class GenericDemo {
    static <T> void copy(List<? extends T> source, List<? super T> target) {
        for (T value : source) {
            target.add(value);
        }
    }

    static double sum(List<? extends Number> values) {
        double result = 0;
        for (Number value : values) {
            result += value.doubleValue();
        }
        return result;
    }

    public static void main(String[] args) {
        List<Integer> source = List.of(1, 2, 3);
        List<Number> target = new ArrayList<>();
        copy(source, target);
        System.out.println("copied=" + target);
        System.out.println("sum=" + sum(source));
        List<String> words = new ArrayList<>();
        List<Integer> numbers = new ArrayList<>();
        System.out.println("sameRuntimeClass=" + (words.getClass() == numbers.getClass()));
        Object value = source;
        System.out.println("isList=" + (value instanceof List<?>));
    }
}
