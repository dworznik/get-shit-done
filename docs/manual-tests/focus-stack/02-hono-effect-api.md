# Slice 2: Hono + Effect API Endpoint

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
