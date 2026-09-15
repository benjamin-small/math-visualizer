//! Sorting algorithms recorded as op traces.
//!
//! The lab does not sort while it animates: it records a complete trace up
//! front and replays it. That only works if every mutation goes through
//! [`Recorder`], so no algorithm here writes into the array directly.

use core::cmp::Ordering;

use serde::{Deserialize, Serialize};

/// One recorded step. `Compare` is inspection only (a no-op on playback);
/// `Swap` and `Write` are the mutations that reproduce the sort.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Op {
    Compare(u16, u16),
    Swap(u16, u16),
    Write(u16, u16 /* value */),
}

/// The array under sort plus the log of everything done to it.
pub struct Recorder {
    pub values: Vec<u16>,
    pub ops: Vec<Op>,
}

impl Recorder {
    /// Start recording from a copy of `initial`.
    pub fn new(initial: &[u16]) -> Self {
        Recorder {
            values: initial.to_vec(),
            ops: Vec::new(),
        }
    }

    /// Number of elements under sort.
    pub fn len(&self) -> usize {
        self.values.len()
    }

    /// Whether there is nothing to sort.
    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    /// Current value at `i`. Reads are not recorded — only comparisons are.
    pub fn get(&self, i: usize) -> u16 {
        self.values[i]
    }

    /// Compare two live elements and log it.
    pub fn compare(&mut self, i: usize, j: usize) -> Ordering {
        let (a, b) = (self.values[i], self.values[j]);
        self.record_compare(i, j, a, b)
    }

    /// Compare the live element at `i` against a value the algorithm is
    /// holding outside the array (the insertion/shell key, the quicksort
    /// pivot). `held_at` is the index the held value came from; it is logged
    /// for highlighting only and its slot may since have been overwritten.
    pub fn compare_held(&mut self, i: usize, held_at: usize, held: u16) -> Ordering {
        let a = self.values[i];
        self.record_compare(i, held_at, a, held)
    }

    /// Compare two values that both live outside the array (merge sort's two
    /// run heads sit in the aux buffer). `i`/`j` are the main-array positions
    /// of those heads, logged for highlighting.
    pub fn compare_pair(&mut self, i: usize, j: usize, a: u16, b: u16) -> Ordering {
        self.record_compare(i, j, a, b)
    }

    /// Exchange two elements and log it.
    pub fn swap(&mut self, i: usize, j: usize) {
        self.ops.push(Op::Swap(i as u16, j as u16));
        self.values.swap(i, j);
    }

    /// Store `v` at `i` and log it.
    pub fn write(&mut self, i: usize, v: u16) {
        self.ops.push(Op::Write(i as u16, v));
        self.values[i] = v;
    }

    fn record_compare(&mut self, i: usize, j: usize, a: u16, b: u16) -> Ordering {
        self.ops.push(Op::Compare(i as u16, j as u16));
        a.cmp(&b)
    }
}

/// The algorithms the lab can animate.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Algorithm {
    Bubble,
    Insertion,
    Selection,
    Shell,
    Merge,
    Quick,
    Heap,
}

impl Algorithm {
    /// Every algorithm, in menu order.
    pub const ALL: [Algorithm; 7] = [
        Algorithm::Bubble,
        Algorithm::Insertion,
        Algorithm::Selection,
        Algorithm::Shell,
        Algorithm::Merge,
        Algorithm::Quick,
        Algorithm::Heap,
    ];

    /// Human-readable name for the UI.
    pub fn label(self) -> &'static str {
        match self {
            Algorithm::Bubble => "Bubble sort",
            Algorithm::Insertion => "Insertion sort",
            Algorithm::Selection => "Selection sort",
            Algorithm::Shell => "Shell sort",
            Algorithm::Merge => "Merge sort",
            Algorithm::Quick => "Quick sort",
            Algorithm::Heap => "Heap sort",
        }
    }

    /// Average-case time complexity, as displayed next to the label.
    pub fn complexity(self) -> &'static str {
        match self {
            Algorithm::Bubble | Algorithm::Insertion | Algorithm::Selection => "O(n²)",
            Algorithm::Shell => "O(n^1.3)",
            Algorithm::Merge | Algorithm::Quick | Algorithm::Heap => "O(n log n)",
        }
    }
}

/// Record the full op trace of `alg` sorting `initial`.
pub fn trace(alg: Algorithm, initial: &[u16]) -> Vec<Op> {
    let mut rec = Recorder::new(initial);
    run(alg, &mut rec);
    rec.ops
}

/// Replay one op onto `values`. `Compare` is inspection, so it does nothing.
pub fn apply(values: &mut [u16], op: Op) {
    match op {
        Op::Compare(_, _) => {}
        Op::Swap(i, j) => values.swap(i as usize, j as usize),
        Op::Write(i, v) => values[i as usize] = v,
    }
}

