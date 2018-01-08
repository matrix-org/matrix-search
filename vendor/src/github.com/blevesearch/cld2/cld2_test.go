package cld2

import (
	"reflect"
	"testing"
)

func TestDetect(t *testing.T) {
	tests := []struct {
		input  string
		output string
	}{
		{
			input:  "the quick brown fox",
			output: "en",
		},
		{
			input:  "こんにちは世界",
			output: "ja",
		},
		{
			input:  "แยกคำภาษาไทยก็ทำได้นะจ้ะ",
			output: "th",
		},
		{
			input:  "مرحبا، العالم!",
			output: "ar",
		},
	}

	for _, test := range tests {
		res := Detect(test.input)
		if !reflect.DeepEqual(res, test.output) {
			t.Errorf("expected: %s got: %s", test.output, res)
		}
	}

}
