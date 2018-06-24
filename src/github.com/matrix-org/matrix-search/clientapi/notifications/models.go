package notifications

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"github.com/matrix-org/gomatrix"
)

type Content map[string]interface{}

func (c Content) Value() (driver.Value, error) {
	v, err := json.Marshal(c)
	return driver.Value(v), err
}

func (c *Content) Scan(src interface{}) error {
	var source []byte
	switch src.(type) {
	case string:
		source = []byte(src.(string))
	case []byte:
		source = src.([]byte)
	default:
		return errors.New("incompatible type for Content")
	}

	return json.Unmarshal(source, &c)
}

type Event struct {
	RoomID    string  `db:"room_id"`
	EventID   string  `db:"event_id"`
	Sender    string  `db:"sender"`
	Type      string  `db:"type"`
	StateKey  *string `db:"state_key,omitempty"`
	Content   Content `db:"content"`
	Redacts   string  `db:"redacts,omitempty"`
	Timestamp int64   `db:"timestamp"`

	ContainsURL    bool `db:"contains_url"`
	IsNotification bool `db:"is_notification"`
}

func (Event) TableName() string {
	return "events"
}

func NewEvent(ev *gomatrix.Event, containsURL, isNotification bool) *Event {
	return &Event{
		RoomID:    ev.RoomID,
		EventID:   ev.ID,
		Sender:    ev.Sender,
		Type:      ev.Type,
		StateKey:  ev.StateKey,
		Content:   ev.Content,
		Redacts:   ev.Redacts,
		Timestamp: ev.Timestamp,

		ContainsURL:    containsURL,
		IsNotification: isNotification,
	}
}

type Tweak struct {
	RoomID  string `sql:"room_id"`
	EventID string `sql:"event_id"`
	Tweak   string `sql:"tweak"`
	Value   string `sql:"value"`
}

func (Tweak) TableName() string {
	return "notification_tweaks"
}

func NewModelTweak(roomID, eventID, tweak, value string) *Tweak {
	return &Tweak{roomID, eventID, tweak, value}
}
