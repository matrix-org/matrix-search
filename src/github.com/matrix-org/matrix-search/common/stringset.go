package common

import "encoding/json"

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

// auto packs string into Set<string>(string) or Set<string>(...string)
func (ss *StringSet) UnmarshalJSON(b []byte) error {
	if b[0] == '[' {
		var s []string
		if err := json.Unmarshal(b, &s); err != nil {
			return err
		}

		*ss = StringSet{}
		ss.AddStrings(s)
		return nil
	}

	// auto pack string into Set
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	*ss = StringSet{}
	ss.AddString(s)
	return nil
}

func NewStringSet(str []string) StringSet {
	ss := StringSet{}
	ss.AddStrings(str)
	return ss
}
