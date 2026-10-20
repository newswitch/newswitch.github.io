package demo.internals.creation;

import org.springframework.beans.BeansException;
import org.springframework.beans.factory.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

public final class CreationDemo {
    public static class A implements InitializingBean {
        @Autowired public B b;
        public boolean ready;
        @Override public void afterPropertiesSet() { ready = true; }
    }
    public static class B implements InitializingBean {
        @Autowired public A a;
        public boolean sawReady;
        @Override public void afterPropertiesSet() { sawReady = a.ready; }
    }
    public static class ConstructorA { public ConstructorA(ConstructorB b) {} }
    public static class ConstructorB { public ConstructorB(ConstructorA a) {} }
    public static boolean causedBy(Throwable error, Class<? extends Throwable> type) {
        for (Throwable current = error; current != null; current = current.getCause())
            if (type.isInstance(current)) return true;
        return false;
    }
    public static void main(String[] args) {
        try (var context = new AnnotationConfigApplicationContext()) {
            context.getDefaultListableBeanFactory().setAllowCircularReferences(true);
            context.registerBean("a", A.class); context.registerBean("b", B.class);
            context.refresh();
            A a = context.getBean(A.class); B b = context.getBean(B.class);
            System.out.println("sameA=" + (a == b.a));
            System.out.println("bSawReady=" + b.sawReady);
            System.out.println("aReady=" + a.ready);
        }
        try (var context = new AnnotationConfigApplicationContext()) {
            context.getDefaultListableBeanFactory().setAllowCircularReferences(true);
            context.registerBean(ConstructorA.class); context.registerBean(ConstructorB.class);
            try { context.refresh(); throw new AssertionError("Cycle unexpectedly resolved"); }
            catch (BeansException error) {
                if (!causedBy(error, BeanCurrentlyInCreationException.class)) throw error;
                System.out.println("constructorCycle=blocked");
            }
        }
    }
}
