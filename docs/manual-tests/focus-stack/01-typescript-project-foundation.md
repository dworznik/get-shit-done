# Slice 1: TypeScript Project Foundation

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
