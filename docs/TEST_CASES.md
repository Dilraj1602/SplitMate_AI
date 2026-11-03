# SplitMate AI Test Cases

Executed status refers to the commands and smoke checks recorded on 2026-10-31. Automated cases ran against isolated SQLite or jsdom mocks unless noted. The table inventories the collected cases; the source test suites contain detailed setup and assertions.

## Backend automated cases (27 passed)

| Test case ID | Feature | Preconditions / steps | Expected result | Actual result |
|---|---|---|---|---|
| B-AUTH-01 | Authentication API | Register, verify email, login, request/confirm password reset | Correct verification and credential/session behavior | Pass |
| B-AUTH-02 | Development OTP | Exercise local bypass and loopback restriction | Valid local-only code accepted | Pass |
| B-AUTH-03 | OTP service | Verify hash, purpose binding, one-time consumption | OTP cannot be reused or cross-purpose | Pass |
| B-AUTH-04 | OTP service | Count invalid attempts and expire code | Invalid/expired codes rejected | Pass |
| B-AUTH-05 | OTP service | Issue new code and enforce cooldown | Prior code invalidated; cooldown enforced | Pass |
| B-AUTH-06 | OTP cooldown | Request another code during cooldown | No new code issued | Pass |
| B-AUTH-07 | OTP service | Verify local code stored hashed and consumed once | Hash at rest; single use | Pass |
| B-EMAIL-01 | Email | Inspect mocked Brevo request | Sender/template/API header correct | Pass |
| B-EMAIL-02 | Email | Missing provider key | Safe failure without request | Pass |
| B-EMAIL-03 | Email | Provider error and timeout | Safe error handling | Pass |
| B-FOUND-01 | Configuration | Load database URL from environment | Setting resolved | Pass |
| B-FOUND-02 | CORS | Parse comma-separated origins | Origins parsed | Pass |
| B-FOUND-03 | Configuration | Start without DB config | App configuration allowed | Pass |
| B-FOUND-04 | CORS | Development defaults | Local Vite origins included | Pass |
| B-FOUND-05 | CORS | Production defaults | No inferred origins | Pass |
| B-FOUND-06 | OTP configuration | Attempt dev OTP in production config | Rejected | Pass |
| B-FOUND-07 | DB session | Close request database session | Session lifecycle correct | Pass |
| B-FOUND-08 | Alembic | Resolve migration path/model metadata | Models registered | Pass |
| B-FOUND-09 | Readiness | No DB configured | 503 returned | Pass |
| B-FOUND-10 | Readiness | Execute probe against test engine | Read-only query succeeds | Pass |
| B-FOUND-11 | API | Versioned health/OpenAPI registration | Routes registered | Pass |
| B-FOUND-12 | CORS | Registration preflight | Expected CORS response | Pass |
| B-HEALTH-01 | Health | Request health endpoint | Healthy response | Pass |
| B-HEALTH-02 | OpenAPI | Request schema | Schema available | Pass |
| B-PRODUCT-01 | Group/expense/balance/settlement/analytics | Create group; invite/join; create expense; inspect splits/balances; propose/confirm settlements; inspect notifications; void expense; query analytics/date/access | Financial calculations and authorization consistent | Pass |
| B-PRODUCT-02 | Dashboard | Compare active expenses across active/inactive groups | Dashboard counts only active accessible records | Pass |
| B-PRODUCT-03 | Group/invitation | Exercise group name and invitation lifecycle | Duplicate/invalid lifecycle handled | Pass |

## Frontend automated cases (34 passed)

| Test case ID | Feature | Steps / assertion | Expected result | Actual result |
|---|---|---|---|---|
| F-API-01 | API client | Backend error response | Safe backend message surfaced | Pass |
| F-API-02 | API client | Network failure | Clear connection error | Pass |
| F-API-03 | API client | Request timeout | Retryable timeout error | Pass |
| F-API-04 | API client | Set access token and request | Bearer token attached | Pass |
| F-SPLIT-01 | Split math | Format local date | Local calendar day retained | Pass |
| F-SPLIT-02 | Split math | Equal split odd paise | Deterministic remainder | Pass |
| F-SPLIT-03 | Split math | Exact and residual sample splits | Correct allocations | Pass |
| F-SPLIT-04 | Split math | Exact shares do not reconcile | Rejected | Pass |
| F-SPLIT-05 | Split math | Valid exact shares | Preserved | Pass |
| F-SPLIT-06 | Split math | Percentage residual | Deterministic allocation | Pass |
| F-SPLIT-07 | Split math | Fractional percentages | Total reconciles | Pass |
| F-SPLIT-08 | Split math | INR precision/format | Paise precision retained | Pass |
| F-TOAST-01 | Notifications | Render success/error | Accessible roles present | Pass |
| F-TOAST-02 | Notifications | Duplicate/dismiss toast | Deduplication and dismissal work | Pass |
| F-LANDING-01 | Public UI | Inspect sign-in/sign-up links | Real navigation available | Pass |
| F-LANDING-02 | Public UI | Inspect financial examples | No fake live figures shown | Pass |
| F-SETTINGS-01 | Settings | Navigate account/security content | Separate settings screens | Pass |
| F-SETTINGS-02 | Password UI | Show/hide password | Accessible toggle works | Pass |
| F-AUTH-01 | Registration UI | Show/hide password | Accessible toggle works | Pass |
| F-SETTINGS-03 | Password UI | Same old/new password | User receives validation | Pass |
| F-AUTH-02 | Registration | Submit registration request | API receives expected payload | Pass |
| F-SETTINGS-04 | Password UI | Password contains outer spaces | Password not trimmed | Pass |
| F-BALANCE-01 | Group balances | Render member balances | Each member has own amount | Pass |
| F-EXPENSE-01 | Expense detail | Compare payer to current user | Correct payer label | Pass |
| F-SETTLE-01 | Settlement UI | Use server available debt | Partial proposal prefilled correctly | Pass |
| F-GROUP-01 | Invitation UI | Invite by username | Existing API payload used | Pass |
| F-AUTH-03 | Registration UI | Submit too-short password | API not called | Pass |
| F-GROUP-02 | Invitation UI | API returns error | Dismissible error shown | Pass |
| F-EXPENSE-02 | Expense list | Render accessible expenses | Group/expense links shown | Pass |
| F-AUTH-04 | Verification UI | Submit email and six-digit code | Payload sent without persistence | Pass |
| F-AUTH-05 | Verification UI | Request resend | Cooldown displayed | Pass |
| F-AUTH-06 | Password reset UI | Submit reset code/new password | Correct reset endpoint called | Pass |
| F-SESSION-01 | Session restore | Restore valid saved session | Validate before authenticated UI | Pass |
| F-SESSION-02 | Session restore | Restore expired saved session | Clear expired session/sign out | Pass |

## Manual and runtime checks

| Test case ID | Feature | Preconditions and steps | Expected result | Actual result |
|---|---|---|---|---|
| M-SMOKE-01 | Browser landing | Start local Vite and open `http://127.0.0.1:5173/` | Landing content and navigation render | Pass |
| M-HEALTH-01 | Backend liveness | GET `http://127.0.0.1:8000/health` | Healthy response | Pass |
| M-READY-01 | Backend DB readiness | GET `http://127.0.0.1:8000/ready` | Ready when database responds | Pass |

No authenticated browser workflows or cross-viewport visual comparisons were executed. See `TESTING_REPORT.md` for blocked and untested cases.

