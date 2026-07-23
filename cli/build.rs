// Inject the release version into the binaries at compile time.
// Single source of truth is the repo-root VERSION file (workflow.md / CI pin it
// to the release tag). Read here so `env!("JJ_VERSION")` is always the real
// version — no "dev" fallback path like the old Bun build had.
use std::fs;

fn main() {
    let version = fs::read_to_string("../VERSION")
        .expect("read ../VERSION")
        .trim()
        .to_string();
    assert!(!version.is_empty(), "../VERSION is empty");
    println!("cargo:rustc-env=JJ_VERSION={version}");
    println!("cargo:rerun-if-changed=../VERSION");
}
