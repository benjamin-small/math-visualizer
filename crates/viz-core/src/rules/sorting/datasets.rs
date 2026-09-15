//! Deterministic input arrays for the sorting lab.
//!
//! Every generator is a pure function of `(dataset, n, seed)` so a shared link
//! reproduces exactly the same run.

use serde::{Deserialize, Serialize};

use crate::rules::rng::splitmix64;

/// The shapes of input the lab can sort.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Dataset {
    Random,
    NearlySorted,
    Reversed,
    FewUnique,
}

impl Dataset {
    /// Every dataset, in menu order.
    pub const ALL: [Dataset; 4] = [
        Dataset::Random,
        Dataset::NearlySorted,
        Dataset::Reversed,
        Dataset::FewUnique,
    ];

    /// Human-readable name for the UI.
    pub fn label(self) -> &'static str {
        match self {
            Dataset::Random => "Random",
            Dataset::NearlySorted => "Nearly sorted",
            Dataset::Reversed => "Reversed",
            Dataset::FewUnique => "Few unique",
        }
    }
}

/// Distinct salts keep the streams of the different generators independent
/// even when they share a seed.
const SALT_RANDOM: u64 = 0x5EED_0001;
const SALT_NEARLY_PICK: u64 = 0x5EED_0002;
const SALT_NEARLY_STEP: u64 = 0x5EED_0003;
const SALT_FEW_PICK: u64 = 0x5EED_0004;
const SALT_FEW_SHUFFLE: u64 = 0x5EED_0005;

/// Build the initial array for `ds` with `n` elements. `n == 0` yields an
/// empty vec. Values are in `1..=n` (or the five levels, for `FewUnique`).
pub fn generate(ds: Dataset, n: usize, seed: u64) -> Vec<u16> {
    if n == 0 {
        return Vec::new();
    }
    match ds {
        Dataset::Random => {
            let mut v: Vec<u16> = (1..=n as u16).collect();
            shuffle(&mut v, seed, SALT_RANDOM);
            v
        }
        Dataset::NearlySorted => {
            let mut v: Vec<u16> = (1..=n as u16).collect();
            let disturbances = (n / 10).max(1);
            for k in 0..disturbances {
                let i = (splitmix64(seed ^ (k as u64) ^ SALT_NEARLY_PICK) % n as u64) as usize;
                // Swap with a neighbour one or two slots to the right, clamped
                // to the end of the array so the shuffle stays local.
                let step = 1 + (splitmix64(seed ^ (k as u64) ^ SALT_NEARLY_STEP) % 2) as usize;
                let j = (i + step).min(n - 1);
                v.swap(i, j);
            }
            v
        }
        Dataset::Reversed => (1..=n as u16).rev().collect(),
        Dataset::FewUnique => {
            let levels: [u16; 5] = core::array::from_fn(|k| (((k + 1) * n) / 5).max(1) as u16);
            let mut v: Vec<u16> = (0..n)
                .map(|i| {
                    let pick = (splitmix64(seed ^ (i as u64) ^ SALT_FEW_PICK) % 5) as usize;
                    levels[pick]
                })
                .collect();
            shuffle(&mut v, seed, SALT_FEW_SHUFFLE);
            v
        }
    }
}

