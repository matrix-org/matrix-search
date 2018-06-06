package indexing

import (
	"encoding/base64"
	"errors"
	"fmt"
	"github.com/blevesearch/bleve"
	"github.com/blevesearch/bleve/analysis/analyzer/custom"
	"github.com/blevesearch/bleve/analysis/analyzer/web"
	"github.com/blevesearch/bleve/analysis/lang/en"
	"github.com/blevesearch/bleve/analysis/token/apostrophe"
	"github.com/blevesearch/bleve/analysis/token/camelcase"
	"github.com/blevesearch/bleve/analysis/token/lowercase"
	"github.com/blevesearch/bleve/analysis/token/porter"
	"github.com/blevesearch/bleve/analysis/tokenizer/single"
	"github.com/blevesearch/bleve/analysis/tokenizer/unicode"
	"github.com/blevesearch/bleve/mapping"
	"github.com/blevesearch/bleve/search/query"
	"github.com/blevesearch/blevex/detectlang"
	"github.com/matrix-org/gomatrix"
	log "github.com/sirupsen/logrus"
	"os"
	"strings"
	"sync"
	"time"
)

type Indexer struct {
	idxs map[string]bleve.Index
	sync.RWMutex
}

func GetIndex(id string) (idx bleve.Index) {
	var err error
	idx, err = Bleve(base64.URLEncoding.EncodeToString([]byte(id)))

	if err != nil {
		log.WithError(err).Error("failed to get bleve index")
		return
	}

	return
}

func (i *Indexer) GetIndex(id string) (idx bleve.Index) {
	id = "all"

	i.RLock()
	idx = i.idxs[id]
	i.RUnlock()

	if idx != nil {
		return
	}

	i.Lock()
	defer i.Unlock()

	idx = GetIndex(id)
	i.idxs[id] = idx
	return idx
}

func (i *Indexer) IndexEvent(ev *gomatrix.Event) {
	if ev.Type != "m.room.message" {
		return
	}

	ts := time.Unix(0, ev.Timestamp*int64(time.Millisecond))
	iev := NewEvent(ev.Sender, ev.RoomID, ev.Type, ev.Content, ts)
	// TODO handle err from AddEvent and bail txn processing
	err := i.AddEvent(ev.ID, ev.RoomID, iev)
	fmt.Println(err)
}

func (i *Indexer) AddEvent(ID, RoomID string, ev Event) error {
	return ev.Index(fmt.Sprintf("%s/%s", RoomID, ID), i.GetIndex(RoomID))
}

func makeSearchQuery(query string) query.Query {
	return bleve.NewQueryStringQuery(strings.ToLower(query))
}

func (i *Indexer) Query(sr *bleve.SearchRequest) (*bleve.SearchResult, error) {
	ix := i.GetIndex("")
	return ix.Search(sr)
}

//func (i *Indexer) QueryMultiple(roomIds []string, qs string) (*bleve.SearchResult, error) {
//	//targetedIdxs := make([]bleve.Index, len(roomIds))
//	//for j, roomId := range roomIds {
//	//	targetedIdxs[j] = i.GetIndex(roomId)
//	//}
//	//collection := bleve.NewIndexAlias(targetedIdxs...)
//	collection := i.GetIndex("")
//	request := makeSearchQuery(qs)
//
//	roomIdQueries := make([]query.query, 0, len(roomIds))
//	for _, roomId := range roomIds {
//		qr := query.NewTermQuery(roomId)
//		qr.SetField("room_id")
//		roomIdQueries = append(roomIdQueries, qr)
//	}
//
//	roomIdQ := query.NewBooleanQuery(nil, roomIdQueries, nil)
//
//	q := bleve.NewConjunctionQuery(roomIdQ, request)
//	return collection.Search(bleve.NewSearchRequest(q))
//}

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

type Event map[string]interface{}

func (ev *Event) Type() string {
	return "event"
}

// Index is used to add the event in the bleve index.
func (ev *Event) Index(ID string, index bleve.Index) error {
	if index == nil {
		return errors.New("missing index")
	}
	return index.Index(ID, ev)
}

