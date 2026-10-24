# SplitMate AI — Project Decisions and Assumptions

Decisions are marked **Provisional** until explicitly approved in the product requirements. No high-impact ambiguity below has been silently resolved in code.

## DEC-001 — Signup identity fields and normalization

- **Date:** 2026-10-24
- **Status:** Superseded by DEC-012
- **Context/evidence:** `project_details.md` §4.1 requests name, email, and password. `FRONTEND_ARCHITECTURE.md` §5 and `FRONTEND_DESIGN_SPEC.md` §5.2 specify username, email, and password. The current `User` model requires a unique username and email, but the normalization and case-sensitivity policy is not defined consistently.
- **Options:** Treat name and username as separate required values; use username as display name; make one optional.
- **Decision:** No schema/API implementation until identity fields and uniqueness normalization are resolved.
- **Implications:** Identity uniqueness and profile/API contracts; no database changes made.
- **Affected files/contracts:** `backend/app/models/user.py`, signup schema/API, frontend signup form.
- **Supersession note:** DEC-012 selects a display name plus required normalized username and email for the MVP.

## DEC-002 — Invite-link approval policy

- **Date:** 2026-10-24
- **Status:** Superseded by DEC-014
- **Context/evidence:** `project_details.md` §7.5 explicitly assumes invitee acceptance completes joining without additional admin approval. `DATABASE_DESIGN.md` §6 instead proposes that link-based join requests require admin approval and adds admin approve/reject endpoints. `FRONTEND_DESIGN_SPEC.md` §16 calls for reconciliation.
- **Options:** Invitee acceptance alone; admin approval alone after a request; both approvals.
- **Decision:** No link-join state machine implementation until this conflict is resolved. Opening a link must not activate membership under any option.
- **Implications:** Authorization and membership transitions.
- **Affected files/contracts:** Invitation/link services, API, database statuses, UI.
- **Supersession note:** DEC-014 provisionally requires both the invitee's authenticated request and administrator approval for a link-based join.

## DEC-003 — Member removal, leaving, and admin succession

- **Date:** 2026-10-24
- **Status:** Superseded by DEC-014
- **Context/evidence:** `project_details.md` §7.6–7.7 requires historical preservation and refers to outstanding-balance and administrator-transfer rules; the owner policy is not fully specified.
- **Decision:** Do not implement membership removal/leave or last-admin transitions until rules are reconciled. Preserve historical financial records as the invariant.
- **Implications:** Prevents unsafe loss of debt/credit or a group without an authorized administrator.
- **Affected files/contracts:** Membership model/service, group permissions, API, activity history.
- **Supersession note:** DEC-014 provisionally allows leaving with preserved debt history and requires admin transfer before the last admin leaves.

## DEC-004 — Settlement transition and reversal contract

- **Date:** 2026-10-24
- **Status:** Superseded by DEC-009
- **Context/evidence:** Product/API/database documents require recipient confirmation and state pending settlements do not change official balances. They do not completely align on reject, cancel, and void permissions or terminal states.
- **Decision:** Implement no settlement write workflow until allowed transitions, actors, and reversal semantics are explicitly aligned. Keep confirmed transfers separate from expenses.
- **Implications:** Financial balances and audit integrity.
- **Affected files/contracts:** Settlement model, API, balance service, UI.
- **Supersession note:** This blocked assessment was refined after reconciling API and database contracts; DEC-009 is the current documented direction.

## DEC-005 — Canonical ASGI module

- **Date:** 2026-10-24
- **Status:** Provisional
- **Context/evidence:** Backend architecture names `backend.app.main`; root `main.py` defines a different FastAPI application. No README or launch script resolves this.
- **Decision:** Treat `backend.app.main:app` as the provisional canonical target because it matches the documented architecture. Retain the root module until compatibility expectations are checked.
- **Implications:** Startup/documentation only; no user data impact.
- **Affected files/contracts:** `main.py`, `backend/app/main.py`, future README and run scripts.

## DEC-006 — Invitation expiry and reinvitation policy

