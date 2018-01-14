package appservice

import (
	"encoding/json"
	"github.com/gorilla/mux"
	"github.com/matrix-org/matrix-search/indexing"
	"net/http"
	"time"
)

func authenticate(h http.HandlerFunc, hsToken string) http.HandlerFunc {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if token := r.URL.Query().Get("access_token"); token == hsToken {
			h.ServeHTTP(w, r)
			return
		}

		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte("{}"))
	})
}

func doesNotExist(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusNotFound)
	w.Write([]byte("{}"))
}

type Event struct {
	Age       int                    `json:"age"`
	Sender    string                 `json:"user_id"`
	Type      string                 `json:"type"`
	Timestamp int64                  `json:"origin_server_ts"`
	ID        string                 `json:"event_id"`
	RoomID    string                 `json:"room_id"`
	Content   map[string]interface{} `json:"content"`
}

type transaction struct {
	Events []Event `json:"events"`
}

// TODO persist txnIds 4 dedup
type processedTransaction struct {
	ID  string
	Num int
}

func txnHandler(w http.ResponseWriter, r *http.Request, txnId string, indexer indexing.Indexer) {
	// CHECK IF txnId is already in GORM, skip if it is

	var txn transaction
	if r.Body == nil {
		http.Error(w, "Please send a request body", http.StatusBadRequest)
		w.Write([]byte("{}"))
		return
	}
	err := json.NewDecoder(r.Body).Decode(&txn)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		w.Write([]byte("{}"))
		return
	}

	for _, ev := range txn.Events {
		if ev.Type != "m.room.message" {
			continue
		}

		ts := time.Unix(0, ev.Timestamp*int64(time.Millisecond))
		iev := indexing.NewEvent(ev.Sender, ev.Type, ev.Content, ts)
		// TODO handle err from AddEvent and bail txn processing
		indexer.AddEvent(ev.ID, ev.RoomID, iev)
	}

	//proc := processedTransaction{txnId, len(txn.Events)}
	// persist in GORM

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("{}"))
}

func RegisterHandler(r *mux.Router, idxr indexing.Indexer, hsToken string) {
	r.HandleFunc("/asapi/transactions/{txnId}", func(w http.ResponseWriter, r *http.Request) {
		txnId := mux.Vars(r)["txnId"]
		txnHandler(w, r, txnId, idxr)
	}).Methods("PUT")

	r.HandleFunc("/asapi/rooms/{roomAlias}", authenticate(doesNotExist, hsToken)).Methods("GET")
	r.HandleFunc("/asapi/users/{userId}", authenticate(doesNotExist, hsToken)).Methods("GET")
}
