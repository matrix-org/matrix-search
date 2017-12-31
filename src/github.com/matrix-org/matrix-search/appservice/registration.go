package appservice

import (
	"crypto/rand"
	"encoding/hex"
	"gopkg.in/yaml.v2"
	"io/ioutil"
)

type Namespace struct {
	Exclusive bool   `yaml:"exclusive"`
	Regex     string `yaml:"regex"`
}

type Registration struct {
	ID              string `yaml:"id"`
	URL             string `yaml:"url"`
	ASToken         string `yaml:"as_token"`
	HSToken         string `yaml:"hs_token"`
	SenderLocalpart string `yaml:"sender_localpart"`
	Namespaces      struct {
		Users   []Namespace `yaml:"users"`
		Aliases []Namespace `yaml:"aliases"`
		Rooms   []Namespace `yaml:"rooms"`
	} `yaml:"namespaces"`
}

func (r *Registration) AddUserNamespace(exclusive bool, regex string) {
	r.Namespaces.Users = append(r.Namespaces.Users, Namespace{exclusive, regex})
}
func (r *Registration) AddAliasNamespace(exclusive bool, regex string) {
	r.Namespaces.Aliases = append(r.Namespaces.Aliases, Namespace{exclusive, regex})
}
func (r *Registration) AddRoomNamespace(exclusive bool, regex string) {
	r.Namespaces.Rooms = append(r.Namespaces.Rooms, Namespace{exclusive, regex})
}

const tokenSize = 32

func generateToken() string {
	bytes := make([]byte, tokenSize)
	rand.Read(bytes)

	return hex.EncodeToString(bytes)
}

func (r *Registration) Save(path string) error {
	blob, err := yaml.Marshal(&r)
	if err != nil {
		return err
	}

	return ioutil.WriteFile(path, blob, 0644)
}

func NewRegistration(url, senderLocalpart string) *Registration {
	return &Registration{
		URL:             url,
		SenderLocalpart: senderLocalpart,
		ID:              generateToken(),
		HSToken:         generateToken(),
		ASToken:         generateToken(),
	}
}

func LoadRegistration(path string) (registration *Registration, err error) {
	var yamlFile []byte
	if yamlFile, err = ioutil.ReadFile(path); err != nil {
		return
	}

	err = yaml.Unmarshal(yamlFile, &registration)
	return
}
