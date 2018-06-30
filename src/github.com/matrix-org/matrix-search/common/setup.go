package common

import (
	log "github.com/sirupsen/logrus"
	"net/http"
	"time"
)

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
