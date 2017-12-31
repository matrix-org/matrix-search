//  Copyright (c) 2017 Couchbase, Inc.
//
//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the
//  License. You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
//  Unless required by applicable law or agreed to in writing,
//  software distributed under the License is distributed on an "AS
//  IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
//  express or implied. See the License for the specific language
//  governing permissions and limitations under the License.

package ghistogram

import (
	"bytes"
	"testing"
)

func TestSearch(t *testing.T) {
	tests := []struct {
		arr []uint64
		val uint64
		exp int
	}{
		{[]uint64(nil), 0, -1},
		{[]uint64(nil), 100, -1},

		{[]uint64{0}, 0, 0},
		{[]uint64{0, 10}, 0, 0},
		{[]uint64{0, 10, 20}, 0, 0},

		{[]uint64{0}, 1, 0},
		{[]uint64{0, 10}, 1, 0},
		{[]uint64{0, 10, 20}, 1, 0},

		{[]uint64{0}, 10, 0},
		{[]uint64{0, 10}, 10, 1},
		{[]uint64{0, 10, 20}, 10, 1},

		{[]uint64{0}, 15, 0},
		{[]uint64{0, 10}, 15, 1},
		{[]uint64{0, 10, 20}, 15, 1},

		{[]uint64{0}, 20, 0},
		{[]uint64{0, 10}, 20, 1},
		{[]uint64{0, 10, 20}, 20, 2},

		{[]uint64{0}, 30, 0},
		{[]uint64{0, 10}, 30, 1},
		{[]uint64{0, 10, 20}, 30, 2},
	}

	for testi, test := range tests {
		got := search(test.arr, test.val)
		if got != test.exp {
			t.Errorf("test #%d, arr: %v, val: %d, exp: %d, got: %d",
				testi, test.arr, test.val, test.exp, got)
		}
		if got >= 0 &&
			got < len(test.arr) &&
			test.arr[got] > test.val {
			t.Errorf("test #%d, test.arr[got] > test.val,"+
				" arr: %v, val: %d, exp: %d, got: %d",
				testi, test.arr, test.val, test.exp, got)
		}
	}
}

func TestNewHistogram(t *testing.T) {
	tests := []struct {
		numBins         int
		binFirst        uint64
		binGrowthFactor float64
		exp             []uint64
	}{
		{2, 123, 10.0, []uint64{0, 123}},
		{2, 123, 10.0, []uint64{0, 123}},

		// Test constant bin sizes.
		{5, 10, 0.0, []uint64{0, 10, 20, 30, 40}},

		// Test growing bin sizes.
		{5, 10, 1.5, []uint64{0, 10, 15, 23, 35}},
		{5, 10, 2.0, []uint64{0, 10, 20, 40, 80}},
		{5, 10, 10.0, []uint64{0, 10, 100, 1000, 10000}},
	}

	for testi, test := range tests {
		gh := NewHistogram(
			test.numBins, test.binFirst, test.binGrowthFactor)
		if len(gh.Ranges) != len(gh.Counts) {
			t.Errorf("mismatched len's")
		}
		if len(gh.Ranges) != test.numBins {
			t.Errorf("wrong len's")
		}
		if len(gh.Ranges) != len(test.exp) {
			t.Errorf("unequal len's")
		}
		for i := 0; i < len(gh.Ranges); i++ {
			if gh.Ranges[i] != test.exp[i] {
				t.Errorf("test #%d, actual (%v) != exp (%v)",
					testi, gh.Ranges, test.exp)
			}
		}
	}
}

func TestAdd(t *testing.T) {
	// Bins will look like: {0, 10, 20, 40, 80}.
	gh := NewHistogram(5, 10, 2.0)

	tests := []struct {
		val uint64
		exp []uint64
	}{
		{0, []uint64{1, 0, 0, 0, 0}},
		{0, []uint64{2, 0, 0, 0, 0}},
		{0, []uint64{3, 0, 0, 0, 0}},

		{2, []uint64{4, 0, 0, 0, 0}},
		{3, []uint64{5, 0, 0, 0, 0}},
		{4, []uint64{6, 0, 0, 0, 0}},

		{10, []uint64{6, 1, 0, 0, 0}},
		{11, []uint64{6, 2, 0, 0, 0}},
		{12, []uint64{6, 3, 0, 0, 0}},

		{100, []uint64{6, 3, 0, 0, 1}},
		{90, []uint64{6, 3, 0, 0, 2}},
		{80, []uint64{6, 3, 0, 0, 3}},

		{20, []uint64{6, 3, 1, 0, 3}},
		{30, []uint64{6, 3, 2, 0, 3}},
		{40, []uint64{6, 3, 2, 1, 3}},
	}

	for testi, test := range tests {
		gh.Add(test.val, 1)

		for i := 0; i < len(gh.Counts); i++ {
			if gh.Counts[i] != test.exp[i] {
				t.Errorf("test #%d, actual (%v) != exp (%v)",
					testi, gh.Counts, test.exp)
			}
		}

		if gh.TotCount != uint64(testi+1) {
			t.Errorf("TotCounts wrong")
		}
	}
}

