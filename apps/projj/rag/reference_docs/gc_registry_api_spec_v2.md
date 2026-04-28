# EnergyTag GC Registry API Specification V2 Reference Notes

Source:
- EnergyTag, "GC Registry API Specification V2"
- Official publication page: https://energytag.org/publications/gc-registry-api-specification_v2/
- PDF download observed on 2026-04-26: https://energytag.org/wp-content/uploads/2023/09/GC-Registry-API-Specification_V2.pdf

Purpose in this repo:
- Anchor registry-facing RAG answers and validation language.
- Provide guidance for structured certificate, listing, and audit data exchange.

Key implementation notes:
- Registry APIs should expose stable identifiers for certificates and related records.
- Registry responses should be structured and machine-readable so downstream agents can reason over them safely.
- Traceability data such as transaction references, actor identity, and state transitions should be preserved.
- Registry implementations should support interoperability across issuers, verifiers, and trading workflows.
- API payloads should distinguish ownership, issuance metadata, lifecycle state, and audit records.
