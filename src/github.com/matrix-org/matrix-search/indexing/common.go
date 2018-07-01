package indexing

import (
	"fmt"
	"github.com/blevesearch/bleve/search/query"
	"github.com/matrix-org/matrix-search/common"
	"strings"
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

func SplitIndexID(str string) (roomID, eventID string) {
	parts := strings.SplitN(str, "/", 2)
	return parts[0], parts[1]
}

func MakeIndexID(roomID, eventID string) string {
	return fmt.Sprintf("%s/%s", roomID, eventID)
}
