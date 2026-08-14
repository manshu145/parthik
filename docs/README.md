# Parthik Documentation

Architecture and design documentation for the Parthik rebuild. **No application code exists yet** — this set completes the master spec §27 Step 1 requirements-freeze gate.

## Read in this order

| Document | Contents |
|---|---|
| [`PARTHIK_MASTER_SPEC.md`](./PARTHIK_MASTER_SPEC.md) | The authoritative product specification. Everything else interprets it |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | System design, stack, runtime constraints, module boundaries, caching, storage, cross-cutting services — **and the decision register (§16)** |
| [`DATABASE.md`](./DATABASE.md) | Logical schema, enums, indexes, state machines, migration and retention policy |
| [`ROUTES.md`](./ROUTES.md) | Every route, its rendering strategy, access control and SEO treatment |
| [`API_SPEC.md`](./API_SPEC.md) | Transport rules, response envelope, error codes, idempotency, endpoint inventory |
| [`SECURITY.md`](./SECURITY.md) | Threat model, auth, sessions, RBAC, rate limits, data protection, pre-production checklist |
| [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md) | Task sequence, GitHub workflow, CI/CD, Definition of Done, cutover SOP, risk register |

## Start here

**[`ARCHITECTURE.md` §16 — Decision Register](./ARCHITECTURE.md#16-decision-register)** lists 33 decisions that need approval before implementation. The commerce rules in group C (multi-vendor cart, COD, GST, inventory semantics, zones, cancellation policy) are the expensive ones to change later.

## Status

| Document | Status |
|---|---|
| All six architecture documents | Draft, awaiting approval |
| Application code | Not started — correct at this stage |
| Decisions resolved | 0 of 33 |
