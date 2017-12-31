package main

import (
	"flag"
	"github.com/matrix-org/matrix-search/appservice"
	"github.com/matrix-org/matrix-search/config"
	"github.com/matrix-org/matrix-search/indexing"
	"log"
	"net/http"
	"time"
)

// TODO config
// TODO AS config generator

func common() *config.Config {
	configPathPtr := flag.String("config", "config.yaml", "The path to the matrix-search config YAML")
	flag.Parse()

	config, err := config.LoadConfig(*configPathPtr)
	if err != nil {
		panic(err)
	}

	return config
}

func main() {
	s := indexing.NewIndexer()

	config := common()

	srv := &http.Server{
		Handler:      appservice.Handler(s, "token"),
		Addr:         "127.0.0.1:8123",
		WriteTimeout: 15 * time.Second,
		ReadTimeout:  15 * time.Second,
	}

	log.Fatal(srv.ListenAndServe())
}
