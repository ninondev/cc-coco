//! TLS trust from the operating system only. On Linux the roots come from fixed system bundle
//! paths, so SSL_CERT_FILE and SSL_CERT_DIR have no say; macOS and Windows ask the OS verifier.

use std::sync::Arc;

use rustls::ClientConfig;
use rustls::crypto::CryptoProvider;

use crate::hooks;
use crate::out::{Fail, Kind};

fn tls_fail(detail: &str) -> Fail {
    Fail::new(Kind::Offline, format!("tls-{detail}"))
}

fn provider() -> Arc<CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

fn with_roots(roots: rustls::RootCertStore) -> Result<Arc<ClientConfig>, Fail> {
    if roots.is_empty() {
        return Err(tls_fail("no-roots"));
    }
    let cfg = ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .map_err(|_| tls_fail("config"))?
        .with_root_certificates(roots)
        .with_no_client_auth();
    Ok(Arc::new(cfg))
}

fn roots_from_pem_file(path: &str, roots: &mut rustls::RootCertStore) {
    use rustls::pki_types::CertificateDer;
    use rustls::pki_types::pem::PemObject;
    if let Ok(iter) = CertificateDer::pem_file_iter(path) {
        roots.add_parsable_certificates(iter.flatten());
    }
}

pub fn client_config() -> Result<Arc<ClientConfig>, Fail> {
    if let Some(ca) = hooks::ca_file() {
        let mut roots = rustls::RootCertStore::empty();
        roots_from_pem_file(&ca, &mut roots);
        return with_roots(roots);
    }
    os_config()
}

/// Debian and Ubuntu, Fedora and RHEL, openSUSE, newer RHEL, Alpine; the first that loads wins.
#[cfg(all(unix, not(target_os = "macos")))]
pub const SYSTEM_BUNDLES: &[&str] = &[
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/ca-bundle.pem",
    "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
    "/etc/ssl/cert.pem",
];

#[cfg(all(unix, not(target_os = "macos")))]
fn os_config() -> Result<Arc<ClientConfig>, Fail> {
    let mut roots = rustls::RootCertStore::empty();
    for path in SYSTEM_BUNDLES {
        roots_from_pem_file(path, &mut roots);
        if !roots.is_empty() {
            break;
        }
    }
    with_roots(roots)
}

#[cfg(any(target_os = "macos", windows))]
fn os_config() -> Result<Arc<ClientConfig>, Fail> {
    let verifier = rustls_platform_verifier::Verifier::new(provider()).map_err(|_| tls_fail("verifier"))?;
    let cfg = ClientConfig::builder_with_provider(provider())
        .with_safe_default_protocol_versions()
        .map_err(|_| tls_fail("config"))?
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(verifier))
        .with_no_client_auth();
    Ok(Arc::new(cfg))
}
