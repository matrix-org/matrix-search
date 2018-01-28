package clientapi

import (
	"encoding/json"
	"fmt"
	"github.com/gorilla/mux"
	"github.com/matrix-org/gomatrix"
	"github.com/matrix-org/matrix-search/indexing"
	"net/http"
	"github.com/blevesearch/bleve"
	"github.com/blevesearch/bleve/search/query"
	"github.com/fatih/set"
	"strings"
)

type GroupValue struct {
	NextBatch *string  `json:"next_batch"`
	Order     int      `json:"order"`
	Results   []string `json:"results"`
}

type UserProfile struct {
	DisplayName string `json:"displayname"`
	AvatarURL   string `json:"avatar_url"`
}

type EventContext struct {
	Start        string                  `json:"start"`
	End          string                  `json:"end"`
	ProfileInfo  map[string]*UserProfile `json:"profile_info"`
	EventsBefore []*gomatrix.Event       `json:"events_before"`
	EventsAfter  []*gomatrix.Event       `json:"events_after"`
}

type Result struct {
	Rank    float64         `json:"rank"`
	Result  *gomatrix.Event `json:"result"`
	Context *EventContext   `json:"context"`
}

type RoomEventResults struct {
	Count     int                              `json:"count"`
	Results   []Result                         `json:"results"`
	State     map[string]*gomatrix.Event       `json:"state"`
	Groups    map[string]map[string]GroupValue `json:"groups"`
	NextBatch *string                          `json:"next_batch,omitempty"`
}

type Categories struct {
	RoomEvents RoomEventResults `json:"room_events"`
}

type Results struct {
	SearchCategories Categories `json:"search_categories"`
}

type RequestGroup struct {
	Key string `json:"key"` // room_id/sender
}

type RequestGroupings struct {
	GroupBy RequestGroup `json:"group_by"`
}

type RequestEventContext struct {
	BeforeLimit    int  `json:"before_limit"`
	AfterLimit     int  `json:"after_limit"`
	IncludeProfile bool `json:"include_profile"`
}

type RequestRoomEvents struct {
	SearchTerm string              `json:"search_term"`
	Keys       []string            `json:"keys"`
	Filter     gomatrix.FilterPart `json:"filter"`
	OrderBy    string              `json:"order_by"` // recent/rank
	//EventContext
	IncludeState bool               `json:"include_state"`
	Groupings    []RequestGroupings `json:"groupings"`
}

type RequestCategories struct {
	RoomEvents RequestRoomEvents `json:"room_events"`
}

type SearchRequest struct {
	SearchCategories RequestCategories `json:"search_categories"`
}

func generateQueryList(filterSet []string, fieldName string) []query.Query {
	if size := len(filterSet); size > 0 {
		queries := make([]query.Query, 0, size)
		for i := range filterSet {
			qr := query.NewTermQuery(filterSet[i])
			qr.SetField(fieldName)
			queries = append(queries, qr)
		}
		return queries
	}
	return nil
}

