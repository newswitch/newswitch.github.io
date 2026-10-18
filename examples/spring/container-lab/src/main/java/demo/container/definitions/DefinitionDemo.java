package demo.container.definitions;

import org.springframework.beans.factory.support.RootBeanDefinition;
import org.springframework.context.support.GenericApplicationContext;

public class DefinitionDemo {
    public static class QueueSettings {
        private int capacity;
        public void setCapacity(int capacity) {
            if (capacity < 1) throw new IllegalArgumentException("capacity must be positive");
            this.capacity = capacity;
        }
        public int getCapacity() { return capacity; }
    }

    public static void main(String[] args) {
        try (var context = new GenericApplicationContext()) {
            RootBeanDefinition definition = new RootBeanDefinition(QueueSettings.class);
            definition.setLazyInit(true);
            definition.getPropertyValues().add("capacity", 4);
            context.registerBeanDefinition("queueSettings", definition);
            context.refresh();
            System.out.println("definition=" + context.containsBeanDefinition("queueSettings"));
            System.out.println("beforeGet=" + context.getBeanFactory().containsSingleton("queueSettings"));
            QueueSettings settings = context.getBean("queueSettings", QueueSettings.class);
            System.out.println("capacity=" + settings.getCapacity());
            System.out.println("afterGet=" + context.getBeanFactory().containsSingleton("queueSettings"));
        }
    }
}
