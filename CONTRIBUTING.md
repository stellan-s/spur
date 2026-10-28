# Contributing

Spur is licensed under the GNU Affero General Public License v3.0. By contributing, you agree that your contribution is licensed under it.

## Set up

1. Install Node.js 22 and Docker (the tests start PostgreSQL in a container), or set `TEST_DATABASE_URL` to an empty PostgreSQL database.
2. `npm ci`
3. `cp .env.example .env.local`. Without an organisation, Spur runs the demo organisation on `./fixture-repo`.
4. `npm run dev`

## Before a pull request

1. `npm run lint`
2. `npm run typecheck`
3. `npm test`

Add or update tests for changed behaviour. Schema changes go in a new numbered file in `migrations/`; never edit an applied migration.

## Style

- British English and sentence case in UI text, docs and commit messages.
- No emojis.
- Test data uses fictional organisations and people.
- Never commit credentials or real customer data.