- **Date:** 2026-10-24
- **Status:** Superseded by DEC-014
- **Context/evidence:** `DATABASE_DESIGN.md` §6 proposes seven-day invitation expiry; `project_details.md` §19 explicitly leaves invitation/link expiry and reinvitation after rejection, removal, or expiry undecided.
- **Options:** Adopt the seven-day proposal with explicit reinvitation rules; choose another expiry and rate policy.
- **Decision:** Do not encode expiry or reinvitation behavior until confirmed. The seven-day value remains a proposal, not an approved requirement.
- **Implications:** Invitation availability, abuse prevention, and lifecycle state.
- **Affected files/contracts:** Invitation/link models, services, API, notifications, UI.
- **Supersession note:** DEC-014 adopts the database design's seven-day lifetime and permits reinvitation after decline/expiry with duplicate-pending prevention.

## DEC-007 — Currency scope and precision

- **Date:** 2026-10-24
- **Status:** Superseded by DEC-013
- **Context/evidence:** `DATABASE_DESIGN.md` supports per-currency balances and proposes INR in its example, while `project_details.md` §19 asks whether the first release is INR-only or multi-currency. Currency-specific precision and a supported-code list are not finalized.
- **Options:** INR-only for the first release; multiple currencies with an explicit allowlist and precision table.
- **Decision:** No monetary schema or authoritative split calculations until the supported currency set and precision policy are confirmed. Never combine different currencies.
- **Implications:** Database precision, expense validation, display formatting, balances.
- **Affected files/contracts:** Expense/split schemas and services, database models, frontend amount controls.
- **Supersession note:** DEC-013 selects INR-only with two decimal places for the initial release.

## DEC-008 — Group archive with outstanding balances

- **Date:** 2026-10-24
- **Status:** Superseded by DEC-014
- **Context/evidence:** `DATABASE_DESIGN.md` §5 proposes allowing archives with unresolved balances and continued settlement recording; `project_details.md` §6.5 says the initial policy should prevent archiving while unresolved balances remain unless the product explicitly supports it. Product §19 lists this as a decision.
- **Options:** Block archive until all balances settle; permit archive while preserving balances and allow settlements.
- **Decision:** Do not implement archive behavior until the product policy is confirmed.
- **Implications:** Group lifecycle and ability to settle historical debt.
- **Affected files/contracts:** Group service/API, settlement permissions, UI warnings.
- **Supersession note:** DEC-014 allows archive with debt, disables new expenses/invitations, and preserves settlement access.

## DEC-009 — Settlement transitions

- **Date:** 2026-10-24
- **Status:** Provisional
- **Context/evidence:** `API_DOCUMENTATION.md` §8 and `DATABASE_DESIGN.md` §8 agree that settlements are proposals, pending transfers do not affect balances, the recipient confirms, the recipient may reject, pending transfers may be cancelled under policy, and corrections use audited reversal/adjustment records. Product §9 requires confirmation and allows confirm/reject/void according to the contract.
- **Decision:** Follow the API contract's distinct confirm, reject, cancel, and reversal operations. A reversal must record an adjustment and must not rewrite a confirmed settlement. Authorization policy for cancellation/reversal must be explicit in implementation.
- **Implications:** Balance correctness, concurrent state changes, and audit history.
- **Affected files/contracts:** Settlement model/API/service, balances, UI.

## DEC-010 — Authentication contract and token/session policy

- **Date:** 2026-10-24
- **Status:** Superseded by DEC-012
- **Context/evidence:** The product/API documents use different registration route names (`/signup` and `/register`) and verification/reset request shapes (verification code versus one-time token; product flow includes reset-code verification while API documentation lists a direct reset token). The product calls short-lived access tokens, rotating opaque refresh tokens, hashed refresh-token storage, HttpOnly/Secure/SameSite cookies, rate limiting, and Google token verification recommended, while the frontend/architecture documents require CSRF protection where cookie credentials are used. Exact access-token format/TTL, refresh expiry/cookie scope/CSRF mechanism, rate limits, code TTL/attempt policy, Google account-link behavior, and session revocation rules are not fixed.
- **Options:** Reconcile a single API contract and make the token/cookie/CSRF, expiry, rate-limit, and account-linking policies explicit before implementing auth; preserve secure defaults in the chosen design.
- **Decision:** Implement no authentication routes, token model, or credential cookies until the contracts and session policy are approved. Continue with database-independent foundation work only.
- **Security implications:** Incorrect assumptions could enable account takeover, replay, CSRF, account enumeration, or persistent sessions.
- **Affected files/contracts:** `backend/app/config.py`, user/session/token models, auth schemas/routes, frontend auth client, `API_DOCUMENTATION.md`, environment-variable example.
- **Supersession note:** DEC-012 records a provisional MVP contract and secure defaults; external mail/Google credentials remain an integration dependency.

