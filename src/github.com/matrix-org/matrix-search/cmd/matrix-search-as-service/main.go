package main

import (
	"github.com/matrix-org/matrix-search/asapi"
	"github.com/matrix-org/matrix-search/indexing"
	"log"
	"net/http"
	"time"
)

// TODO config
// TODO AS config generator

func main() {
	s := indexing.NewIndexer()

	srv := &http.Server{
		Handler:      asapi.Handler(s, "token"),
		Addr:         "127.0.0.1:8123",
		WriteTimeout: 15 * time.Second,
		ReadTimeout:  15 * time.Second,
	}

	log.Fatal(srv.ListenAndServe())
}
