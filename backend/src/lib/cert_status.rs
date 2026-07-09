//! TLS certificate introspection for the `/health` endpoint.
//!
//! Surfaces two operator-facing facts about the TLS cert nginx serves so the
//! DJ can catch a stale / self-signed cert at the at-home pre-party test rather
//! than at the door (see `docs/https-setup.md` §6):
//!
//! - `cert_days_remaining`: whole days until the cert's `notAfter` (negative if
//!   already expired), or `None` if the cert can't be read/parsed.
//! - `cert_is_real_le`: `true` for a real Let's Encrypt cert, `false` for the
//!   NixOS self-signed bootstrap cert (issuer == subject), or `None` if
//!   unreadable.
//!
//! The cert file (default `/var/lib/acme/hushfm.dedyn.io/cert.pem`) is
//! group-`nginx` mode 0640, so the backend process user may not be able to read
//! it. In that case BOTH fields are `None` and `/health` stays green — we never
//! fail the probe on a cert-read problem.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use x509_parser::prelude::*;

/// Default location of the served cert on the Pi (NixOS `security.acme`).
const DEFAULT_CERT_PATH: &str = "/var/lib/acme/hushfm.dedyn.io/cert.pem";

/// The two cert facts surfaced on `/health`. Both `None` == cert unreadable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CertStatus {
    /// Whole days until `notAfter`. Negative when already expired. `None` when
    /// the cert can't be read or parsed.
    pub days_remaining: Option<i64>,
    /// `true` for a real Let's Encrypt cert, `false` for self-signed/other,
    /// `None` when the cert can't be read or parsed.
    pub is_real_le: Option<bool>,
}

impl CertStatus {
    /// The all-`None` result used whenever the cert is unreadable/unparseable.
    const UNKNOWN: CertStatus = CertStatus {
        days_remaining: None,
        is_real_le: None,
    };
}

/// Resolve the configured cert path once, from `HUSHFM_TLS_CERT_PATH`, falling
/// back to the NixOS default. Read via `OnceLock` to avoid config.rs churn.
fn cert_path() -> &'static Path {
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    PATH.get_or_init(|| {
        std::env::var("HUSHFM_TLS_CERT_PATH")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from(DEFAULT_CERT_PATH))
    })
    .as_path()
}

/// Read + parse the served cert and derive the two `/health` facts.
///
/// Infallible by contract: any IO or parse failure yields `CertStatus::UNKNOWN`
/// (both fields `None`) and a server-side warning log. Never panics, never
/// blocks meaningfully (small local file).
///
/// Group-read gotcha: if `cert.pem` is unreadable we try `fullchain.pem` in the
/// same directory as a fallback (the leaf is the first cert in the chain file).
pub fn read_cert_status() -> CertStatus {
    let primary = cert_path();

    match read_cert_status_from(primary) {
        Ok(status) => status,
        Err(primary_err) => {
            // Fall back to fullchain.pem in the same directory — same leaf cert,
            // sometimes different perms. The leaf is the first PEM in the chain.
            if let Some(fallback) = fullchain_fallback(primary) {
                match read_cert_status_from(&fallback) {
                    Ok(status) => {
                        tracing::warn!(
                            primary = %primary.display(),
                            fallback = %fallback.display(),
                            error = %primary_err,
                            "TLS cert: primary unreadable, used fullchain.pem fallback"
                        );
                        return status;
                    }
                    Err(fallback_err) => {
                        tracing::warn!(
                            primary = %primary.display(),
                            fallback = %fallback.display(),
                            primary_error = %primary_err,
                            fallback_error = %fallback_err,
                            "TLS cert unreadable (primary + fullchain fallback); /health cert fields null"
                        );
                        return CertStatus::UNKNOWN;
                    }
                }
            }

            tracing::warn!(
                path = %primary.display(),
                error = %primary_err,
                "TLS cert unreadable; /health cert fields null"
            );
            CertStatus::UNKNOWN
        }
    }
}

/// `<dir>/fullchain.pem` alongside the primary cert path, if it differs.
fn fullchain_fallback(primary: &Path) -> Option<PathBuf> {
    let dir = primary.parent()?;
    let fallback = dir.join("fullchain.pem");
    if fallback == primary {
        None
    } else {
        Some(fallback)
    }
}

/// Read a PEM cert file and derive the status. Returns `Err` (a human message)
/// on any IO or parse failure so the caller can decide fallback vs. warn.
fn read_cert_status_from(path: &Path) -> Result<CertStatus, String> {
    let pem_bytes = std::fs::read(path).map_err(|e| format!("read {}: {e}", path.display()))?;
    parse_leaf_cert_status(&pem_bytes)
}

