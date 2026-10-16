import java.util.Comparator;
import java.util.TreeMap;
import java.util.TreeSet;

public class SortedDemo {
    public static void main(String[] args) {
        var deadlines = new TreeMap<Integer, String>();
        deadlines.put(10, "backup");
        deadlines.put(20, "verify");
        deadlines.put(30, "archive");
        System.out.println("floor=" + deadlines.floorKey(25));
        System.out.println("ceiling=" + deadlines.ceilingKey(25));
        var window = deadlines.subMap(10, true, 30, false);
        System.out.println("window=" + window.keySet());
        window.remove(20);
        System.out.println("original=" + deadlines.keySet());

        var lengthOnly = new TreeSet<String>(Comparator.comparingInt(String::length));
        lengthOnly.add("db");
        lengthOnly.add("io");
        System.out.println("lengthOnlySize=" + lengthOnly.size());
        var distinct = new TreeSet<String>(
                Comparator.comparingInt(String::length).thenComparing(Comparator.naturalOrder()));
        distinct.add("io");
        distinct.add("db");
        distinct.add("cpu");
        System.out.println("distinct=" + distinct);
    }
}
