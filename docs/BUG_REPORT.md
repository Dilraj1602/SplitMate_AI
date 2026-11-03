# SplitMate AI Bug Report

**Audit date:** 2026-10-31  
**Scope:** repository review, current backend/frontend automated suites, read-only local health checks, and a browser landing-page smoke check.

## Confirmed bugs

No pre-existing product bug was reproduced in the executed automated cases. The requested group spending analytics feature was absent before this work; it has been implemented as a requested feature rather than recorded as an existing defect.

| Bug ID | Title | Module | Description / reproduction | Expected / actual | Severity / priority | Root cause / affected files | Suggested fix | Evidence | Status |
|---|---|---|---|---|---|---|---|---|---|
| — | No confirmed product defects | — | — | — | — | — | — | Backend 27/27 and frontend 34/34 automated tests passed; see `TESTING_REPORT.md`. | No reproduced defect |

## Non-bug findings and coverage gaps

| Finding | Impact | Evidence | Status |
|---|---|---|---|
| No Playwright/Cypress browser workflow suite is configured. | Authenticated user journeys and responsive behavior across all routes were not exercised in a real browser. | Package scripts and repository inventory contain Vitest/jsdom only. | Open coverage gap |
| Email OTP delivery depends on external Brevo credentials and inbox access. | Real email delivery and provider configuration could not be established from the isolated API tests. | Email service tests mock provider calls. | External integration not verified |
| Member removal, leaving a group, and group deletion are intentionally unavailable. | Those lifecycle paths cannot be tested through product UI/API. | Members page documents membership actions as disabled pending balance/admin transfer rules; no corresponding routes found. | Product limitation |
| The configured database readiness endpoint responded successfully, but migration drift and database integrity were not audited. | Full schema/data integrity status remains unknown. | `GET /ready` returned ready; no Alembic check or data query was run against configured DB. | Not assessed to avoid inspecting/modifying user data |
| Backend tests emit a Starlette deprecation warning for `HTTP_422_UNPROCESSABLE_ENTITY`. | Maintenance noise only; no observed runtime failure. | Pytest warning summary. | Low, open |

