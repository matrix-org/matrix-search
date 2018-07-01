package indexing

import (
	"github.com/blevesearch/bleve"
	"github.com/blevesearch/bleve/analysis/analyzer/custom"
	"github.com/blevesearch/bleve/analysis/lang/en"
	"github.com/blevesearch/bleve/analysis/token/apostrophe"
	"github.com/blevesearch/bleve/analysis/token/camelcase"
	"github.com/blevesearch/bleve/analysis/token/lowercase"
	"github.com/blevesearch/bleve/analysis/token/porter"
	"github.com/blevesearch/bleve/analysis/tokenizer/single"
	"github.com/blevesearch/bleve/analysis/tokenizer/unicode"
	"github.com/blevesearch/bleve/mapping"
	"github.com/blevesearch/blevex/detectlang"
)

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
