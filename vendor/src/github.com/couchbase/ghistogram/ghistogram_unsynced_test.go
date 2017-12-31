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
	"strings"
	"testing"
)

func TestUnsyncedAdd(t *testing.T) {
	hists := make(Histograms)
	hists["hist1"] = NewNamedHistogram("hist1", 10, 4, 4)
	hists["hist2"] = NewNamedHistogram("hist2", 10, 4, 4)

	F1 := func(hist HistogramMutator) {
		for i := 0; i < 10000; i++ {
			hist.Add(uint64(i%100), 1)
		}
	}

	F2 := func(hist HistogramMutator) {
		for i := 0; i < 10000; i++ {
			hist.Add(uint64(i%1000), 1)
		}
	}

	hists["hist1"].CallSyncEx(F1)
	hists["hist2"].CallSyncEx(F2)

	hist1 := `hist1 (10000 Total)
[0 - 4]       4.00%    4.00% ## (400)
[4 - 16]     12.00%   16.00% ####### (1200)
[16 - 64]    48.00%   64.00% ############################## (4800)
[64 - 256]   36.00%  100.00% ###################### (3600)
`

	hist2 := `hist2 (10000 Total)
[0 - 4]         0.40%    0.40%  (40)
[4 - 16]        1.20%    1.60%  (120)
[16 - 64]       4.80%    6.40% # (480)
[64 - 256]     19.20%   25.60% ####### (1920)
[256 - 1024]   74.40%  100.00% ############################## (7440)
`

	if !strings.Contains(hists.String(), hist1) ||
		!strings.Contains(hists.String(), hist2) {
		t.Errorf("Unexpected content in histograms!")
	}
}
