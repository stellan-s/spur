# Spur

Spur is an MCP-native organisational memory for software systems. It turns verified repository evidence and human decisions into typed, connected knowledge that can be explored through a web workspace or Model Context Protocol (MCP).

> Spur and its generated models are in beta. Verify important answers against their cited sources.

## What Spur provides

- Typed knowledge for systems, integrations, information, entities, capabilities, processes, controls, decisions, rules and observations.
- Commit-pinned evidence with file, line range and exact excerpt.
- Candidate, accepted, disputed and stale lifecycle states, separate from confidence and authority.
- Organisation-scoped PostgreSQL storage, permissions, feature switches and OAuth grants.
- Repository modelling through the bundled Claude Code skill and MCP tools.
- Local standard-input/output MCP and OAuth-protected remote MCP.
- Optional answer synthesis through OpenAI or Anthropic; external MCP hosts can use their own model instead.
- Google or passwordless email-code sign-in for shared deployments.

## Requirements

- Node.js 22 LTS or Node.js 24 LTS
- Git
- PostgreSQL 14 or newer, or Docker with Compose

## Run locally

```bash
npm install
cp .env.example .env.local
docker compose up -d postgres
npx spur migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The default configuration uses the bundled fixture repository, local loopback-only authentication and no built-in answer model.

To start the complete Compose stack instead:

```bash
docker compose up --build
```

## Configure an organisation

Set the organisation and repository in `.env.local`:

```dotenv
DATABASE_URL=postgresql://spur:spur@localhost:5432/spur
SPUR_ORGANIZATION_SLUG=example
SPUR_ORGANIZATION_NAME=Example
SPUR_REPOSITORY_ROOT=/absolute/path/to/repository
SPUR_REPOSITORY_NAME=Example application
SPUR_AUTH=none
SPUR_SYNTHESIS_PROVIDER=none
```

`SPUR_AUTH=none` is accepted only for a loopback-bound local installation. Shared deployments use Google OpenID Connect or passwordless email codes delivered through SMTP or the Mailgun adapter. See [`.env.example`](.env.example) and [multi-organisation setup](docs/multi-organisation.md).

## Model a repository

Install the bundled Claude Code skill:

```bash
npx spur skills install claude
npx spur skills install claude --skill spur-write-requirements
```

Connect Claude Code to the intended Spur MCP instance and ask it to model the current committed repository with the installed `spur-model-repository` skill. The workflow pins one immutable commit, writes candidate knowledge with exact evidence and never promotes candidates automatically.

Use the bundled `spur-write-requirements` skill to draft evidence-aware PRDs or technical specifications with selectable acceptance criteria, Definition of Done, delivery sections, diagrams, images, screenshots, and wireframes. It saves an unverified draft in Spur only after explicit approval.

## MCP

Run the local MCP server with the same environment as the web application:

```bash
node --env-file=.env.local bin/spur.mjs mcp
```

Shared deployments expose Streamable HTTP at `/mcp` and use OAuth with Proof Key for Code Exchange (PKCE). Remote MCP must be enabled for the organisation.

## Validation

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Security

Report vulnerabilities according to [SECURITY.md](SECURITY.md). Never commit credentials or tenant data. Spur stores session and OAuth tokens only as hashes and binds repository evidence to immutable commits.

## Licence

Spur is licensed under the [GNU Affero General Public License v3.0](LICENSE).
