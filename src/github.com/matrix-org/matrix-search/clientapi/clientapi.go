package clientapi

import (
	"github.com/blevesearch/bleve"
	"github.com/gin-gonic/gin"
	"github.com/matrix-org/matrix-search/clientapi/search"
	"github.com/matrix-org/matrix-search/wrappedclient"
	"upper.io/db.v3/lib/sqlbuilder"
)

func Register(r *gin.RouterGroup, sess sqlbuilder.Database, cli *wrappedclient.WrappedClient, index bleve.Index) {
	search.Register(r, cli, index)
	//notifications.Register(r, sess)
}
