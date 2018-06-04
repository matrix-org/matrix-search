package clientapi

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"github.com/matrix-org/gomatrix"
	"github.com/matrix-org/matrix-search/common"
)

type requestGroup struct {
	Key string `json:"key"` // room_id/sender
}

type requestGroupings struct {
	GroupBy []requestGroup `json:"group_by"`
}

type RequestEventContext struct {
	beforeLimit    *int `json:"before_limit"`
	afterLimit     *int `json:"after_limit"`
	IncludeProfile bool `json:"include_profile"`
}

func (rec *RequestEventContext) BeforeLimit() int {
	if rec.beforeLimit != nil {
		return *rec.beforeLimit
	}
	return 5
}

func (rec *RequestEventContext) AfterLimit() int {
	if rec.afterLimit != nil {
		return *rec.afterLimit
	}
	return 5
}

type RequestGroups struct {
	//Groupings []RequestGroups
	roomID bool
	sender bool
}

func (rg *RequestGroups) UnmarshalJSON(b []byte) error {
	var groupings requestGroupings
	err := json.Unmarshal(b, &groupings)
	if err != nil {
		return err
	}

	*rg = RequestGroups{}

	for _, v := range groupings.GroupBy {
		switch v.Key {
		case "room_id":
			rg.roomID = true
		case "sender":
			rg.sender = true
		default:
			return errors.New("invalid group by keys")
		}
	}
	return nil
}

type FilterPart struct {
	Rooms       common.StringSet
	NotRooms    common.StringSet
	Senders     common.StringSet
	NotSenders  common.StringSet
	Types       common.StringSet
	NotTypes    common.StringSet
	Limit       int
	ContainsURL *bool
	//gomatrix.FilterPart
}

func (fp *FilterPart) UnmarshalJSON(b []byte) error {
	var filter gomatrix.FilterPart
	err := json.Unmarshal(b, &filter)
	if err != nil {
		return err
	}

	// Limit (default=10)
	limit := 10
	if filter.Limit != nil {
		limit = *filter.Limit
	}

	*fp = FilterPart{
		Limit:       limit,
		ContainsURL: filter.ContainsURL,

		Rooms:      common.StringSet{},
		NotRooms:   common.StringSet{},
		Senders:    common.StringSet{},
		NotSenders: common.StringSet{},
		Types:      common.StringSet{},
		NotTypes:   common.StringSet{},
	}

	if len(filter.Rooms) > 0 {
		fp.Rooms.AddStrings(filter.Rooms)
	}
	if len(filter.NotRooms) > 0 {
		fp.NotRooms.AddStrings(filter.NotRooms)
	}

	if len(filter.Senders) > 0 {
		fp.Senders.AddStrings(filter.Senders)
	}
	if len(filter.NotSenders) > 0 {
		fp.NotSenders.AddStrings(filter.NotSenders)
	}

	if len(filter.Types) > 0 {
		fp.Types.AddStrings(filter.Types)
	}
	if len(filter.NotTypes) > 0 {
		fp.NotTypes.AddStrings(filter.NotTypes)
	}

	return nil
}

func (fp *FilterPart) filterRooms(roomIDs []string) common.StringSet {
	ss := common.NewStringSet(roomIDs)
	if !fp.NotRooms.IsEmpty() {
		ss.Remove(fp.NotRooms)
	}

	if !fp.Rooms.IsEmpty() {
		ss.Intersect(fp.Rooms)
	}

	return ss
}

func (fp *FilterPart) checkField(field string, allowed, disallowed common.StringSet) bool {
	if disallowed.Has(field) {
		return false
	}
	if !allowed.IsEmpty() && !allowed.Has(field) {
		return false
	}
	return true
}

func (fp *FilterPart) checkFields(roomID, sender, evType string, isURL bool) bool {
	if !fp.checkField(roomID, fp.Rooms, fp.NotRooms) {
		return false
	}
	if !fp.checkField(sender, fp.Senders, fp.NotSenders) {
		return false
	}
	if !fp.checkField(evType, fp.Types, fp.NotTypes) {
		return false
	}

	if fp.ContainsURL != nil {
		if *fp.ContainsURL != isURL {
			return false
		}
	}
	return true
}

func (fp *FilterPart) filterEv(ev *WrappedEvent) bool {
	sender := ev.Sender
	roomID := ev.RoomID
	evType := ev.Type
	_, isURL := ev.Content["url"]
	return fp.checkFields(roomID, sender, evType, isURL)
}

func (fp *FilterPart) filter(events []*Result) []*Result {
	// destructive filter, writes over original array.
	filtered := events[:0]
	for _, e := range events {
		// TODO handle Presence events
		if fp.filterEv(e.Result) {
			filtered = append(filtered, e)
		}
	}

	return filtered
}

type RequestRoomEvents struct {
	SearchTerm   string               `json:"search_term"`
	Keys         []string             `json:"keys"`
	Filter       FilterPart           `json:"filter"`
	OrderBy      string               `json:"order_by"`
	EventContext *RequestEventContext `json:"event_context"`
	IncludeState bool                 `json:"include_state"`
	Groupings    RequestGroups        `json:"groupings"`
}

type RequestCategories struct {
	RoomEvents RequestRoomEvents `json:"room_events"`
}

type SearchRequest struct {
	SearchCategories RequestCategories `json:"search_categories"`
}

type batch struct {
	Group    *string `json:"group,omitempty"`
	GroupKey *string `json:"group_key,omitempty"`
	Token    *string `json:"token,omitempty"`
}

func (b *batch) HasToken() bool {
	return b != nil && b.Token != nil
}

func (b *batch) isValid() bool {
	return b != nil && b.Group != nil && b.GroupKey != nil
}

func (b *batch) isGrouping(str string) bool {
	return b != nil && b.Group != nil && *b.Group == str
}

func readBatch(str string) (b *batch, err error) {
	dec, err := base64.URLEncoding.DecodeString(str)
	if err != nil {
		return
	}

	err = json.Unmarshal(dec, &b)
	if err == nil && (b.Group == nil || b.GroupKey == nil || b.Token == nil) {
		err = errors.New("invalid batch")
		return
	}
	return
}

func newBatch(group, key, token string) (string, error) {
	b, err := json.Marshal(&batch{&group, &key, &token})
	if err != nil {
		return "", err
	}

	return base64.URLEncoding.EncodeToString(b), nil
}