/// In-place Fisher-Yates using `splitmix64(seed ^ i ^ salt)` per step.
fn shuffle(values: &mut [u16], seed: u64, salt: u64) {
    let n = values.len();
    if n < 2 {
        return;
    }
    for i in (1..n).rev() {
        let r = splitmix64(seed ^ (i as u64) ^ salt);
        let j = (r % (i as u64 + 1)) as usize;
        values.swap(i, j);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    fn ascending(n: usize) -> Vec<u16> {
        (1..=n as u16).collect()
    }

    #[test]
    fn all_lists_every_dataset_with_labels() {
        assert_eq!(Dataset::ALL.len(), 4);
        let labels: Vec<&str> = Dataset::ALL.iter().map(|d| d.label()).collect();
        assert_eq!(
            labels,
            vec!["Random", "Nearly sorted", "Reversed", "Few unique"]
        );
    }

    #[test]
    fn empty_for_n_zero() {
        for ds in Dataset::ALL {
            assert!(generate(ds, 0, 7).is_empty(), "{ds:?}");
        }
    }

    #[test]
    fn length_matches_n() {
        for ds in Dataset::ALL {
            for n in [1, 2, 7, 50, 300] {
                assert_eq!(generate(ds, n, 3).len(), n, "{ds:?} n={n}");
            }
        }
    }

    #[test]
    fn deterministic_per_seed_and_differs_across_seeds() {
        for ds in Dataset::ALL {
            assert_eq!(generate(ds, 50, 11), generate(ds, 50, 11), "{ds:?}");
        }
        // Reversed ignores the seed by construction; the randomized ones must not.
        for ds in [Dataset::Random, Dataset::NearlySorted, Dataset::FewUnique] {
            assert_ne!(generate(ds, 50, 11), generate(ds, 50, 12), "{ds:?}");
        }
    }

    #[test]
    fn random_and_nearly_sorted_are_permutations() {
        for ds in [Dataset::Random, Dataset::NearlySorted] {
            for n in [1, 2, 7, 50, 300] {
                for seed in [0, 1, 99] {
                    let mut got = generate(ds, n, seed);
                    got.sort_unstable();
                    assert_eq!(got, ascending(n), "{ds:?} n={n} seed={seed}");
                }
            }
        }
    }

    #[test]
    fn random_is_actually_shuffled() {
        let v = generate(Dataset::Random, 50, 5);
        assert_ne!(v, ascending(50));
    }

    #[test]
    fn reversed_is_strictly_decreasing() {
        for n in [1, 2, 7, 50] {
            let v = generate(Dataset::Reversed, n, 0);
            assert_eq!(v[0], n as u16);
            assert!(v.windows(2).all(|w| w[0] > w[1]), "n={n}");
        }
    }

    #[test]
    fn few_unique_has_at_most_five_distinct_values() {
        for n in [1, 2, 7, 50, 300] {
            for seed in [0, 4, 77] {
                let v = generate(Dataset::FewUnique, n, seed);
                let distinct: BTreeSet<u16> = v.iter().copied().collect();
                assert!(distinct.len() <= 5, "n={n} seed={seed} -> {distinct:?}");
                assert!(distinct.iter().all(|&x| x >= 1), "values must be >= 1");
            }
        }
    }

    #[test]
    fn nearly_sorted_keeps_at_least_80_percent_in_place() {
        for n in [50, 100, 300] {
            for seed in [0, 2, 42, 1234] {
                let v = generate(Dataset::NearlySorted, n, seed);
                let in_place = v
                    .iter()
                    .enumerate()
                    .filter(|(i, &x)| x == *i as u16 + 1)
                    .count();
                assert!(
                    in_place * 100 >= n * 80,
                    "n={n} seed={seed}: only {in_place} of {n} in place"
                );
            }
        }
    }

    #[test]
    fn nearly_sorted_is_disturbed_but_not_identity() {
        let v = generate(Dataset::NearlySorted, 50, 9);
        assert_ne!(v, ascending(50));
    }

    #[test]
    fn serde_round_trips_snake_case() {
        assert_eq!(
            serde_json::to_string(&Dataset::NearlySorted).unwrap(),
            "\"nearly_sorted\""
        );
        let ds: Dataset = serde_json::from_str("\"nearly_sorted\"").unwrap();
        assert_eq!(ds, Dataset::NearlySorted);
        for ds in Dataset::ALL {
            let s = serde_json::to_string(&ds).unwrap();
            assert_eq!(serde_json::from_str::<Dataset>(&s).unwrap(), ds);
        }
    }
}
