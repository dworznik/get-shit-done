# Slice 3: Cloudflare Deployment

Prepare Cloudflare deployment for the Hono + Effect API app and deploy it.

Goal:
Make the API app deployable to Cloudflare Workers with a minimal, production-sensible setup, then perform the first deployment.

Constraints:
- Target Cloudflare Workers
- Use Wrangler for configuration and deployment
- Preserve the Hono + Effect integration from slice 2
- Do not replace Hono with another framework
- Keep deployment config small and explicit
- Add only the environment/config scaffolding needed for this app
- Assume Cloudflare auth and account access are available in the local environment before deployment starts

Acceptance criteria:
- Wrangler config exists and matches the app structure
- The app builds for the Cloudflare Workers runtime
- Deployment command is documented and runnable
- The app is deployed successfully to Cloudflare Workers
- Basic post-deploy verification is documented, including the deployed URL and a smoke test command
- Any required environment variables or secrets are documented clearly
- Project docs include local run, build, and deploy steps

Do not touch:
- API behavior beyond what is required to make deployment work
- New product features unrelated to deployment
- Unrelated refactors to the Hono + Effect implementation
