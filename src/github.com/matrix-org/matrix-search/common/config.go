package common

import (
	"encoding/json"
	"io/ioutil"
)

type Config struct {
	HSURL       string `json:"hs_url"`
	UserID      string `json:"user_id"`
	DeviceID    string `json:"device_id"`
	AccessToken string `json:"access_token"`
}

func NewConfig(HSURL, UserID, DeviceID, AccessToken string) *Config {
	return &Config{
		HSURL:       HSURL,
		UserID:      UserID,
		DeviceID:    DeviceID,
		AccessToken: AccessToken,
	}
}

func (c *Config) WriteToFile(path string) error {
	buf, _ := json.Marshal(c)
	return ioutil.WriteFile(path, buf, 0644)
}

func ReadConfigFromFile(path string) (c *Config, err error) {
	var buf []byte
	if buf, err = ioutil.ReadFile(path); err != nil {
		return
	}

	err = json.Unmarshal(buf, &c)
	return
}
