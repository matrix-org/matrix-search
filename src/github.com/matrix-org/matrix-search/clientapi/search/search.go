package search

import (
	"errors"
	"fmt"
	"github.com/blevesearch/bleve"
	"github.com/blevesearch/bleve/search"
	"github.com/blevesearch/bleve/search/query"
	"github.com/gin-gonic/gin"
	"github.com/matrix-org/gomatrix"
	"github.com/matrix-org/matrix-search/common"
	"github.com/matrix-org/matrix-search/indexing"
	"net/http"
	"strconv"
	"strings"
)

func generateQueryList(filterSet common.StringSet, fieldName string) []query.Query {
	if size := len(filterSet); size > 0 {
		queries := make([]query.Query, 0, size)
		for k := range filterSet {
			qr := query.NewMatchQuery(k)
			//qr := query.NewTermQuery(k)
			qr.SetField(fieldName)
			queries = append(queries, qr)
		}
		return queries
	}
	return nil
}

func qrAdd(qr *query.BooleanQuery, fieldName string, must, mustNot common.StringSet) {
	if !must.IsEmpty() {
		qr.AddMust(query.NewDisjunctionQuery(generateQueryList(must, fieldName)))
	}
	if !mustNot.IsEmpty() {
		qr.AddMustNot(generateQueryList(mustNot, fieldName)...)
	}
}

func qrAddBoolField(qr *query.BooleanQuery, fieldName string, value bool) {
	q := query.NewBoolFieldQuery(value)
	q.SetField(fieldName)
	qr.AddMust(q)
}

func search1(index bleve.Index, keys []string, filter FilterPart, orderBy, searchTerm string, from, size int) (resp *bleve.SearchResult, err error) {
	qr := bleve.NewBooleanQuery()

	// Must satisfy room_id
	qrAdd(qr, indexing.FieldNameRoomID, filter.Rooms, filter.NotRooms)
	// Must satisfy sender
	qrAdd(qr, indexing.FieldNameSender, filter.Senders, filter.NotSenders)
	// Must satisfy type
	qrAdd(qr, indexing.FieldNameType, filter.Types, filter.NotTypes)

	// Must satisfy ContainsURL
	if filter.ContainsURL != nil {
		qrAddBoolField(qr, indexing.FieldNameIsURL, *filter.ContainsURL)
	}

	// The user-entered query string
	if len(keys) > 0 {
		oneOf := query.NewDisjunctionQuery(nil)
		for _, key := range keys {
			qrs := query.NewMatchQuery(strings.ToLower(searchTerm))
			qrs.SetField(key)
			oneOf.AddQuery(qrs)
		}
		qr.AddMust(oneOf)
	}

	sr := bleve.NewSearchRequestOptions(qr, size, from, false)
	sr.IncludeLocations = true

	if orderBy == "recent" {
		//req.SortBy([]string{"-time"})
		sr.SortByCustom(search.SortOrder{
			&search.SortField{
				Field: indexing.FieldNameTime,
				Desc:  true,
			},
		})
	}
	resp, err = index.Search(sr)
	return
}

func splitRoomEventIDs(str string) (roomID, eventID string) {
	segs := strings.SplitN(str, "/", 2)
	return segs[0], segs[1]
}

func glueRoomEventIDs(ev *common.WrappedEvent) string {
	return ev.RoomID + "/" + ev.ID
}

type SearchResultProcessor interface {
	Build(id string, includeProfile bool) *Result
	GetEv() *common.WrappedEvent
}

func buildResult(reg *common.RespEvGeneric, includeProfile bool) (r Result) {
	r.Result = reg.Event

	ctx := reg.Context
	if ctx == nil {
		return
	}

	r.Context = &EventContext{
		Start:        ctx.Start,
		End:          ctx.End,
		EventsBefore: ctx.EventsBefore,
		EventsAfter:  ctx.EventsAfter,
	}

	if includeProfile {
		senders := common.StringSet{}

		for _, ev := range ctx.EventsBefore {
			senders.AddString(ev.Sender)
		}
		for _, ev := range ctx.EventsAfter {
			senders.AddString(ev.Sender)
		}
		senders.AddString(reg.Event.Sender)

		r.Context.ProfileInfo = make(map[string]*UserProfile)
		for _, ev := range ctx.State {
			// if stateEvent with type "m.room.member" and sender thereof is in this context
			if ev.IsStateEvent() && ev.Type == "m.room.member" && senders.Has(*ev.StateKey) {
				userProfile := UserProfile{}

				if str, ok := ev.Content["displayname"].(string); ok {
					userProfile.DisplayName = str
				}
				if str, ok := ev.Content["avatar_url"].(string); ok {
					userProfile.AvatarURL = str
				}

				r.Context.ProfileInfo[*ev.StateKey] = &userProfile
			}
		}
	}

	return
}

const MaxSearchRuns = 3

