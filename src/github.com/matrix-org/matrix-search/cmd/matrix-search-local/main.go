package main

import (
	"encoding/json"
	"fmt"
	"github.com/blevesearch/bleve"
	"github.com/blevesearch/bleve/search"
	"github.com/blevesearch/bleve/search/query"
	"github.com/gorilla/mux"
	"github.com/matrix-org/gomatrix"
	"github.com/matrix-org/matrix-search/clientapi"
	"github.com/matrix-org/matrix-search/common"
	"github.com/matrix-org/matrix-search/indexing"
	log "github.com/sirupsen/logrus"
	"net/http"
	"strings"
	"time"
)

type QueryRequest struct {
	Keys   []string `json:"keys"`
	Filter struct {
		Must    map[string]common.StringSet `json:"must"`    // all of must
		Should  map[string]common.StringSet `json:"should"`  // any of should
		MustNot map[string]common.StringSet `json:"mustNot"` // any of must not
	} `json:"filter"`
	SortBy     string `json:"sortBy"`
	SearchTerm string `json:"searchTerm"`
	From       int    `json:"from"`
	Size       int    `json:"size"`
}

type ResponseRow struct {
	RoomID     string           `json:"roomId"`
	EventID    string           `json:"eventId"`
	Score      float64          `json:"score"`
	Highlights common.StringSet `json:"highlights"`
}

type QueryResponse struct {
	Rows  []ResponseRow `json:"rows"`
	Total uint64        `json:"total"`
}

func (req *QueryRequest) Valid() bool {
	if req.SortBy != "rank" && req.SortBy != "recent" {
		return false
	}

	return true
}

func generateQueryList(filterSet common.StringSet, fieldName string) []query.Query {
	if size := len(filterSet); size > 0 {
		queries := make([]query.Query, 0, size)
		for k := range filterSet {
			qr := query.NewMatchQuery(k)
			qr.SetField(fieldName)
			queries = append(queries, qr)
		}
		return queries
	}
	return nil
}

func (req *QueryRequest) generateSearchRequest() *bleve.SearchRequest {
	qr := bleve.NewBooleanQuery()

	for fieldName, values := range req.Filter.Must {
		if len(values) > 0 {
			qr.AddMust(query.NewDisjunctionQuery(generateQueryList(values, fieldName))) // must have one of the values for field
		}
	}
	for fieldName, values := range req.Filter.Should {
		if len(values) > 0 {
			qr.AddShould(generateQueryList(values, fieldName)...)
		}
	}
	for fieldName, values := range req.Filter.MustNot {
		if len(values) > 0 {
			qr.AddMustNot(generateQueryList(values, fieldName)...)
		}
	}

	//The user-entered query string
	if len(req.Keys) > 0 && req.SearchTerm != "" {
		oneOf := query.NewDisjunctionQuery(nil)
		for _, key := range req.Keys {
			qrs := query.NewMatchQuery(strings.ToLower(req.SearchTerm))
			qrs.SetField(key)
			oneOf.AddQuery(qrs)
		}
		qr.AddMust(oneOf)
	}

	sr := bleve.NewSearchRequestOptions(qr, req.Size, req.From, false)
	sr.IncludeLocations = true

	if req.SortBy == "recent" {
		//req.SortBy([]string{"-time"})
		sr.SortByCustom(search.SortOrder{
			&search.SortField{
				Field: "time",
				Desc:  true,
			},
		})
	}

	return sr
}

func calculateHighlights(hit *search.DocumentMatch, keys []string) common.StringSet {
	highlights := common.StringSet{}
	for _, key := range keys {
		if matches, ok := hit.Locations[key]; ok {
			for match := range matches {
				highlights.AddString(match)
			}
		}
	}
	return highlights
}

func splitRoomEventIDs(str string) (roomID, eventID string) {
	parts := strings.SplitN(str, "/", 2)
	return parts[0], parts[1]
}

func makeIndexID(roomID, eventID string) string {
	return fmt.Sprintf("%s/%s", roomID, eventID)
}

var DesiredContentFields = [...]string{"body", "name", "topic", "url"}

func shouldIndexEvent(ev *gomatrix.Event) bool {
	// this event is a redaction
	if ev.Redacts != "" {
		return true
	}

	for _, key := range DesiredContentFields {
		if _, has := ev.Content[key].(string); has {
			return true
		}
	}
	return false
}

