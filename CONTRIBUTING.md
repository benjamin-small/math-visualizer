# Contributing

Open an issue before substantial changes so scope and expected behavior are clear. Keep pull requests focused and include tests or documentation for changed behavior.

## Local setup

Follow the setup instructions in `README.md`.

## Validation

Run the checks that apply before opening a pull request:

```sh
cargo fmt --all --check
cargo clippy --all-targets --all-features
cargo test --all-features
```

CI runs the same three commands, so a green local run means a green CI run.

## Pre-commit hook (optional)

There's a `cargo fmt --check` pre-commit hook in `.githooks/pre-commit`. Enable it once per clone with:

```sh
git config core.hooksPath .githooks
```

Then a commit that would fail CI's format gate is rejected locally. Bypass with `git commit --no-verify` if needed.
