package clientapi

import (
	"github.com/matrix-org/gomatrix"
	"strconv"
	"sync"
)

type Resolver struct {
	*gomatrix.Client
	sync.Mutex
}

func NewResolver(cli *gomatrix.Client) *Resolver {
	return &Resolver{cli, sync.Mutex{}}
}

type RespContext struct {
	Start        string            `json:"start"`
	End          string            `json:"end"`
	EventsBefore []*gomatrix.Event `json:"events_before"`
	Event        *gomatrix.Event   `json:"event"`
	EventsAfter  []*gomatrix.Event `json:"events_after"`
	State        []*gomatrix.Event `json:"state"`
}

func (r *Resolver) resolveEvent(roomID, eventID string, limit int) (resp *RespContext, err error) {
	r.Lock()
	defer r.Unlock()

	r.AppServiceUserID = "@testguy:synapse"

	urlPath := r.BuildURLWithQuery([]string{"rooms", roomID, "context", eventID}, map[string]string{
		"limit": strconv.Itoa(limit),
	})
	_, err = r.MakeRequest("GET", urlPath, nil, &resp)

	r.AppServiceUserID = ""
	return
}
