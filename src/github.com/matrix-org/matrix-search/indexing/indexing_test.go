package indexing

import (
	"testing"

	"github.com/blevesearch/bleve"
	"github.com/matrix-org/gomatrix"
	"github.com/matrix-org/matrix-search/common"
	"io/ioutil"
	"os"
	"time"
)

func TestBleve(t *testing.T) {
	type args struct {
		path string
	}
	tests := []struct {
		name    string
		args    args
		wantErr bool
	}{
		{
			"invalid path",
			args{""},
			true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := Bleve(tt.args.path)
			if (err != nil) != tt.wantErr {
				t.Errorf("Bleve() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}

	dir, err := ioutil.TempDir("", "test")
	if err != nil {
		t.Errorf("*setup* failed to make temp dir: %v", err)
		return
	}
	defer os.RemoveAll(dir)

	t.Run("valid", func(t *testing.T) {
		idx, err := Bleve(dir)
		if err != nil {
			t.Errorf("Bleve() error = %v", err)
			return
		}
		if err := idx.Close(); err != nil {
			t.Errorf("idx.Close() error = %v", err)
		}
	})
}

func TestEvent_Type(t *testing.T) {
	tests := []struct {
		name string
		e    *Event
		want string
	}{
		{
			"simple_0",
			&Event{},
			docTypeEvent,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			//t.Parallel()
			if got := tt.e.Type(); got != tt.want {
				t.Errorf("Event.Type() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestIndexEvent(t *testing.T) {
	dir, err := ioutil.TempDir("", "test")
	if err != nil {
		t.Errorf("*setup* failed to make temp dir: %v", err)
		return
	}
	defer os.RemoveAll(dir)

	idx, err := Bleve(dir)
	if err != nil {
		t.Errorf("*setup* failed to instantiate Bleve: %v", err)
		return
	}

	evs := []*gomatrix.Event{
		{
			Sender:    "@user:server",
			Type:      "m.room.message",
			Timestamp: time.Now().UnixNano() / int64(time.Millisecond),
			ID:        "$12345:server",
			RoomID:    "!abcde:server",
			Content: map[string]interface{}{
				"body": "hello world",
			},
		}, {
			Sender:    "@user:server",
			Type:      "m.room.message",
			Timestamp: time.Now().UnixNano() / int64(time.Millisecond),
			ID:        "$12222:server",
			RoomID:    "!abcde:server",
			Content: map[string]interface{}{
				"topic": "hello world",
			},
		}, {
			Sender:    "@user1:server",
			Type:      "m.room.message",
			Timestamp: time.Now().UnixNano() / int64(time.Millisecond),
			ID:        "$12333:server",
			RoomID:    "!abcde:server",
			Content: map[string]interface{}{
				"name": "hello world",
			},
		},
	}

	tests := []struct {
		name    string
		ev      *gomatrix.Event
		wantErr bool
	}{
		{
			"insert_0",
			evs[0],
			false,
		}, {
			"insert_1",
			evs[1],
			false,
		}, {
			"insert_2",
			evs[2],
			false,
		},
	}

	var expectDocumentCount uint64 = 0

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if !tt.wantErr {
				expectDocumentCount++
			}

			if err := IndexEvent(idx, tt.ev); (err != nil) != tt.wantErr {
				t.Errorf("IndexEvent() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}

	t.Run("doc count", func(t *testing.T) {
		count, err := idx.DocCount()
		if err != nil {
			t.Errorf("DocCount() error = %v", err)
			return
		}
		if count != expectDocumentCount {
			t.Errorf("DocCount() = %v, want %v", count, expectDocumentCount)
		}
	})

	tests2 := []struct {
		name   string
		sreq   *bleve.SearchRequest
		expIDs []string
	}{
		{
			"query by content.body",
			func() *bleve.SearchRequest {
				qr := bleve.NewMatchQuery("world")
				qr.SetField("content.body")
				return bleve.NewSearchRequest(qr)
			}(),
			[]string{MakeIndexID(evs[0].RoomID, evs[0].ID)},
		}, {
			"query by content.topic",
			func() *bleve.SearchRequest {
				qr := bleve.NewMatchQuery("world")
				qr.SetField("content.topic")
				return bleve.NewSearchRequest(qr)
			}(),
			[]string{MakeIndexID(evs[1].RoomID, evs[1].ID)},
		}, {
			"query by content.name",
			func() *bleve.SearchRequest {
				qr := bleve.NewMatchQuery("world")
				qr.SetField("content.name")
				return bleve.NewSearchRequest(qr)
			}(),
			[]string{MakeIndexID(evs[2].RoomID, evs[2].ID)},
		}, {
			"query by content.invalid (unused field)",
			func() *bleve.SearchRequest {
				qr := bleve.NewMatchQuery("world")
				qr.SetField("content.invalid")
				return bleve.NewSearchRequest(qr)
			}(),
			[]string{},
		}, {
			"query by sender",
			func() *bleve.SearchRequest {
				qr := bleve.NewMatchQuery(evs[0].Sender)
				qr.SetField(FieldNameSender)
				return bleve.NewSearchRequest(qr)
			}(),
			[]string{
				MakeIndexID(evs[0].RoomID, evs[0].ID),
				MakeIndexID(evs[1].RoomID, evs[1].ID),
			},
		}, {
			"query by room_id",
			func() *bleve.SearchRequest {
				qr := bleve.NewMatchQuery(evs[0].RoomID)
				qr.SetField(FieldNameRoomID)
				return bleve.NewSearchRequest(qr)
			}(),
			[]string{
				MakeIndexID(evs[0].RoomID, evs[0].ID),
				MakeIndexID(evs[1].RoomID, evs[1].ID),
				MakeIndexID(evs[2].RoomID, evs[2].ID),
			},
		},
	}
	for _, tt := range tests2 {
		t.Run(tt.name, func(t *testing.T) {
			sr, err := idx.Search(tt.sreq)

			if err != nil {
				t.Errorf("idx.Search() error = %v", err)
			}

			if sr.Total != uint64(len(tt.expIDs)) {
				t.Errorf("idx.Search() wrong number of documents found = %v, want %v", sr.Total, len(tt.expIDs))
				return
			}

			expIDs := common.NewStringSet(tt.expIDs)

			for i := range sr.Hits {
				// TODO verify internal doc if we ever begin relying on it
				//raw, e := idx.GetInternal([]byte(sr.Hits[i].ID))
				//t.Log(string(raw), e)
				if !expIDs.Has(sr.Hits[i].ID) {
					t.Errorf("sr.Hits[i] not in expIDs; ID = %v, want %v", sr.Hits[i].ID, expIDs)
				}
			}
		})
	}

	if err := idx.Close(); err != nil {
		t.Errorf("idx.Close() error = %v", err)
	}
}
