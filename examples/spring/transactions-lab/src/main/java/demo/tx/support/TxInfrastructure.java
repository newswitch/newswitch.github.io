package demo.tx.support;

import java.sql.SQLException;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.EnableTransactionManagement;

@Configuration(proxyBeanMethods = false)
@EnableTransactionManagement
public class TxInfrastructure {
    @Bean(destroyMethod = "close") LabDatabase database() throws SQLException { return new LabDatabase(); }
    @Bean PlatformTransactionManager transactionManager(LabDatabase database) { return database.manager(); }
}
