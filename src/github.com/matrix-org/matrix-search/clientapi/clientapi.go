package clientapi

import (
	"encoding/json"
	"errors"
	"github.com/blevesearch/bleve"
	"github.com/blevesearch/bleve/search/query"
	"github.com/fatih/set"
	"github.com/gorilla/mux"
	"github.com/matrix-org/gomatrix"
	"github.com/matrix-org/matrix-search/indexing"
	"io"
	"net/http"
	"strings"
)

type GroupValue struct {
	NextBatch *string  `json:"next_batch,omitempty"`
	Order     int      `json:"order,omitempty"`
	Results   []string `json:"results,omitempty"`
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

type Result struct {
	Rank    float64         `json:"rank"`
	Result  *gomatrix.Event `json:"result"`
	Context *EventContext   `json:"context,omitempty"`
}

type RoomEventResults struct {
	Count     int                              `json:"count"`
	Results   []Result                         `json:"results"`
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

type RequestGroup struct {
	Key string `json:"key"` // room_id/sender
}

type RequestGroupings struct {
	GroupBy RequestGroup `json:"group_by"`
}

type RequestEventContext struct {
	BeforeLimit    *int `json:"before_limit"`
	AfterLimit     *int `json:"after_limit"`
	IncludeProfile bool `json:"include_profile"`
}

type RequestRoomEvents struct {
	SearchTerm   string               `json:"search_term"`
	Keys         []string             `json:"keys"`
	Filter       gomatrix.FilterPart  `json:"filter"`
	OrderBy      string               `json:"order_by"` // recent/rank // TODO
	EventContext *RequestEventContext `json:"event_context"`
	IncludeState bool                 `json:"include_state"`
	Groupings    []RequestGroupings   `json:"groupings"` // TODO
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

func handler(body io.ReadCloser, idxr indexing.Indexer, hsURL, localpart, token string) (resp interface{}, err error) {
	var sr SearchRequest
	if body == nil {
		err = errors.New("please send a request body")
		return
	}

	err = json.NewDecoder(body).Decode(&sr)
	if err != nil {
		return
	}

	// TODO Should we use the Token given in the REQ then lookup their userid or WAT
	cli, err := NewWrappedClient("@testguy:synapse", hsURL, localpart, token)
	if err != nil {
		return
	}

	joinedRooms, err := cli.joinedRooms()
	if err != nil {
		return
	}

	joinedRoomIDsSet := set.NewNonTS()
	for i := range joinedRooms.JoinedRooms {
		joinedRoomIDsSet.Add(joinedRooms.JoinedRooms[i])
	}

	q := sr.SearchCategories.RoomEvents

	wantedRoomIDsSet := set.NewNonTS()
	for i := range q.Filter.Rooms {
		wantedRoomIDsSet.Add(q.Filter.Rooms[i])
	}

	roomIDsSet := set.Intersection(joinedRoomIDsSet, wantedRoomIDsSet)

	for i := range q.Filter.NotRooms {
		roomIDsSet.Remove(q.Filter.NotRooms[i])
	}

	qr := bleve.NewBooleanQuery()

	// Must satisfy room_id
	qr.AddMust(query.NewDisjunctionQuery(generateQueryList(set.StringSlice(roomIDsSet), "room_id")))

	// Must satisfy sender
	mustSenders := generateQueryList(q.Filter.Senders, "sender")
	if len(mustSenders) > 0 {
		qr.AddMust(query.NewDisjunctionQuery(mustSenders))
	}

	// Must satisfy not sender
	qr.AddMustNot(generateQueryList(q.Filter.NotSenders, "sender")...)

	// Must satisfy type
	mustType := generateQueryList(q.Filter.Types, "type")
	if len(mustType) > 0 {
		qr.AddMust(query.NewDisjunctionQuery(mustType))
	}

	// Must satisfy not type
	qr.AddMustNot(generateQueryList(q.Filter.NotTypes, "type")...)

	// The user-entered query string
	if len(q.Keys) > 0 {
		oneOf := query.NewDisjunctionQuery(nil)
		for _, key := range q.Keys {
			qrs := query.NewMatchQuery(strings.ToLower(q.SearchTerm))
			qrs.SetField(key)
			oneOf.AddQuery(qrs)
		}
		qr.AddMust(oneOf)
	} else {
		qr.AddMust(query.NewQueryStringQuery(strings.ToLower(q.SearchTerm)))
	}

	req := bleve.NewSearchRequest(qr)
	res, err := idxr.Query(req)

	if err != nil {
		return
	}

	results := make([]Result, 0, len(res.Hits))
	rooms := map[string]struct{}{}

	wantsContext := q.EventContext != nil

	beforeLimit := 5
	afterLimit := 5
	includeProfile := q.EventContext.IncludeProfile

	if q.EventContext.BeforeLimit != nil {
		beforeLimit = *q.EventContext.BeforeLimit
	}
	if q.EventContext.AfterLimit != nil {
		afterLimit = *q.EventContext.AfterLimit
	}

	for _, hit := range res.Hits {

		result := Result{
			Rank: hit.Score,
		}

		segs := strings.SplitN(hit.ID, "/", 2)
		roomID := segs[0]
		eventID := segs[1]

		if wantsContext {
			context, err := cli.resolveEventContext(roomID, eventID, beforeLimit, afterLimit)
			if err != nil {
				return
			}

			result.Result = context.Event
			result.Context = &EventContext{
				Start:        context.Start,
				End:          context.End,
				EventsBefore: context.EventsBefore,
				EventsAfter:  context.EventsAfter,
			}

			if includeProfile {
				result.Context.ProfileInfo = make(map[string]*UserProfile)
				for _, ev := range context.State {
					if ev.Type == "m.room.member" {
						userProfile := UserProfile{}

						if str, ok := ev.Content["displayname"].(string); ok {
							userProfile.DisplayName = str
						}
						if str, ok := ev.Content["avatar_url"].(string); ok {
							userProfile.AvatarURL = str
						}

						result.Context.ProfileInfo[*ev.StateKey] = &userProfile
					}
				}
			}
		} else {
			ev, err := cli.resolveEvent(roomID, eventID)
			if err != nil {
				return
			}
			result.Result = ev
		}

		results = append(results, result)
		rooms[result.Result.RoomID] = struct{}{}
	}

	roomStateMap := map[string][]*gomatrix.Event{}
	if q.IncludeState {
		// fetch state from server using API.
		for roomID := range rooms {
			state, err := cli.latestState(roomID)
			if err != nil {
				return
			}
			roomStateMap[roomID] = state
		}
	}

	resp = Results{
		Categories{
			RoomEventResults{
				Count:   int(res.Total),
				Results: results,
				State:   roomStateMap,
				//Groups:,
				//NextBatch:,
			},
		},
	}
	return
}

func RegisterHandler(router *mux.Router, idxr indexing.Indexer, hsURL, localpart, token string) {
	router.HandleFunc("/clientapi/search/", func(w http.ResponseWriter, r *http.Request) {
		resp, err := handler(r.Body, idxr, hsURL, localpart, token)

		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}

		//hits, err := json.Marshal(events)
		hits, err := json.Marshal(resp)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Write(hits)
	})
}
