import java.util.ArrayList;
import java.util.LinkedList;
import java.util.List;

public class ListDemo {
    public static void main(String[] args) {
        var values = new ArrayList<>(List.of(10, 20, 30));
        values.ensureCapacity(100);
        System.out.println("size=" + values.size());
        values.remove(1);
        System.out.println("byIndex=" + values);
        values.remove(Integer.valueOf(10));
        System.out.println("byValue=" + values);

        var linked = new LinkedList<>(List.of("a", "c"));
        var iterator = linked.listIterator();
        iterator.next();
        iterator.add("b");
        System.out.println("inserted=" + linked);
        linked.removeIf("b"::equals);
        System.out.println("filtered=" + linked);

        List<Integer> emptyWithCapacity = new ArrayList<>(100);
        System.out.println("capacityIsNotSize=" + emptyWithCapacity.isEmpty());
    }
}
