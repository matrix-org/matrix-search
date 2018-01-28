package indexing

import (
	"encoding/base64"
	"errors"
	"fmt"
	"github.com/blevesearch/bleve"
	"github.com/blevesearch/bleve/analysis/analyzer/custom"
	"github.com/blevesearch/bleve/analysis/analyzer/keyword"
	"github.com/blevesearch/bleve/analysis/analyzer/web"
	"github.com/blevesearch/bleve/analysis/lang/en"
	"github.com/blevesearch/bleve/analysis/token/apostrophe"
	"github.com/blevesearch/bleve/analysis/token/camelcase"
	"github.com/blevesearch/bleve/analysis/token/lowercase"
	"github.com/blevesearch/bleve/analysis/token/ngram"
	"github.com/blevesearch/bleve/analysis/token/porter"
	"github.com/blevesearch/bleve/analysis/tokenizer/single"
	"github.com/blevesearch/bleve/analysis/tokenizer/unicode"
	"github.com/blevesearch/bleve/mapping"
	"github.com/blevesearch/bleve/search/query"
	"github.com/blevesearch/blevex/detectlang"
	"log"
	"os"
	"strings"
	"sync"
	"time"
)

type Indexer struct {
	idxs map[string]bleve.Index
	sync.RWMutex
}

func (i *Indexer) getIndex(id string) (idx bleve.Index) {
	id = "all"

	i.RLock()
	idx = i.idxs[id]
	i.RUnlock()

	if idx != nil {
		return
	}

	i.Lock()
	defer i.Unlock()

	var err error
	idx, err = Bleve(base64.URLEncoding.EncodeToString([]byte(id)))

	if err != nil {
		fmt.Println(err)
		return
	}

	i.idxs[id] = idx
	return
}

func (i *Indexer) AddEvent(ID, RoomID string, ev Event) bool {
	if err := ev.Index(fmt.Sprintf("%s/%s", RoomID, ID), i.getIndex(RoomID)); err != nil {
		fmt.Println(err)
		return false
	}
	return true
}

func makeSearchQuery(query string) query.Query {
	return bleve.NewQueryStringQuery(strings.ToLower(query))
}

//func (i *Indexer) Query(id, query string) (*bleve.SearchResult, error) {
//searchRequest := bleve.NewSearchRequest(bleve.NewMatchQuery(query))
//searchRequest := bleve.NewSearchRequest(bleve.NewFuzzyQuery(query))
//return i.getIndex(id).Search(makeSearchRequest(query))
//}

func (i *Indexer) QueryMultiple(roomIds []string, qs string) (*bleve.SearchResult, error) {
	//targetedIdxs := make([]bleve.Index, len(roomIds))
	//for j, roomId := range roomIds {
	//	targetedIdxs[j] = i.getIndex(roomId)
	//}
	//collection := bleve.NewIndexAlias(targetedIdxs...)
	collection := i.getIndex("")
	request := makeSearchQuery(qs)

	roomIdQueries := make([]query.Query, 0, len(roomIds))
	for _, roomId := range roomIds {
		qr := query.NewTermQuery(roomId)
		qr.SetField("room_id")
		roomIdQueries = append(roomIdQueries, qr)
	}

	roomIdQ := query.NewBooleanQuery(nil, roomIdQueries, nil)

	q := bleve.NewConjunctionQuery(roomIdQ, request)
	return collection.Search(bleve.NewSearchRequest(q))
}

func NewIndexer() Indexer {
	return Indexer{
		idxs: make(map[string]bleve.Index),
	}
}

const bleveBasePath = "bleve"

//var bleveIdx bleve.Index
//var bleveIdxMap = make(map[string]bleve.Index)

// Bleve connect or create the index persistence
func Bleve(indexPath string) (bleve.Index, error) {
	//if bleveIdx, exists := bleveIdxMap[indexPath]; exists {
	//	return bleveIdx, nil
	//}

	path := bleveBasePath + string(os.PathSeparator) + indexPath

	// try to open de persistence file...
	bleveIdx, err := bleve.Open(path)

	// if doesn't exists or something goes wrong...
	if err != nil {
		// create a new mapping file and create a new index
		//newMapping := bleve.NewIndexMapping()
		var newMapping mapping.IndexMapping
		newMapping, err = createEventMapping()
		if err != nil {
			return nil, err
		}
		bleveIdx, err = bleve.New(path, newMapping)
	}

	//if err == nil {
	//	bleveIdxMap[indexPath] = bleveIdx
	//}
	return bleveIdx, err
}

/*type Event struct {
	//ID      string
	sender  string
	content map[string]interface{}
	//RoomID  string
	time time.Time
}*/

type Event map[string]interface{}

func (ev *Event) Type() string {
	return "event"
}

// Index is used to add the event in the bleve index.
func (ev *Event) Index(ID string, index bleve.Index) error {
	if index == nil {
		return errors.New("missing index")
	}
	err := index.Index(ID, ev)
	return err
}