func searchMessages(cli *common.WrappedClient, index bleve.Index, keys []string, filter FilterPart, orderBy, searchTerm string, from int, context *RequestEventContext) (
	roomEvMap map[string]*Result, total int, res search.DocumentMatchCollection, err error) {

	if roomEvMap == nil {
		roomEvMap = make(map[string]*Result)
	}

	// set page size to double their limit
	// iterate minimum number of pages : minimum
	// iterate minimum + constant      : maximum
	// always return at maximum

	// from is an int of events not pages

	pageSize := filter.Limit * 2
	//offset := 0

	beforeLimit := context.BeforeLimit()
	afterLimit := context.AfterLimit()

	numGotten := 0
	res = make(search.DocumentMatchCollection, 0, filter.Limit)
	for i := 0; i < MaxSearchRuns; i++ {
		// If we have reached our target within our search runs, break out of the loop
		if numGotten >= filter.Limit {
			break
		}

		var resp *bleve.SearchResult
		resp, err = search1(index, keys, filter, orderBy, searchTerm, from+(i*pageSize), pageSize)
		if err != nil {
			return
		}

		total = int(resp.Total)
		numHits := len(resp.Hits)

		tuples := make([]common.EventTuple, 0, numHits)
		hitMap := map[string]*search.DocumentMatch{}
		for _, hit := range resp.Hits {
			hitMap[hit.ID] = hit
			roomID, eventID := splitRoomEventIDs(hit.ID)
			tuples = append(tuples, common.EventTuple{roomID, eventID})
		}

		ttt := make([]*common.RespEvGeneric, 0, numHits)

		if context != nil { // wantsContext
			var ctxs []*common.RespContext
			ctxs, err = cli.MassResolveEventContext(tuples, beforeLimit, afterLimit)
			if err != nil {
				return
			}

			for _, ctx := range ctxs {
				context := common.Context{ctx.Start, ctx.End, ctx.EventsBefore, ctx.EventsAfter, ctx.State}
				ttt = append(ttt, &common.RespEvGeneric{ctx.Event, &context})
			}
		} else {
			var evs []*common.WrappedEvent
			evs, err = cli.MassResolveEvent(tuples)
			if err != nil {
				return
			}

			for _, ev := range evs {
				ttt = append(ttt, &common.RespEvGeneric{ev, nil})
			}
		}

		for _, t := range ttt {
			// If we have reached our target within our search runs, break out of the loop
			if numGotten >= filter.Limit {
				break
			}

			gluedID := glueRoomEventIDs(t.Event)
			hit := hitMap[gluedID]

			result := buildResult(t, context.IncludeProfile)
			result.Rank = hit.Score
			roomEvMap[hit.ID] = &result

			res = append(res, hit)
			numGotten++
		}
	}

	// for sanity truncate
	//res = res[:limit]
	return
}

type HTTPError struct {
	Message string
	Code    int
}

func (err *HTTPError) Error() string {
	return fmt.Sprintf("[%d] %s", err.Code, err.Message)
}

func getHTTPError(code int) *HTTPError {
	return &HTTPError{
		Message: http.StatusText(code),
		Code:    code,
	}
}

