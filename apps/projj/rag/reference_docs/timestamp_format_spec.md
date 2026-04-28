# Timestamp Format Specification for GEC Issuance

This local reference captures the format rules enforced by the RAG validation layer.

Required format:
- ISO 8601 string, for example `2025-04-20T14:00:00Z`

Granularity:
- Hourly granularity only
- Minutes must be `00`
- Seconds must be `00`

Validation rules:
- `prod_start` is required for complete issuance validation
- `prod_end` is required for complete issuance validation
- `prod_end` must be later than `prod_start`
- If timestamps are omitted, the system may warn and allow only partial validation depending on the execution path

Examples:
- Valid: `2025-04-20T14:00:00Z`
- Invalid: `2025-04-20T14:30:00Z`
- Invalid: `2025-04-20 14:45`