func RegisterHandler(router *mux.Router, idxr indexing.Indexer, cli *gomatrix.Client) {
	contextResolver := NewResolver(cli)

	router.HandleFunc("/clientapi/search/", func(w http.ResponseWriter, r *http.Request) {
		var sr SearchRequest
		if r.Body == nil {
			http.Error(w, "Please send a request body", 400)
			return
		}
		err := json.NewDecoder(r.Body).Decode(&sr)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}

		q := sr.SearchCategories.RoomEvents

		resp, err := contextResolver.JoinedRooms()
		if err != nil {
			panic(err)
		}

		joinedRoomIDsSet := set.NewNonTS()
		for i := range resp.JoinedRooms {
			joinedRoomIDsSet.Add(resp.JoinedRooms[i])
		}

		wantedRoomIDsSet := set.NewNonTS()
		for i := range q.Filter.Rooms {
			wantedRoomIDsSet.Add(q.Filter.Rooms[i])
		}

		joinedRoomIDsSet.Add("!room1")
		joinedRoomIDsSet.Add("!room2")

		roomIDsSet := set.Intersection(joinedRoomIDsSet, wantedRoomIDsSet)

		for i := range q.Filter.NotRooms {
			roomIDsSet.Remove(q.Filter.NotRooms[i])
		}

		//queryRoomID := make([]query.Query, 0, roomIDsSet.Size())
		//roomIDsSet.Each(func(item interface{}) bool {
		//	if roomId, ok := item.(string); ok {
		//		qr := query.NewTermQuery(roomId)
		//		qr.SetField("room_id")
		//		queryRoomID = append(queryRoomID, qr)
		//	}
		//	return true
		//})

		qr := bleve.NewBooleanQuery()

		// Must satisfy room_id
		qr.AddMust(query.NewDisjunctionQuery(generateQueryList(set.StringSlice(roomIDsSet), "room_id")))

		// Must satisfy sender
		mustSenders := generateQueryList(q.Filter.Senders, "sender")
		if len(mustSenders) > 0 {
			qr.AddMust(query.NewDisjunctionQuery(mustSenders))
		}

		//if q.Filter.Senders != nil && len(q.Filter.Senders) > 0 {
		//	senderQuery := query.NewDisjunctionQuery([]query.Query{})
		//	for i := range q.Filter.Senders {
		//		qr := query.NewTermQuery(q.Filter.Senders[i])
		//		qr.SetField("sender")
		//		senderQuery.AddQuery(qr)
		//	}
		//	must = append(must, senderQuery)
		//}

		// Must satisfy not sender
		qr.AddMustNot(generateQueryList(q.Filter.NotSenders, "sender")...)

		//if q.Filter.NotSenders != nil && len(q.Filter.NotSenders) > 0 {
		//	notSenderQuery := query.NewDisjunctionQuery([]query.Query{})
		//	for i := range q.Filter.NotSenders {
		//		qr := query.NewTermQuery(q.Filter.NotSenders[i])
		//	}
		//}

		// Must satisfy type
		mustType := generateQueryList(q.Filter.Types, "type")
		if len(mustType) > 0 {
			qr.AddMust(query.NewDisjunctionQuery(mustType))
		}

		// Must satisfy not type
		qr.AddMustNot(generateQueryList(q.Filter.NotTypes, "type")...)

		// The user-entered query string
		qr.AddMust(query.NewQueryStringQuery(strings.ToLower(q.SearchTerm)))

		//res, err := idxr.QueryMultiple(set.StringSlice(roomIDsSet), q.SearchTerm)
		req := bleve.NewSearchRequest(qr)
		res, err := idxr.Query(req)

		if err != nil {
			fmt.Println(err)
			http.Error(w, err.Error(), 400)
			return
			// TODO handle err
		}

		//events := make([]string, 0, len(res.Hits))
		results := make([]Result, 0, len(res.Hits))

		for _, hit := range res.Hits {
			//events = append(events, hit.ID)
			//segs := strings.SplitN(hit.ID, "/", 2)
			//context, err := contextResolver.resolveEvent(segs[0], segs[1], 2)
			//if err != nil {
			//	panic(err)
			//}
			result := Result{
				Rank: hit.Score,
				//Result: context.Event,
				//Context: &EventContext{
				//	Start:        context.Start,
				//	End:          context.End,
				//	ProfileInfo:  map[string]*UserProfile{},
				//	EventsBefore: context.EventsBefore,
				//	EventsAfter:  context.EventsAfter,
				//},
			}
			results = append(results, result)
		}

		//hits, err := json.Marshal(events)
		hits, err := json.Marshal(Results{
			Categories{
				RoomEventResults{
					Count:   int(res.Total),
					Results: results,
					//State: ,
					//Groups:,
					//NextBatch:,
				},
			},
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Write(hits)
	})
}
