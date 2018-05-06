package clientapi

import (
	"encoding/json"
	"fmt"
	"github.com/matrix-org/gomatrix"
	"github.com/matrix-org/matrix-search/config"
	"github.com/matrix-org/matrix-search/indexing"
	"os"
	"runtime/debug"
	"time"
)

// Syncer is the default syncing implementation. You can either write your own syncer, or selectively
// replace parts of this default syncer (e.g. the ProcessResponse method). The default syncer uses the observer
// pattern to notify callers about incoming events. See Syncer.OnEventType for more information.
type Syncer struct {
	UserID    string
	Store     gomatrix.Storer
	listeners map[string][]OnEventListener // event type to listeners array
}

// OnEventListener can be used with Syncer.OnEventType to be informed of incoming events.
type OnEventListener func(*gomatrix.Event)

// NewSyncer returns an instantiated Syncer
func NewSyncer(userID string, store gomatrix.Storer) *Syncer {
	return &Syncer{
		UserID:    userID,
		Store:     store,
		listeners: make(map[string][]OnEventListener),
	}
}

// ProcessResponse processes the /sync response in a way suitable for bots. "Suitable for bots" means a stream of
// unrepeating events. Returns a fatal error if a listener panics.
func (s *Syncer) ProcessResponse(res *gomatrix.RespSync, since string) (err error) {
	if !s.shouldProcessResponse(res, since) {
		return
	}

	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("ProcessResponse panicked! userID=%s since=%s panic=%s\n%s", s.UserID, since, r, debug.Stack())
		}
	}()

	for roomID, roomData := range res.Rooms.Join {
		room := s.getOrCreateRoom(roomID)
		for _, event := range roomData.State.Events {
			event.RoomID = roomID
			room.UpdateState(&event)
			s.notifyListeners(&event)
		}
		for _, event := range roomData.Timeline.Events {
			event.RoomID = roomID
			s.notifyListeners(&event)
		}
	}
	for roomID, roomData := range res.Rooms.Invite {
		room := s.getOrCreateRoom(roomID)
		for _, event := range roomData.State.Events {
			event.RoomID = roomID
			room.UpdateState(&event)
			s.notifyListeners(&event)
		}
	}
	for roomID, roomData := range res.Rooms.Leave {
		room := s.getOrCreateRoom(roomID)
		for _, event := range roomData.Timeline.Events {
			if event.StateKey != nil {
				event.RoomID = roomID
				room.UpdateState(&event)
				s.notifyListeners(&event)
			}
		}
	}
	return
}

// OnEventType allows callers to be notified when there are new events for the given event type.
// There are no duplicate checks.
func (s *Syncer) OnEventType(eventType string, callback OnEventListener) {
	_, exists := s.listeners[eventType]
	if !exists {
		s.listeners[eventType] = []OnEventListener{}
	}
	s.listeners[eventType] = append(s.listeners[eventType], callback)
}

// shouldProcessResponse returns true if the response should be processed. May modify the response to remove
// stuff that shouldn't be processed.
func (s *Syncer) shouldProcessResponse(resp *gomatrix.RespSync, since string) bool {
	if since == "" {
		return false
	}
	// This is a horrible hack because /sync will return the most recent messages for a room
	// as soon as you /join it. We do NOT want to process those events in that particular room
	// because they may have already been processed (if you toggle the bot in/out of the room).
	//
	// Work around this by inspecting each room's timeline and seeing if an m.room.member event for us
	// exists and is "join" and then discard processing that room entirely if so.
	// TODO: We probably want to process messages from after the last join event in the timeline.
	for roomID, roomData := range resp.Rooms.Join {
		for i := len(roomData.Timeline.Events) - 1; i >= 0; i-- {
			e := roomData.Timeline.Events[i]
			if e.Type == "m.room.member" && e.StateKey != nil && *e.StateKey == s.UserID {
				m := e.Content["membership"]
				mship, ok := m.(string)
				if !ok {
					continue
				}
				if mship == "join" {
					_, ok := resp.Rooms.Join[roomID]
					if !ok {
						continue
					}
					delete(resp.Rooms.Join, roomID)   // don't re-process messages
					delete(resp.Rooms.Invite, roomID) // don't re-process invites
					break
				}
			}
		}
	}
	return true
}

// getOrCreateRoom must only be called by the Sync() goroutine which calls ProcessResponse()
func (s *Syncer) getOrCreateRoom(roomID string) *gomatrix.Room {
	room := s.Store.LoadRoom(roomID)
	if room == nil { // create a new Room
		room = gomatrix.NewRoom(roomID)
		s.Store.SaveRoom(room)
	}
	return room
}

func (s *Syncer) notifyListeners(event *gomatrix.Event) {
	listeners, exists := s.listeners[event.Type]
	if !exists {
		return
	}
	for _, fn := range listeners {
		fn(event)
	}
}

// OnFailedSync always returns a 10 second wait period between failed /syncs, never a fatal error.
func (s *Syncer) OnFailedSync(res *gomatrix.RespSync, err error) (time.Duration, error) {
	return 10 * time.Second, nil
}

// GetFilterJSON returns a filter with a timeline limit of 50.
func (s *Syncer) GetFilterJSON(userID string) json.RawMessage {
	return json.RawMessage(`{"room":{"timeline":{"limit":50}}}`)
}

func RegisterSyncer(idxr indexing.Indexer, conf *config.Config) {
	if conf.LocalDaemon.UserID == "" || conf.LocalDaemon.AccessToken == "" {
		panic("invalid local_daemon settings")
	}

	cli, err := NewWrappedClient(conf.Homeserver.URL, conf.LocalDaemon.UserID, conf.LocalDaemon.AccessToken)
	if err != nil {
		fmt.Println(err)
		os.Exit(-1)
	}

	store := NewPersistedStore()
	syncer := gomatrix.NewDefaultSyncer(conf.LocalDaemon.UserID, store)

	cli.Syncer = syncer
	cli.Store = store

	syncer.OnEventType("m.room.message", idxr.IndexEvent)

	for {
		err := cli.Sync()
		if err != nil {
			fmt.Println(err)
			time.Sleep(time.Second)
		}
	}

}
