package wrappedclient

import (
	"crypto/tls"
	"github.com/matrix-org/gomatrix"
	"net/http"
	"strconv"
	"sync"
)

type WrappedClient struct {
	*gomatrix.Client
	sync.Mutex
}

type RespWhoami struct {
	UserID string `json:"user_id"`
}

func (cli *WrappedClient) Whoami() (resp *RespWhoami, err error) {
	cli.Lock()
	defer cli.Unlock()

	urlPath := cli.BuildURL("account", "whoami")
	_, err = cli.MakeRequest("GET", urlPath, nil, &resp)
	return
}

type RespJoinedRooms struct {
	JoinedRooms []string `json:"joined_rooms"`
}

func (cli *WrappedClient) JoinedRooms() (resp *RespJoinedRooms, err error) {
	cli.Lock()
	defer cli.Unlock()

	urlPath := cli.BuildURL("joined_rooms")
	_, err = cli.MakeRequest("GET", urlPath, nil, &resp)
	return
}

func (cli *WrappedClient) LatestState(roomID string) (resp []*gomatrix.Event, err error) {
	cli.Lock()
	defer cli.Unlock()

	urlPath := cli.BuildURL("rooms", roomID, "state")
	_, err = cli.MakeRequest("GET", urlPath, nil, &resp)
	return
}

type Context struct {
	Start        string
	End          string
	EventsBefore []*gomatrix.Event
	EventsAfter  []*gomatrix.Event
	State        []*WrappedEvent
}

type RespEvGeneric struct {
	Event   *WrappedEvent
	Context *Context
}

type RespContext struct {
	Start        string            `json:"start"`
	End          string            `json:"end"`
	EventsBefore []*gomatrix.Event `json:"events_before"`
	Event        *WrappedEvent     `json:"event"`
	EventsAfter  []*gomatrix.Event `json:"events_after"`
	State        []*WrappedEvent   `json:"state"`
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func (cli *WrappedClient) ResolveEventContext(roomID, eventID string, beforeLimit, afterLimit int) (resp *RespContext, err error) {
	cli.Lock()
	defer cli.Unlock()

	limit := max(beforeLimit, afterLimit) + 1

	urlPath := cli.BuildURLWithQuery([]string{"rooms", roomID, "context", eventID}, map[string]string{
		"limit": strconv.Itoa(limit),
	})
	_, err = cli.MakeRequest("GET", urlPath, nil, &resp)

	if err == nil {
		resp.EventsAfter = resp.EventsAfter[:min(len(resp.EventsAfter), afterLimit)]
		resp.EventsBefore = resp.EventsBefore[:min(len(resp.EventsBefore), beforeLimit)]
	}

	return
}

type WrappedEvent gomatrix.Event

func (ev *WrappedEvent) IsStateEvent() bool {
	return ev.StateKey != nil
}

func (cli *WrappedClient) ResolveEvent(roomID, eventID string) (resp *WrappedEvent, err error) {
	cli.Lock()
	defer cli.Unlock()

	urlPath := cli.BuildURL("rooms", roomID, "event", eventID)
	_, err = cli.MakeRequest("GET", urlPath, nil, &resp)
	return
}

type EventTuple struct {
	RoomID  string
	EventID string
}

func NewEventTuple(roomID, eventID string) *EventTuple {
	return &EventTuple{roomID, eventID}
}

func (cli *WrappedClient) MassResolveEventContext(wants []*EventTuple, beforeLimit, afterLimit int) (resp []*RespEvGeneric, err error) {
	resp = make([]*RespEvGeneric, 0, len(wants))
	for _, want := range wants {
		ctx, err := cli.ResolveEventContext(want.RoomID, want.EventID, beforeLimit, afterLimit)
		if err != nil {
			// TODO ignore history-perms
			return nil, err
		}
		resp = append(resp, &RespEvGeneric{
			ctx.Event,
			&Context{
				ctx.Start,
				ctx.End,
				ctx.EventsBefore,
				ctx.EventsAfter,
				ctx.State,
			},
		})
	}
	return
}

func (cli *WrappedClient) MassResolveEvent(wants []*EventTuple) (resp []*RespEvGeneric, err error) {
	resp = make([]*RespEvGeneric, 0, len(wants))
	for _, want := range wants {
		ev, err := cli.ResolveEvent(want.RoomID, want.EventID)
		if err != nil {
			// TODO ignore history-perms
			return nil, err
		}
		resp = append(resp, &RespEvGeneric{ev, nil})
	}
	return
}

func MakeClient(hsURL, localpart, token string) (cli *gomatrix.Client, err error) {
	cli, err = gomatrix.NewClient(hsURL, localpart, token)
	if err != nil {
		return
	}
	cli.Client = &http.Client{Transport: &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true},
	}}
	return
}

func NewWrappedASClient(userID, hsURL, ASUserID, token string) (wp *WrappedClient, err error) {
	cli, err := MakeClient(hsURL, ASUserID, token)
	if err != nil {
		return
	}
	cli.AppServiceUserID = userID
	return &WrappedClient{Client: cli}, nil
}

func NewWrappedClient(hsURL, userID, token string) (wp *WrappedClient, err error) {
	cli, err := MakeClient(hsURL, userID, token)
	if err != nil {
		return
	}
	return &WrappedClient{Client: cli}, nil
}
