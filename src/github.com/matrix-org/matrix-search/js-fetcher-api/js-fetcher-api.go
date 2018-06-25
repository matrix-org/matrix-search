package js_fetcher_api

import (
	"github.com/blevesearch/bleve"
	"github.com/gin-gonic/gin"
	"github.com/matrix-org/gomatrix"
	log "github.com/sirupsen/logrus"
	"net/http"
)

func Register(r *gin.RouterGroup, index bleve.Index) {
	router := r.Group("/api")

	router.POST("/enqueue", func(c *gin.Context) {
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

	router.PUT("/index", func(c *gin.Context) {
		var evs []*gomatrix.Event
		if err := c.ShouldBindJSON(&evs); err != nil {
			log.WithField("path", c.Request.URL.Path).WithError(err).Error("failed to decode request body")
			c.AbortWithError(http.StatusBadRequest, err)
			return
		}

		indexBatch(index, evs)

		c.Status(http.StatusOK)
	})

	router.POST("/query", func(c *gin.Context) {
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
}
