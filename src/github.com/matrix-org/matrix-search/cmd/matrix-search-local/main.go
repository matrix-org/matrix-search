package main

import (
	"database/sql"
	"fmt"
	"github.com/blevesearch/bleve"
	"github.com/blevesearch/bleve/search"
	"github.com/blevesearch/bleve/search/query"
	"github.com/gin-contrib/pprof"
	"github.com/gin-gonic/gin"
	"github.com/jessevdk/go-flags"
	"github.com/matrix-org/gomatrix"
	"github.com/matrix-org/matrix-search/clientapi"
	"github.com/matrix-org/matrix-search/clientapi/notifications"
	"github.com/matrix-org/matrix-search/common"
	"github.com/matrix-org/matrix-search/indexing"
	_ "github.com/mattn/go-sqlite3"
	log "github.com/sirupsen/logrus"
	"net/http"
	"path"
	"strings"
	"time"
	"upper.io/db.v3/sqlite"
)

type QueryRequest struct {
	Keys   []string `json:"keys"`
	Filter struct {
		Must    map[string]common.StringSet `json:"must"`    // all of must
		Should  map[string]common.StringSet `json:"should"`  // any of should
		MustNot map[string]common.StringSet `json:"mustNot"` // any of must not
	} `json:"filter"`
	SortBy     string `json:"sortBy"`
	SearchTerm string `json:"searchTerm"`
	From       int    `json:"from"`
	Size       int    `json:"size"`
}

type ResponseRow struct {
	RoomID     string           `json:"roomId"`
	EventID    string           `json:"eventId"`
	Score      float64          `json:"score"`
	Highlights common.StringSet `json:"highlights"`
}

type QueryResponse struct {
	Rows  []ResponseRow `json:"rows"`
	Total uint64        `json:"total"`
}

func (req *QueryRequest) Valid() bool {
	if req.SortBy != "rank" && req.SortBy != "recent" {
		return false
	}

	return true
}

func generateQueryList(filterSet common.StringSet, fieldName string) []query.Query {
	if size := len(filterSet); size > 0 {
		queries := make([]query.Query, 0, size)
		for k := range filterSet {
			qr := query.NewMatchQuery(k)
			qr.SetField(fieldName)
			queries = append(queries, qr)
		}
		return queries
	}
	return nil
}

func (req *QueryRequest) generateSearchRequest() *bleve.SearchRequest {
	qr := bleve.NewBooleanQuery()

	for fieldName, values := range req.Filter.Must {
		if len(values) > 0 {
			qr.AddMust(query.NewDisjunctionQuery(generateQueryList(values, fieldName))) // must have one of the values for field
		}
	}
	for fieldName, values := range req.Filter.Should {
		if len(values) > 0 {
			qr.AddShould(generateQueryList(values, fieldName)...)
		}
	}
	for fieldName, values := range req.Filter.MustNot {
		if len(values) > 0 {
			qr.AddMustNot(generateQueryList(values, fieldName)...)
		}
	}

	//The user-entered query string
	if len(req.Keys) > 0 && req.SearchTerm != "" {
		oneOf := query.NewDisjunctionQuery(nil)
		for _, key := range req.Keys {
			qrs := query.NewMatchQuery(strings.ToLower(req.SearchTerm))
			qrs.SetField(key)
			oneOf.AddQuery(qrs)
		}
		qr.AddMust(oneOf)
	}

	sr := bleve.NewSearchRequestOptions(qr, req.Size, req.From, false)
	sr.IncludeLocations = true

	if req.SortBy == "recent" {
		//req.SortBy([]string{"-time"})
		sr.SortByCustom(search.SortOrder{
			&search.SortField{
				Field: "time",
				Desc:  true,
			},
		})
	}

	return sr
}

func calculateHighlights(hit *search.DocumentMatch, keys []string) common.StringSet {
	highlights := common.StringSet{}
	for _, key := range keys {
		if matches, ok := hit.Locations[key]; ok {
			for match := range matches {
				highlights.AddString(match)
			}
		}
	}
	return highlights
}

func splitRoomEventIDs(str string) (roomID, eventID string) {
	parts := strings.SplitN(str, "/", 2)
	return parts[0], parts[1]
}

func makeIndexID(roomID, eventID string) string {
	return fmt.Sprintf("%s/%s", roomID, eventID)
}

var DesiredContentFields = [...]string{"body", "name", "topic", "url"}

func shouldIndexEvent(ev *gomatrix.Event) bool {
	// this event is a redaction
	if ev.Redacts != "" {
		return true
	}

	for _, key := range DesiredContentFields {
		if _, has := ev.Content[key].(string); has {
			return true
		}
	}
	return false
}

func indexBatch(index bleve.Index, evs []*gomatrix.Event) {
	log.WithField("batch_size", len(evs)).Info("received batch of events to index")

	for _, ev := range evs {
		if !shouldIndexEvent(ev) {
			log.WithField("event", ev).Debug("discarding event")
			continue
		}

		ts := time.Unix(0, ev.Timestamp*int64(time.Millisecond))
		iev := indexing.NewEvent(ev.Sender, ev.RoomID, ev.Type, ev.Content, ts)

		logger := log.WithFields(log.Fields{
			"room_id":  ev.RoomID,
			"event_id": ev.ID,
		})

		if err := index.Index(makeIndexID(ev.RoomID, ev.ID), iev); err != nil {
			// TODO keep a list of these maybe as missing events are not good
			logger.WithError(err).Error("failed to index event")
		} else {
			logger.Info("successfully indexed event")
		}
	}
}

