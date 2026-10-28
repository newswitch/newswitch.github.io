package lab.plus;

import com.baomidou.mybatisplus.annotation.DbType;
import com.baomidou.mybatisplus.extension.plugins.MybatisPlusInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.OptimisticLockerInnerInterceptor;
import com.baomidou.mybatisplus.extension.plugins.inner.PaginationInnerInterceptor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
public class PlusConfiguration {
    @Bean MybatisPlusInterceptor plugins() {
        var interceptor = new MybatisPlusInterceptor();
        interceptor.addInnerInterceptor(new OptimisticLockerInnerInterceptor());
        var pagination = new PaginationInnerInterceptor(DbType.H2); pagination.setMaxLimit(100L);
        interceptor.addInnerInterceptor(pagination);
        return interceptor;
    }
}
