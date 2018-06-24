package main

import (
	"github.com/jessevdk/go-flags"
	"github.com/matrix-org/gomatrix"
	"github.com/matrix-org/matrix-search/common"
	log "github.com/sirupsen/logrus"
)

type Options struct {
	HSURL      string `short:"h" long:"hs-url" default:"https://matrix.org" description:"The URL of the Homeserver to connect to"`
	Username   string `short:"u" long:"username" description:"The username to connect with" required:"true"`
	Password   string `short:"p" long:"password" description:"The password to connect with" required:"true"`
	ConfigPath string `short:"o" long:"output" default:"config.json" description:"Where to write the JSON config file to"`
}

func main() {
	common.SetupLogger()

	var opts Options
	if _, err := flags.Parse(&opts); err != nil {
		return
	}

	log.WithFields(log.Fields{
		"hs-url":   opts.HSURL,
		"username": opts.Username,
		"password": opts.Password,
		"output":   opts.ConfigPath,
	})

	// Log in here
	cli, err := common.MakeClient(opts.HSURL, "", "")
	if err != nil {
		log.WithError(err).Fatal("failed to make client")
		return
	}

	resp, err := cli.Login(&gomatrix.ReqLogin{
		Type:                     "m.login.password",
		User:                     opts.Username,
		Password:                 opts.Password,
		InitialDeviceDisplayName: "matrix-search",
	})
	if err != nil {
		log.WithError(err).Fatal("failed to login")
	}

	config := common.NewConfig(opts.HSURL, resp.UserID, resp.DeviceID, resp.AccessToken)

	log.WithField("path", opts.ConfigPath).Info("writing config file")
	if err := config.WriteToFile(opts.ConfigPath); err != nil {
		log.WithError(err).Error("failed to write config file")
	}
	log.Info("writing config file was successful")
}
