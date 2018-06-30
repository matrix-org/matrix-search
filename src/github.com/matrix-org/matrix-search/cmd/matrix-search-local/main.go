package main

import (
	"github.com/gin-contrib/pprof"
	"github.com/gin-gonic/gin"
	"github.com/jessevdk/go-flags"
	"github.com/matrix-org/matrix-search/clientapi"
	"github.com/matrix-org/matrix-search/common"
	"github.com/matrix-org/matrix-search/indexing"
	"github.com/matrix-org/matrix-search/js-fetcher-api"
	"github.com/matrix-org/matrix-search/wrappedclient"
	_ "github.com/mattn/go-sqlite3"
	log "github.com/sirupsen/logrus"
	"path"
	"upper.io/db.v3/sqlite"
)

type Options struct {
	ConfigPath  string `short:"c" long:"config" default:"config.json" description:"Path to the JSON config file"`
	DataPath    string `short:"d" long:"data" default:"data" description:"Path to data folder (MUST EXIST)"`
	EnablePprof bool   `long:"enable-pprof" description:"Whether to attach pprof handlers"`
	BindAddr    string `short:"b" long:"bind" default:":8000" description:"The address:port to bind the web server to"`
}

func main() {
	common.SetupLogger()

	var opts Options
	if _, err := flags.Parse(&opts); err != nil {
		return
	}

	config, err := common.ReadConfigFromFile(opts.ConfigPath)
	if err != nil {
		log.WithError(err).Fatal("failed to read config json")
		return
	}

	cli, err := wrappedclient.NewWrappedClient(config.HSURL, config.UserID, config.AccessToken)
	if err != nil {
		log.WithError(err).Fatal("failed to instantiate matrix client")
		return
	}

	resp, err := cli.Whoami()
	if err != nil {
		log.WithError(err).Fatal("failed to perform matrix action")
		return
	}

	if resp.UserID != config.UserID {
		log.WithFields(log.Fields{
			"config.user_id": config.UserID,
			"whoami.user_id": resp.UserID,
		}).Fatal("user_id mismatch")
		return
	}

	index, err := indexing.Bleve(path.Join(opts.DataPath, "bleve"))
	if err != nil {
		log.WithError(err).Fatal("failed to connect to bleve index")
		return
	}

	router := gin.Default()

	if opts.EnablePprof {
		pprof.Register(router)
	}

	dbPath := path.Join(opts.DataPath, "db.sqlite")
	log.WithField("db_path", dbPath).Info("opening sqlite database")

	sess, err := sqlite.Open(sqlite.ConnectionURL{
		Database: dbPath,
		Options: map[string]string{
			"_fk": "true",
		},
	})

	if err != nil {
		log.WithError(err).Fatal("failed to open database")
		return
	}

	//driver, err := postgres.WithInstance(sess.Driver().(*sql.DB), &postgres.Config{})
	//m, err := migrate.NewWithDatabaseInstance("file:///migrations", "sqlite3", driver)
	//m.Up()

	js_fetcher_api.Register(router.Group("/api"), index)
	clientapi.Register(router.Group("/clientapi"), sess, cli, index)

	log.WithField("bind", opts.BindAddr).Info("starting matrix-search indexing daemon")

	// start the HTTP server
	common.Begin(router, opts.BindAddr)
}

// Node should just be a syncer for Encrypted stuff,
// but we need to sync redactions too so both should be in there I guess
// go has to house the bleve stuff
