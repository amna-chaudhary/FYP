# GEC Move Package

This package follows the blockchain layout referenced in `GEC_AGENT.md`:

- `blockchain/Move.toml`
- `blockchain/contracts/GECertificate.move`
- `blockchain/contracts/Marketplace.move`

## What is implemented

- Certificate registry initialization
- Issuer allowlist management
- Certificate creation with duplicate prevention
- Ownership checks for transfer / retire / cancel
- Marketplace listing / cancel / buy-request / accept-buy flows
- Simple view functions used by the Python backend

## Expected backend function names

The Python API layer in `apps/Gec_Server_C/backend/chain_api.py` currently expects:

- `gec_certificate::init`
- `gec_certificate::add_issuer`
- `gec_certificate::remove_issuer`
- `gec_certificate::create_certificate_simple`
- `gec_certificate::transfer_certificate`
- `gec_certificate::claim_certificate`
- `gec_certificate::cancel_certificate`
- `gec_certificate::get_bundle_quantity`
- `gec_certificate::get_certificate`
- `gec_marketplace::initialize_marketplace`
- `gec_marketplace::list_certificate`
- `gec_marketplace::cancel_listing`
- `gec_marketplace::request_buy`
- `gec_marketplace::accept_buy_request`
- `gec_marketplace::get_listing_count`
- `gec_marketplace::get_total_trades`
- `gec_marketplace::get_total_volume`

## Compile / test locally

The Aptos CLI is not installed in this workspace right now, so this package could not be compiled here.

Once Aptos CLI is available:

```bash
cd apps/Gec_Server_C/blockchain
aptos move test
aptos move compile
```
