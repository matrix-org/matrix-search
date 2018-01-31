package main

import (
	"github.com/matrix-org/matrix-search/appservice"
	"github.com/matrix-org/matrix-search/clientapi"
	"github.com/matrix-org/matrix-search/common"
)

func main() {
	conf, reg := common.LoadConfigs()
	if conf == nil || reg == nil {
		panic("MISSING")
	}

	idxr, r := common.Setup()

	clientapi.RegisterHandler(r, idxr, conf.Homeserver.URL)

	appservice.RegisterHandler(r, idxr, reg.HSToken)

	common.Begin(r, conf)
}
