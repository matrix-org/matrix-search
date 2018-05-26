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
	"log"
	"net/http"
	"strings"
	"time"
)

type QueryFilter struct {
	FieldName string   `json:"fieldName"`
	Type      string   `json:"type"`
	Values    []string `json:"values"`
}

type QueryRequest struct {
	Keys       []string      `json:"keys"`
	Filter     []QueryFilter `json:"filter"`
	SortBy     string        `json:"sortBy"`
	SearchTerm string        `json:"searchTerm"`
	From       int           `json:"from"`
	Size       int           `json:"size"`
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

	for _, q := range req.Filter {
		if q.Type != "must" && q.Type != "mustnot" {
			return false
		}
	}

	return true
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

func (req *QueryRequest) generateSearchRequest() *bleve.SearchRequest {
	qr := bleve.NewBooleanQuery()

	for _, q := range req.Filter {
		if len(q.Values) < 1 {
			continue
		}

		vs := common.NewStringSet(q.Values)

		switch q.Type {
		case "mustNot":
			qr.AddMustNot(generateQueryList(vs, q.FieldName)...)
		case "must":
			qr.AddMust(query.NewDisjunctionQuery(generateQueryList(vs, q.FieldName)))
		}
	}

	// The user-entered query string
	if len(req.Keys) > 0 {
		oneOf := query.NewDisjunctionQuery(nil)
		for _, key := range req.Keys {
			qrs := query.NewMatchQuery(strings.ToLower(req.SearchTerm))
			qrs.SetField(key)
			oneOf.AddQuery(qrs)
		}
		qr.AddMust(oneOf)
	} else {
		qr.AddMust(query.NewQueryStringQuery(strings.ToLower(req.SearchTerm)))
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

func calculateHighlights(hit *search.DocumentMatch, keys []string) (highlights common.StringSet) {
	for _, key := range keys {
		if matches, ok := hit.Locations[key]; ok {
			for match := range matches {
				highlights.AddString(match)
			}
		}
	}
	return
}

func splitRoomEventIDs(str string) (roomID, eventID string) {
	segs := strings.SplitN(str, "/", 2)
	return segs[0], segs[1]
}

func main() {
	conf := common.LoadConfig()
	if conf == nil {
		panic("MISSING")
	}

	idxr := indexing.NewIndexer()
	index := idxr.GetIndex("")

	// create a router to serve static files
	router := mux.NewRouter()
	router.StrictSlash(true)

	// PUT INDEX
	// [MatrixEvent]

	// POST QUERY
	//

	// SEARCH
	// INDEX
	// takes an array of Matrix events

	router.HandleFunc("/api/index", func(w http.ResponseWriter, r *http.Request) {
		decoder := json.NewDecoder(r.Body)
		var evs []gomatrix.Event
		err := decoder.Decode(&evs)
		if err != nil {
			fmt.Println(err)
		}
		// defer r.Body.Close()

		for _, ev := range evs {
			if ev.Type != "m.room.message" {
				continue
			}

			ts := time.Unix(0, ev.Timestamp*int64(time.Millisecond))
			iev := indexing.NewEvent(ev.Sender, ev.RoomID, ev.Type, ev.Content, ts)
			// TODO handle err from AddEvent and bail txn processing

			err = index.Index(fmt.Sprintf("%s/%s", ev.RoomID, ev.ID), iev)
			fmt.Println(err)
			log.Println(ev)
		}
	}).Methods("PUT")

	router.HandleFunc("/api/query", func(w http.ResponseWriter, r *http.Request) {
		var req QueryRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			fmt.Println(err)
			return
		}

		if valid := req.Valid(); !valid {
			fmt.Println("query Request invalid", req)
			return
		}

		sr := req.generateSearchRequest()
		resp, err := idxr.Query(sr)

		if err != nil {
			panic(err)
		}

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

		fmt.Println(resp, err)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(res)

	}).Methods("POST")

	fmt.Println("Starting LS")

	// start the HTTP server
	http.Handle("/", router)
	log.Fatal(http.ListenAndServe(":9999", nil))

	// clientapi.RegisterLocalHandler(r, idxr, conf)
	//
	// go clientapi.RegisterSyncer(idxr, conf)
	//
	// common.Begin(r, conf)
}
