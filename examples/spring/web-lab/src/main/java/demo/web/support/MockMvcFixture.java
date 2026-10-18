package demo.web.support;

import org.springframework.mock.web.MockServletContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.support.AnnotationConfigWebApplicationContext;

public final class MockMvcFixture implements AutoCloseable {
    private final AnnotationConfigWebApplicationContext context = new AnnotationConfigWebApplicationContext();
    private final MockMvc mvc;
    public MockMvcFixture(Class<?> configuration) {
        context.setServletContext(new MockServletContext());
        context.register(configuration);
        try {
            context.refresh();
            mvc = MockMvcBuilders.webAppContextSetup(context).build();
        } catch (RuntimeException error) { context.close(); throw error; }
    }
    public MockMvc mvc() { return mvc; }
    public AnnotationConfigWebApplicationContext context() { return context; }
    @Override public void close() { context.close(); }
}