func TestAddAll(t *testing.T) {
	// Bins will look like: {0, 10, 20, 40, 80}.
	gh := NewHistogram(5, 10, 2.0)

	gh.Add(15, 2)
	gh.Add(25, 3)
	gh.Add(1000, 1)

	gh2 := NewHistogram(5, 10, 2.0)
	gh2.AddAll(gh)
	gh2.AddAll(gh)

	exp := []uint64{0, 4, 6, 0, 2}

	for i := 0; i < len(gh2.Counts); i++ {
		if gh2.Counts[i] != exp[i] {
			t.Errorf("AddAll mismatch, actual (%v) != exp (%v)",
				gh2.Counts, exp)
		}
	}

	if gh2.TotCount != 12 {
		t.Errorf("TotCount wrong")
	}
}

func TestGraph(t *testing.T) {
	// Bins will look like: {0, 10, 20, 40, 80, 160, 320}.
	gh := NewNamedHistogram("TestGraph", 9, 10, 2.0)

	gh.Add(5, 2)
	gh.Add(10, 20)
	gh.Add(20, 10)
	gh.Add(40, 3)
	gh.Add(160, 2)
	gh.Add(320, 1)
	gh.Add(1280, 10)

	buf := gh.EmitGraph([]byte("- "), nil)

	exp := `TestGraph (48 Total)
- [0 - 10]        4.17%    4.17% ### (2)
- [10 - 20]      41.67%   45.83% ############################## (20)
- [20 - 40]      20.83%   66.67% ############### (10)
- [40 - 80]       6.25%   72.92% #### (3)
- [160 - 320]     4.17%   77.08% ### (2)
- [320 - 640]     2.08%   79.17% # (1)
- [1280 - inf]   20.83%  100.00% ############### (10)
`

	got := buf.String()
	if got != exp {
		t.Errorf("didn't get expected graph,\ngot: %s\nexp: %s",
			got, exp)
	}
}

func BenchmarkAdd_100_10_0p0(b *testing.B) {
	benchmarkAdd(b, 100, 10, 0.0)
}

func BenchmarkAdd_100_10_1p5(b *testing.B) {
	benchmarkAdd(b, 100, 10, 1.5)
}

func BenchmarkAdd_100_10_2p0(b *testing.B) {
	benchmarkAdd(b, 100, 10, 2.0)
}

func BenchmarkAdd_1000_10_0p0(b *testing.B) {
	benchmarkAdd(b, 1000, 10, 0.0)
}

func BenchmarkAdd_1000_10_1p5(b *testing.B) {
	benchmarkAdd(b, 1000, 10, 1.5)
}

func BenchmarkAdd_1000_10_2p0(b *testing.B) {
	benchmarkAdd(b, 1000, 10, 2.0)
}

func benchmarkAdd(b *testing.B,
	numBins int,
	binFirst uint64,
	binGrowthFactor float64) {
	gh := NewHistogram(numBins, binFirst, binGrowthFactor)

	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		gh.Add(uint64(i), 1)
	}
}

func BenchmarkEmitGraph(b *testing.B) {
	benchmarkEmitGraph(b, 100, 10, 2.0)
}

func benchmarkEmitGraph(b *testing.B,
	numBins int,
	binFirst uint64,
	binGrowthFactor float64) {
	gh := NewHistogram(numBins, binFirst, binGrowthFactor)
	for i := 0; i < b.N/1000; i++ {
		gh.Add(uint64(i), 1)
	}

	buf := bytes.NewBuffer(make([]byte, 0, 20000))

	b.ResetTimer()

	for i := 0; i < b.N; i++ {
		gh.EmitGraph(nil, buf)

		buf.Reset()
	}
}
