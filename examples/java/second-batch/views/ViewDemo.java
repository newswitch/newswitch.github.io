import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public class ViewDemo {
    public static void main(String[] args) {
        var source = new ArrayList<>(List.of("a", "b"));
        List<String> view = Collections.unmodifiableList(source);
        List<String> snapshot = List.copyOf(source);
        source.add("c");
        System.out.println("view=" + view);
        System.out.println("snapshot=" + snapshot);
        var iterator = source.iterator();
        while (iterator.hasNext()) {
            if (iterator.next().equals("b")) {
                iterator.remove();
            }
        }
        System.out.println("removed=" + source);

        String[] array = {"x", "y"};
        List<String> fixed = Arrays.asList(array);
        fixed.set(0, "z");
        System.out.println("array=" + Arrays.toString(array));
        try {
            fixed.add("q");
        } catch (UnsupportedOperationException expected) {
            System.out.println("fixedSize=true");
        }
        var part = source.subList(0, 1);
        part.clear();
        System.out.println("afterSubList=" + source);
    }
}
