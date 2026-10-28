# Google Cloud deployment

These files define a Spur service in `europe-north1`: Cloud Run, a private Cloud SQL for PostgreSQL instance in one zone (set `sql_availability_type = "REGIONAL"` for a standby in a second zone), daily backups and seven days of point-in-time recovery (PITR), Secret Manager secrets, a runtime service account, a Direct VPC egress subnet, a migration job and a private import bucket.

Users sign in with Google. A first sign-in creates an access request that an administrator approves. Restricted records stay masked for everyone without `restricted.read`. MCP clients can connect only from Claude (claude.ai and claude.com) and loopback addresses unless `mcp_redirect_hosts` says otherwise.

## Sharing a project with other services

The stack can go into a project that already runs other services. It creates only its own resources, named after `service_name` (default `spur`), and never changes existing ones: IAM grants are additive and scoped to Spur's own resources, enabled APIs stay on when the stack is destroyed, and a name clash makes Terraform stop with an error instead of taking over the existing resource. The image goes into the project's existing Artifact Registry repository (`artifact_repository`).

A project has one OAuth consent screen. In a shared project, leave it as it is: changing it to Internal locks out every other app's external users, such as customers connecting ad accounts. Spur only admits accounts in `allowed_domains` with a matching Google hosted-domain claim, whatever the consent screen says.

## What stays out of Terraform state

The Google OAuth client secret and the GitHub App private key are added to Secret Manager with `gcloud`, never through Terraform. The state still holds the generated database password, so it lives in a private, versioned bucket.

## 1. Tools and project

1. Install Terraform 1.7 or newer and the Google Cloud CLI.
2. Pick a project with billing on, then set it:

   ```bash
   gcloud config set project PROJECT_ID
   gcloud auth application-default login
   ```

3. Create the state bucket:

   ```bash
   gcloud storage buckets create gs://PROJECT_ID-spur-tfstate --location=europe-north1 \
     --uniform-bucket-level-access --public-access-prevention
   gcloud storage buckets update gs://PROJECT_ID-spur-tfstate --versioning
   ```

## 2. Google sign-in client

1. In a project of its own, set the OAuth consent screen to **Internal**. In a shared project, leave the consent screen unchanged (see above).
2. Create an OAuth 2.0 client of type **Web application**. Its redirect URI is `https://spur-PROJECT_NUMBER.europe-north1.run.app/api/auth/google/callback` (find the project number with `gcloud projects describe PROJECT_ID --format='value(projectNumber)'`), or `PUBLIC_URL/api/auth/google/callback` if you set `public_url` to a custom domain.
3. Keep the client ID for `terraform.tfvars` and the client secret for step 5.
4. Set `allowed_domains` to your Workspace domain. Spur also checks Google's hosted-domain claim, so a personal Google account on a company address cannot sign in.

## 3. GitHub App

One app serves every owner when it can be installed on any account.

1. Create a GitHub App in one GitHub organisation. Give it read-only **Contents** permission, no other permissions, no webhook, and let it be installed on any account.
2. Install it only on the repositories Spur needs, in each organisation or account that owns one.
3. Generate a private key and keep the `.pem` file for step 5. Spur mints a one-hour token per repository from this key, limited to read-only contents.

## 4. Configure

```bash
cd deploy/gcp
cp terraform.tfvars.example terraform.tfvars   # untracked; fill in every value
terraform init -backend-config="bucket=PROJECT_ID-spur-tfstate"
terraform validate
```

## 5. First deployment

Always apply through `./apply.sh`, never `terraform apply` directly. It checks that gcloud points at the project in `terraform.tfvars`, refuses any plan that deletes or replaces a resource, and applies only after you type the project ID. The database, its network and the secrets also carry `prevent_destroy`, so Terraform itself refuses to delete them.

1. Create the secret containers first:

   ```bash
   ./apply.sh -target=google_secret_manager_secret.runtime
   ```

2. Add the two secret values from files, so they never appear in shell history:

   ```bash
   gcloud secrets versions add spur-google-client-secret --data-file=client-secret.txt
   gcloud secrets versions add spur-github-app-private-key --data-file=spur-app.private-key.pem
   ```

   Delete both local files afterwards.