func handler(cli *common.WrappedClient, index bleve.Index, sr *SearchRequest, b *batch) (resp *Results, err error) {
	roomCat := sr.SearchCategories.RoomEvents

	// The actual thing to query in FTS
	searchTerm := roomCat.SearchTerm

	// Which "keys" to search over in FTS query
	keys := []string{"content.body", "content.name", "content.topic"}
	if len(roomCat.Keys) > 0 {
		keys = roomCat.Keys
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
	joinedRooms, err := cli.JoinedRooms()
	if err != nil {
		return
	}

	roomIDs := joinedRooms.JoinedRooms
	// Filter room IDs
	//roomIDsSet := roomCat.Filter.filterRooms(roomIDs)

	if b.isGrouping("room_id") {
		searchFilter.Rooms = common.NewStringSet([]string{*b.GroupKey})
	}

	if len(roomIDs) < 1 {
		resp = &Results{
			Categories{
				RoomEventResults{
					Highlights: []string{},
					Results:    []*Result{},
					Count:      0,
				},
			},
		}
		return
	}

	roomGroups := GroupValueMap{}
	senderGroups := GroupValueMap{}

	// Holds the next_batch for the engine result set if one of those exists
	var globalNextBatch *string
	var count int
	var allowedEvents search.DocumentMatchCollection
	var eventMap map[string]*Result

	rooms := common.StringSet{}

	switch roomCat.OrderBy {
	case "rank":
	case "":
		eventMap, count, allowedEvents, err = searchMessages(cli, index, keys, searchFilter, "rank", searchTerm, 0, eventContext)
		if err != nil {
			return
		}

		// so we have a bunch of {rank,eventId} tuples
		// we need to look them up with Synapse using the Context API,
		// we need to detect which requests failed due to history permissions, and ignore them
		// ala `filter_events_for_client`

		// This is done at search time instead.
		//eventMap := searchFilter.filter() // TODO

		// SORT?

		// Truncation will be done by the search method
		// Truncate
		//allowedEvents = eventMap[:searchFilter.Limit]

	case "recent":
		from := 0
		if b.HasToken() {
			if num, err := strconv.Atoi(*b.Token); err == nil {
				from = num
			}
		}

		eventMap, count, allowedEvents, err = searchMessages(cli, index, keys, searchFilter, "recent", searchTerm, from, eventContext)

		// the number of the events the caller still has not seen after this batch
		numUnseen := count - from - len(allowedEvents)
		// if there are events they haven't seen we need to give them a token
		if numUnseen > 0 {
			offset := strconv.Itoa(int(from + len(allowedEvents)))

			if b.isValid() {
				if t, err := newBatch(*b.Group, *b.GroupKey, offset); err == nil {
					globalNextBatch = &t
				}
			} else {
				if t, err := newBatch("all", "", offset); err == nil {
					globalNextBatch = &t
				}
			}

			for roomID, group := range roomGroups {
				if t, err := newBatch("room_id", roomID, offset); err == nil {
					group.NextBatch = &t
				}
			}
		}

	default:
		err = getHTTPError(http.StatusNotImplemented)
		return
	}

	if len(allowedEvents) < 1 {
		resp = &Results{
			Categories{
				RoomEventResults{
					Highlights: []string{},
					Results:    []*Result{},
					Count:      0,
				},
			},
		}
		return
	}

	for _, e := range allowedEvents {
		res := eventMap[e.ID]
		ev := res.Result

		if groupByRoomID {
			roomGroups.add(ev.RoomID, ev.ID, res.Rank)
		}

		if groupBySender {
			senderGroups.add(ev.Sender, ev.ID, res.Rank)
		}

		rooms.AddString(ev.RoomID)
	}

	// TODO can we do this better than O(n * 3 * m) [O(n^3)]
	highlights := common.StringSet{}
	for _, hit := range allowedEvents {
		for _, key := range keys {
			if matches, ok := hit.Locations[key]; ok {
				for match := range matches {
					highlights.AddString(match)
				}
			}
		}
	}

	roomStateMap := map[string][]*gomatrix.Event{}
	if includeState {
		// fetch state from server using API.
		for roomID := range rooms {
			var stateEvs []*gomatrix.Event
			stateEvs, err = cli.LatestState(roomID)
			if err != nil {
				return
			}
			roomStateMap[roomID] = stateEvs
		}
	}

	results := make([]*Result, 0, len(allowedEvents))
	for _, hit := range allowedEvents {
		results = append(results, eventMap[hit.ID])
	}

	resp = &Results{
		Categories{
			RoomEventResults{
				Count:      count,
				Results:    results,
				State:      roomStateMap,
				NextBatch:  globalNextBatch,
				Highlights: highlights.ToArray(),
			},
		},
	}

	// If groupByRoomID/groupBySender attach Groups field in response.
	if groupByRoomID {
		if resp.SearchCategories.RoomEvents.Groups == nil {
			resp.SearchCategories.RoomEvents.Groups = map[string]map[string]*GroupValue{}
		}
		resp.SearchCategories.RoomEvents.Groups["room_id"] = roomGroups

	}
	if groupBySender {
		if resp.SearchCategories.RoomEvents.Groups == nil {
			resp.SearchCategories.RoomEvents.Groups = map[string]map[string]*GroupValue{}
		}
		resp.SearchCategories.RoomEvents.Groups["sender"] = senderGroups

	}
	return
}

func getBatch(c *gin.Context) (b *batch, err error) {
	if batchStr := c.QueryArray("next_batch"); len(batchStr) == 1 {
		b, err = readBatch(batchStr[0])
		return
	}
	return
}

func Register(r *gin.RouterGroup, cli *common.WrappedClient, index bleve.Index) {
	r.POST("/clientapi/search", func(c *gin.Context) {
		b, err := getBatch(c)
		if err != nil {
			c.AbortWithError(http.StatusBadRequest, err)
			return
		}

		var sr SearchRequest
		if err := c.ShouldBindJSON(&sr); err != nil {
			c.AbortWithError(http.StatusBadRequest, errors.New("invalid request body"))
			return
		}

		resp, err := handler(cli, index, &sr, b)

		if err != nil {
			if e, ok := err.(gomatrix.HTTPError); ok {
				wrapped := e.WrappedError
				fmt.Println(e, wrapped)
				// http.Error...
				// return
			}
			fmt.Println(err)
			c.AbortWithError(http.StatusBadRequest, err)
			return
		}

		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Content-Type", "application/json")
		c.JSON(http.StatusOK, resp)
	})
}
