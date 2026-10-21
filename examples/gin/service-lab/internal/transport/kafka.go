package transport

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/twmb/franz-go/pkg/kgo"
	"newswitch.dev/gin-service-lab/internal/store"
	"time"
)

type Kafka struct {
	Client *kgo.Client
	Topic  string
}

func NewKafka(address, topic, group string) (*Kafka, error) {
	if address == "" || topic == "" {
		return nil, fmt.Errorf("broker and topic required")
	}
	options := []kgo.Opt{kgo.SeedBrokers(address), kgo.RequiredAcks(kgo.AllISRAcks()), kgo.RecordDeliveryTimeout(5 * time.Second), kgo.MaxBufferedRecords(100)}
	if group != "" {
		options = append(options, kgo.ConsumerGroup(group), kgo.ConsumeTopics(topic), kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()), kgo.DisableAutoCommit(), kgo.BlockRebalanceOnPoll())
	}
	client, err := kgo.NewClient(options...)
	if err != nil {
		return nil, err
	}
	return &Kafka{Client: client, Topic: topic}, nil
}
func (k *Kafka) Close() { k.Client.Close() }
func (k *Kafka) Publish(ctx context.Context, event store.Event) error {
	body, err := json.Marshal(event)
	if err != nil {
		return err
	}
	return k.Client.ProduceSync(ctx, &kgo.Record{Topic: k.Topic, Key: []byte(event.TaskID), Value: body}).FirstErr()
}

// Stop on any unhandled record error. Operators must repair/quarantine it; never silently commit a poison event.
func (k *Kafka) Consume(ctx context.Context, s *store.Store) error {
	for {
		fetches := k.Client.PollRecords(ctx, 10)
		if err := fetches.Err(); err != nil {
			return err
		}
		records := fetches.Records()
		for _, record := range records {
			if len(record.Value) > 4096 {
				k.Client.AllowRebalance()
				return fmt.Errorf("oversized event")
			}
			var event store.Event
			if err := json.Unmarshal(record.Value, &event); err != nil {
				k.Client.AllowRebalance()
				return err
			}
			if _, err := s.Apply(ctx, event); err != nil {
				k.Client.AllowRebalance()
				return err
			}
			if err := k.Client.CommitRecords(ctx, record); err != nil {
				k.Client.AllowRebalance()
				return err
			}
		}
		k.Client.AllowRebalance()
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
}
