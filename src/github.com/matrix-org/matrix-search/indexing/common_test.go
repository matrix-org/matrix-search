package indexing

import (
	"testing"
)

func TestSplitIndexID(t *testing.T) {
	type args struct {
		str string
	}
	tests := []struct {
		name        string
		args        args
		wantRoomID  string
		wantEventID string
	}{
		{
			"simple_0",
			args{"!123/$abc"},
			"!123",
			"$abc",
		}, {
			"simple_1",
			args{"!wijdoaiwhdoawohdio/$fuhwaoidhwaoido"},
			"!wijdoaiwhdoawohdio",
			"$fuhwaoidhwaoido",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotRoomID, gotEventID := SplitIndexID(tt.args.str)
			if gotRoomID != tt.wantRoomID {
				t.Errorf("SplitIndexID() gotRoomID = %v, want %v", gotRoomID, tt.wantRoomID)
			}
			if gotEventID != tt.wantEventID {
				t.Errorf("SplitIndexID() gotEventID = %v, want %v", gotEventID, tt.wantEventID)
			}
		})
	}
}

func TestMakeIndexID(t *testing.T) {
	type args struct {
		roomID  string
		eventID string
	}
	tests := []struct {
		name string
		args args
		want string
	}{
		{
			"simple_0",
			args{"!123", "$abc"},
			"!123/$abc",
		}, {
			"simple_1",
			args{"!wijdoaiwhdoawohdio", "$fuhwaoidhwaoido"},
			"!wijdoaiwhdoawohdio/$fuhwaoidhwaoido",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := MakeIndexID(tt.args.roomID, tt.args.eventID); got != tt.want {
				t.Errorf("MakeIndexID() = %v, want %v", got, tt.want)
			}
		})
	}
}
