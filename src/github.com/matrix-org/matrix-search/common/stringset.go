package common

import (
	"github.com/gin-gonic/gin/json"
)

type StringSet map[string]struct{}

func (ss StringSet) AddStrings(str []string) {
	for i := range str {
		ss[str[i]] = struct{}{}
	}
}

func (ss StringSet) AddString(str string) {
	ss[str] = struct{}{}
}

func (ss StringSet) Has(str string) bool {
	_, exists := ss[str]
	return exists
}

func (ss StringSet) Remove(set StringSet) {
	for k := range set {
		delete(ss, k)
	}
}

func (ss StringSet) Intersect(other StringSet) {
	for k := range ss {
		if _, exists := other[k]; !exists {
			delete(ss, k)
		}
	}
}

func (ss StringSet) IsEmpty() bool {
	return len(ss) == 0
}

func (ss StringSet) ToArray() []string {
	arr := make([]string, 0, len(ss))
	for k := range ss {
		arr = append(arr, k)
	}
	return arr
}

func (ss StringSet) MarshalJSON() ([]byte, error) {
	return json.Marshal(ss.ToArray())
}

func NewStringSet(str []string) StringSet {
	ss := StringSet{}
	ss.AddStrings(str)
	return ss
}
