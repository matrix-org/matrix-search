package clientapi

import (
	"github.com/matrix-org/gomatrix"
	"github.com/matrix-org/matrix-search/common"
	"strconv"
	"sync"
)

type WrappedClient struct {
	*gomatrix.Client
	sync.Mutex
}

type RespJoinedRooms struct {
	JoinedRooms []string `json:"joined_rooms"`
}

func (cli *WrappedClient) joinedRooms() (resp *RespJoinedRooms, err error) {
	cli.Lock()
	defer cli.Unlock()

	urlPath := cli.BuildURL("joined_rooms")
	_, err = cli.MakeRequest("GET", urlPath, nil, &resp)
	return
}

func (cli *WrappedClient) latestState(roomID string) (resp []*gomatrix.Event, err error) {
	cli.Lock()
	defer cli.Unlock()

	urlPath := cli.BuildURL("rooms", roomID, "state")
	_, err = cli.MakeRequest("GET", urlPath, nil, &resp)
	return
}

type RespContext struct {
	Start        string            `json:"start"`
	End          string            `json:"end"`
	EventsBefore []*gomatrix.Event `json:"events_before"`
	Event        *gomatrix.Event   `json:"event"`
	EventsAfter  []*gomatrix.Event `json:"events_after"`
	State        []*gomatrix.Event `json:"state"`
}

func (cli *WrappedClient) resolveEvent(roomID, eventID string, beforeLimit, afterLimit int) (resp *RespContext, err error) {
	cli.Lock()
	defer cli.Unlock()

	limit := beforeLimit
	if afterLimit > beforeLimit {
		limit = afterLimit
	}

	urlPath := cli.BuildURLWithQuery([]string{"rooms", roomID, "context", eventID}, map[string]string{
		"limit": strconv.Itoa(limit),
	})
	_, err = cli.MakeRequest("GET", urlPath, nil, &resp)
	return
}

func NewWrappedClient(userID, hsURL, localpart, token string) (wp *WrappedClient, err error) {
	cli, err := common.MakeClient(hsURL, localpart, token)
	if err != nil {
		return
	}
	cli.AppServiceUserID = userID
	return &WrappedClient{Client: cli}, nil
}
