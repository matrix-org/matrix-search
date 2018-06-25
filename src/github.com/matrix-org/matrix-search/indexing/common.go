package indexing

import (
	"github.com/blevesearch/bleve/search/query"
	"github.com/matrix-org/matrix-search/common"
)

func GenerateQueryList(filterSet common.StringSet, fieldName string) []query.Query {
	if size := len(filterSet); size > 0 {
		queries := make([]query.Query, 0, size)
		for k := range filterSet {
			qr := query.NewMatchQuery(k)
			qr.SetField(fieldName)
			queries = append(queries, qr)
		}
		return queries
	}
	return nil
}
