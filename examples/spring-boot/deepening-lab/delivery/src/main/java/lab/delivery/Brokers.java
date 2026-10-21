package lab.delivery;

import com.rabbitmq.client.Channel;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.apache.kafka.clients.admin.NewTopic;
import org.apache.kafka.common.TopicPartition;
import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.amqp.rabbit.connection.CorrelationData;
import org.springframework.context.annotation.*;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.*;
import org.springframework.util.backoff.FixedBackOff;

@Configuration(proxyBeanMethods=false)
@Profile("brokers")
public class Brokers {
    public static final String TOPIC="boot-lab-events", QUEUE="boot-lab-events";
    @Bean NewTopic eventsTopic() { return new NewTopic(TOPIC,1,(short)1); }
    @Bean NewTopic deadTopic() { return new NewTopic(TOPIC+".DLT",1,(short)1); }
    @Bean DirectExchange exchange() { return new DirectExchange("boot-lab"); }
    @Bean DirectExchange deadExchange() { return new DirectExchange("boot-lab-dead"); }
    @Bean Queue eventsQueue() { return QueueBuilder.durable(QUEUE).deadLetterExchange("boot-lab-dead").deadLetterRoutingKey("failed").build(); }
    @Bean Queue deadQueue() { return QueueBuilder.durable(QUEUE+".dead").build(); }
    @Bean Binding eventsBinding() { return BindingBuilder.bind(eventsQueue()).to(exchange()).with("created"); }
    @Bean Binding deadBinding() { return BindingBuilder.bind(deadQueue()).to(deadExchange()).with("failed"); }
    @Bean CommonErrorHandler kafkaErrors(KafkaTemplate<String,String> template) {
        var recoverer=new DeadLetterPublishingRecoverer(template,(record,error)->new TopicPartition(TOPIC+".DLT",record.partition()));
        recoverer.setFailIfSendResultIsError(true);
        var handler=new DefaultErrorHandler(recoverer,new FixedBackOff(200L,2L));
        handler.addNotRetryableExceptions(IllegalArgumentException.class);
        return handler;
    }
    @Bean KafkaPublisher kafkaPublisher(KafkaTemplate<String,String> template) { return new KafkaPublisher(template); }
    @Bean RabbitPublisher rabbitPublisher(RabbitTemplate template) { return new RabbitPublisher(template); }
    @Bean Consumers consumers(Inbox inbox) { return new Consumers(inbox); }

    public record KafkaPublisher(KafkaTemplate<String,String> template) implements Relay.Publisher {
        @Override public void publish(TaskEvent event) throws Exception {
            template.send(TOPIC,event.taskId(),event.json()).get(5,TimeUnit.SECONDS);
        }
    }
    public record RabbitPublisher(RabbitTemplate template) implements Relay.Publisher {
        @Override public void publish(TaskEvent event) throws Exception {
            var correlation=new CorrelationData(UUID.randomUUID().toString());
            var message=MessageBuilder.withBody(event.json().getBytes(StandardCharsets.UTF_8))
                .setContentType("application/json").setMessageId(event.eventId()).setDeliveryMode(MessageDeliveryMode.PERSISTENT).build();
            template.send("boot-lab","created",message,correlation);
            var confirm=correlation.getFuture().get(5,TimeUnit.SECONDS);
            if (!confirm.ack() || correlation.getReturned()!=null) throw new IOException("publish rejected or unroutable");
        }
    }
    public record Consumers(Inbox inbox) {
        @KafkaListener(topics=TOPIC)
        public void kafka(String json) { inbox.apply(TaskEvent.parse(json)); }
        @RabbitListener(queues=QUEUE)
        public void rabbit(Message message,Channel channel) throws IOException {
            long tag=message.getMessageProperties().getDeliveryTag();
            try { inbox.apply(TaskEvent.parse(new String(message.getBody(),StandardCharsets.UTF_8))); }
            catch (RuntimeException error) {
                // Lab policy: park every failed delivery in DLQ for controlled recovery, never hot-loop requeue.
                channel.basicReject(tag,false); return;
            }
            channel.basicAck(tag,false);
        }
    }
}
