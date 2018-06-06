package common

import (
	"crypto/tls"
	"flag"
	"fmt"
	"github.com/gorilla/mux"
	"github.com/matrix-org/gomatrix"
	"github.com/matrix-org/matrix-search/config"
	"github.com/matrix-org/matrix-search/indexing"
	"log"
	"net/http"
	"net/http/pprof"
	"os"
	"time"
)

var pathPtr = flag.String("path", "my_registration_file.yaml", "The path to which to write the generated Registration YAML")

var bindPtr = flag.String("bind", "127.0.0.1:9999", "The host:port to bind to")

var configPathPtr = flag.String("config", "config.yaml", "The path to the matrix-search config YAML")
var PprofEnabledPtr = flag.Bool("pprof", false, "Whether or not to enable Pprof debugging")

var parsed = false

func parse() {
	if !parsed {
		flag.Parse()
		parsed = true
	}
}

func LoadConfig() (conf *config.Config) {
	parse()

	var err error
	if conf, err = config.LoadConfig(*configPathPtr); err != nil {
		fmt.Printf("Unable to load config file: %v\n", err)
		os.Exit(-1)
	}
	return
}

func MakeClient(hsURL, localpart, token string) (cli *gomatrix.Client, err error) {
	cli, err = gomatrix.NewClient(hsURL, localpart, token)
	if err != nil {
		return
	}
	cli.Client = &http.Client{Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}}
	return
}

func Setup() (idxr indexing.Indexer, r *mux.Router) {
	idxr = indexing.NewIndexer()

	r = mux.NewRouter()
	if *PprofEnabledPtr {
		r.HandleFunc("/debug/pprof/", pprof.Index)
		r.HandleFunc("/debug/pprof/cmdline", pprof.Cmdline)
		r.HandleFunc("/debug/pprof/profile", pprof.Profile)
		r.HandleFunc("/debug/pprof/symbol", pprof.Symbol)
	}

	return
}

func Begin(handler http.Handler, conf *config.Config) {
	srv := &http.Server{
		Handler:      handler,
		Addr:         *bindPtr,
		WriteTimeout: 15 * time.Second,
		ReadTimeout:  15 * time.Second,
	}

	log.Fatal(srv.ListenAndServe())
}
