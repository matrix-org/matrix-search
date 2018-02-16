package clientapi

import "github.com/matrix-org/gomatrix"

type GroupValue struct {
	NextBatch *string  `json:"next_batch,omitempty"`
	Order     float64  `json:"order,omitempty"`
	Results   []string `json:"results,omitempty"`
}

func (sg GroupValue) addResult(res string) {
	sg.Results = append(sg.Results, res)
}

func makeGroupValue(order float64) GroupValue {
	return GroupValue{
		Results: []string{},
		Order:   order,
	}
}

type UserProfile struct {
	DisplayName string `json:"displayname,omitempty"`
	AvatarURL   string `json:"avatar_url,omitempty"`
}

type EventContext struct {
	Start        string                  `json:"start,omitempty"`
	End          string                  `json:"end,omitempty"`
	ProfileInfo  map[string]*UserProfile `json:"profile_info,omitempty"`
	EventsBefore []*gomatrix.Event       `json:"events_before,omitempty"`
	EventsAfter  []*gomatrix.Event       `json:"events_after,omitempty"`
}

type ResultSet struct {
}

type Result struct {
	Rank    float64       `json:"rank"`
	Result  *WrappedEvent `json:"result"`
	Context *EventContext `json:"context,omitempty"`
}

type RoomEventResults struct {
	Count     int                              `json:"count"`
	Results   []*Result                        `json:"results"`
	State     map[string][]*gomatrix.Event     `json:"state,omitempty"`
	Groups    map[string]map[string]GroupValue `json:"groups,omitempty"`
	NextBatch *string                          `json:"next_batch,omitempty"`
}

type Categories struct {
	RoomEvents RoomEventResults `json:"room_events"`
}

type Results struct {
	SearchCategories Categories `json:"search_categories"`
}
