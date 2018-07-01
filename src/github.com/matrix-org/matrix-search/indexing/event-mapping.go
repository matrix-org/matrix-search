package indexing

import (
	"github.com/blevesearch/bleve"
	"github.com/blevesearch/bleve/analysis/analyzer/web"
	"github.com/blevesearch/bleve/mapping"
	"github.com/blevesearch/blevex/detectlang"
)

const textFieldAnalyzer = "en"

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