func redactBatch(index bleve.Index, evs []*gomatrix.Event) {
	log.WithField("batch_size", len(evs)).Info("received batch of events to redact")

	for _, ev := range evs {
		logger := log.WithFields(log.Fields{
			"room_id":  ev.RoomID,
			"event_id": ev.ID,
			"redacts":  ev.Redacts,
		})

		if err := index.Delete(makeIndexID(ev.RoomID, ev.Redacts)); err != nil {
			logger.WithError(err).Error("failed to redact index")
			// TODO handle error better here
			continue
		}

		logger.Info("redacted index successfully")
	}
}

type Options struct {
	ConfigPath  string `short:"c" long:"config" default:"config.json" description:"Path to the JSON config file"`
	DataPath    string `short:"d" long:"data" default:"data" description:"Path to data folder (MUST EXIST)"`
	EnablePprof bool   `long:"enable-pprof" default:"false" description:"Whether to attach pprof handlers"`
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

	cli, err := clientapi.NewWrappedClient(config.HSURL, config.UserID, config.AccessToken)
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

	router.POST("/api/enqueue", func(c *gin.Context) {
		var req []gomatrix.Event
		if err := c.ShouldBindJSON(&req); err != nil {
			log.WithField("path", c.Request.URL.Path).WithError(err).Error("failed to decode request body")
			c.AbortWithError(http.StatusBadRequest, err)
			return
		}

		toIndex := make([]*gomatrix.Event, 0, len(req))
		toRedact := make([]*gomatrix.Event, 0, len(req))

		for i := range req {
			if req[i].Redacts == "" {
				toIndex = append(toIndex, &req[i])
			} else {
				toRedact = append(toRedact, &req[i])
			}
		}

		if len(toIndex) > 0 {
			indexBatch(index, toIndex)
		}
		if len(toRedact) > 0 {
			redactBatch(index, toRedact)
		}

		c.Status(http.StatusOK)
	})

	router.PUT("/api/index", func(c *gin.Context) {
		var evs []*gomatrix.Event
		if err := c.ShouldBindJSON(&evs); err != nil {
			log.WithField("path", c.Request.URL.Path).WithError(err).Error("failed to decode request body")
			c.AbortWithError(http.StatusBadRequest, err)
			return
		}

		indexBatch(index, evs)

		c.Status(http.StatusOK)
	})

	router.POST("/api/query", func(c *gin.Context) {
		var req QueryRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			log.WithField("path", c.Request.URL.Path).WithError(err).Error("failed to decode request body")
			c.AbortWithError(http.StatusBadRequest, err)
			return
		}

		if valid := req.Valid(); !valid {
			log.WithField("path", "/api/query").WithField("req", req).Error("invalid query request provided")
			return
		}

		logger := log.WithFields(log.Fields{
			"search_term": req.SearchTerm,
			"sort_by":     req.SortBy,
			"size":        req.Size,
			"from":        req.From,
		})

		logger.Info("processing search request")

		sr := req.generateSearchRequest()
		resp, err := index.Search(sr)

		if err != nil {
			log.WithError(err).Error("failed to search index")
			return
		}

		logger.WithFields(log.Fields{
			"num_found": resp.Total,
			"num_sent":  len(resp.Hits),
		}).Info("search request completed")

		res := QueryResponse{
			Total: resp.Total,
			Rows:  make([]ResponseRow, len(resp.Hits)),
		}

		for i := 0; i < len(resp.Hits); i++ {
			roomID, eventID := splitRoomEventIDs(resp.Hits[i].ID)

			res.Rows[i].RoomID = roomID
			res.Rows[i].EventID = eventID
			res.Rows[i].Score = resp.Hits[i].Score
			res.Rows[i].Highlights = calculateHighlights(resp.Hits[i], req.Keys)
		}

		c.Header("Content-Type", "application/json")
		c.JSON(http.StatusOK, res)
	})

	db, err := sql.Open("sqlite3", fmt.Sprintf("file:%s?_fk=true", path.Join(opts.DataPath, "db.sqlite")))

	sess, err := sqlite.New(db)
	if err != nil {
		panic(err)
	}

	//driver, err := postgres.WithInstance(db, &postgres.Config{})
	//m, err := migrate.NewWithDatabaseInstance("file:///migrations", "sqlite3", driver)
	//m.Up()

	clientapiRouter := router.Group("/clientapi")
	{
		clientapi.RegisterLocalHandler(clientapiRouter, cli, index)
		notifications.Register(clientapiRouter, sess)
	}

	log.WithField("bind", opts.BindAddr).Info("starting matrix-search indexing daemon")

	// start the HTTP server
	common.Begin(router, opts.BindAddr)
}

// Node should just be a syncer for Encrypted stuff,
// but we need to sync redactions too so both should be in there I guess
// go has to house the bleve stuff
