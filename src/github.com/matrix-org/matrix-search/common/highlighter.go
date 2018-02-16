package common

import (
	"container/heap"

	"github.com/blevesearch/bleve/document"
	"github.com/blevesearch/bleve/registry"
	"github.com/blevesearch/bleve/search"
	"github.com/blevesearch/bleve/search/highlight"
)

const Name = "list"
const DefaultSeparator = "…"

// FragmentScorer will score fragments by how many
// unique terms occur in the fragment with no regard for
// any boost values used in the original query
type FragmentScorer struct {
	tlm search.TermLocationMap
}

func NewFragmentScorer(tlm search.TermLocationMap) *FragmentScorer {
	return &FragmentScorer{
		tlm: tlm,
	}
}

func (s *FragmentScorer) Score(f *highlight.Fragment) {
	score := 0.0
OUTER:
	for _, locations := range s.tlm {
		for _, location := range locations {
			if location.ArrayPositions.Equals(f.ArrayPositions) && int(location.Start) >= f.Start && int(location.End) <= f.End {
				score += 1.0
				// once we find a term in the fragment
				// don't care about additional matches
				continue OUTER
			}
		}
	}
	f.Score = score
}

type Highlighter struct {
	fragmenter highlight.Fragmenter
	formatter  highlight.FragmentFormatter
	sep        string
}

func NewHighlighter() *Highlighter {
	return &Highlighter{}
}

func (s *Highlighter) Fragmenter() highlight.Fragmenter {
	return s.fragmenter
}

func (s *Highlighter) SetFragmenter(f highlight.Fragmenter) {
	s.fragmenter = f
}

func (s *Highlighter) FragmentFormatter() highlight.FragmentFormatter {
	return s.formatter
}

func (s *Highlighter) SetFragmentFormatter(f highlight.FragmentFormatter) {
	s.formatter = f
}

func (s *Highlighter) Separator() string {
	return s.sep
}

func (s *Highlighter) SetSeparator(sep string) {
	s.sep = sep
}

func (s *Highlighter) BestFragmentInField(dm *search.DocumentMatch, doc *document.Document, field string) string {
	fragments := s.BestFragmentsInField(dm, doc, field, 1)
	if len(fragments) > 0 {
		return fragments[0]
	}
	return ""
}

func (s *Highlighter) BestFragmentsInField(dm *search.DocumentMatch, doc *document.Document, field string, num int) []string {
	tlm := dm.Locations[field]
	orderedTermLocations := highlight.OrderTermLocations(tlm)
	scorer := NewFragmentScorer(tlm)

	// score the fragments and put them into a priority queue ordered by score
	fq := make(FragmentQueue, 0)
	heap.Init(&fq)
	for _, f := range doc.Fields {
		if f.Name() == field {
			_, ok := f.(*document.TextField)
			if ok {
				termLocationsSameArrayPosition := make(highlight.TermLocations, 0)
				for _, otl := range orderedTermLocations {
					if otl.ArrayPositions.Equals(f.ArrayPositions()) {
						termLocationsSameArrayPosition = append(termLocationsSameArrayPosition, otl)
					}
				}

				fieldData := f.Value()
				fragments := s.fragmenter.Fragment(fieldData, termLocationsSameArrayPosition)
				for _, fragment := range fragments {
					fragment.ArrayPositions = f.ArrayPositions()
					scorer.Score(fragment)
					heap.Push(&fq, fragment)
				}
			}
		}
	}

	// now find the N best non-overlapping fragments
	var bestFragments []*highlight.Fragment
	if len(fq) > 0 {
		candidate := heap.Pop(&fq)
	OUTER:
		for candidate != nil && len(bestFragments) < num {
			// see if this overlaps with any of the best already identified
			if len(bestFragments) > 0 {
				for _, frag := range bestFragments {
					if candidate.(*highlight.Fragment).Overlaps(frag) {
						if len(fq) < 1 {
							break OUTER
						}
						candidate = heap.Pop(&fq)
						continue OUTER
					}
				}
				bestFragments = append(bestFragments, candidate.(*highlight.Fragment))
			} else {
				bestFragments = append(bestFragments, candidate.(*highlight.Fragment))
			}

			if len(fq) < 1 {
				break
			}
			candidate = heap.Pop(&fq)
		}
	}

	// now that we have the best fragments, we can format them
	orderedTermLocations.MergeOverlapping()
	formattedFragments := make([]string, len(bestFragments))
	for i, fragment := range bestFragments {
		formattedFragments[i] = ""
		if fragment.Start != 0 {
			formattedFragments[i] += s.sep
		}
		formattedFragments[i] += s.formatter.Format(fragment, orderedTermLocations)
		if fragment.End != len(fragment.Orig) {
			formattedFragments[i] += s.sep
		}
	}

	if dm.Fragments == nil {
		dm.Fragments = make(search.FieldFragmentMap, 0)
	}
	if len(formattedFragments) > 0 {
		dm.Fragments[field] = formattedFragments
	}

	return formattedFragments
}

// FragmentQueue implements heap.Interface and holds Items.
type FragmentQueue []*highlight.Fragment

func (fq FragmentQueue) Len() int { return len(fq) }

func (fq FragmentQueue) Less(i, j int) bool {
	// We want Pop to give us the highest, not lowest, priority so we use greater-than here.
	return fq[i].Score > fq[j].Score
}

func (fq FragmentQueue) Swap(i, j int) {
	fq[i], fq[j] = fq[j], fq[i]
	fq[i].Index = i
	fq[j].Index = j
}

func (fq *FragmentQueue) Push(x interface{}) {
	n := len(*fq)
	item := x.(*highlight.Fragment)
	item.Index = n
	*fq = append(*fq, item)
}

func (fq *FragmentQueue) Pop() interface{} {
	old := *fq
	n := len(old)
	item := old[n-1]
	item.Index = -1 // for safety
	*fq = old[0 : n-1]
	return item
}

func Constructor(config map[string]interface{}, cache *registry.Cache) (highlight.Highlighter, error) {
	return &Highlighter{}, nil
}

func init() {
	registry.RegisterHighlighter(Name, Constructor)
}
