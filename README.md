# @mac9sb/deno-foundation

Auth, KV, routing, and observability primitives for Deno apps.

Provides a shared foundation for apps built on
[Deno KV](https://docs.deno.com/kv/) with passwordless authentication (magic
links + passkeys), a minimal HTTP router, CSRF protection, rate limiting, and
structured logging.

## Install

```ts
import {
  createI18n,
  createSession,
  Router,
  sendMagicLink,
  validateSession,
  verifyMagicToken,
} from "jsr:@mac9sb/deno-foundation@^0.1.9";
```

## Modules

| Module       | Exports                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------- |
| `schemas`    | `User`, `Session`, `MagicToken`, `PasskeyCredential`                                     |
| `kv`         | `keys` — KV key builders                                                                 |
| `crypto`     | `randomToken`, `sha256Hex`, `constantTimeEqual`                                          |
| `session`    | `createSession`, `validateSession`, `revokeSession`, `clearSessionCookie`                |
| `magic_link` | `sendMagicLink`, `verifyMagicToken`                                                      |
| `email`      | `sendEmail`                                                                              |
| `passkey`    | `beginRegistration`, `finishRegistration`, `beginAuthentication`, `finishAuthentication` |
| `apple_auth` | `verifyAppleToken`                                                                       |
| `i18n`       | `createI18n`, `TranslateFn`, `I18n`                                                      |
| `router`     | `Router`, `jsonResponse`, `errorResponse`                                                |
| `csrf`       | `checkOrigin`                                                                            |
| `rate_limit` | `enforce`                                                                                |
| `logging`    | `createLogger`                                                                           |

## i18n

Load locale JSON files at startup and pass a per-request `t` function into your
route handlers:

```ts
const i18n = await createI18n({ locales: ["en", "fr"] });

// In a route:
const locale = req.headers.get("Accept-Language")?.slice(0, 2) ?? "en";
const t = i18n.t(locale);
t("nav.sign_in"); // → "Sign in"
t("hello", { name: "World" }); // → "Hello, World!"
```

Translation files are flat JSON at `public/locales/<locale>.json`:

```json
{
  "nav.sign_in": "Sign in",
  "hello": "Hello, {name}!"
}
```

The first locale in `locales` is the fallback. Unknown locales and missing keys
fall back gracefully — a missing key returns the key itself.

## Environment variables

| Variable          | Required        | Description                                                     |
| ----------------- | --------------- | --------------------------------------------------------------- |
| `RESEND_API_KEY`  | Yes (for email) | Resend API key                                                  |
| `EMAIL_FROM`      | No              | From address (default: `noreply@example.com`)                   |
| `APPLE_CLIENT_ID` | Yes (for Apple) | Bundle ID (native) or Services ID (web) registered with Apple   |
| `LOG_LEVEL`       | No              | `trace` / `debug` / `info` / `warn` / `error` (default: `info`) |

## Development

```bash
deno task test   # run tests
deno task lint   # lint
deno task fmt    # format
deno task check  # type-check
```

## License

MIT
