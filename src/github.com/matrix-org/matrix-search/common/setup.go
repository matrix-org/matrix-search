package common

import (
	"flag"
	"fmt"
	"github.com/gorilla/mux"
	"github.com/matrix-org/gomatrix"
	"github.com/matrix-org/matrix-search/appservice"
	"github.com/matrix-org/matrix-search/clientapi"
	"github.com/matrix-org/matrix-search/config"
	"github.com/matrix-org/matrix-search/indexing"
	"log"
	"net/http"
	"net/http/pprof"
	"os"
	"time"
)

var pathPtr = flag.String("path", "my_registration_file.yaml", "The path to which to write the generated Registration YAML")

var configPathPtr = flag.String("config", "config.yaml", "The path to the matrix-search config YAML")
var PprofEnabledPtr = flag.Bool("pprof", false, "Whether or not to enable Pprof debugging")

func LoadConfigs() (conf *config.Config, reg *appservice.Registration) {
	flag.Parse()

	var err error

	if reg, err = appservice.LoadRegistration(*pathPtr); err != nil {
		fmt.Printf("Unable to load registration file: %v\n", err)
		os.Exit(-1)
	}

	if conf, err = config.LoadConfig(*configPathPtr); err != nil {
		fmt.Printf("Unable to load config file: %v\n", err)
		os.Exit(-1)
	}

	return
}

func Setup(cli *gomatrix.Client) (idxr indexing.Indexer, r *mux.Router) {
	idxr = indexing.NewIndexer()

	r = mux.NewRouter()
	if *PprofEnabledPtr {
		r.HandleFunc("/debug/pprof/", pprof.Index)
		r.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
		r.HandleFunc("/debug/pprof/profile", pprof.Profile)
		r.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	}

	clientapi.RegisterHandler(r, idxr, cli)

	return
}

func Begin(handler http.Handler, conf *config.Config) {
	srv := &http.Server{
		Handler:      handler,
		Addr:         "127.0.0.1:9999",
		WriteTimeout: 15 * time.Second,
		ReadTimeout:  15 * time.Second,
	}

	log.Fatal(srv.ListenAndServe())
}