fn run(alg: Algorithm, rec: &mut Recorder) {
    match alg {
        Algorithm::Bubble => bubble(rec),
        Algorithm::Insertion => insertion(rec),
        Algorithm::Selection => selection(rec),
        Algorithm::Shell => shell(rec),
        Algorithm::Merge => {
            let n = rec.len();
            merge_sort(rec, 0, n);
        }
        Algorithm::Quick => {
            let n = rec.len();
            if n >= 2 {
                quick_sort(rec, 0, n - 1);
            }
        }
        Algorithm::Heap => heap_sort(rec),
    }
}

/// Adjacent swaps, one bubble per pass, stopping as soon as a pass is clean.
fn bubble(rec: &mut Recorder) {
    let n = rec.len();
    if n < 2 {
        return;
    }
    for pass in 0..n - 1 {
        let mut swapped = false;
        for j in 0..n - 1 - pass {
            if rec.compare(j, j + 1) == Ordering::Greater {
                rec.swap(j, j + 1);
                swapped = true;
            }
        }
        if !swapped {
            break;
        }
    }
}

/// Key held aside, larger elements shifted right one write at a time.
fn insertion(rec: &mut Recorder) {
    let n = rec.len();
    for i in 1..n {
        let key = rec.get(i);
        let mut j = i;
        while j > 0 && rec.compare_held(j - 1, i, key) == Ordering::Greater {
            let shifted = rec.get(j - 1);
            rec.write(j, shifted);
            j -= 1;
        }
        rec.write(j, key);
    }
}

/// One swap per position: find the minimum of the tail, then place it.
fn selection(rec: &mut Recorder) {
    let n = rec.len();
    for i in 0..n {
        let mut min = i;
        for j in i + 1..n {
            if rec.compare(j, min) == Ordering::Less {
                min = j;
            }
        }
        if min != i {
            rec.swap(i, min);
        }
    }
}

/// Gapped insertion sort over the gap sequence `n/2, n/4, …, 1`.
fn shell(rec: &mut Recorder) {
    let n = rec.len();
    let mut gap = n / 2;
    while gap > 0 {
        for i in gap..n {
            let key = rec.get(i);
            let mut j = i;
            while j >= gap && rec.compare_held(j - gap, i, key) == Ordering::Greater {
                let shifted = rec.get(j - gap);
                rec.write(j, shifted);
                j -= gap;
            }
            rec.write(j, key);
        }
        gap /= 2;
    }
}

/// Top-down merge sort over `[lo, hi)`, merging through an aux buffer and
/// writing every merged element back into the main array.
fn merge_sort(rec: &mut Recorder, lo: usize, hi: usize) {
    if hi - lo < 2 {
        return;
    }
    let mid = lo + (hi - lo) / 2;
    merge_sort(rec, lo, mid);
    merge_sort(rec, mid, hi);

    let aux: Vec<u16> = rec.values[lo..hi].to_vec();
    let (mut li, mut ri) = (lo, mid);
    for k in lo..hi {
        let take_left = if li < mid && ri < hi {
            let (a, b) = (aux[li - lo], aux[ri - lo]);
            // `<=` keeps the merge stable; the recorded indices are the two
            // run heads' positions in the main array.
            rec.compare_pair(li, ri, a, b) != Ordering::Greater
        } else {
            li < mid
        };
        if take_left {
            let v = aux[li - lo];
            rec.write(k, v);
            li += 1;
        } else {
            let v = aux[ri - lo];
            rec.write(k, v);
            ri += 1;
        }
    }
}

/// Quicksort over the inclusive range `[lo, hi]` with a Hoare partition
/// around the *value* at the midpoint.
fn quick_sort(rec: &mut Recorder, lo: usize, hi: usize) {
    if lo >= hi {
        return;
    }
    let split = hoare_partition(rec, lo, hi);
    quick_sort(rec, lo, split);
    quick_sort(rec, split + 1, hi);
}

/// Returns `j` such that everything in `[lo..=j]` is `<=` everything in
/// `[j+1..=hi]`. The pivot is the value at `(lo+hi)/2`; that index is also
/// what the scanning comparisons are recorded against (highlighting only —
/// the pivot value itself may move during the scan).
fn hoare_partition(rec: &mut Recorder, lo: usize, hi: usize) -> usize {
    let pivot_index = (lo + hi) / 2;
    let pivot = rec.get(pivot_index);
    let mut i = lo as isize - 1;
    let mut j = hi as isize + 1;
    loop {
        loop {
            i += 1;
            if rec.compare_held(i as usize, pivot_index, pivot) != Ordering::Less {
                break;
            }
        }
        loop {
            j -= 1;
            if rec.compare_held(j as usize, pivot_index, pivot) != Ordering::Greater {
                break;
            }
        }
        if i >= j {
            return j as usize;
        }
        rec.swap(i as usize, j as usize);
    }
}

