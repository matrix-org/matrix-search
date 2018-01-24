package main

import (
	"crypto/tls"
	"github.com/matrix-org/gomatrix"
	"github.com/matrix-org/matrix-search/appservice"
	"github.com/matrix-org/matrix-search/common"
	"net/http"
)

func main() {
	conf, reg := common.LoadConfigs()
	if conf == nil || reg == nil {
		panic("MISSING")
	}

	cli, err := gomatrix.NewClient(conf.Homeserver.URL, reg.SenderLocalpart, reg.ASToken)
	if err != nil {
		panic(err)
	}
	cli.Client = &http.Client{Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}}
	idxr, r := common.Setup(cli)

	appservice.RegisterHandler(r, idxr, reg.HSToken)

	common.Begin(r, conf)
}
