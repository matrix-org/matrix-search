package indexing

import (
	"fmt"
	"github.com/blevesearch/bleve"
	"os"
	"testing"
	"time"
)

const (
	checkMark = "\u2713"
	ballotX   = "\u2717"
	testIdx   = "test.bleve"
	dbFile    = "test.sqlite3.db"
)

var eventList = []Event{
	{"$1", "@mxidOne:server", "The European Go conference", "!room", time.Date(2015, 11, 19, 9, 0, 0, 0, time.UTC)},

	{"$2", "@mxidTwo:server", "The Go Conference in India", "!room", time.Date(2016, 2, 19, 0, 0, 0, 0, time.UTC)},

	{"$3", "@mxidThr:server", "GopherCon, It is the largest event in the world dedicated solely to the Go programming language. It's attended by the best and the brightest of the Go team and community.", "!room2", time.Date(2016, 7, 11, 0, 0, 0, 0, time.UTC)},
}

func TestIndexing(t *testing.T) {
	//_, eventList := dbCreate()
	idx := idxCreate()

	err := eventList[0].Index(idx)
	if err != nil {
		t.Error("Wasn't possible create the index", err, ballotX)
	} else {
		t.Log("Should create an event index", checkMark)
	}

	idxDestroy()
}

func TestFindByAnything(t *testing.T) {
	//db, eventList := dbCreate()
	idx := idxCreate()
	indexEvents(idx, eventList)

	// We are looking to an Event with some string which match with dotGo
	query := bleve.NewMatchQuery("largest")
	searchRequest := bleve.NewSearchRequest(query)
	searchResult, err := idx.Search(searchRequest)
	if err != nil {
		t.Error("Something wrong happen with the search", err, ballotX)
	} else {
		t.Log("Should search the query", checkMark)
	}

	if searchResult.Total != 1 {
		t.Error("Only 1 result are expected, got ", searchResult.Total, ballotX)
	} else {
		t.Log("Should return only one result", checkMark)
	}

	raw, err := idx.GetInternal([]byte(searchResult.Hits[0].ID))
	t.Log(string(raw))

	//t.Log("Found ", searchResult.Total, " results!")
	str := fmt.Sprintf("%+v\n", searchResult)
	//for i := range searchResult.Hits {
	//	t.Log(searchResult.Hits[i])
	//}
	t.Log(str)

	//event := &Event{}
	//db.First(&event, &searchResult.Hits[0].ID)
	//if event.Name != "dotGo 2015" {
	//	t.Error("Expected \"dotGo 2015\", Receive: ", event.Name)
	//} else {
	//	t.Log("Should return an event with the name equal a", event.Name, checkMark)
	//}

	idxDestroy()
}

// indexEvents add the eventList to the index
func indexEvents(idx bleve.Index, eventList []Event) {
	for _, event := range eventList {
		event.Index(idx)
	}
}

func idxCreate() bleve.Index {
	idx, _ := Bleve(testIdx)
	return idx
}

func idxDestroy() {
	os.RemoveAll(testIdx)
}

func TestMain(m *testing.M) {
	m.Run()
}