/// Parse the FIRST certificate out of PEM bytes (the leaf, for a fullchain) and
/// derive the two `/health` facts against the current wall clock.
fn parse_leaf_cert_status(pem_bytes: &[u8]) -> Result<CertStatus, String> {
    let now = x509_parser::time::ASN1Time::now();
    parse_leaf_cert_status_at(pem_bytes, now)
}

/// Testable core: parse the leaf cert and derive status at a caller-supplied
/// "now" so tests can pin the clock relative to a fixture's validity window.
fn parse_leaf_cert_status_at(
    pem_bytes: &[u8],
    now: x509_parser::time::ASN1Time,
) -> Result<CertStatus, String> {
    // Take the first PEM block (the leaf cert; fullchain.pem = leaf + chain).
    let (_, pem) = x509_parser::pem::parse_x509_pem(pem_bytes)
        .map_err(|e| format!("PEM parse: {e}"))?;
    let cert = pem
        .parse_x509()
        .map_err(|e| format!("X.509 parse: {e}"))?;

    Ok(CertStatus {
        days_remaining: days_until(&cert, now),
        is_real_le: Some(is_lets_encrypt(&cert)),
    })
}

/// Whole days from `now` until the cert's `notAfter`. Negative once expired.
/// Rounds toward zero (a cert expiring in 47h reads as 1 day; expired 47h ago
/// reads as -1).
///
/// Gotcha: x509-parser's `ASN1Time - ASN1Time` returns `Some(duration)` ONLY
/// when the left side is strictly later, and `None` otherwise — it never yields
/// a negative duration. So we branch on ordering to build the signed day count
/// ourselves: future → positive, past → negated, equal → 0.
fn days_until(cert: &X509Certificate, now: x509_parser::time::ASN1Time) -> Option<i64> {
    let not_after = cert.validity().not_after;

    // Still valid: not_after is strictly after now → positive days remaining.
    if let Some(remaining) = not_after - now {
        return Some(remaining.whole_days());
    }
    // Already expired (or exactly now): now >= not_after → negative days (or 0).
    if let Some(overdue) = now - not_after {
        return Some(-overdue.whole_days());
    }
    // now == not_after exactly: neither subtraction is `Some` → zero days.
    Some(0)
}

