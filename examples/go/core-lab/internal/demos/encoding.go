package demos

import "encoding/json"

func EncodeDynamic(payload []byte) ([]byte, error) {
	return json.Marshal(map[string]any{"kind": "demo", "payload": payload})
}
func EncodeTyped(payload []byte) ([]byte, error) {
	return json.Marshal(struct {
		Kind    string `json:"kind"`
		Payload []byte `json:"payload"`
	}{"demo", payload})
}
