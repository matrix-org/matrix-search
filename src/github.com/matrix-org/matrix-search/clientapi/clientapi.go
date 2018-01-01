package clientapi

import (
	"encoding/json"
	"github.com/gorilla/mux"
	"github.com/matrix-org/matrix-search/indexing"
	"net/http"
)

func RegisterHandler(r *mux.Router, idxr indexing.Indexer) {
	r.HandleFunc("/clientapi/search/{roomId}/{query}", func(w http.ResponseWriter, r *http.Request) {
		vars := mux.Vars(r)
		roomId := vars["roomId"]
		query := vars["query"]
		res, _ := idxr.Query(roomId, query)

		hits, err := json.Marshal(res.Hits)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.Write(hits)
	})
}
