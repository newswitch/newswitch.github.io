import java.util.List;

public class StartupDemo {
    public static void main(String[] args) {
        List<String> tasks = List.of("load", "validate", "serve");
        System.out.println("tasks=" + String.join(",", tasks));
    }
}
