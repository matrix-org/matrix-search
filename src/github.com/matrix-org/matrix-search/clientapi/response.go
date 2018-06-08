package clientapi

import (
	"github.com/gin-gonic/gin/json"
	"github.com/matrix-org/gomatrix"
	"sort"
)

type GroupValue struct {
	NextBatch *string  `json:"next_batch,omitempty"`
	Order     float64  `json:"order"`
	Results   []string `json:"results"`
}

type NormalizedGroupValue struct {
	NextBatch *string  `json:"next_batch,omitempty"`
	Order     int      `json:"order"`
	Results   []string `json:"results"`
}

type KeyOrderTuple struct {
	Key   string
	Order float64
}

type KeyOrderTupleList []KeyOrderTuple

func (l KeyOrderTupleList) Len() int {
	return len(l)
}
func (l KeyOrderTupleList) Swap(i, j int) {
	l[i], l[j] = l[j], l[i]
}
func (l KeyOrderTupleList) Less(i, j int) bool {
	return l[i].Order < l[i].Order
}

func (sg *GroupValue) addResult(res string) {
	sg.Results = append(sg.Results, res)
}

type GroupValueMap map[string]*GroupValue

func (gvm GroupValueMap) add(key, id string, order float64) {
	if _, ok := gvm[key]; !ok {
		gvm[key] = &GroupValue{
			Results: []string{},
			Order:   order,
		}
	}
	gvm[key].addResult(id)
}

func (gvm GroupValueMap) MarshalJSON() ([]byte, error) {
	list := make(KeyOrderTupleList, 0, len(gvm))
	normalized := make(map[string]*NormalizedGroupValue, len(gvm))

	for k, v := range gvm {
		list = append(list, KeyOrderTuple{k, v.Order})
		normalized[k] = &NormalizedGroupValue{
			NextBatch: v.NextBatch,
			Results:   v.Results,
		}
	}
	sort.Sort(list)

	for i := range list {
		normalized[list[i].Key].Order = i + 1
	}

	return json.Marshal(normalized)
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
	Count      int                               `json:"count"`
	Results    []*Result                         `json:"results"`
	State      map[string][]*gomatrix.Event      `json:"state,omitempty"`
	Groups     map[string]map[string]*GroupValue `json:"groups,omitempty"`
	NextBatch  *string                           `json:"next_batch,omitempty"`
	Highlights []string                          `json:"highlights"`
}

type Categories struct {
	RoomEvents RoomEventResults `json:"room_events"`
}

type Results struct {
	SearchCategories Categories `json:"search_categories"`
}
