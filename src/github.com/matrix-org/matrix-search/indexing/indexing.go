package indexing

import (
	"github.com/blevesearch/bleve"
	"github.com/blevesearch/bleve/mapping"
	"github.com/matrix-org/gomatrix"
	"time"
)

const docTypeEvent = "event"

// Bleve connect or create the index persistence
func Bleve(path string) (idx bleve.Index, err error) {
	// try to open the persistence file...
	idx, err = bleve.Open(path)

	// if doesn't exists or something goes wrong...
	if err != nil {
		// create a new mapping file and create a new index
		//newMapping := bleve.NewIndexMapping()
		var newMapping mapping.IndexMapping
		if newMapping, err = createEventMapping(); err != nil {
			return
		}
		idx, err = bleve.New(path, newMapping)
	}

	return
}

type Event map[string]interface{}

func (*Event) Type() string {
	return docTypeEvent
}

const FieldNameIsURL = "_isURL"
const FieldNameSender = "sender"
const FieldNameContent = "content"
const FieldNameRoomID = "room_id"
const FieldNameType = "type"
const FieldNameTime = "time"

func IndexEvent(idx bleve.Index, ev *gomatrix.Event) error {
	// TODO move if not indexable here

	ts := time.Unix(0, ev.Timestamp*int64(time.Millisecond))
	_, isURL := ev.Content["url"]

	return idx.Index(MakeIndexID(ev.RoomID, ev.ID), Event{
		FieldNameIsURL:   isURL,
		FieldNameSender:  ev.Sender,
		FieldNameContent: ev.Content,
		FieldNameRoomID:  ev.RoomID,
		FieldNameType:    ev.Type,
		FieldNameTime:    ts,
	})
}
