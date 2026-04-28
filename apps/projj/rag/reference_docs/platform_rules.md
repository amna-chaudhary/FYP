# GEC Platform Rules

Project-specific rules used by the action backend and frontend:

- Certificate issuance requires `energy_amount`, `energy_source`, and `location`.
- Production timestamps should be provided as ISO 8601 values and should align to hourly boundaries.
- `prod_end` must be later than `prod_start`.
- Energy amount must be greater than zero.
- Destructive operations such as transfer, retire, cancel certificate, cancel listing, and accept buy request require user confirmation.
- Every successful blockchain-style action should create an audit-log transaction in the local registry.
- Registry search should support filtering by status, owner, date range, and energy source.
- Notification records should be written for user-visible certificate lifecycle changes.
