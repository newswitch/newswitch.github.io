package demo.boot.dependencies;

import org.springframework.boot.SpringBootVersion;
import org.springframework.core.SpringVersion;

public final class DependencyDemo {
    public static void main(String[] args) throws Exception {
        System.out.println("boot=" + SpringBootVersion.getVersion());
        System.out.println("spring=" + SpringVersion.getVersion());
        System.out.println("mvcPresent=" + (Class.forName("org.springframework.web.servlet.DispatcherServlet") != null));
        System.out.println("greetingApiPresent=" + (Class.forName("io.newswitch.greeting.GreetingService") != null));
    }
}
