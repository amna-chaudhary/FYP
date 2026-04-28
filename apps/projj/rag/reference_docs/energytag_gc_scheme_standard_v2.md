# EnergyTag GC Scheme Standard V2 Reference Notes

Source:
- EnergyTag, "Granular Certificate Scheme Standard V2"
- Official publication page: https://energytag.org/publications/granular-certificate-scheme-standard-v2/
- PDF download observed on 2026-04-26: https://energytag.org/wp-content/uploads/2024/12/EnergyTag_Granular-Certificate-Scheme-Standard-V2.pdf

Purpose in this repo:
- Provide a local reference source for the GEC agent's RAG layer.
- Capture the rules the platform validates before issuing or trading certificates.

Key implementation notes:
- Granular certificates are intended to represent renewable production with time-based granularity.
- Hourly matching is a core concept across the EnergyTag ecosystem and platform flows in this project.
- Certificate records should preserve clear provenance, issuer responsibility, and anti-double-counting safeguards.
- Timestamp handling should use a machine-readable ISO 8601 format and be suitable for hourly matching workflows.
- Certificate systems need auditability, error handling, and registry traceability over the certificate lifecycle.
- Granular certificate attributes include certificate identity, ownership, production metadata, and lifecycle status.
- Production-device metadata and location context matter for registry integrity and downstream claim verification.
