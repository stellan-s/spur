# Security

## Reporting a vulnerability

Do not open a public issue. Report it privately through GitHub's "Report a vulnerability" button on this repository's Security tab.

Include the affected version or commit, the steps to reproduce and the impact. You get a reply within five working days.

## Supported versions

Security fixes go into the latest release only.

## Scope

Spur stores organisational memory, including restricted security details. In scope:

- reading another organisation's data
- reading restricted details without `restricted.read`
- bypassing sign-in, roles or permissions
- MCP and OAuth token handling
- code execution through repository analysis

Out of scope: findings that need a compromised host or database, and installs that run `SPUR_AUTH=none` on a network address (Spur refuses to start that way).
