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

func (cli *WrappedClient) resolveEventContext(roomID, eventID string, beforeLimit, afterLimit int) (resp *RespContext, err error) {
	cli.Lock()
	defer cli.Unlock()

	limit := 1 + beforeLimit + afterLimit

	urlPath := cli.BuildURLWithQuery([]string{"rooms", roomID, "context", eventID}, map[string]string{
		"limit": strconv.Itoa(limit),
	})
	_, err = cli.MakeRequest("GET", urlPath, nil, &resp)

	if err == nil {
		resp.EventsAfter = resp.EventsAfter[:afterLimit]
		resp.EventsBefore = resp.EventsBefore[:beforeLimit]
	}

	return
}

type WrappedEvent gomatrix.Event

func (ev *WrappedEvent) IsStateEvent() bool {
	return ev.StateKey != nil
}

func (cli *WrappedClient) resolveEvent(roomID, eventID string) (resp *WrappedEvent, err error) {
	cli.Lock()
	defer cli.Unlock()

	urlPath := cli.BuildURL("rooms", roomID, "event", eventID)
	_, err = cli.MakeRequest("GET", urlPath, nil, &resp)
	return
}

type eventTuple struct {
	roomID  string
	eventID string
}

func (cli *WrappedClient) massResolveEventContext(wants []eventTuple, beforeLimit, afterLimit int) (resp []*RespContext, err error) {
	resp = make([]*RespContext, 0, len(wants))
	for _, want := range wants {
		ctx, err := cli.resolveEventContext(want.roomID, want.eventID, beforeLimit, afterLimit)
		if err != nil {
			// TODO ignore history-perms
			return nil, err
		}
		resp = append(resp, ctx)
	}
	return
}

func (cli *WrappedClient) massResolveEvent(wants []eventTuple) (resp []*WrappedEvent, err error) {
	resp = make([]*WrappedEvent, 0, len(wants))
	for _, want := range wants {
		ev, err := cli.resolveEvent(want.roomID, want.eventID)
		if err != nil {
			// TODO ignore history-perms
			return nil, err
		}
		resp = append(resp, ev)
	}
	return
}

func NewWrappedASClient(userID, hsURL, ASUserID, token string) (wp *WrappedClient, err error) {
	cli, err := common.MakeClient(hsURL, ASUserID, token)
	if err != nil {
		return
	}
	cli.AppServiceUserID = userID
	return &WrappedClient{Client: cli}, nil
}

func NewWrappedClient(hsURL, userID, token string) (wp *WrappedClient, err error) {
	cli, err := common.MakeClient(hsURL, userID, token)
	if err != nil {
		return
	}
	return &WrappedClient{Client: cli}, nil
}

type SearchResultProcessor interface {
	build(id string, includeProfile bool) *Result
	getEv() *WrappedEvent
}

type options struct {
	Context        *RespContext
	IncludeProfile bool
}

func (reg *RespEvGeneric) build(includeProfile bool) (r *Result) {
	r.Result = reg.Event

	ctx := reg.Context
	if ctx == nil {
		return
	}

	r.Context = &EventContext{
		Start:        ctx.Start,
		End:          ctx.End,
		EventsBefore: ctx.EventsBefore,
		EventsAfter:  ctx.EventsAfter,
	}

	if includeProfile {
		senders := common.StringSet{}

		for _, ev := range ctx.EventsBefore {
			senders.AddString(ev.Sender)
		}
		for _, ev := range ctx.EventsAfter {
			senders.AddString(ev.Sender)
		}
		senders.AddString(reg.Event.Sender)

		r.Context.ProfileInfo = make(map[string]*UserProfile)
		for _, ev := range ctx.State {
			// if stateEvent with type "m.room.member" and sender thereof is in this context
			if ev.IsStateEvent() && ev.Type == "m.room.member" && senders.Has(*ev.StateKey) {
				userProfile := UserProfile{}

				if str, ok := ev.Content["displayname"].(string); ok {
					userProfile.DisplayName = str
				}
				if str, ok := ev.Content["avatar_url"].(string); ok {
					userProfile.AvatarURL = str
				}

				r.Context.ProfileInfo[*ev.StateKey] = &userProfile
			}
		}
	}

	return
}
