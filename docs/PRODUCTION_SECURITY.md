# Production deployment security baseline

## Ingress and TLS

- Terminate TLS at the KPS/Coolify-managed reverse proxy.
- Only the frontend and the backend HTTP service may receive reverse-proxy traffic.
- The default Compose host bindings are loopback-only so a raw server IP cannot bypass TLS.
- Set `FRONTEND_URL`, `PUBLIC_APP_URL`, `NEXT_PUBLIC_API_URL`, and `CORS_ALLOWED_ORIGINS` to the final HTTPS origins in production.
- Do not expose Redis or PostgreSQL to public host interfaces.

## Internal services

- Redis is `expose`-only on port 6379 and is reached as `redis://redis:6379` from the backend network.
- PostgreSQL/pgvector should be on a private service network or managed private endpoint.
- The migrator is one-shot and must complete successfully before the backend starts.
- Persistent upload storage is mounted only into the backend. S3/off-server storage can be enabled later without changing the ingress model.

## Runtime

- Node.js 22 is the supported runtime for frontend, backend, reporter, CI, and containers.
- Containers run as non-root application users.
- Next.js uses `output: "standalone"` so production does not ship the complete development dependency tree.
- Production secrets are supplied by KPS/Coolify environment management, never committed to source.

## Security gates

- CI blocks any npm audit finding at High or Critical severity.
- Backend typecheck, full tests and build must pass.
- Frontend lint and production build must pass.
- Playwright reporter typecheck, tests and build must pass.
- Both production container images must build before merge.

## Reverse-proxy contract

Recommended public routing:

- `https://qa.<domain>/` -> frontend:3000
- `https://qa-api.<domain>/` -> backend:7000, or a same-origin `/api` route if the proxy is configured that way.

Redis/PostgreSQL have no public route.
