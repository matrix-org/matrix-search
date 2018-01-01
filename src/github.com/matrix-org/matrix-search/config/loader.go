package config

import (
	"gopkg.in/yaml.v2"
	"io/ioutil"
)

type Config struct {
	Homeserver struct {
		URL    string `yaml:"url"`
		Domain string `yaml:"domain"`
	} `yaml:"homeserver"`

	Search struct {
		ModeAppservice bool `yaml:"mode_appservice"`
		Stemming       struct {
		} `yaml:"stemming"`
	} `yaml:"search"`

	Logging struct {
		Level   string `yaml:"level"`
		Logfile string `yaml:"logfile"`
	} `yaml:"logging"`

	Database struct {
		URI string `yaml:"uri"`
	} `yaml:"database"`

	Bleve struct {
		BasePath string `yaml:"base_path"`
	} `yaml:"bleve"`

	Debug struct {
		PProf bool `yaml:"pprof"`
	} `yaml:"debug"`

	Registration struct {
		Path string `yaml:"path"`
		Port int    `yaml:"port"`
	} `yaml:"registration"`
}

func LoadConfig(path string) (config *Config, err error) {
	var yamlFile []byte
	if yamlFile, err = ioutil.ReadFile(path); err != nil {
		return
	}

	err = yaml.Unmarshal(yamlFile, &config)
	return
}