func indexBatch(index bleve.Index, evs []*gomatrix.Event) {
	log.WithField("batch_size", len(evs)).Info("received batch of events to index")

	for _, ev := range evs {
		if !shouldIndexEvent(ev) {
			log.WithField("event", ev).Debug("discarding event")
			continue
		}

		ts := time.Unix(0, ev.Timestamp*int64(time.Millisecond))
		iev := indexing.NewEvent(ev.Sender, ev.RoomID, ev.Type, ev.Content, ts)

		logger := log.WithFields(log.Fields{
			"room_id":  ev.RoomID,
			"event_id": ev.ID,
		})

		if err := index.Index(makeIndexID(ev.RoomID, ev.ID), iev); err != nil {
			// TODO keep a list of these maybe as missing events are not good
			logger.WithError(err).Error("failed to index event")
		} else {
			logger.Info("successfully indexed event")
		}
	}
}

func redactBatch(index bleve.Index, evs []*gomatrix.Event) {
	log.WithField("batch_size", len(evs)).Info("received batch of events to redact")

	for _, ev := range evs {
		logger := log.WithFields(log.Fields{
			"room_id":  ev.RoomID,
			"event_id": ev.ID,
			"redacts":  ev.Redacts,
		})

		if err := index.Delete(makeIndexID(ev.RoomID, ev.Redacts)); err != nil {
			logger.WithError(err).Error("failed to redact index")
			// TODO handle error better here
			continue
		}

		logger.Info("redacted index successfully")
	}
}

func main() {
	// force colours on the logrus standard logger
	log.StandardLogger().Formatter = &log.TextFormatter{ForceColors: true}

	index := indexing.GetIndex("all")

	router := mux.NewRouter()
	router.StrictSlash(true)

	router.HandleFunc("/api/enqueue", func(w http.ResponseWriter, r *http.Request) {
		var req []gomatrix.Event
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.WithField("path", "/api/enqueue").WithError(err).Error("failed to decode request body")
			return
		}

		toIndex := make([]*gomatrix.Event, 0, len(req))
		toRedact := make([]*gomatrix.Event, 0, len(req))

		for i := range req {
			if req[i].Redacts == "" {
				toIndex = append(toIndex, &req[i])
			} else {
				toRedact = append(toRedact, &req[i])
			}
		}

		if len(toIndex) > 0 {
			indexBatch(index, toIndex)
		}
		if len(toRedact) > 0 {
			redactBatch(index, toRedact)
		}
	}).Methods(http.MethodPost)

	router.HandleFunc("/api/index", func(w http.ResponseWriter, r *http.Request) {
		decoder := json.NewDecoder(r.Body)
		var evs []*gomatrix.Event

		if err := decoder.Decode(&evs); err != nil {
			log.WithField("path", "/api/index").WithError(err).Error("failed to decode request body")
			return
		}

		indexBatch(index, evs)

		w.WriteHeader(http.StatusOK)
	}).Methods(http.MethodPut)

	router.HandleFunc("/api/query", func(w http.ResponseWriter, r *http.Request) {
		var req QueryRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			log.WithField("path", "/api/query").WithError(err).Error("failed to decode request body")
			return
		}

		if valid := req.Valid(); !valid {
			log.WithField("path", "/api/query").WithField("req", req).Error("invalid query request provided")
			return
		}

		logger := log.WithFields(log.Fields{
			"search_term": req.SearchTerm,
			"sort_by":     req.SortBy,
			"size":        req.Size,
			"from":        req.From,
		})

		logger.Info("processing search request")

		sr := req.generateSearchRequest()
		resp, err := index.Search(sr)

		if err != nil {
			log.WithError(err).Error("failed to search index")
			return
		}

		logger.WithFields(log.Fields{
			"num_found": resp.Total,
			"num_sent":  len(resp.Hits),
		}).Info("search request completed")

		res := QueryResponse{
			Total: resp.Total,
			Rows:  make([]ResponseRow, len(resp.Hits)),
		}

		for i := 0; i < len(resp.Hits); i++ {
			roomID, eventID := splitRoomEventIDs(resp.Hits[i].ID)

			res.Rows[i].RoomID = roomID
			res.Rows[i].EventID = eventID
			res.Rows[i].Score = resp.Hits[i].Score
			res.Rows[i].Highlights = calculateHighlights(resp.Hits[i], req.Keys)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(res)
	}).Methods(http.MethodPost)

	clientapi.RegisterLocalHandler(router, index)

	bind := ":8000"

	log.WithField("bind", bind).Info("starting matrix-search indexing daemon")

	// start the HTTP server
	log.Fatal(http.ListenAndServe(bind, router))
}

// Node should just be a syncer for Encrypted stuff,
// but we need to sync redactions too so both should be in there I guess
// go has to house the bleve stuff
