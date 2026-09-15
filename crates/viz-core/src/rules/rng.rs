//! Tiny deterministic RNG helpers shared by the rules.

/// SplitMix64 — deterministic mixer. Stateless: callers get a reproducible
/// stream by mixing a seed with an index before each call.
pub fn splitmix64(mut z: u64) -> u64 {
    z = z.wrapping_add(0x9E3779B97F4A7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
    z ^ (z >> 31)
}

#[cfg(test)]
mod tests {
    use super::splitmix64;

    #[test]
    fn deterministic_and_spreads() {
        assert_eq!(splitmix64(0), splitmix64(0));
        assert_ne!(splitmix64(0), splitmix64(1));
        assert_ne!(splitmix64(7), splitmix64(8));
    }

    /// Known-answer test: pins the exact output of the current implementation
    /// so a future change to the mixing constants is caught, not just a
    /// change in behavior.
    #[test]
    fn known_answer_vectors() {
        assert_eq!(splitmix64(0), 0xe220a8397b1dcdaf);
        assert_eq!(splitmix64(1), 0x910a2dec89025cc1);
    }
}