func NewEvent(sender, roomID, evType string, content map[string]interface{}, time time.Time) Event {
	//return interface{}(Event{sender, content, time})
	return Event{
		"sender":  sender,
		"content": content,
		"room_id": roomID,
		"type":    evType,
		"time":    time,
	}
}

func OpenIndex(databasePath string) bleve.Index {
	index, err := bleve.Open(databasePath)

	if err != nil {
		log.Fatal(err)
		os.Exit(-1)
	}

	return index
}

//func CreateIndex(databasePath string) bleve.Index {
//	mapping := bleve.NewIndexMapping()
//	mapping = addCustomAnalyzers(mapping)
//	mapping, _ = createEventMapping()
//
//	index, err := bleve.New(databasePath, mapping)
//	if err != nil {
//		log.Fatal(err)
//		os.Exit(-1)
//	}
//
//	return index
//}

const textFieldAnalyzer = "en"

func createIndexMapping() *mapping.IndexMappingImpl {
	indexMapping := bleve.NewIndexMapping()

	err := indexMapping.AddCustomAnalyzer("custom_alt", map[string]interface{}{
		"type":      custom.Name,
		"tokenizer": unicode.Name,
		"token_filters": []string{
			detectlang.FilterName,
			en.PossessiveName,
			apostrophe.Name,
			lowercase.Name,
			camelcase.Name,
			//elision.Name,
			en.StopName,
			porter.Name,
		},
	})

	if err != nil {
		fmt.Println(err)
	}

	return indexMapping
}

func createEventMapping() (mapping.IndexMapping, error) {
	indexMapping := createIndexMapping()

	// a generic reusable mapping for english text
	englishTextFieldMapping := bleve.NewTextFieldMapping()
	englishTextFieldMapping.Analyzer = en.AnalyzerName

	// a generic reusable mapping for keyword text
	keywordFieldMapping := bleve.NewTextFieldMapping()
	keywordFieldMapping.Analyzer = keyword.Name
	keywordFieldMapping.IncludeInAll = false

	// a specific mapping to index the description fields
	// detected language
	descriptionLangFieldMapping := bleve.NewTextFieldMapping()
	descriptionLangFieldMapping.Name = "descriptionLang"
	descriptionLangFieldMapping.Analyzer = detectlang.AnalyzerName
	descriptionLangFieldMapping.Store = false
	descriptionLangFieldMapping.IncludeTermVectors = false
	//descriptionLangFieldMapping.IncludeInAll = false

	descriptionLangFieldMappingAlt := bleve.NewTextFieldMapping()
	descriptionLangFieldMappingAlt.Analyzer = "custom_alt"

	descriptionLangFieldMappingWeb := bleve.NewTextFieldMapping()
	descriptionLangFieldMappingWeb.Analyzer = web.Name

	eventMapping := bleve.NewDocumentMapping()

	eventMapping.AddFieldMappingsAt("room_id", keywordFieldMapping)
	eventMapping.AddFieldMappingsAt("sender", keywordFieldMapping)
	eventMapping.AddFieldMappingsAt("type", keywordFieldMapping)

	//roomIDMapping := bleve.NewTextFieldMapping()
	//roomIDMapping.IncludeInAll = false
	//eventMapping.AddFieldMappingsAt("room_id", roomIDMapping)

	//contentMapping := bleve.NewTextFieldMapping()
	//contentMapping.IncludeInAll = false
	//eventMapping.AddFieldMappingsAt("content.body", descriptionLangFieldMapping)
	eventMapping.AddFieldMappingsAt("content", descriptionLangFieldMapping, descriptionLangFieldMappingAlt, descriptionLangFieldMappingWeb)

	eventMapping.AddFieldMappingsAt("time", bleve.NewDateTimeFieldMapping())

	indexMapping.AddDocumentMapping("event", eventMapping)

	indexMapping.TypeField = "type"
	indexMapping.DefaultAnalyzer = textFieldAnalyzer

	return indexMapping, nil
}

func addCustomTokenFilter(indexMapping *mapping.IndexMappingImpl) *mapping.IndexMappingImpl {
	err := indexMapping.AddCustomTokenFilter("bigram_tokenfilter", map[string]interface{}{
		"type": ngram.Name,
		//"side": ngram.FRONT,
		"min": 3.0,
		"max": 25.0,
	})

	if err != nil {
		log.Fatal(err)
	}

	return indexMapping
}

func addCustomAnalyzers(indexMapping *mapping.IndexMappingImpl) *mapping.IndexMappingImpl {
	indexMapping = addCustomTokenFilter(indexMapping)

	err := indexMapping.AddCustomAnalyzer("not_analyzed", map[string]interface{}{
		"type":      custom.Name,
		"tokenizer": single.Name,
	})

	if err != nil {
		log.Fatal(err)
	}

	err = indexMapping.AddCustomAnalyzer("fulltext_ngram", map[string]interface{}{
		"type":      custom.Name,
		"tokenizer": unicode.Name,
		"token_filters": []string{
			lowercase.Name,
			"bigram_tokenfilter",
		},
	})

	if err != nil {
		log.Fatal(err)
	}

	return indexMapping
}

func Execute() {

}
