package clientapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/blevesearch/bleve"
	"github.com/blevesearch/bleve/search"
	"github.com/blevesearch/bleve/search/query"
	"github.com/fatih/set"
	"github.com/gorilla/mux"
	"github.com/matrix-org/gomatrix"
	"github.com/matrix-org/matrix-search/common"
	"github.com/matrix-org/matrix-search/indexing"
	"go/types"
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

type ResultSet struct {
}

type Result struct {
	Rank    float64         `json:"rank"`
	Result  *gomatrix.Event `json:"result"`
	Context *EventContext   `json:"context,omitempty"`
}

//type ContextMap map[string]map[string]*EventContext
//func (cm ContextMap) getContext(roomID, eventID string) *EventContext {
//	if _, exists := cm[roomID]; exists {
//		return cm[roomID][eventID]
//	}
//	return nil
//}

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
	GroupBy []RequestGroup `json:"group_by"`
}

type RequestEventContext struct {
	BeforeLimit    *int `json:"before_limit"`
	AfterLimit     *int `json:"after_limit"`
	IncludeProfile bool `json:"include_profile"`
}

type RequestGroups struct {
	//Groupings []RequestGroups
	roomID bool
	sender bool
}

func (rg *RequestGroups) UnmarshalJSON(b []byte) error {
	var groupings RequestGroupings
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

func (fp *FilterPart) filterEv(ev *gomatrix.Event) bool {
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

//type rankedEvent struct {
//	rank float64
//	*gomatrix.Event
//}

type RequestRoomEvents struct {
	SearchTerm   string               `json:"search_term"`
	Keys         []string             `json:"keys"`
	Filter       FilterPart           `json:"filter"`
	OrderBy      string               `json:"order_by"`
	EventContext *RequestEventContext `json:"event_context"`
	IncludeState bool                 `json:"include_state"`
	Groupings    RequestGroups        `json:"groupings"` // TODO
}

type RequestCategories struct {
	RoomEvents RequestRoomEvents `json:"room_events"`
}

type SearchRequest struct {
	SearchCategories RequestCategories `json:"search_categories"`
}

func generateQueryList(filterSet common.StringSet, fieldName string) []query.Query {
	if size := len(filterSet); size > 0 {
		queries := make([]query.Query, 0, size)
		for k := range filterSet {
			qr := query.NewTermQuery(k)
			qr.SetField(fieldName)
			queries = append(queries, qr)
		}
		return queries
	}
	return nil
}

type batch struct {
	Group    *string `json:"group"`
	GroupKey *string `json:"group_key"`
	Token    *string `json:"token"`
}

func (b *batch) isValid() bool {
	return b.Group != nil && b.GroupKey != nil && b.Token != nil
}

func (b *batch) isGrouping(str string) bool {
	return b.Group != nil && *b.Group == str
}

func newBatch(str string) (b *batch, err error) {
	err = json.Unmarshal([]byte(str), &b)
	if err == nil && (b.Group == nil || b.GroupKey == nil || b.Token == nil) {
		err = errors.New("invalid batch")
	}
	return
}

func search1(idxr *indexing.Indexer, keys []string, filter FilterPart, roomIDs common.StringSet, searchTerm string, from, size int) (resp *bleve.SearchResult, err error) {
	qr := bleve.NewBooleanQuery()

	// Must satisfy room_id
	qr.AddMust(query.NewDisjunctionQuery(generateQueryList(roomIDs, "room_id")))

	// Must satisfy sender
	mustSenders := generateQueryList(filter.Senders, "sender")
	if len(mustSenders) > 0 {
		qr.AddMust(query.NewDisjunctionQuery(mustSenders))
	}

	// Must satisfy not sender
	qr.AddMustNot(generateQueryList(filter.NotSenders, "sender")...)

	// Must satisfy type
	mustType := generateQueryList(filter.Types, "type")
	if len(mustType) > 0 {
		qr.AddMust(query.NewDisjunctionQuery(mustType))
	}

	// Must satisfy not type
	qr.AddMustNot(generateQueryList(filter.NotTypes, "type")...)

	// The user-entered query string
	if len(keys) > 0 {
		oneOf := query.NewDisjunctionQuery(nil)
		for _, key := range keys {
			qrs := query.NewMatchQuery(strings.ToLower(searchTerm))
			qrs.SetField(key)
			oneOf.AddQuery(qrs)
		}
		qr.AddMust(oneOf)
	} else {
		qr.AddMust(query.NewQueryStringQuery(strings.ToLower(searchTerm)))
	}

	sr := bleve.NewSearchRequestOptions(qr, size, from, false)
	sr.IncludeLocations = true
	return
}

func splitRoomEventIDs(str string) (roomID, eventID string) {
	segs := strings.SplitN(str, "/", 2)
	return segs[0], segs[1]
}

func glueRoomEventIDs(ev *gomatrix.Event) string {
	return ev.RoomID + "/" + ev.ID
}

const MAX_SEARCH_RUNS = 3

// TODO sortBy
func searchMessages(cli *WrappedClient, idxr *indexing.Indexer, keys []string, filter FilterPart, roomIDs common.StringSet, searchTerm string, from, limit int, context *RequestEventContext) (
	roomEvMap map[string]*Result, total uint64, res search.DocumentMatchCollection, err error) {

	// set page size to double their limit
	// iterate minimum number of pages : minimum
	// iterate minimum + constant      : maximum
	// always return at maximum

	// from is an int of events not pages

	pageSize := limit * 2

	numGotten := 0
	res = make(search.DocumentMatchCollection, 0, limit)
	for i := 0; i < MAX_SEARCH_RUNS; i++ {
		// If we have reached our target within our search runs, break out of the loop
		if numGotten >= limit {
			break
		}

		resp, err := search1(idxr, keys, filter, roomIDs, searchTerm, from+(i*pageSize), pageSize)
		if err != nil {
			return
		}

		tuples := make([]eventTuple, 0, len(resp.Hits))
		hitMap := map[string]*search.DocumentMatch{}
		for _, hit := range resp.Hits {
			hitMap[hit.ID] = hit
			roomID, eventID := splitRoomEventIDs(hit.ID)
			tuples = append(tuples, eventTuple{roomID, eventID})
		}

		if context != nil { // wantsContext
			// TODO we should only be doing this calculation once, maybe at UNMARSH?
			beforeLimit := 5
			afterLimit := 5

			if context.BeforeLimit != nil {
				beforeLimit = *context.BeforeLimit
			}
			if context.AfterLimit != nil {
				afterLimit = *context.AfterLimit
			}

			var ctxs []*RespContext
			ctxs, err = cli.massResolveEventContext(tuples, beforeLimit, afterLimit)
			if err != nil {
				return
			}

			// TODO make generic using interfaces
			for _, ctx := range ctxs {
				// If event does not match out filter we cannot return it, so it does not count towards the limit.
				// TODO this is really suboptimal as we can't do it at index-query time...
				if !filter.filterEv(ctx.Event) {
					continue
				}

				gluedID := glueRoomEventIDs(ctx.Event)
				hit := hitMap[gluedID]
				result := Result{
					Rank:   hit.Score,
					Result: ctx.Event,
					Context: &EventContext{
						Start:        ctx.Start,
						End:          ctx.End,
						EventsBefore: ctx.EventsBefore,
						EventsAfter:  ctx.EventsAfter,
					},
				}

				if context.IncludeProfile {
					result.Context.ProfileInfo = make(map[string]*UserProfile)
					for _, ev := range ctx.State {
						// if is StateEvent and of Type m.room.member
						if ev.StateKey != nil && ev.Type == "m.room.member" {
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

				roomEvMap[gluedID] = &result
				res = append(res, hit)
				numGotten++
			}
		} else {
			var evs []*gomatrix.Event
			evs, err = cli.massResolveEvent(tuples)
			if err != nil {
				return
			}

			// TODO make generic using interfaces
			for _, ev := range evs {
				// If event does not match out filter we cannot return it, so it does not count towards the limit.
				// TODO this is really suboptimal as we can't do it at index-query time...
				if !filter.filterEv(ev) {
					continue
				}

				if roomEvMap == nil {
					roomEvMap = make(map[string]*Result)
				}

				gluedID := glueRoomEventIDs(ev)
				hit := hitMap[gluedID]
				roomEvMap[gluedID] = &Result{
					Rank:   hit.Score,
					Result: ev,
				}
				res = append(res, hit)
				numGotten++
			}
		}

		/*
			// This could be paralleled as its used to make a map which is not the source of truth for order.
			for _, hit := range resp.Hits {
				// If we have reached our target within our search runs, break out of the loop
				if numGotten >= limit {
					break
				}

				roomID, eventID := splitRoomEventIDs(hit.ID)

				result := Result{
					Rank: hit.Score,
				}

				if context != nil { // wantsContext
					beforeLimit := 5
					afterLimit := 5

					if context.BeforeLimit != nil {
						beforeLimit = *context.BeforeLimit
					}
					if context.AfterLimit != nil {
						afterLimit = *context.AfterLimit
					}

					var ctx *RespContext
					ctx, err = cli.resolveEventContext(roomID, eventID, beforeLimit, afterLimit)
					if err != nil {
						// TODO error handling for history permissions
						continue
					}

					// If event does not match out filter we cannot return it, so it does not count towards the limit.
					// TODO this is really suboptimal as we can't do it at index-query time...
					if !filter.filterEv(ctx.Event) {
						continue
					}

					result.Result = ctx.Event
					result.Context = &EventContext{
						Start:        ctx.Start,
						End:          ctx.End,
						EventsBefore: ctx.EventsBefore,
						EventsAfter:  ctx.EventsAfter,
					}

					if context.IncludeProfile {
						result.Context.ProfileInfo = make(map[string]*UserProfile)
						for _, ev := range ctx.State {
							// if is StateEvent and of Type m.room.member
							if ev.StateKey != nil && ev.Type == "m.room.member" {
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
					var ev *gomatrix.Event
					ev, err = cli.resolveEvent(roomID, eventID)
					if err != nil {
						// TODO error handling for history permissions
						continue
					}

					// If event does not match out filter we cannot return it, so it does not count towards the limit.
					// TODO this is really suboptimal as we can't do it at index-query time...
					if !filter.filterEv(ev) {
						continue
					}

					result.Result = ev
				}
			}*/
	}

	// for sanity truncate
	res = res[:limit]
	return
}

func h(cli *WrappedClient, idxr *indexing.Indexer, sr *SearchRequest, b *batch) (resp interface{}, err error) {
	roomCat := sr.SearchCategories.RoomEvents

	// The actual thing to query in FTS
	searchTerm := roomCat.SearchTerm

	// Which "keys" to search over in FTS query
	keys := []string{"content.body", "content.name", "content.topic"}
	if len(roomCat.Keys) > 0 {
		keys = roomCat.Keys
	}

	// What to order results by (impacts whether pagination can be done) {rank,recent}
	var orderBy string
	switch roomCat.OrderBy {
	case "recent":
		orderBy = "recent"
	case "rank":
		fallthrough
	case "":
		orderBy = "rank"
	default:
		// TODO error
	}

	// Return the current state of the rooms?
	includeState := roomCat.IncludeState

	// Include context around each event?
	// TODO
	eventContext := roomCat.EventContext

	// Group results together? May allow clients to paginate within a group
	groupByRoomID := roomCat.Groupings.roomID
	groupBySender := roomCat.Groupings.sender

	// TODO
	searchFilter := roomCat.Filter // || {}
	// move filtering logic out to extended filterStruct//

	// TODO: Search through left rooms too.
	joinedRooms, err := cli.joinedRooms()
	if err != nil {
		return
	}

	roomIDs := joinedRooms.JoinedRooms
	// Filter room IDs
	roomIDsSet := roomCat.Filter.filterRooms(roomIDs)

	// TODO WAT
	if b.isGrouping("room_id") {
		roomIDsSet.Intersect(common.NewStringSet([]string{*b.GroupKey}))
	}

	if len(roomIDs) < 1 {
		resp = Results{
			Categories{
				RoomEventResults{
					//Highlight:
					Results: []Result{},
					Count:   0,
				},
			},
		}
		return
	}

	// TODO do we need this
	//rankMap := map[string]float64{}
	//allowedEvents := []*Result{}
	// TODO these need changing
	roomGroups := map[string]SearchGroup{}
	senderGroup := map[string]SearchGroup{}

	// Holds the next_batch for the engine result set if one of those exists
	// TODO
	globalNextBatch := string(nil)

	highlights := common.StringSet{}

	// TODO
	count := int(nil)

	var allowedEvents search.DocumentMatchCollection
	var eventMap map[string]map[string]*Result

	switch orderBy {
	case "rank":
		eventMap, total, allowedEvents, err := searchMessages(cli, idxr, keys, searchFilter, roomIDsSet, searchTerm, searchFilter.Limit, eventContext)
		if err != nil {
			return
		}

		count = int(total)

		// so we have a bunch of {rank,eventId} tuples
		// we need to look them up with Synapse using the Context API,
		// we need to detect which requests failed due to history permissions, and ignore them
		// ala `filter_events_for_client`

		// TODO
		//if len(searchResult.Highlights) > 0 {
		//	highlights.AddStrings(searchResult.Highlights)
		//}

		//searchResult.

		// getting event and filtering must be interleaved otherwise our pages will be too short

		// This is done at search time instead.
		//eventMap := searchFilter.filter() // TODO

		// SORT?

		// Truncation will be done by the search method
		// Truncate
		//allowedEvents = eventMap[:searchFilter.Limit]

		for _, e := range allowedEvents {
			roomID, eventID := splitRoomEventIDs(e.ID)
			res := eventMap[roomID][eventID]
			ev := res.Result

			if _, ok := roomGroups[ev.RoomID]; !ok {
				roomGroups[ev.RoomID] = makeSearchGroup(res.Rank)
			}
			roomGroups[ev.RoomID].addResult(ev.ID)

			if _, ok := senderGroup[ev.Sender]; !ok {
				senderGroup[ev.Sender] = makeSearchGroup(res.Rank)
			}
			senderGroup[ev.Sender].addResult(ev.ID)
		}

	case "recent":

	}

	if eventContext != nil {
		if eventContext.IncludeProfile {
			// only put ProfileInfo in for eventMap that are given
		}
	}
}

type SearchGroup struct {
	Results []string
	Order   float64
}

func (sg *SearchGroup) addResult(res string) {
	sg.Results = append(sg.Results, res)
}

func makeSearchGroup(order float64) SearchGroup {
	return SearchGroup{
		Results: []string{},
		Order:   order,
	}
}

func handler(body io.ReadCloser, idxr indexing.Indexer, hsURL, token string, b *batch) (resp interface{}, err error) {
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
	cli, err := NewWrappedClient(hsURL, "", token)
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

	//groupKeys := []string
	fmt.Println(q.Groupings)

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

	limit := q.Filter.Limit

	//req := bleve.NewSearchRequest(qr)
	// TODO from=pagination
	req := bleve.NewSearchRequestOptions(qr, limit, 0, false)

	// TODO be less naive on rank/recent check
	if q.OrderBy == "recent" {
		//req.SortBy([]string{"-time"})
		req.SortByCustom(search.SortOrder{
			&search.SortField{
				Field: "time",
				Desc:  true,
			},
		})
	}
	res, err := idxr.Query(req)

	if err != nil {
		return
	}

	results := make([]Result, 0, len(res.Hits))
	rooms := map[string]struct{}{}

	// START
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
	//END

	for _, hit := range res.Hits {

		result := Result{
			Rank: hit.Score,
		}

		segs := strings.SplitN(hit.ID, "/", 2)
		roomID := segs[0]
		eventID := segs[1]

		if wantsContext {
			var context *RespContext
			context, err = cli.resolveEventContext(roomID, eventID, beforeLimit, afterLimit)
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
			var ev *gomatrix.Event
			ev, err = cli.resolveEvent(roomID, eventID)
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
			var stateEvs []*gomatrix.Event
			stateEvs, err = cli.latestState(roomID)
			if err != nil {
				return
			}
			roomStateMap[roomID] = stateEvs
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

func getToken(r *http.Request) (string, bool) {
	header := r.Header.Get("Authorization")
	if strings.HasPrefix(header, "Bearer ") {
		return strings.TrimPrefix(header, "Bearer "), true
	}

	if keys, ok := r.URL.Query()["key"]; ok && len(keys) == 1 {
		return keys[0], true
	}

	return "", false
}

func getBatch(r *http.Request) (b *batch, err error) {
	if batchStr, ok := r.URL.Query()["next_batch"]; ok && len(batchStr) == 1 {
		b, err = newBatch(batchStr[0])
		return
	}
	return
}

func RegisterHandler(router *mux.Router, idxr indexing.Indexer, hsURL string) {
	router.HandleFunc("/clientapi/search/", func(w http.ResponseWriter, r *http.Request) {
		token, ok := getToken(r)

		if !ok {
			http.Error(w, "access_token missing", http.StatusUnauthorized)
		}

		b, err := getBatch(r)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}

		resp, err := handler(r.Body, idxr, hsURL, token, b)

		if err != nil {
			if e, ok := err.(gomatrix.HTTPError); ok {
				wrapped := e.WrappedError
				fmt.Println(e, wrapped)
				// http.Error...
				// return
			}
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
