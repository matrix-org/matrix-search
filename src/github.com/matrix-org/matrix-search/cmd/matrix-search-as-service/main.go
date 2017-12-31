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

func common() (conf *config.Config, reg *appservice.Registration) {
	pathPtr := flag.String("path", "my_registration_file.yaml", "The path to which to write the generated Registration YAML")
	//configPathPtr := flag.String("config", "config.yaml", "The path to the matrix-search config YAML")
	flag.Parse()

	var err error

	if reg, err = appservice.LoadRegistration(*pathPtr); err != nil {
		panic(err)
	}

	//if conf, err = config.LoadConfig(*configPathPtr); err != nil {
	//	panic(err)
	//}

	return
}

func main() {
	s := indexing.NewIndexer()

	_, reg := common()

	srv := &http.Server{
		Handler:      appservice.Handler(s, reg.HSToken),
		Addr:         "127.0.0.1:9999",
		WriteTimeout: 15 * time.Second,
		ReadTimeout:  15 * time.Second,
	}

	log.Fatal(srv.ListenAndServe())
}
