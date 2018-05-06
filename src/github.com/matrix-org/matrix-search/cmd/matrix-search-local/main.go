package main

import (
	bleveHttp "github.com/blevesearch/bleve/http"
	// "github.com/matrix-org/matrix-search/clientapi"
	"encoding/json"
	"fmt"
	"github.com/gorilla/mux"
	"github.com/matrix-org/gomatrix"
	"github.com/matrix-org/matrix-search/common"
	"github.com/matrix-org/matrix-search/indexing"
	"log"
	"net/http"
	"time"
)

func IndexHandler(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	w.WriteHeader(http.StatusOK)
	fmt.Fprintf(w, "Category: %v\n", vars["category"])
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

	}).Methods("POST")

	// add the API
	bleveHttp.RegisterIndexName("search", index)
	// indexHandler := bleveHttp.NewDocIndexHandler("search")
	// indexHandler.DocIDLookup = docIDLookup
	// router.Handle("/api/index/{docID}", indexHandler).Methods("PUT")
	searchHandler := bleveHttp.NewSearchHandler("search")
	router.Handle("/api/search", searchHandler).Methods("POST")
	listFieldsHandler := bleveHttp.NewListFieldsHandler("search")
	router.Handle("/api/fields", listFieldsHandler).Methods("GET")

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
