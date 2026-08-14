# Cloudflare backend

This directory is the Supabase replacement target. It uses one Worker, D1 and a private R2 bucket.

## Safe deployment order

1. `npm install`
2. `npx wrangler login`
3. `npx wrangler d1 create science-fair-coach` and copy the returned ID into `wrangler.jsonc`.
4. `npx wrangler r2 bucket create science-fair-coach-files`
5. Set secrets: `BOOTSTRAP_TOKEN`, `OPENAI_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`.
6. `npm run cf:deploy`
7. Initialize the first administrator using `POST /admin-api` action `bootstrap` with `Authorization: Bearer BOOTSTRAP_TOKEN`.
8. Run migration and parity checks before changing `config.js`.

Never delete or pause Supabase until record counts, attachments, authentication and the 365+30 day lifecycle have been verified.
