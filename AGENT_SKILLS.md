# AI Agent Skills Definition

This document defines reusable AI-agent skills for this project and maps each skill to the current system components.

## Purpose

Use this as the single reference for:

- What capabilities each agent should have.
- How mature each capability is.
- Which service owns implementation.
- What should be improved next.

## Skill Levels

| Level | Meaning |
| --- | --- |
| `L0` | Not implemented |
| `L1` | Basic/manual implementation |
| `L2` | Production-usable implementation |
| `L3` | Advanced/automated implementation with monitoring |

## Agent Roles in This Project

| Role | Primary Service |
| --- | --- |
| `Conversation Router Agent` | `projj/backend/server.js` |
| `RAG Knowledge Agent` | `projj/rag_service.py`, `projj/rag_main.py`, `projj/rag_retrieval.py` |
| `Action Orchestrator Agent` | `Gec_Server_C/backend/app.py`, `Gec_Server_C/backend/agent.py` |
| `MCP Tool Proxy Agent` | `Gec_Server_C/mcp_server.py` |
| `Blockchain Transaction Agent` | `Gec_Server_C/backend/chain_api.py`, `Gec_Server_C/backend/aptos_client.py` |

## Universal Skill Catalog

### 1) Core Cognitive Skills

| Skill ID | Skill Name | Description | Owner | Current Level |
| --- | --- | --- | --- | --- |
| `core.instruction_following` | Instruction Following | Follows explicit user intent and backend constraints. | Router + Action | `L2` |
| `core.context_management` | Context Management | Preserves useful chat/session context and avoids irrelevant data. | Frontend + Router | `L2` |
| `core.planning` | Planning and Decomposition | Breaks user intent into actionable backend operations. | Action Agent | `L2` |
| `core.self_check` | Output Self-Validation | Checks outputs for validity and missing fields before execution. | Action Agent | `L2` |
| `core.error_recovery` | Error Recovery | Handles failures and returns actionable feedback. | Router + Action + RAG | `L2` |

### 2) Language Understanding Skills

| Skill ID | Skill Name | Description | Owner | Current Level |
| --- | --- | --- | --- | --- |
| `nlp.intent_detection` | Intent Detection | Distinguishes procedural questions vs concrete action commands. | Router | `L2` |
| `nlp.entity_extraction` | Entity Extraction | Extracts addresses, cert IDs, quantities, sources, location from text. | Action Agent | `L2` |
| `nlp.multilingual_tolerance` | Multilingual Tolerance | Handles mixed language or non-standard user wording. | RAG + Action | `L1` |
| `nlp.response_style` | Response Style Control | Produces concise and user-friendly responses. | RAG + Router | `L2` |

### 3) Knowledge and Retrieval Skills

| Skill ID | Skill Name | Description | Owner | Current Level |
| --- | --- | --- | --- | --- |
| `rag.repo_indexing` | Repository Indexing | Ingests local project files into vector index. | RAG | `L2` |
| `rag.semantic_retrieval` | Semantic Retrieval | Retrieves relevant chunks with thresholding and diversity controls. | RAG | `L2` |
| `rag.citation_awareness` | Source Awareness | Uses source metadata from retrieved chunks in answers. | RAG | `L2` |
| `rag.knowledge_fallback` | Fallback Knowledge | Graceful fallback when evidence is insufficient. | RAG | `L2` |
| `rag.freshness_management` | Index Freshness Management | Keeps index synchronized with code changes. | RAG | `L1` |

### 4) Action Execution Skills

| Skill ID | Skill Name | Description | Owner | Current Level |
| --- | --- | --- | --- | --- |
| `act.tool_selection` | Tool Selection | Maps user intent to operation IDs like `cert_create` or `market_list`. | Action Agent | `L2` |
| `act.arg_building` | Argument Construction | Builds validated payloads for MCP and REST calls. | Action Agent | `L2` |
| `act.workflow_orchestration` | Multi-Step Orchestration | Supports chained operations requiring ordered execution. | Router + Action | `L1` |
| `act.idempotency` | Idempotent Action Safety | Avoids duplicate side effects on repeated user prompts. | Action + Chain API | `L0` |
| `act.status_normalization` | Result Normalization | Converts variable backend responses to one stable shape. | Action Backend | `L2` |

### 5) Tool and Integration Skills

| Skill ID | Skill Name | Description | Owner | Current Level |
| --- | --- | --- | --- | --- |
| `tool.openapi_mapping` | OpenAPI Tool Mapping | Builds operation map from OpenAPI spec dynamically. | MCP Proxy | `L2` |
| `tool.http_invocation` | Reliable HTTP Invocation | Performs request forwarding with timeout/error handling. | MCP + Router + Action | `L2` |
| `tool.response_adaptation` | Response Adaptation | Adapts nested response formats for downstream consumers. | Action Backend | `L2` |
| `tool.contract_validation` | API Contract Validation | Strong schema enforcement across all inter-service calls. | Router + MCP + Action | `L1` |

### 6) Blockchain-Specific Skills