## DEC-011 — Initial user model versus product identity schema

- **Date:** 2026-10-24
- **Status:** Superseded by DEC-012
- **Context/evidence:** `backend/app/models/user.py` currently requires unique username and email, allows a nullable password hash, and has no display-name field. `project_details.md` §4.1 describes signup with name/email/password, while its §11.1 makes username conditional and lists display name; `DATABASE_DESIGN.md` proposes username required and calls case-insensitive normalization unresolved. No model/schema migration exists.
- **Options:** Required username plus display name; optional/later username; treat name as username/display name. Decide normalized storage and case-insensitive uniqueness policy for email and username.
- **Decision:** Preserve current model unchanged and create no migration until identity fields and normalization are approved.
- **Implications:** User signup/profile contract, uniqueness constraints, and compatibility with any existing records.
- **Affected files/contracts:** `backend/app/models/user.py`, signup/profile schemas, user migration, API and frontend.
- **Supersession note:** DEC-012 resolves the initial MVP fields provisionally; no existing data is rewritten.

## DEC-012 — Provisional authentication defaults for MVP

- **Date:** 2026-10-24
- **Status:** Provisional (selected to proceed under the implementation brief; review before production)
- **Context/evidence:** The API contract names `/auth/register`, one-time email tokens, token-based password reset, bearer access tokens, and refresh sessions. Product security guidance specifies Argon2id, short-lived access credentials, rotating opaque refresh credentials stored as hashes, email verification, generic reset responses, and server-side Google token validation.
- **Decision:** Use `/auth/register`; require `display_name`, username, email, and password; canonicalize username/email to lowercase for uniqueness; use Argon2id; require verified email for normal sign-in; use random single-use verification/reset tokens stored hashed; use 15-minute signed access tokens and 30-day rotating opaque refresh tokens stored hashed in a Secure, HttpOnly, SameSite=Lax cookie in production; keep access tokens in memory in the SPA; protect cookie-authenticated mutations with a CSRF token and Origin validation; revoke all refresh sessions on password reset/change. Google linking requires a valid Google identity token and must not auto-link solely by matching email.
- **Alternatives:** Short-code verification/reset as described in product workflow; persistent browser access-token storage; shorter or longer refresh lifetime.
- **Rationale/security implications:** High-entropy URL tokens avoid a short-code guessing surface; Argon2id and refresh rotation follow existing requirements. Production settings must fail closed without secrets/provider configuration. Cookie flags and CSRF checks must be verified in the deployed origin model.
- **Affected files/contracts:** `backend/app/config.py`, user/session/token models, auth services/routes/schemas, frontend session state and API client, API docs, `.env.example`.

## DEC-013 — MVP currency and exact split policy

- **Date:** 2026-10-24
- **Status:** Provisional
- **Context/evidence:** Product examples consistently use INR; project section 19 leaves INR-only versus multi-currency unresolved. Financial correctness requires explicit currency precision and deterministic residual handling.
- **Decision:** Start with INR only at two decimal places (paise); no conversion. Store monetary values as `NUMERIC` and calculate with `Decimal` on the server. Equal splits allocate paise in ascending participant UUID order; percentage shares accept two decimal percentage places, floor each participant's paise allocation, and distribute remaining paise in ascending participant UUID order. Exact splits must reconcile exactly.
- **Alternatives:** Support a currency allowlist and precision table in the initial release; defer all expense writing pending a currency decision.
- **Rationale/implications:** An INR-only first release avoids silently assigning precision to unsupported currencies and is reversible before multi-currency records are created. API, group creation, expense forms, and tests must reject all other currencies.
- **Affected files/contracts:** Group/expense/split models, API schemas/services, frontend forms/formatting, API and database docs.

## DEC-014 — MVP membership, invitation, and archive lifecycle

