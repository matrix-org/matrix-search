package indexing

import (
	"testing"

	"github.com/blevesearch/bleve"
	"github.com/matrix-org/gomatrix"
	"io/ioutil"
	"os"
	"path/filepath"
	"time"
)

func TestBleve(t *testing.T) {
	type args struct {
		path string
	}
	tests := []struct {
		name    string
		args    args
		wantIdx bleve.Index
		wantErr bool
	}{
		{
			"invalid path",
			args{""},
			nil,
			true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotIdx, err := Bleve(tt.args.path)
			if (err != nil) != tt.wantErr {
				t.Errorf("Bleve() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if gotIdx != tt.wantIdx {
				t.Errorf("Bleve() = %v, want %v", gotIdx, tt.wantIdx)
			}
		})
	}
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

	idx, err := Bleve(filepath.Join(dir, "bleve"))
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
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := IndexEvent(idx, tt.ev); (err != nil) != tt.wantErr {
				t.Errorf("IndexEvent() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}

	const expectDocumentCount = 1
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
			"query_0",
			func() *bleve.SearchRequest {
				qr := bleve.NewMatchQuery("world")
				qr.SetField("content.body")
				return bleve.NewSearchRequest(qr)
			}(),
			[]string{MakeIndexID(evs[0].RoomID, evs[0].ID)},
		},
	}
	for _, tt := range tests2 {
		t.Run(tt.name, func(t *testing.T) {
			sr, err := idx.Search(tt.sreq)

			if err != nil {
				t.Errorf("idx.Search() error = %v", err)
			}

			for i := range sr.Hits {
				// TODO verify internal doc if we ever begin relying on it
				//raw, e := idx.GetInternal([]byte(sr.Hits[i].ID))
				//t.Log(string(raw), e)
				if sr.Hits[i].ID != tt.expIDs[i] {
					t.Errorf("sr.Hits[i] ID = %v, want %v", sr.Hits[i].ID, tt.expIDs[i])
				}
			}
		})
	}
}
