package main

import (
	"encoding/json"
	"fmt"
	"github.com/blevesearch/bleve"
	"github.com/blevesearch/bleve/search"
	"github.com/blevesearch/bleve/search/query"
	"github.com/gorilla/mux"
	"github.com/matrix-org/gomatrix"
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

func main() {
	// force colours on the logrus standard logger
	log.StandardLogger().Formatter = &log.TextFormatter{ForceColors: true}

	index := indexing.GetIndex("all")

	router := mux.NewRouter()
	router.StrictSlash(true)

	router.HandleFunc("/api/index", func(w http.ResponseWriter, r *http.Request) {
		decoder := json.NewDecoder(r.Body)
		var evs []gomatrix.Event

		if err := decoder.Decode(&evs); err != nil {
			log.WithField("path", "/api/index").WithError(err).Error("failed to decode request body")
			return
		}

		log.WithField("batch_size", len(evs)).Info("received batch of events to index")

		for _, ev := range evs {
			if ev.Type != "m.room.message" {
				continue
			}

			ts := time.Unix(0, ev.Timestamp*int64(time.Millisecond))
			iev := indexing.NewEvent(ev.Sender, ev.RoomID, ev.Type, ev.Content, ts)

			logger := log.WithFields(log.Fields{
				"room_id":  ev.RoomID,
				"event_id": ev.ID,
			})

			if err := index.Index(fmt.Sprintf("%s/%s", ev.RoomID, ev.ID), iev); err != nil {
				// TODO keep a list of these maybe as missing events are not good
				logger.WithError(err).Error("failed to index event")
			} else {
				logger.Info("successfully indexed event")
			}
		}

		w.WriteHeader(http.StatusOK)
	}).Methods("PUT")

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
	}).Methods("POST")

	bind := ":9999"

	log.WithField("bind", bind).Info("starting matrix-search indexing daemon")

	// start the HTTP server
	log.Fatal(http.ListenAndServe(bind, router))
}