- **Date:** 2026-10-24
- **Status:** Provisional
- **Context/evidence:** API/database documents specify email invitations and admin-approved link join requests; product details specifies username invitations and says the link policy is unresolved. Database design proposes seven-day expiry, rejoining by membership reactivation, leaving with balances while preserving history, and archived groups allowing settlements.
- **Decision:** Support direct invitations by either a normalized username or email, with invitee acceptance required; set invitations and links to seven days; allow reinvitation after decline/expiry while preventing duplicate pending invitations; link requests require an authenticated user's explicit request and admin approval; preserve a user's membership history by reactivating the same row after a later approved join; permit leaving/removal with debt while preserving financial records; require admin transfer before an admin leaves or is removed; allow group archive with outstanding balances, block new expenses/invitations, and continue settlement access.
- **Alternatives:** Link acceptance alone; archive blocked until debt is settled; prohibit leaving with balances.
- **Rationale/implications:** The selected link flow requires both user intent and group approval. Membership state changes never erase historical splits or settlements. Reinvitation abuse limits remain to be implemented before public exposure.
- **Affected files/contracts:** Group/membership/invitation models, API, services, authorization, frontend group and invitation screens.

## DEC-015 — Frontend session lifetime

- **Date:** 2026-10-24
- **Status:** Provisional
- **Context/evidence:** Frontend now routes authenticated pages behind session state; project docs disallow long-lived sensitive tokens in local storage and recommend secure refresh cookies with CSRF protection.
- **Decision:** Keep the access token in memory only. Until refresh-cookie and CSRF endpoints are implemented and verified, a page reload returns the user to sign-in; do not persist bearer credentials in local/session storage.
- **Alternatives:** Persist a token in browser storage; implement refresh immediately with an unapproved cookie policy.
- **Security implications:** This is intentionally conservative; users may need to sign in again after a reload.
- **Affected files/contracts:** `frontend/src/app/auth.tsx`, API client, authentication integration.

## Unresolved decisions before feature persistence/auth rollout

These remain open even where a provisional MVP direction exists above. The provisional entries are implementation assumptions, not user approval or production authorization.

- **Account retention/deletion:** required retention/anonymization behavior for users referenced by financial history and whether account deletion is a request, immediate anonymization, or delayed workflow.
- **Authentication abuse controls:** exact rate limits, lockout/backoff policy, verification/reset token TTL and attempt limits, email delivery semantics/provider, and production secret/key rotation requirements.
- **Google sign-in:** client ID, provider configuration, account-linking confirmation flow, and behavior for existing password accounts.
- **Settlement cancellation and reversals:** which role can cancel pending settlements or reverse confirmed ones, and whether dispute evidence/notes are required.
- **Frontend/backend contract alignment:** response envelopes and request field names in the current UI must be reconciled against API docs before feature endpoints are considered implemented.
- **Production CORS/deployment model:** explicit allowed origins and cookie/CSRF deployment setup are still environment decisions; development examples are not production policy.

No authentication or financial write endpoint should be exposed until its relevant decision is finalized and tested.

## Positive-flow verification note — 2026-10-24

The A–H end-to-end verification pass made no new product or security decisions. Existing provisional entries remain unapproved. Full results are recorded in `TEST_REPORT.md`; no data was written and the development database was not migrated.

## DEC-016 — Password minimum length for signup/reset

- **Date:** 2026-10-24
- **Status:** User-directed UI requirement; backend enforcement must match before registration is enabled.
- **Context:** User requested a six-character minimum after observing the signup form's 12-character hint. The submitted sample was longer than 12 characters, so length was not the cause of the failed request.
- **Decision:** Set the signup and password-reset UI minimum to six characters and validate it explicitly in the form. Login accepts existing passwords without this client-side minimum.
- **Security implication:** Six characters is a weak minimum for accounts that may expose financial records. The backend must use Argon2id, rate limiting, and breached-password/abuse controls, and the minimum should be reconsidered before production.
- **Affected files/contracts:** `frontend/src/pages/AuthPages.tsx`, backend registration/reset schemas when implemented.

## Positive-flow verification note — 2026-10-24

The A–H end-to-end verification pass made no new product or security decisions. Existing provisional entries remain unapproved. Full results are recorded in `TEST_REPORT.md`; no data was written and the development database was not migrated.
