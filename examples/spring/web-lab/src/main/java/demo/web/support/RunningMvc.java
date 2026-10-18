package demo.web.support;

import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;
import org.springframework.web.servlet.DispatcherServlet;
import java.net.URI;

public final class RunningMvc implements AutoCloseable {
    private final EmbeddedTomcat server;
    private final AnnotationConfigWebApplicationContext context;
    public RunningMvc(Class<?> configuration) throws Exception { this(configuration, false); }
    public RunningMvc(Class<?> configuration, boolean webSocket) throws Exception {
        server = new EmbeddedTomcat();
        context = new AnnotationConfigWebApplicationContext();
        context.register(configuration);
        try {
            if (webSocket) server.enableWebSocket();
            server.servlet("mvc", "/", new DispatcherServlet(context));
            server.start();
            if (!context.isActive()) throw new IllegalStateException("MVC context did not start");
        } catch (Exception error) {
            try { close(); } catch (Exception cleanup) { error.addSuppressed(cleanup); }
            throw error;
        }
    }
    public URI baseUri() { return server.baseUri(); }
    public AnnotationConfigWebApplicationContext context() { return context; }
    @Override public void close() throws Exception {
        try { server.close(); } finally { context.close(); }
    }
}
