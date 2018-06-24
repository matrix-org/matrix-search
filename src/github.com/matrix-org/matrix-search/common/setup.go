package common

import (
	"crypto/tls"
	"github.com/matrix-org/gomatrix"
	log "github.com/sirupsen/logrus"
	"net/http"
	"time"
)

//var bindPtr = flag.String("bind", "127.0.0.1:9999", "The host:port to bind to")
//var PprofEnabledPtr = flag.Bool("pprof", false, "Whether or not to enable Pprof debugging")

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

func Begin(handler http.Handler, addr string) {
	srv := &http.Server{
		Handler:      handler,
		Addr:         addr,
		WriteTimeout: 15 * time.Second,
		ReadTimeout:  15 * time.Second,
	}

	log.Fatal(srv.ListenAndServe())
}

func SetupLogger() {
	// force colours on the logrus standard logger
	log.StandardLogger().Formatter = &log.TextFormatter{ForceColors: true}
}
