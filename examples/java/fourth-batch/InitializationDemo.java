public class InitializationDemo {
    static class Parent {
        static { System.out.println("Parent initialized"); }
    }
    static class Child extends Parent {
        static final int CONSTANT = 7;
        static int value = initialize();
        static int initialize() {
            System.out.println("Child initialized");
            return 9;
        }
    }

    public static void main(String[] args) throws Exception {
        System.out.println(Child.CONSTANT);
        ClassLoader loader = InitializationDemo.class.getClassLoader();
        Class.forName("InitializationDemo$Child", false, loader);
        System.out.println("loaded without initialization");
        System.out.println(Child.value);
    }
}
