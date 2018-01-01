package main

import (
	"github.com/matrix-org/matrix-search/appservice"
	"github.com/matrix-org/matrix-search/common"
)

func main() {
	conf, reg := common.LoadConfigs()
	idxr, r := common.Setup()

	appservice.RegisterHandler(r, idxr, reg.HSToken)

	common.Begin(r, conf)
}
