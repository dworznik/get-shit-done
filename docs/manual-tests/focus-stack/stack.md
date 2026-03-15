# Focus Stack Manual Test

Use this file as the direct input to `/gsd:focus-stack`.

## 1. TypeScript project foundation

Create a new TypeScript API project foundation for a Cloudflare Workers app.

Goal:
Set up a clean TypeScript codebase with testing, linting, formatting, and sensible project structure so the later Hono/Effect and deployment slices build on a solid base.

Constraints:
- Use TypeScript throughout
- Use `npm` unless the target repo already uses another package manager
- Add a test runner and at least one passing smoke test
- Add ESLint and Prettier with scripts wired in `package.json`
- Add strict TypeScript settings
- Keep the setup small and production-oriented
- Do not add application-specific business logic yet
- Do not add Cloudflare deployment config in this slice

Acceptance criteria:
- Project installs and runs with a standard `npm install`
- `package.json` includes `build`, `test`, `lint`, and `format` scripts
- TypeScript config is strict and suitable for maintainable server-side code
- Test runner is configured and a smoke test passes
- ESLint and Prettier are configured and run successfully
- Project structure clearly separates source code and tests
- Basic project docs explain how to install, lint, test, and build

Do not touch:
- Hono route implementation
- Effect-based domain logic
- Cloudflare deployment files beyond what is unavoidably required by the chosen project shape

## 2. Hono + Effect API endpoint

Implement a simple API endpoint using Hono and Effect.

Goal:
Add a single HTTP endpoint that demonstrates a clean integration between Hono and Effect while keeping the codebase functional, typed, and explicit about failures.

Constraints:
- Use Hono as the HTTP framework
- Use Effect for application logic and error handling
- Do not use Effect's built-in HTTP server
- Integrate Effect with Hono explicitly inside the request handling flow
- Keep the code in FP style: pure logic where practical, small composable functions, no class-based design
- Model expected failures with typed Effect errors and return appropriate HTTP responses
- Limit the scope to one simple endpoint plus the minimal supporting structure
- Reuse the tooling and conventions from slice 1

Acceptance criteria:
- There is one working API endpoint, for example `GET /api/health` or `GET /api/hello`
- Request handling uses Hono while business logic runs through Effect
- Expected failures are represented through Effect error channels rather than ad hoc `try/catch` branching
- The Hono handler translates Effect success and failure into clear HTTP responses
- Code remains easy to extend with more endpoints later
- Add or update focused tests for the endpoint behavior and failure mapping
- Lint and test pass after the change

Do not touch:
- Cloudflare deployment setup except for minimal runtime-safe app structure
- Broader API surface than the single endpoint required here
- Unrelated refactors to the project foundation

## 3. Cloudflare deployment

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
