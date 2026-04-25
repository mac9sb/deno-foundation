# @mac9sb/deno-foundation

Auth, KV, routing, and observability primitives for Deno apps.

Provides a shared foundation for apps built on [Deno KV](https://docs.deno.com/kv/) with passwordless authentication (magic links + passkeys), a minimal HTTP router, CSRF protection, rate limiting, and structured logging.

## Install

```ts
import {
  createSession,
  validateSession,
  sendMagicLink,
  verifyMagicToken,
  Router,
} from "jsr:@mac9sb/deno-foundation@^0.1.0";
```

## Modules

| Module | Exports |
|---|---|
| `schemas` | `User`, `Session`, `MagicToken`, `PasskeyCredential` |
| `kv` | `keys` — KV key builders |
| `crypto` | `randomToken`, `sha256Hex`, `constantTimeEqual` |
| `session` | `createSession`, `validateSession`, `revokeSession`, `clearSessionCookie` |
| `magic_link` | `sendMagicLink`, `verifyMagicToken` |
| `email` | `sendEmail` |
| `passkey` | `beginRegistration`, `finishRegistration`, `beginAuthentication`, `finishAuthentication` |
| `router` | `Router`, `jsonResponse`, `errorResponse` |
| `csrf` | `checkOrigin` |
| `rate_limit` | `enforce` |
| `logging` | `createLogger` |

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `RESEND_API_KEY` | Yes (for email) | Resend API key |
| `EMAIL_FROM` | No | From address (default: `noreply@example.com`) |
| `LOG_LEVEL` | No | `trace` / `debug` / `info` / `warn` / `error` (default: `info`) |

## Development

```bash
deno task test   # run tests
deno task lint   # lint
deno task fmt    # format
deno task check  # type-check
```

## License

MIT