/// Max-heap build followed by repeated extract-max into the sorted tail.
fn heap_sort(rec: &mut Recorder) {
    let n = rec.len();
    if n < 2 {
        return;
    }
    for start in (0..n / 2).rev() {
        sift_down(rec, start, n);
    }
    for end in (1..n).rev() {
        rec.swap(0, end);
        sift_down(rec, 0, end);
    }
}

/// Push `root` down the heap `[0, end)` until both children are smaller.
fn sift_down(rec: &mut Recorder, mut root: usize, end: usize) {
    loop {
        let child = 2 * root + 1;
        if child >= end {
            return;
        }
        let mut largest = root;
        if rec.compare(child, largest) == Ordering::Greater {
            largest = child;
        }
        if child + 1 < end && rec.compare(child + 1, largest) == Ordering::Greater {
            largest = child + 1;
        }
        if largest == root {
            return;
        }
        rec.swap(root, largest);
        root = largest;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::rules::sorting::datasets::{generate, Dataset};

    const SIZES: [usize; 5] = [0, 1, 2, 7, 50];
    const SEED: u64 = 20_250_914;

    fn sorted_copy(v: &[u16]) -> Vec<u16> {
        let mut s = v.to_vec();
        s.sort_unstable();
        s
    }

    fn count(ops: &[Op], f: impl Fn(&Op) -> bool) -> usize {
        ops.iter().filter(|o| f(o)).count()
    }

    fn compares(ops: &[Op]) -> usize {
        count(ops, |o| matches!(o, Op::Compare(..)))
    }

    fn swaps(ops: &[Op]) -> usize {
        count(ops, |o| matches!(o, Op::Swap(..)))
    }

    fn writes(ops: &[Op]) -> usize {
        count(ops, |o| matches!(o, Op::Write(..)))
    }

    /// The fidelity proof: replaying the trace onto a copy of the initial
    /// array must reproduce the sorted array exactly.
    #[test]
    fn replaying_the_trace_sorts_every_algorithm_dataset_and_size() {
        for alg in Algorithm::ALL {
            for ds in Dataset::ALL {
                for n in SIZES {
                    let initial = generate(ds, n, SEED);
                    let ops = trace(alg, &initial);
                    let mut replay = initial.clone();
                    for op in &ops {
                        apply(&mut replay, *op);
                    }
                    assert_eq!(
                        replay,
                        sorted_copy(&initial),
                        "{alg:?} / {ds:?} / n={n} replay diverged"
                    );
                }
            }
        }
    }

    #[test]
    fn recorder_values_end_sorted_for_every_algorithm_dataset_and_size() {
        for alg in Algorithm::ALL {
            for ds in Dataset::ALL {
                for n in SIZES {
                    let initial = generate(ds, n, SEED);
                    let mut rec = Recorder::new(&initial);
                    run(alg, &mut rec);
                    assert_eq!(
                        rec.values,
                        sorted_copy(&initial),
                        "{alg:?} / {ds:?} / n={n}"
                    );
                }
            }
        }
    }

    #[test]
    fn no_op_references_an_index_outside_the_array() {
        for alg in Algorithm::ALL {
            for ds in Dataset::ALL {
                for n in SIZES {
                    let initial = generate(ds, n, SEED);
                    for op in trace(alg, &initial) {
                        let idxs: Vec<u16> = match op {
                            Op::Compare(i, j) | Op::Swap(i, j) => vec![i, j],
                            Op::Write(i, _) => vec![i],
                        };
                        for i in idxs {
                            assert!(
                                (i as usize) < n,
                                "{alg:?} / {ds:?} / n={n}: {op:?} indexes {i}"
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn traces_are_empty_for_trivial_inputs() {
        for alg in Algorithm::ALL {
            for n in [0usize, 1] {
                let initial: Vec<u16> = (1..=n as u16).collect();
                assert!(trace(alg, &initial).is_empty(), "{alg:?} n={n}");
            }
        }
    }

    #[test]
    fn bubble_on_sorted_input_is_a_single_clean_pass() {
        for n in SIZES {
            let initial: Vec<u16> = (1..=n as u16).collect();
            let ops = trace(Algorithm::Bubble, &initial);
            if n <= 1 {
                assert!(ops.is_empty(), "n={n}");
            } else {
                assert_eq!(compares(&ops), n - 1, "n={n} compares");
                assert_eq!(swaps(&ops), 0, "n={n} swaps");
                assert_eq!(writes(&ops), 0, "n={n} writes");
            }
        }
    }

    #[test]
    fn selection_makes_at_most_n_minus_one_swaps() {
        for ds in Dataset::ALL {
            for n in SIZES {
                let initial = generate(ds, n, SEED);
                let ops = trace(Algorithm::Selection, &initial);
                assert!(
                    swaps(&ops) <= n.saturating_sub(1),
                    "{ds:?} n={n}: {} swaps",
                    swaps(&ops)
                );
            }
        }
    }

    #[test]
    fn insertion_and_shell_move_data_with_writes_not_swaps() {
        let initial = generate(Dataset::Random, 50, SEED);
        for alg in [Algorithm::Insertion, Algorithm::Shell] {
            let ops = trace(alg, &initial);
            assert_eq!(swaps(&ops), 0, "{alg:?} should not swap");
            assert!(writes(&ops) > 0, "{alg:?} should write");
        }
    }

    #[test]
    fn nlogn_algorithms_beat_bubble_on_random_input() {
        let initial = generate(Dataset::Random, 50, SEED);
        let bubble = trace(Algorithm::Bubble, &initial);
        for alg in [Algorithm::Merge, Algorithm::Quick, Algorithm::Heap] {
            let ops = trace(alg, &initial);
            assert!(
                compares(&ops) * 2 < compares(&bubble),
                "{alg:?}: {} compares vs bubble's {}",
                compares(&ops),
                compares(&bubble)
            );
            assert!(
                ops.len() < bubble.len(),
                "{alg:?}: {} ops vs bubble's {}",
                ops.len(),
                bubble.len()
            );
        }
    }

    /// Odd sizes and duplicate-heavy input are where partitioning schemes go
    /// wrong, so sweep them too rather than only the headline sizes.
    #[test]
    fn replaying_the_trace_sorts_every_size_up_to_forty() {
        for alg in Algorithm::ALL {
            for ds in Dataset::ALL {
                for seed in [1u64, 2, 3] {
                    for n in 0..=40usize {
                        let initial = generate(ds, n, seed);
                        let mut replay = initial.clone();
                        for op in trace(alg, &initial) {
                            apply(&mut replay, op);
                        }
                        assert_eq!(
                            replay,
                            sorted_copy(&initial),
                            "{alg:?} / {ds:?} / n={n} / seed={seed}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn apply_treats_compare_as_a_no_op() {
        let mut v = vec![3u16, 1, 2];
        apply(&mut v, Op::Compare(0, 2));
        assert_eq!(v, vec![3, 1, 2]);
        apply(&mut v, Op::Swap(0, 1));
        assert_eq!(v, vec![1, 3, 2]);
        apply(&mut v, Op::Write(2, 9));
        assert_eq!(v, vec![1, 3, 9]);
    }

    #[test]
    fn recorder_logs_every_mutation() {
        let mut rec = Recorder::new(&[5, 2, 9]);
        assert_eq!(rec.len(), 3);
        assert!(!rec.is_empty());
        assert_eq!(rec.compare(0, 1), Ordering::Greater);
        rec.swap(0, 1);
        rec.write(2, 4);
        assert_eq!(rec.values, vec![2, 5, 4]);
        assert_eq!(
            rec.ops,
            vec![Op::Compare(0, 1), Op::Swap(0, 1), Op::Write(2, 4)]
        );
    }

    #[test]
    fn labels_and_complexities_cover_every_algorithm() {
        assert_eq!(Algorithm::ALL.len(), 7);
        assert_eq!(Algorithm::Bubble.label(), "Bubble sort");
        assert_eq!(Algorithm::Bubble.complexity(), "O(n²)");
        assert_eq!(Algorithm::Shell.complexity(), "O(n^1.3)");
        assert_eq!(Algorithm::Merge.complexity(), "O(n log n)");
        for alg in Algorithm::ALL {
            assert!(!alg.label().is_empty(), "{alg:?}");
            assert!(!alg.complexity().is_empty(), "{alg:?}");
        }
    }

    #[test]
    fn serde_round_trips_snake_case() {
        assert_eq!(
            serde_json::to_string(&Algorithm::Quick).unwrap(),
            "\"quick\""
        );
        let alg: Algorithm = serde_json::from_str("\"quick\"").unwrap();
        assert_eq!(alg, Algorithm::Quick);
        for alg in Algorithm::ALL {
            let s = serde_json::to_string(&alg).unwrap();
            assert_eq!(serde_json::from_str::<Algorithm>(&s).unwrap(), alg);
        }
        for op in [Op::Compare(1, 2), Op::Swap(3, 4), Op::Write(5, 600)] {
            let s = serde_json::to_string(&op).unwrap();
            assert_eq!(serde_json::from_str::<Op>(&s).unwrap(), op);
        }
    }
}
