package lab.persistence;

import java.sql.Connection;
import java.util.concurrent.atomic.AtomicInteger;
import org.apache.ibatis.executor.statement.StatementHandler;
import org.apache.ibatis.plugin.*;
import org.springframework.stereotype.Component;

@Component
@Intercepts(@Signature(type=StatementHandler.class, method="prepare", args={Connection.class, Integer.class}))
public class SqlCounter implements Interceptor {
    private final AtomicInteger prepares = new AtomicInteger();
    @Override public Object intercept(Invocation invocation) throws Throwable {
        prepares.incrementAndGet();
        return invocation.proceed();
    }
    public int count() { return prepares.get(); }
    public void reset() { prepares.set(0); }
}