3. Build and push the first image with Cloud Build, from the repository root. Replace `REGISTRY` with your `artifact_repository`. The build skips the deploy steps because nothing is deployed yet:

   ```bash
   gcloud builds submit --config=cloudbuild.yaml --substitutions=_REPOSITORY=REGISTRY,_TAG=$(git rev-parse --short HEAD) .
   ```

   Set `container_image` in `terraform.tfvars` to `IMAGE_REPOSITORY:TAG`, with the tag you built (`terraform output -raw image_repository` prints the repository).

4. Review and apply everything:

   ```bash
   ./apply.sh
   ```

5. Run the migrations:

   ```bash
   gcloud run jobs execute "$(terraform output -raw migration_job_name)" --region=europe-north1 --wait
   ```

6. Check that `$(terraform output -raw service_url)/api/auth/google/callback` matches the redirect URI on the OAuth client.

7. Check health:

   ```bash
   curl -fsS "$(terraform output -raw service_url)/healthz"
   ```

## 6. Import an existing Spur database

Import before anyone signs in. The export holds memory, evidence, relationships, the ISMS register, knowledge gaps, conversations and analysis runs. It leaves out users, roles, sessions, tokens, feature switches and the audit log, which are set up afresh in the cloud.

```bash
gcloud storage cp spur-export.sql "gs://$(terraform output -raw import_bucket)/"
gcloud sql import sql "$(terraform output -raw database_instance)" \
  "gs://$(terraform output -raw import_bucket)/spur-export.sql" --database=spur --user=spur
gcloud storage rm "gs://$(terraform output -raw import_bucket)/spur-export.sql"
```

The export contains restricted records. Delete the local copy once the import has passed the checks below.

## 7. Connect the GitHub repositories

The primary repository comes from `github_owner` and `github_repository`. Add the others on the Sources page as GitHub URLs; they use the same GitHub App. For an owner where the app is not installed, Spur says so on first read.

## 8. First sign-in

1. Sign in with an address from `bootstrap_admins`.
2. On the admin page, set the feature switches. Turn on `remote_mcp` only for organisations that connect Claude.
3. Approve other people with the narrowest role that fits. Only a security owner can grant `restricted.read`, and nobody can change their own access. Administrators cannot grant it, so the first security owner comes from `bootstrap_security_owners`: a listed, approved person becomes security owner at sign-in while the organisation has none.
4. Remove the bootstrap addresses, both lists, from `terraform.tfvars` and apply again once your accounts work.

## Deploying new versions

`cloudbuild.yaml` in the repository root builds the image in Cloud Build, pushes it to the `_REPOSITORY` registry tagged with the commit and `latest`, runs the migration job with the new image, then points the Cloud Run service at it. Terraform ignores the image on the service and the job, so a later `./apply.sh` does not roll a deploy back.

To deploy on every push:

1. Push Spur to a GitHub repository the project's Cloud Build is connected to.
2. In Cloud Build, create a trigger on that repository's main branch, with configuration `cloudbuild.yaml`. Set the substitution `_REPOSITORY` to your `artifact_repository`. Pick a service account for it and note its email.
3. Set `cloudbuild_service_account` in `terraform.tfvars` to that email and run `./apply.sh`. This lets the account deploy Spur's service and migration job only; it already needs write access to the registry.

To deploy by hand, run from the repository root:

```bash
gcloud builds submit --config=cloudbuild.yaml --substitutions=_REPOSITORY=REGISTRY,_TAG=$(git rev-parse --short HEAD) .
```

The web service never migrates on start-up; the build runs the migrations before it deploys.

Infrastructure changes, such as a new environment variable or a larger database, still go through `./apply.sh`.

## Restore from a backup

Restoring to an existing instance overwrites its data, drops connections and restarts it.

1. Stop writes by restricting the service's ingress.
2. List backups: `gcloud sql backups list --instance=INSTANCE_NAME`
3. Restore: `gcloud sql backups restore BACKUP_ID --backup-instance=INSTANCE_NAME --restore-instance=INSTANCE_NAME`
4. Run the migration job for the deployed version.
5. Check `/healthz`, sign-in, organisation isolation, restricted masking and one known evidence excerpt before reopening ingress.

For PITR, clone to a new instance at the last good time and switch the database URL secret only after the same checks pass.

## Quarterly restore test

1. Clone a recent backup to a new, disposable instance. Never test against production.
2. Point an isolated Cloud Run revision at it.
3. Check the migration history, row counts, foreign keys, `/healthz`, restricted masking and one evidence excerpt.
4. Record the recovery point, time taken, results and operator.
5. Delete the disposable instance and revision.