/// Classify issuer: `true` iff this looks like a real Let's Encrypt cert.
///
/// Our two real cases:
/// - Real LE cert: issuer Organization == "Let's Encrypt" (and issuer != subject).
/// - NixOS self-signed bootstrap: issuer == subject → not LE.
///
/// Robust ordering: a self-signed cert (issuer == subject) is always `false`.
/// Otherwise we only say `true` when the issuer actually names Let's Encrypt,
/// keeping the check correct + conservative for our deployment.
fn is_lets_encrypt(cert: &X509Certificate) -> bool {
    // Self-signed bootstrap cert: issuer DN == subject DN → untrusted, not LE.
    if cert.issuer() == cert.subject() {
        return false;
    }

    // Otherwise require the issuer to actually name Let's Encrypt. Check the
    // Organization (O) attribute first, then fall back to the whole issuer DN
    // string (CNs like "R10"/"E5" chain up to "Let's Encrypt" as the O).
    let issuer_names_le = cert
        .issuer()
        .iter_organization()
        .filter_map(|attr| attr.as_str().ok())
        .any(|o| o.eq_ignore_ascii_case("Let's Encrypt"));

    if issuer_names_le {
        return true;
    }

    // Fallback: some intermediates only carry the org in the full DN rendering.
    cert.issuer().to_string().contains("Let's Encrypt")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;
    use x509_parser::time::ASN1Time;

    /// Generate a throwaway self-signed cert (issuer == subject) valid for
    /// `days` days, returning its PEM. Uses the local `openssl` binary.
    fn gen_self_signed(cn: &str, days: u32) -> Vec<u8> {
        gen_cert(cn, cn, days)
    }

    /// Generate a cert with a distinct issuer CN/O to emulate a CA-issued cert.
    /// openssl `req -x509` always self-signs, so to get issuer != subject we
    /// sign a CSR with a separately-generated CA.
    fn gen_ca_issued(subject_cn: &str, issuer_org: &str, days: u32) -> Vec<u8> {
        let dir = tempdir();
        let ca_key = dir.join("ca.key");
        let ca_crt = dir.join("ca.crt");
        let leaf_key = dir.join("leaf.key");
        let leaf_csr = dir.join("leaf.csr");
        let leaf_crt = dir.join("leaf.crt");

        // CA (self-signed root) whose Organization is the issuer_org.
        run_openssl(&[
            "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", ca_key.to_str().unwrap(),
            "-out", ca_crt.to_str().unwrap(),
            "-days", "3650",
            "-subj", &format!("/O={issuer_org}/CN={issuer_org} Root"),
        ]);
        // Leaf key + CSR.
        run_openssl(&[
            "req", "-newkey", "rsa:2048", "-nodes",
            "-keyout", leaf_key.to_str().unwrap(),
            "-out", leaf_csr.to_str().unwrap(),
            "-subj", &format!("/CN={subject_cn}"),
        ]);
        // Sign the leaf with the CA.
        run_openssl(&[
            "x509", "-req",
            "-in", leaf_csr.to_str().unwrap(),
            "-CA", ca_crt.to_str().unwrap(),
            "-CAkey", ca_key.to_str().unwrap(),
            "-CAcreateserial",
            "-days", &days.to_string(),
            "-out", leaf_crt.to_str().unwrap(),
        ]);

        std::fs::read(&leaf_crt).expect("read leaf cert")
    }

    /// Self-signed cert with subject == issuer == CN.
    fn gen_cert(subject_cn: &str, issuer_cn: &str, days: u32) -> Vec<u8> {
        assert_eq!(subject_cn, issuer_cn, "gen_cert only makes self-signed certs");
        let dir = tempdir();
        let key = dir.join("k.pem");
        let crt = dir.join("c.pem");
        run_openssl(&[
            "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", key.to_str().unwrap(),
            "-out", crt.to_str().unwrap(),
            "-days", &days.to_string(),
            "-subj", &format!("/CN={subject_cn}"),
        ]);
        std::fs::read(&crt).expect("read self-signed cert")
    }

    fn tempdir() -> PathBuf {
        let base = std::env::temp_dir().join(format!(
            "hushfm-cert-test-{}-{}",
            std::process::id(),
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&base).expect("create tempdir");
        base
    }

    fn run_openssl(args: &[&str]) {
        let out = Command::new("openssl")
            .args(args)
            .output()
            .expect("spawn openssl");
        assert!(
            out.status.success(),
            "openssl {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }

    #[test]
    fn self_signed_cert_is_not_le() {
        let pem = gen_self_signed("hushfm.dedyn.io", 3650);
        let status = parse_leaf_cert_status(&pem).expect("parse");
        assert_eq!(status.is_real_le, Some(false), "self-signed must be false");
    }

    #[test]
    fn lets_encrypt_issuer_is_real_le() {
        let pem = gen_ca_issued("hushfm.dedyn.io", "Let's Encrypt", 90);
        let status = parse_leaf_cert_status(&pem).expect("parse");
        assert_eq!(status.is_real_le, Some(true), "LE-issued must be true");
    }

    #[test]
    fn other_ca_issuer_is_not_le() {
        // A CA-issued cert whose issuer is NOT Let's Encrypt stays false for
        // our conservative check (we only trust the real LE path).
        let pem = gen_ca_issued("hushfm.dedyn.io", "Some Other CA", 90);
        let status = parse_leaf_cert_status(&pem).expect("parse");
        assert_eq!(status.is_real_le, Some(false));
    }

    #[test]
    fn days_remaining_is_positive_for_future_expiry() {
        let pem = gen_self_signed("hushfm.dedyn.io", 90);
        let status = parse_leaf_cert_status(&pem).expect("parse");
        let days = status.days_remaining.expect("some days");
        // ~90 days out; allow slack for the cert's notBefore/second rounding.
        assert!(days >= 88 && days <= 90, "expected ~90 days, got {days}");
    }

    #[test]
    fn days_remaining_is_negative_for_expired_cert() {
        // Cert valid for 90 days; evaluate "now" as 100 days in the future.
        let pem = gen_self_signed("hushfm.dedyn.io", 90);
        // ASN1Time + Duration yields Option<ASN1Time> in x509-parser 0.18.
        let future_now = (ASN1Time::now() + ::time::Duration::days(100)).expect("future time");
        let status = parse_leaf_cert_status_at(&pem, future_now).expect("parse");
        let days = status.days_remaining.expect("some days");
        assert!(days < 0, "expired cert must be negative, got {days}");
    }

    #[test]
    fn garbage_bytes_fail_to_parse() {
        let err = parse_leaf_cert_status(b"not a certificate at all");
        assert!(err.is_err(), "garbage must not parse");
    }

    #[test]
    fn unreadable_path_yields_all_none() {
        let missing = Path::new("/nonexistent/hushfm/definitely-not-here/cert.pem");
        let err = read_cert_status_from(missing);
        assert!(err.is_err(), "missing file must error at the read layer");
    }

    #[test]
    fn fullchain_fallback_points_at_sibling() {
        let primary = Path::new("/var/lib/acme/hushfm.dedyn.io/cert.pem");
        let fallback = fullchain_fallback(primary).expect("fallback");
        assert_eq!(
            fallback,
            PathBuf::from("/var/lib/acme/hushfm.dedyn.io/fullchain.pem")
        );
    }

    #[test]
    fn fullchain_fallback_is_none_when_primary_is_fullchain() {
        let primary = Path::new("/var/lib/acme/hushfm.dedyn.io/fullchain.pem");
        assert_eq!(fullchain_fallback(primary), None);
    }
}
