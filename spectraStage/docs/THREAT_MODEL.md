# Threat model (anonymous capabilities)

SpectraStage has no user accounts. Access is granted by **capability tokens**: whoever holds a
token has exactly the rights bound to it, for exactly one show.

| Token | Created by | Grants | Lifetime |
| --- | --- | --- | --- |
| Owner token (= recovery key) | `POST /api/sessions` | Full control of one show incl. approving devices, invites, deleting | until rotated |
| Controller token | Redeeming an owner-issued invite code | Show control except approve/remove devices, remove helpers, child-safe toggle, delete | until removed |
| Pending token | Entering a pairing code on a projector PC | Waiting for approval – nothing else (no state, no commands) | until approved/rejected |
| Device token | Issued on approval | Receive the show state of its session, send telemetry | until device removed |

Tokens are 256-bit random values, stored only as SHA-256 hashes, sent only in the request body /
`Authorization` header / first WebSocket message – never in URLs – and redacted from logs.

## Threats and mitigations

| Threat | Mitigation |
| --- | --- |
| Guessing a pairing code | 32⁸ ≈ 1.1·10¹² codes, 15 min validity, 20 attempts / 10 min per IP plus a global failure budget; a correct guess only creates a *pending* request that the owner must approve (it shows up with name and state on the phone). |
| Pairing code used as admin credential | Codes are a separate namespace (hashed with a kind prefix) and are never accepted as tokens; covered by tests. |
| Cross-show access | Every token resolves to exactly one session; all REST and WS handlers derive the session from the token, never from client input; surface/output ids of another show fail validation. Tests cover isolation. |
| Leaked owner key | Owner can rotate it (old key revoked immediately, open connections closed). Controllers and devices can be removed individually. |
| Lost owner key | Explicit recovery-key export/copy at creation and in settings; without it, control cannot be recovered by design (no account). |
| Stolen projector PC / device token | Device token only allows *reading* its show state and sending telemetry. Remove the device in the controller to revoke it. |
| Spam: creating many shows | 10 shows/h per IP, global `MAX_SESSIONS`, body limit 256 KB. |
| Spam: commands / WS floods | Per-IP token buckets for connections and messages, 256 KB frame limit, Zod validation of every message, bounded lists (surfaces, outputs, playlists, cues, masks…). |
| Cross-site WebSocket hijacking | `Origin` must equal `PUBLIC_URL`; tokens are not cookies, so a foreign page cannot ride an existing session anyway. |
| XSS | React escaping, strict CSP (`script-src 'self'`, no inline scripts), no user HTML rendering. |
| Spoofed client IP behind Cloudflare | Only trusted when `CLOUDFLARE=true`; restrict the origin firewall to Cloudflare ranges to make it unforgeable. Affects only rate limiting. |
| Replay / duplicate commands | Command UUIDs with bounded server-side dedup; revisioned state; expired cues are pruned and never replayed. |
| Stale clients after upgrade | Protocol version in `hello`; mismatches are told to reload. |

## Out of scope / residual risks

- Anyone who learns the owner key controls the show. Treat it like a password.
- A public instance can be used by strangers to run their own shows (accepted product decision D2).
- Physical safety (projector light, glare) cannot be guaranteed by software – see OPERATIONS.md.
