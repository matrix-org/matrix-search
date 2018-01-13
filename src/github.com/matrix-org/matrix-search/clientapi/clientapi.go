package clientapi

import (
	"encoding/json"
	"fmt"
	"github.com/gorilla/mux"
	"github.com/matrix-org/matrix-search/indexing"
	"net/http"
)

type searchRequest struct {
	RoomIDs []string `json:"room_ids"`
	Query   string   `json:"query"`
}

func RegisterHandler(router *mux.Router, idxr indexing.Indexer) {
	router.HandleFunc("/clientapi/search/", func(w http.ResponseWriter, r *http.Request) {
		var sr searchRequest
		if r.Body == nil {
			http.Error(w, "Please send a request body", 400)
			return
		}
		err := json.NewDecoder(r.Body).Decode(&sr)
		if err != nil {
			http.Error(w, err.Error(), 400)
			return
		}

		res, err := idxr.QueryMultiple(sr.RoomIDs, sr.Query)

		if err != nil {
			fmt.Println(err)
			// TODO handle err
		}

		hits, err := json.Marshal(res.Hits)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Write(hits)
	})
}
