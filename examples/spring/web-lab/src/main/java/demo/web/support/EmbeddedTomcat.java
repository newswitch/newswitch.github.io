package demo.web.support;

import jakarta.servlet.http.HttpServlet;
import org.apache.catalina.Context;
import org.apache.catalina.startup.Tomcat;
import org.apache.tomcat.websocket.server.WsSci;
import java.net.URI;
import java.nio.file.*;
import java.util.Comparator;
import java.util.Set;

public final class EmbeddedTomcat implements AutoCloseable {
    private final Path base = Files.createTempDirectory("spring-web-tomcat-");
    private final Tomcat tomcat = new Tomcat();
    private final Context context;
    public EmbeddedTomcat() throws Exception {
        tomcat.setBaseDir(base.toString());
        tomcat.setPort(0);
        tomcat.getConnector().setProperty("address", "127.0.0.1");
        tomcat.getConnector().setProperty("maxThreads", "4");
        tomcat.getConnector().setProperty("minSpareThreads", "1");
        tomcat.getConnector().setProperty("acceptCount", "8");
        context = tomcat.addContext("", base.toString());
        context.setParentClassLoader(EmbeddedTomcat.class.getClassLoader());
    }
    public void servlet(String name, String mapping, HttpServlet servlet) {
        var wrapper = Tomcat.addServlet(context, name, servlet);
        wrapper.setLoadOnStartup(1);
        wrapper.setAsyncSupported(true);
        context.addServletMappingDecoded(mapping, name);
    }
    public void enableWebSocket() {
        context.addServletContainerInitializer(new WsSci(), Set.of());
    }
    public void start() throws Exception { tomcat.start(); }
    public URI baseUri() {
        return URI.create("http://127.0.0.1:" + tomcat.getConnector().getLocalPort());
    }
    @Override public void close() throws Exception {
        try { tomcat.stop(); }
        finally {
            try { tomcat.destroy(); }
            finally {
                Path expected = Path.of(System.getProperty("java.io.tmpdir")).toRealPath();
                if (!base.getParent().toRealPath().equals(expected)
                        || !base.getFileName().toString().startsWith("spring-web-tomcat-"))
                    throw new IllegalStateException("Unexpected cleanup path: " + base);
                try (var files = Files.walk(base)) {
                    for (Path file : files.sorted(Comparator.reverseOrder()).toList()) Files.delete(file);
                }
            }
        }
    }
}
