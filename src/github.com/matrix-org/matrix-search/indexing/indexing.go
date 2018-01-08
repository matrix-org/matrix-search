package indexing

import (
	"encoding/base64"
	"github.com/blevesearch/bleve"
	"github.com/blevesearch/bleve/analysis/analyzer/custom"
	"github.com/blevesearch/bleve/analysis/analyzer/keyword"
	"github.com/blevesearch/bleve/analysis/lang/en"
	"github.com/blevesearch/bleve/analysis/token/lowercase"
	"github.com/blevesearch/bleve/analysis/token/ngram"
	"github.com/blevesearch/bleve/analysis/tokenizer/single"
	"github.com/blevesearch/bleve/analysis/tokenizer/unicode"
	"github.com/blevesearch/bleve/mapping"
	"github.com/blevesearch/blevex/detectlang"
	"log"
	"os"
	"sync"
	"time"
)

type Indexer struct {
	idxs map[string]bleve.Index
	sync.RWMutex
}

func (i *Indexer) getIndex(id string) (idx bleve.Index) {
	i.RLock()
	idx = i.idxs[id]
	i.RUnlock()

	if idx != nil {
		return
	}

	i.Lock()
	idx, _ = Bleve(base64.URLEncoding.EncodeToString([]byte(id)))
	i.idxs[id] = idx
	i.Unlock()
	return
}

func (i *Indexer) AddEvent(ID, RoomID string, ev Event) {
	ev.Index(ID, i.getIndex(RoomID))
}

func (i *Indexer) Query(id, query string) (*bleve.SearchResult, error) {
	//searchRequest := bleve.NewSearchRequest(bleve.NewMatchQuery(query))
	//searchRequest := bleve.NewSearchRequest(bleve.NewFuzzyQuery(query))
	searchRequest := bleve.NewSearchRequest(bleve.NewQueryStringQuery(query))
	return i.getIndex(id).Search(searchRequest)
}

func NewIndexer() Indexer {
	return Indexer{
		idxs: make(map[string]bleve.Index),
	}
}

const bleveBasePath = "bleve/"

//var bleveIdx bleve.Index
//var bleveIdxMap = make(map[string]bleve.Index)

// Bleve connect or create the index persistence
func Bleve(indexPath string) (bleve.Index, error) {

	//if bleveIdx, exists := bleveIdxMap[indexPath]; exists {
	//	return bleveIdx, nil
	//}

	// try to open de persistence file...
	bleveIdx, err := bleve.Open(bleveBasePath + indexPath)

	// if doesn't exists or something goes wrong...
	if err != nil {
		// create a new mapping file and create a new index
		//newMapping := bleve.NewIndexMapping()
		newMapping, err := createEventMapping()
		if err != nil {
			return nil, err
		}
		bleveIdx, err = bleve.New(bleveBasePath+indexPath, newMapping)
	}

	//if err == nil {
	//	bleveIdxMap[indexPath] = bleveIdx
	//}
	return bleveIdx, err
}

type Event struct {
	//ID      string
	Sender  string
	Content map[string]interface{}
	//RoomID  string
	Time time.Time
}

func (ev *Event) Type() string {
	return "event"
}

// Index is used to add the event in the bleve index.
func (ev *Event) Index(ID string, index bleve.Index) error {
	err := index.Index(ID, ev)
	return err
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

func createEventMapping() (mapping.IndexMapping, error) {

	// a generic reusable mapping for english text
	englishTextFieldMapping := bleve.NewTextFieldMapping()
	englishTextFieldMapping.Analyzer = en.AnalyzerName

	// a generic reusable mapping for keyword text
	keywordFieldMapping := bleve.NewTextFieldMapping()
	keywordFieldMapping.Analyzer = keyword.Name

	// a specific mapping to index the description fields
	// detected language
	descriptionLangFieldMapping := bleve.NewTextFieldMapping()
	descriptionLangFieldMapping.Name = "descriptionLang"
	descriptionLangFieldMapping.Analyzer = detectlang.AnalyzerName
	descriptionLangFieldMapping.Store = false
	descriptionLangFieldMapping.IncludeTermVectors = false
	descriptionLangFieldMapping.IncludeInAll = false

	eventMapping := bleve.NewDocumentMapping()

	//senderMapping := bleve.NewTextFieldMapping()
	//senderMapping.IncludeInAll = false
	eventMapping.AddFieldMappingsAt("sender", keywordFieldMapping)

	//roomIDMapping := bleve.NewTextFieldMapping()
	//roomIDMapping.IncludeInAll = false
	//eventMapping.AddFieldMappingsAt("room_id", roomIDMapping)

	//contentMapping := bleve.NewTextFieldMapping()
	//contentMapping.IncludeInAll = false
	eventMapping.AddFieldMappingsAt("content.body", descriptionLangFieldMapping)

	indexMapping := bleve.NewIndexMapping()
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