| Skill ID | Skill Name | Description | Owner | Current Level |
| --- | --- | --- | --- | --- |
| `chain.tx_signing` | Transaction Signing | Signs Aptos transactions with sender private key. | Aptos Client | `L2` |
| `chain.tx_submission` | Transaction Submission | Submits and waits for on-chain confirmation. | Aptos Client | `L2` |
| `chain.view_calls` | Read-Only View Calls | Fetches on-chain state and stats via view functions. | Chain API | `L2` |
| `chain.explorer_linking` | Explorer Traceability | Returns explorer URLs for transaction verification. | Aptos Client | `L2` |
| `chain.key_safety` | Key Management Safety | Strong secret lifecycle and non-leakage controls. | All backend services | `L1` |

### 7) Security and Governance Skills

| Skill ID | Skill Name | Description | Owner | Current Level |
| --- | --- | --- | --- | --- |
| `sec.authn` | Authentication | JWT-based login/session verification. | Node Backend Auth | `L2` |
| `sec.device_trust` | Trusted Device Verification | OTP bypass for approved devices using hashed tokens. | Node Backend Auth | `L2` |
| `sec.otp_verification` | OTP Verification | Registration/login OTP issue, validate, and expiry control. | Node Backend Auth | `L2` |
| `sec.access_control` | Fine-Grained Authorization | Role/permission checks for action endpoints. | Router + Action | `L1` |
| `gov.auditability` | Auditability | Captures important events (RAG audit log, tx hash traces). | RAG + Action | `L2` |

### 8) Collaboration and Operations Skills

| Skill ID | Skill Name | Description | Owner | Current Level |
| --- | --- | --- | --- | --- |
| `ops.health_checks` | Service Health Checks | Exposes basic health endpoints and diagnostics. | All services | `L2` |
| `ops.config_standardization` | Config Standardization | Consistent env handling across services. | Repo-level | `L1` |
| `ops.observability` | Observability | Structured logs, metrics, and alert hooks. | Repo-level | `L0` |
| `ops.deployment_packaging` | Deployment Packaging | Unified compose/supervisor process setup. | Repo-level | `L0` |
| `ops.test_coverage` | Automated Testing | Unit/integration tests for critical skills. | Repo-level | `L0` |

## Ownership by Service

### `projj/backend` (Conversation Router + Auth)

- Owns `nlp.intent_detection` and chat traffic splitting (`RAG` vs `Action`).
- Owns `sec.authn`, `sec.otp_verification`, `sec.device_trust`.
- Owns marketplace proxy safety for action endpoints.

### `projj` Python RAG (`rag_service.py`, `rag_main.py`, `rag_retrieval.py`, `rag_index.py`)

- Owns `rag.repo_indexing`, `rag.semantic_retrieval`, `rag.citation_awareness`, `rag.knowledge_fallback`.
- Owns answer-generation quality for explanatory/procedural prompts.
- Owns RAG audit event generation (`rag_audit_log.jsonl`).

### `Gec_Server_C/backend` (Action Orchestrator + Chain API)

- Owns `act.tool_selection`, `act.arg_building`, `act.status_normalization`.
- Owns extraction/parsing of blockchain command entities.
- Owns transaction endpoint contracts and normalization path to frontend.

### `Gec_Server_C/mcp_server.py` (MCP Tool Proxy)

- Owns `tool.openapi_mapping` and operation invocation transport.
- Owns OpenAPI operation discoverability via `/mcp/tools`.
- Owns conversion from MCP tool request to underlying REST call.

### `Gec_Server_C/backend/aptos_client.py` and `chain_api.py`

- Owns all chain execution skills: `chain.tx_signing`, `chain.tx_submission`, `chain.view_calls`, `chain.explorer_linking`.

## Priority Gaps to Close

| Priority | Skill Gap | Why It Matters | Suggested Action |
| --- | --- | --- | --- |
| `P0` | `ops.observability` (`L0`) | Hard to debug production failures across multiple services. | Add structured logs + request IDs + minimal metrics per service. |
| `P0` | `ops.test_coverage` (`L0`) | High regression risk in routing and action parsing. | Add tests for intent routing, entity extraction, and response normalization. |
| `P1` | `act.idempotency` (`L0`) | Duplicate prompts can cause duplicate transactions. | Add prompt hash/request ID and duplicate-action guard. |
| `P1` | `ops.config_standardization` (`L1`) | Port/env drift causes integration failures. | Add `.env.example` for each service and root run profile. |
| `P2` | `sec.access_control` (`L1`) | Missing role-based gates can expose sensitive actions. | Add issuer/admin role checks before privileged chain calls. |
| `P2` | `rag.freshness_management` (`L1`) | RAG answers become stale after code updates. | Trigger index rebuild automatically or via CI/manual script. |

## Definition of Done for Skill Completion

A skill is considered complete when all are true:

1. Feature behavior is implemented in the owning service.
2. Input and output contracts are documented.
3. Error cases are handled with explicit user-safe messages.
4. At least one automated test validates the happy path.
5. At least one automated test validates an expected failure path.

## Suggested Next Skills Milestone

Milestone `v1-skill-hardening`:

1. Add integration tests for router-to-RAG and router-to-action paths.
2. Add idempotency protection for action commands.
3. Add `.env.example` files for `projj/`, `projj/backend/`, `Gec_Server_C/backend/`, and `Gec_Server_C/`.
4. Add standardized error envelope across Node, RAG, Action, and MCP services.

