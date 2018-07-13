package common

import (
	"reflect"
	"sort"
	"testing"
)

func TestStringSet_AddStrings(t *testing.T) {
	tests := []struct {
		name string
		ss   StringSet
		str  []string
	}{
	// TODO: Add test cases.
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.ss.AddStrings(tt.str)
		})
	}
}

func TestStringSet_AddString(t *testing.T) {
	type args struct {
		str string
	}
	tests := []struct {
		name string
		ss   StringSet
		args args
	}{
	// TODO: Add test cases.
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.ss.AddString(tt.args.str)
		})
	}
}

func TestStringSet_Has(t *testing.T) {
	tests := []struct {
		name string
		ss   StringSet
		str  string
		want bool
	}{
		{
			"has when duplicate",
			NewStringSet([]string{"a", "b", "a"}),
			"a",
			true,
		}, {
			"has when does not have",
			NewStringSet([]string{"a", "b", "a"}),
			"c",
			false,
		}, {
			"has when empty",
			NewStringSet([]string{}),
			"a",
			false,
		}, {
			"has when single occurrence",
			NewStringSet([]string{"a"}),
			"a",
			true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.ss.Has(tt.str); got != tt.want {
				t.Errorf("StringSet.Has() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestStringSet_Remove(t *testing.T) {
	type args struct {
		set StringSet
	}
	tests := []struct {
		name string
		ss   StringSet
		args args
	}{
	// TODO: Add test cases.
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.ss.Remove(tt.args.set)
		})
	}
}

func TestStringSet_Intersect(t *testing.T) {
	tests := []struct {
		name  string
		ss    StringSet // in A
		other StringSet // in B
		want  StringSet // out
	}{
		{
			"intersect empty",
			NewStringSet([]string{}),
			NewStringSet([]string{}),
			NewStringSet([]string{}),
		}, {
			"intersect len=1 dup",
			NewStringSet([]string{"a"}),
			NewStringSet([]string{"a"}),
			NewStringSet([]string{"a"}),
		}, {
			"intersect len=1 disjoint",
			NewStringSet([]string{"a"}),
			NewStringSet([]string{"b"}),
			NewStringSet([]string{}),
		}, {
			"intersect complex",
			NewStringSet([]string{"a", "b", "c", "d"}),
			NewStringSet([]string{"b", "c", "d", "e"}),
			NewStringSet([]string{"b", "c", "d"}),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tt.ss.Intersect(tt.other)
			if !reflect.DeepEqual(tt.want, tt.ss) {
				t.Errorf("StringSet.Intersect(); ss = %v, want %v", tt.ss, tt.want)
			}
		})
	}
}

func TestStringSet_IsEmpty(t *testing.T) {
	tests := []struct {
		name string
		ss   StringSet
		want bool
	}{
		{
			"empty",
			NewStringSet([]string{}),
			true,
		}, {
			"not empty",
			NewStringSet([]string{"1"}),
			false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.ss.IsEmpty(); got != tt.want {
				t.Errorf("StringSet.IsEmpty() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestStringSet_ToArray(t *testing.T) {
	tests := []struct {
		name string
		ss   StringSet
		want []string
	}{
		{
			"toArray empty",
			NewStringSet([]string{}),
			[]string{},
		}, {
			"toArray single item duplicated",
			NewStringSet([]string{"a", "a", "a"}),
			[]string{"a"},
		}, {
			"toArray mixed",
			NewStringSet([]string{"a", "c", "c"}),
			[]string{"a", "c"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.ss.ToArray()
			sort.Strings(got)
			sort.Strings(tt.want)
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("StringSet.ToArray() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestStringSet_MarshalJSON(t *testing.T) {
	tests := []struct {
		name    string
		ss      StringSet
		want    []byte
		wantErr bool
	}{
		{ // TODO improve tests, due to Go's random ordering we can only test len=1 here
			"",
			NewStringSet([]string{"a"}),
			[]byte(`["a"]`),
			false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.ss.MarshalJSON()
			if (err != nil) != tt.wantErr {
				t.Errorf("StringSet.MarshalJSON() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("StringSet.MarshalJSON() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestStringSet_UnmarshalJSON(t *testing.T) {
	type args struct {
		b []byte
	}
	tests := []struct {
		name    string
		ss      *StringSet
		args    args
		wantErr bool
	}{
	// TODO: Add test cases.
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := tt.ss.UnmarshalJSON(tt.args.b); (err != nil) != tt.wantErr {
				t.Errorf("StringSet.UnmarshalJSON() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestNewStringSet(t *testing.T) {
	type args struct {
		str []string
	}
	tests := []struct {
		name string
		args args
		want StringSet
	}{
	// TODO: Add test cases.
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := NewStringSet(tt.args.str); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("NewStringSet() = %v, want %v", got, tt.want)
			}
		})
	}
}
