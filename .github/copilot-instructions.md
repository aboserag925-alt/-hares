# Hares Platform — Copilot Instructions

## Architecture
This repository is an existing Arabic-first, RTL web/PWA application with a Node.js HTTP server in `server/`, browser application in `app/`, public pages in `screens/`, Supabase schema in `supabase/`, Capacitor Android support, and Docker deployment. Extend existing modules; do not rewrite the application.

## Non-negotiable safety
- Never automatically merge or deploy production.
- Never expose or commit `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, or `TELEGRAM_BOT_TOKEN`.
- Never bypass authentication or the existing `admin_users` authorization check.
- Never disable or weaken Supabase RLS.
- Never bypass Telegram media approval/removal requirements.
- Never allow an AI agent to approve its own work or its own high-risk changes.
- Never delete or weaken tests to obtain a green CI run.
- Never modify production secrets or merge unrelated pull requests.
- High/critical changes require explicit human approval recorded server-side.

## Implementation
- Preserve Arabic copy, RTL semantics, accessibility, and the current visual identity.
- Keep service-role access server-side only. Public browser code uses safe public configuration/anon access.
- Validate request bodies with allowlists, size limits, and rate limits.
- Trust proxy headers only when explicitly configured.
- AI provider output is untrusted input. Validate structured output and fail closed on authorization decisions.
- Religious answers/content are drafts until reviewed by a qualified human scholar.

## Validation
Run `npm ci`, `npm test`, `npm run build:app`, and `node --check` for changed server entrypoints. Add regression tests for bug fixes and security-sensitive behavior. Report commands not run and failures honestly.

## Pull requests
Use focused task branches and small diffs. Explain security boundaries, database migrations, tests, commands executed, and remaining risks. Do not merge. Stop for human review.
