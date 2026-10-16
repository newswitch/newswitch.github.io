import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class MapDemo {
    record TaskId(long value) {}

    public static void main(String[] args) {
        Map<TaskId, String> tasks = HashMap.newHashMap(10);
        tasks.put(new TaskId(7), "first");
        tasks.put(new TaskId(7), "updated");
        System.out.println("size=" + tasks.size());
        System.out.println("lookup=" + tasks.get(new TaskId(7)));

        var ordered = new LinkedHashMap<String, Integer>();
        ordered.put("b", 2);
        ordered.put("a", 1);
        ordered.put("b", 3);
        System.out.println("insertion=" + ordered.keySet());

        var access = new LinkedHashMap<String, Integer>(16, 0.75f, true);
        access.put("a", 1);
        access.put("b", 2);
        access.get("a");
        System.out.println("access=" + access.keySet());

        var labels = new HashSet<>(List.of("daily", "daily", "urgent"));
        System.out.println("unique=" + labels.size());
        ordered.merge("a", 10, Integer::sum);
        System.out.println("merged=" + ordered.get("a"));
    }
}