const FieldNameIsURL = "_isURL"
const FieldNameSender = "sender"
const FieldNameContent = "content"
const FieldNameRoomID = "room_id"
const FieldNameType = "type"
const FieldNameTime = "time"

func NewEvent(sender, roomID, evType string, content map[string]interface{}, time time.Time) Event {
	_, isURL := content["url"]

	return Event{
		FieldNameIsURL:   isURL,
		FieldNameSender:  sender,
		FieldNameContent: content,
		FieldNameRoomID:  roomID,
		FieldNameType:    evType,
		FieldNameTime:    time,
	}
}

//func OpenIndex(databasePath string) bleve.Index {
//	index, err := bleve.Open(databasePath)
//
//	if err != nil {
//		log.Fatal(err)
//		os.Exit(-1)
//	}
//
//	return index
//}

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
		panic(err)
	}

	err = indexMapping.AddCustomAnalyzer("custom_exact_keyword", map[string]interface{}{
		"type":      custom.Name,
		"tokenizer": single.Name,
		"token_filters": []string{
			lowercase.Name,
		},
		"char_filters": []string{},
	})

	if err != nil {
		panic(err)
	}

	return indexMapping
}

// TODO look into size optimizations
// watch out for breaking highlight stuff
func createEventMapping() (mapping.IndexMapping, error) {
	indexMapping := createIndexMapping()

	// generic reusable mapping for booleans
	booleanFieldMapping := bleve.NewBooleanFieldMapping()
	booleanFieldMapping.IncludeTermVectors = false
	booleanFieldMapping.IncludeInAll = false
	booleanFieldMapping.Store = false

	// a generic reusable mapping for keyword text
	keywordFieldMapping := bleve.NewTextFieldMapping()
	keywordFieldMapping.Analyzer = "custom_exact_keyword"
	keywordFieldMapping.IncludeInAll = false
	keywordFieldMapping.Store = false

	// a specific mapping to index the description fields using detected language
	descriptionLangFieldMapping := bleve.NewTextFieldMapping()
	descriptionLangFieldMapping.Name = "descriptionLang"
	descriptionLangFieldMapping.Analyzer = detectlang.AnalyzerName
	descriptionLangFieldMapping.Store = false
	//descriptionLangFieldMapping.IncludeTermVectors = false
	descriptionLangFieldMapping.IncludeInAll = false

	descriptionLangFieldMappingAlt := bleve.NewTextFieldMapping()
	descriptionLangFieldMappingAlt.Analyzer = "custom_alt"

	descriptionLangFieldMappingWeb := bleve.NewTextFieldMapping()
	descriptionLangFieldMappingWeb.Analyzer = web.Name
	descriptionLangFieldMappingWeb.Store = false
	descriptionLangFieldMappingWeb.IncludeInAll = false

	// create mapping
	eventMapping := bleve.NewDocumentMapping()

	eventMapping.AddFieldMappingsAt(FieldNameRoomID, keywordFieldMapping)
	eventMapping.AddFieldMappingsAt(FieldNameSender, keywordFieldMapping)
	eventMapping.AddFieldMappingsAt(FieldNameType, keywordFieldMapping)

	// whether or not the content has a `url` key i.e Boolean(content["url"]) for filter.isURL
	eventMapping.AddFieldMappingsAt(FieldNameIsURL, booleanFieldMapping)

	//eventMapping.AddFieldMappingsAt("content.body", descriptionLangFieldMapping)
	eventMapping.AddFieldMappingsAt(FieldNameContent, descriptionLangFieldMapping, descriptionLangFieldMappingAlt, descriptionLangFieldMappingWeb)

	eventMapping.AddFieldMappingsAt(FieldNameTime, bleve.NewDateTimeFieldMapping())

	indexMapping.AddDocumentMapping(docTypeEvent, eventMapping)
	indexMapping.DefaultAnalyzer = textFieldAnalyzer
	indexMapping.DefaultType = docTypeEvent

	return indexMapping, nil
}

const docTypeEvent = "event"
