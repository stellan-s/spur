variable "project_id" {
  description = "Google Cloud project ID."
  type        = string
}

variable "region" {
  description = "EU region for Cloud Run, its subnet and Cloud SQL."
  type        = string
  default     = "europe-north1"
}

variable "service_name" {
  description = "Cloud Run service and resource-name prefix."
  type        = string
  default     = "spur"
}

variable "artifact_repository" {
  description = "Existing Artifact Registry Docker repository in the region that holds the Spur image."
  type        = string
}

variable "cloudbuild_service_account" {
  description = "Service account the Cloud Build trigger runs as. It may deploy Spur's service and migration job only. Leave empty to deploy by hand."
  type        = string
  default     = ""
}

variable "container_image" {
  description = "Image for the first deployment, for example europe-north1-docker.pkg.dev/my-project/my-registry/spur:abc1234. Later images come from Cloud Build, and Terraform ignores changes to this value."
  type        = string
}

variable "organization_slug" {
  description = "Lowercase Spur organisation slug."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,62}$", var.organization_slug))
    error_message = "organization_slug must contain lowercase letters, numbers and hyphens."
  }
}

variable "organization_name" {
  description = "Organisation name shown in Spur."
  type        = string
}

variable "bootstrap_admins" {
  description = "Comma-separated Google account emails approved as initial administrators."
  type        = string
}

variable "bootstrap_security_owners" {
  description = "Comma-separated emails that become the first security owner (restricted.read) once approved, while the organisation has none."
  type        = string
  default     = ""
}

variable "allowed_domains" {
  description = "Comma-separated Google Workspace domains allowed to sign in. Required: without it any Google account can request access."
  type        = string

  validation {
    condition     = trimspace(var.allowed_domains) != ""
    error_message = "allowed_domains must name at least one Google Workspace domain."
  }
}

variable "public_url" {
  description = "Public origin users reach Spur on. Leave empty to use the Cloud Run service URL."
  type        = string
  default     = ""
}

variable "mcp_redirect_hosts" {
  description = "Comma-separated hosts that MCP clients may receive authorisation codes on. Loopback addresses are always allowed for Claude Code."
  type        = string
  default     = "claude.ai,claude.com"
}

variable "google_client_id" {
  description = "Google OAuth web client ID. Not secret; the client secret is added to Secret Manager outside Terraform."
  type        = string
}

variable "github_owner" {
  description = "GitHub owner of the primary repository."
  type        = string
}

variable "github_repository" {
  description = "GitHub name of the primary repository."
  type        = string
}

variable "github_app_id" {
  description = "ID of the read-only Spur GitHub App. Its private key is added to Secret Manager outside Terraform."
  type        = string
}

variable "security_contact" {
  description = "Who readers are told to ask about restricted security controls."
  type        = string
  default     = "the security owner"
}

variable "run_subnet_cidr" {
  description = "CIDR used by Cloud Run Direct VPC egress."
  type        = string
  default     = "10.20.0.0/24"
}

variable "sql_tier" {
  description = "Cloud SQL machine tier. db-g1-small is shared-core and has no SLA; db-custom-1-3840 is the smallest dedicated tier."
  type        = string
  default     = "db-g1-small"
}

variable "sql_availability_type" {
  description = "ZONAL for one zone, REGIONAL for a standby in a second zone at about twice the database cost. Changing it later restarts the database but keeps the data."
  type        = string
  default     = "ZONAL"

  validation {
    condition     = contains(["ZONAL", "REGIONAL"], var.sql_availability_type)
    error_message = "sql_availability_type must be ZONAL or REGIONAL."
  }
}

variable "deletion_protection" {
  description = "Protect Cloud Run and Cloud SQL resources from Terraform deletion."
  type        = bool
  default     = true
}

variable "min_instances" {
  description = "Minimum Cloud Run instances."
  type        = number
  default     = 0
}

variable "max_instances" {
  description = "Maximum Cloud Run instances."
  type        = number
  default     = 10
}

variable "application_name" {
  description = "Product name Spur uses in answers, for example the name customers know the application by. Empty uses the names in the model."
  type        = string
  default     = ""
}

variable "application_aliases" {
  description = "Comma-separated other names the application is searched by."
  type        = string
  default     = ""
}
