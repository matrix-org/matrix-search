package wrappedclient

import (
	"encoding/json"
	//"github.com/jinzhu/gorm"
	//_ "github.com/jinzhu/gorm/dialects/sqlite"
	"github.com/matrix-org/gomatrix"
	"io/ioutil"
	"os"
	"time"
)

//type FilterString struct {
//	gorm.Model
//	Key string
//	string
//}
//type NextBatchString struct {
//	gorm.Model
//	Key string
//	string
//}
//type RoomsRoom struct {
//	gorm.Model
//	Key string
//	*gomatrix.Room
//}

type PersistedStore struct {
	//gorm.Model
	Filters   map[string]string
	NextBatch map[string]string
	Rooms     map[string]*gomatrix.Room
}

// SaveFilterID to memory.
func (s *PersistedStore) SaveFilterID(userID, filterID string) {
	s.Filters[userID] = filterID
}

// LoadFilterID from memory.
func (s *PersistedStore) LoadFilterID(userID string) string {
	return s.Filters[userID]
}

// SaveNextBatch to memory.
func (s *PersistedStore) SaveNextBatch(userID, nextBatchToken string) {
	s.NextBatch[userID] = nextBatchToken
}

// LoadNextBatch from memory.
func (s *PersistedStore) LoadNextBatch(userID string) string {
	return s.NextBatch[userID]
}

// SaveRoom to memory.
func (s *PersistedStore) SaveRoom(room *gomatrix.Room) {
	s.Rooms[room.ID] = room
	//s.Create(&RoomsRoom{Key: room.ID, Room: room})
}

// LoadRoom from memory.
func (s *PersistedStore) LoadRoom(roomID string) *gomatrix.Room {
	return s.Rooms[roomID]
	//room, ok := s.Rooms[roomID]
	//if room != nil {
	//	return room
	//}

	//if !ok {
	// Load room from fs
	//}
	//return nil

	//var room RoomsRoom
	//s.First(&room, "key = ?", roomID)
	//return room.Room
}

func (s *PersistedStore) persist() {
	for {
		time.Sleep(100 * time.Second)
		b, err := json.Marshal(s)
		if err != nil {
			panic(err)
		}

		err = ioutil.WriteFile("persist.json", b, 0644)
		if err != nil {
			panic(err)
		}
	}
}

// NewPersistedStore constructs a new InMemoryStore.
func NewPersistedStore() (store *PersistedStore) {
	//db, err := gorm.Open("sqlite3", "test.db")
	//if err != nil {
	//	panic("failed to connect database")
	//}
	//defer db.Close()

	//db.AutoMigrate(&PersistedStore{})

	//db.AutoMigrate(&FilterString{})
	//db.AutoMigrate(&NextBatchString{})
	//db.AutoMigrate(&RoomsRoom{})

	// TODO use GORM here with a proper table structure

	b, err := ioutil.ReadFile("persist.json")
	if err != nil {
		if os.IsNotExist(err) {
			store = &PersistedStore{
				Filters:   make(map[string]string),
				NextBatch: make(map[string]string),
				Rooms:     make(map[string]*gomatrix.Room),
			}
			go store.persist()
			return
		}
		panic(err)
	}

	err = json.Unmarshal(b, &store)
	if err != nil {
		panic(err)
	}

	go store.persist()
	return
}
