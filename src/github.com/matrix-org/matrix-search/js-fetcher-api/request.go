package js_fetcher_api

import (
	"github.com/blevesearch/bleve"
	"github.com/blevesearch/bleve/search"
	"github.com/blevesearch/bleve/search/query"
	"github.com/matrix-org/matrix-search/common"
	"github.com/matrix-org/matrix-search/indexing"
	"strings"
)

type QueryRequest struct {
	Keys   []string `json:"keys"`
	Filter struct {
		Must    map[string]common.StringSet `json:"must"`    // all of must
		Should  map[string]common.StringSet `json:"should"`  // any of should
		MustNot map[string]common.StringSet `json:"mustNot"` // any of must not
	} `json:"filter"`
	SortBy     string `json:"sortBy"`
	SearchTerm string `json:"searchTerm"`
	From       int    `json:"from"`
	Size       int    `json:"size"`
}

func (req *QueryRequest) Valid() bool {
	if req.SortBy != "rank" && req.SortBy != "recent" {
		return false
	}

	return true
}

func (req *QueryRequest) generateSearchRequest() *bleve.SearchRequest {
	qr := bleve.NewBooleanQuery()

	for fieldName, values := range req.Filter.Must {
		if len(values) > 0 {
			qr.AddMust(query.NewDisjunctionQuery(indexing.GenerateQueryList(values, fieldName))) // must have one of the values for field
		}
	}
	for fieldName, values := range req.Filter.Should {
		if len(values) > 0 {
			qr.AddShould(indexing.GenerateQueryList(values, fieldName)...)
		}
	}
	for fieldName, values := range req.Filter.MustNot {
		if len(values) > 0 {
			qr.AddMustNot(indexing.GenerateQueryList(values, fieldName)...)
		}
	}

	//The user-entered query string
	if len(req.Keys) > 0 && req.SearchTerm != "" {
		oneOf := query.NewDisjunctionQuery(nil)
		for _, key := range req.Keys {
			qrs := query.NewMatchQuery(strings.ToLower(req.SearchTerm))
			qrs.SetField(key)
			oneOf.AddQuery(qrs)
		}
		qr.AddMust(oneOf)
	}

	sr := bleve.NewSearchRequestOptions(qr, req.Size, req.From, false)
	sr.IncludeLocations = true

	if req.SortBy == "recent" {
		//req.SortBy([]string{"-time"})
		sr.SortByCustom(search.SortOrder{
			&search.SortField{
				Field: "time",
				Desc:  true,
			},
		})
	}

	return sr
}
