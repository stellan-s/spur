# Multi organisation setup

Spur supports one environment-configured organisation or several database-managed organisations in the same instance. Multi mode adds organisation creation, separate settings and credentials, and membership-based switching. Google or email-code sign-in is required; an instance administrator does not automatically get access to an organisation's knowledge.

## Upgrade and choose a mode

1. Back up the database before upgrading.
2. Apply pending migrations before starting the updated web or MCP server. This includes `0009_multi_tenancy.sql`, even when keeping single mode:

   ```bash
   node --env-file=.env.local bin/spur.mjs migrate
   ```

3. Keep `SPUR_TENANCY=single` for an existing environment-configured organisation. Omitting the setting also selects single mode.
4. Use `SPUR_TENANCY=multi` for new database-managed organisations.

Changing the mode does not copy environment settings into the database. Existing organisation data is not deleted, but it is not listed in multi mode until its organisation settings have been explicitly migrated. There is no automatic adoption command yet. Keep existing installations in single mode until that migration has been planned and tested; do not create another organisation to work around an existing slug conflict.

Multi mode does not create a demo organisation or inherit the instance's repository allowlist. An organisation with no repositories can still browse and manage stored knowledge.

## Configure the instance

Set these variables in the deployment's protected environment or secret store:

| Variable | Purpose |
| --- | --- |
| `SPUR_TENANCY=multi` | Select database-managed organisations. |
| `DATABASE_URL` | Shared PostgreSQL database with all migrations applied. |
| `SPUR_AUTH=google` or `SPUR_AUTH=otp` | Require Google or email-code sign-in. Local unauthenticated mode is rejected. |
| `SPUR_PUBLIC_URL` | Public origin, also used for authorisation redirects. |
| `SPUR_GOOGLE_CLIENT_ID` | Instance Google OpenID Connect client ID. |
| `SPUR_GOOGLE_CLIENT_SECRET` | Instance Google client secret. |
| `SPUR_EMAIL_PROVIDER` | `smtp` for a standards-compatible service or `mailgun` for its HTTP API. |
| `SPUR_EMAIL_FROM` | Authorised sender used for login-code messages. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD` | SMTP delivery settings. `SMTP_SECURE` selects implicit TLS; STARTTLS is required by default otherwise. |
| `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_BASE_URL` | Direct Mailgun adapter settings; the API origin defaults to the EU endpoint. |
| `SPUR_INSTANCE_ADMINS` | Comma-separated exact email addresses for the initial instance administrators. |
| `SPUR_ENCRYPTION_KEY` | Base64-encoded 32-byte encryption key for organisation credentials. Required when storing or reading those credentials. |

When using Google, register `<SPUR_PUBLIC_URL>/api/auth/google/callback` as an authorised redirect URI in each Google client used by the instance or an organisation. When using OTP, apply migration `0010_email_otp.sql` and configure one email-delivery adapter at instance level. Restart Spur after changing environment configuration.

Generate the encryption key with a cryptographically secure secret-management tool. Keep it out of Git, logs and chat. Back it up separately from the database: losing it makes stored organisation credentials unreadable. Replacing it does not re-encrypt existing credentials; automatic key rotation is not implemented.

`SPUR_ALLOWED_DOMAINS`, `SPUR_APPLICATION_NAME`, `SPUR_APPLICATION_ALIASES` and `SPUR_SECURITY_CONTACT` provide defaults that an organisation may override. AI provider credentials remain instance-level; per-organisation feature settings decide whether a provider is used.

`SPUR_ORGANIZATION_SLUG`, `SPUR_ORGANIZATION_NAME`, repository environment settings and `SPUR_BOOTSTRAP_ADMINS` do not provision organisations in multi mode. GitHub credentials from the instance environment are not inherited by tenants.

## Bootstrap and create an organisation

1. Put all intended initial instance administrators in `SPUR_INSTANCE_ADMINS` before the first administrator signs in.
2. Open `/organizations` and sign in with one of those exact email addresses through the configured provider.
3. Open **Manage organisations** at `/admin/organizations`.
4. Select **Create organisation**.
5. Enter its name, URL identifier and first administrator's exact email address.
6. Save the organisation.
7. Copy its sign-in link and share it with that administrator. Spur does not send an invitation email.
8. Have the administrator use that link and sign in with the specified email address. They become the organisation's first administrator and can approve other members, manage roles and configure features.

Instance bootstrap runs once: the first verified sign-in from the configured list provisions that list and records completion. Removing the environment list afterwards does not revoke existing administrators. Adding an address afterwards does not grant access, and a removed instance administrator is not silently re-granted the role. There is no instance-administrator management screen yet.

The first organisation administrator can sign in from a different email domain. Other users follow the organisation's domain policy and require membership approval. An empty explicit domain list allows any provider-verified email to request access; it does not grant membership.

## Configure organisation settings

Instance administrators can edit settings in **Manage organisations**. The organisation URL identifier and first-administrator email cannot be changed there after creation.

1. Set allowed email domains or retain the instance policy.
2. Set the preferred product name, search aliases and security contact as needed.
3. Add repository connections, one per line: `github://owner/repository` or an absolute path to a read-only Git checkout mounted on the server.
4. Add organisation-specific credentials under **Sign-in and encrypted credentials**.
5. Save changes.

The first repository is the primary source. All repositories and credentials must belong to that organisation's intended scope. Local paths are an instance-administrator setting, not an end-user or MCP parameter. Memory-only organisations can leave the list empty; repository evidence verification still needs a configured source.

A Google client override needs both the organisation's client ID and its stored client secret. GitHub uses the organisation's App ID and private key, or an installation token. Blank secret fields preserve stored values; the explicit removal checkbox deletes a credential. The API returns only which credentials are configured, never their values. Credentials use authenticated AES-256-GCM encryption, bound to the organisation and credential name.

Generic OpenID Connect (OIDC) discovery settings and client secrets can be stored, but do not enable OIDC sign-in yet. OIDC and email magic-link sign-in belong to phase 3.

## Switch organisations and connect MCP

The **Your organisations** screen lists only approved memberships. A browser session can switch between them; permissions are checked against the selected organisation on each request. Revoking membership removes access without relying on a cached role in the session.

For Model Context Protocol (MCP) clients:

1. Enable **Remote MCP** in the organisation's feature settings; it is off by default.
2. Connect the client to the instance's `/mcp` endpoint using OAuth authorisation.
3. Choose an approved organisation during authorisation.
4. Confirm the consent screen, which names that organisation.

Each token is bound to the chosen organisation. Passing another organisation in a request does not switch its access. Authorise a separate connection to work with a different organisation. Multi mode rejects unauthenticated local standard-input/output (stdio) MCP; the existing stdio workflow remains available in single mode.

Unscoped web URLs open the organisation picker in multi mode. Scoped links such as `/o/northstar/model` stay within that organisation, including sign-in and approval flows.

## Operational limits

Organisation creation and settings changes are recorded in `instance_audit_log`. Instance administrators manage configuration, not automatic knowledge access. Existing organisation permissions, restricted-memory masking and feature checks still apply to web and MCP reads and writes.

There is no automatic adoption of existing single-organisation settings, instance-administrator management UI, invitation email delivery, encryption-key rotation or billing in this phase. The migration and mode change must be performed deliberately by the operator; merely installing the code does not activate multi mode.
