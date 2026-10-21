package lab.delivery;

import java.time.Clock;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootApplication
public class DeliveryApplication {
    public static void main(String[] args) { SpringApplication.run(DeliveryApplication.class,args); }
    @Bean TransactionTemplate transactionTemplate(PlatformTransactionManager tm) { return new TransactionTemplate(tm); }
    @Bean Clock clock() { return Clock.systemUTC(); }
}
