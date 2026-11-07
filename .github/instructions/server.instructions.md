---
applyTo: "server/**/*.js"
---
Keep server modules small and testable. Validate methods, paths, JSON size, content type, allowlisted fields, and authorization. Reuse the existing admin_users model. Never trust client-provided status/risk/approval flags. Keep service-role keys server-only. Default TRUST_PROXY to false. Add regression tests for every API/security fix.
