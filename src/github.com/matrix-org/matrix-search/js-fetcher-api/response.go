package js_fetcher_api

import (
	"github.com/blevesearch/bleve"
	"github.com/blevesearch/bleve/search"
	"github.com/matrix-org/gomatrix"
	"github.com/matrix-org/matrix-search/common"
	"github.com/matrix-org/matrix-search/indexing"
	log "github.com/sirupsen/logrus"
)

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

		logger := log.WithFields(log.Fields{
			"room_id":  ev.RoomID,
			"event_id": ev.ID,
		})

		if err := indexing.IndexEvent(index, ev); err != nil {
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

		if err := index.Delete(indexing.MakeIndexID(ev.RoomID, ev.Redacts)); err != nil {
			logger.WithError(err).Error("failed to redact index")
			// TODO handle error better here
			continue
		}

		logger.Info("redacted index successfully")
	}
}
