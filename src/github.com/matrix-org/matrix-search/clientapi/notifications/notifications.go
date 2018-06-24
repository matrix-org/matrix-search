package notifications

import (
	"context"
	"github.com/gin-gonic/gin"
	"github.com/matrix-org/gomatrix"
	"net/http"
	"upper.io/db.v3/lib/sqlbuilder"
)

type RequestNotifications struct {
	From  string `form:"from"`
	Limit *int   `form:"limit"`
	Only  string `form:"only"`
}

type Notification struct {
	Actions    map[string]interface{} `json:"actions"`
	Event      *gomatrix.Event        `json:"event"`
	ProfileTag string                 `json:"profile_tag,omitempty"`
	Read       bool                   `json:"read"`
	RoomID     string                 `json:"room_id"`
	Timestamp  int64                  `json:"ts"`
}

type ResponseNotifications struct {
	NextToken     string         `json:"next_token,omitempty"`
	Notifications []Notification `json:"notifications"`
}

const CollectionEvents = "events"
const CollectionTweaks = "notification_tweaks"

func InsertEvent(sess sqlbuilder.Database, ctx context.Context, ev *gomatrix.Event, isNotification bool, tweaks []*Tweak) error {
	return sess.Tx(ctx, func(tx sqlbuilder.Tx) (err error) {
		eventsTable := tx.Collection(CollectionEvents)
		tweaksTable := tx.Collection(CollectionTweaks)

		if _, err = eventsTable.Insert(NewEvent(ev, false, isNotification)); err != nil {
			return
		}

		for i := range tweaks {
			if _, err = tweaksTable.Insert(tweaks[i]); err != nil {
				return
			}
		}
		return nil // Commit
	})
}

const tokenKey = "token"

func handler(sess sqlbuilder.Database, req *RequestNotifications) (resp *ResponseNotifications, err error) {
	return nil, nil
}

func Register(r *gin.RouterGroup, sess sqlbuilder.Database) {
	r.POST("/notifications", func(c *gin.Context) {
		//token := c.MustGet(tokenKey).(string) // we don't need token we just need them to be Authed
		var req RequestNotifications
		c.BindQuery(&req)

		resp, err := handler(sess, &req)
		if err != nil {
			c.AbortWithError(http.StatusInternalServerError, err)
			return
		}
		c.JSON(http.StatusOK, resp)
	})

	r.POST("/test", func(c *gin.Context) {
		var ev gomatrix.Event
		c.Bind(&ev)

		InsertEvent(sess, c, &ev, true, []*Tweak{
			{
				Tweak: "key",
				Value: "v",
			}, {
				Tweak: "kkk",
				Value: "vvv",
			},
		})
	})
}
