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

// Package ghistogram provides a simple histogram of uint64's that
// avoids heap allocations (garbage creation) during data processing.

package ghistogram

import (
	"strings"
	"testing"
)

func initAndFetchHistograms(t *testing.T) (Histograms, string, string) {
	histograms := make(Histograms)
	histograms["test1"] = NewNamedHistogram("test1 (µs)", 10, 2, 2)
	histograms["test2"] = NewNamedHistogram("test2 (µs)", 10, 2, 2)

	histograms["test1"].Add(uint64(1), 2)
	histograms["test1"].Add(uint64(3), 4)
	histograms["test2"].Add(uint64(2), 1)
	histograms["test2"].Add(uint64(4), 3)

	test1 := `test1 (µs) (6 Total)
[0 - 2]   33.33%   33.33% ############### (2)
[2 - 4]   66.67%  100.00% ############################## (4)
`

	test2 := `test2 (µs) (4 Total)
[2 - 4]   25.00%   25.00% ########## (1)
[4 - 8]   75.00%  100.00% ############################## (3)
`

	return histograms, test1, test2
}

func TestStringHistograms(t *testing.T) {
	histograms, exp1, exp2 := initAndFetchHistograms(t)

	output := histograms.String()
	if !strings.Contains(output, exp1) || !strings.Contains(output, exp2) {
		t.Errorf("Unexpected content in String()")
	}
}

func TestAddAllHistograms(t *testing.T) {
	histograms, exp1, exp2 := initAndFetchHistograms(t)

	newhistograms := make(Histograms)
	newhistograms.AddAll(histograms)

	output := newhistograms.String()

	if !strings.Contains(output, exp1) || !strings.Contains(output, exp2) {
		t.Errorf("Unexpected content in String() after AddAll")
	}
}
