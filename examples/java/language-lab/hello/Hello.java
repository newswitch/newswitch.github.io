public class Hello {
    public static void main(String[] args) {
        String name = args.length == 0 ? "Java" : args[0];
        System.out.println("Hello, " + name);
    }
}
