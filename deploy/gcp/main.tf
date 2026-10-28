locals {
  required_services = toset([
    "compute.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "servicenetworking.googleapis.com",
    "sqladmin.googleapis.com",
  ])
  database_name = "spur"
  # Cloud Run's deterministic service URL, unless a custom domain is set.
  public_url    = var.public_url != "" ? var.public_url : "https://${var.service_name}-${data.google_project.current.number}.${var.region}.run.app"
  database_user = "spur"
  # Images live in the project's existing registry, next to the portal's.
  image_repository = "${var.region}-docker.pkg.dev/${var.project_id}/${var.artifact_repository}/${var.service_name}"
}

data "google_project" "current" {
  project_id = var.project_id
}

resource "google_project_service" "required" {
  for_each           = local.required_services
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_compute_network" "spur" {
  # Terraform refuses any plan that would delete this.
  lifecycle {
    prevent_destroy = true
  }

  name                    = "${var.service_name}-network"
  auto_create_subnetworks = false
  depends_on              = [google_project_service.required]
}

resource "google_compute_subnetwork" "run" {
  name          = "${var.service_name}-run"
  region        = var.region
  network       = google_compute_network.spur.id
  ip_cidr_range = var.run_subnet_cidr
}

resource "google_compute_subnetwork_iam_member" "cloud_run_network_user" {
  project    = var.project_id
  region     = var.region
  subnetwork = google_compute_subnetwork.run.name
  role       = "roles/compute.networkUser"
  member     = "serviceAccount:service-${data.google_project.current.number}@serverless-robot-prod.iam.gserviceaccount.com"

  depends_on = [google_project_service.required]
}

resource "google_compute_global_address" "private_services" {
  name          = "${var.service_name}-private-services"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.spur.id
}

resource "google_service_networking_connection" "private_services" {
  network                 = google_compute_network.spur.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_services.name]
  depends_on              = [google_project_service.required]
}

resource "random_password" "database" {
  length  = 32
  special = false
}

resource "google_sql_database_instance" "spur" {
  # Terraform refuses any plan that would delete this.
  lifecycle {
    prevent_destroy = true
  }

  name                = "${var.service_name}-postgres"
  region              = var.region
  database_version    = "POSTGRES_16"
  deletion_protection = var.deletion_protection

  settings {
    edition                     = "ENTERPRISE"
    tier                        = var.sql_tier
    availability_type           = var.sql_availability_type
    disk_type                   = "PD_SSD"
    disk_autoresize             = true
    deletion_protection_enabled = var.deletion_protection

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      start_time                     = "01:00"
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 14
        retention_unit   = "COUNT"
      }
    }

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.spur.id
      ssl_mode        = "ENCRYPTED_ONLY"
    }

    maintenance_window {
      day          = 7
      hour         = 2
      update_track = "stable"
    }
  }

  depends_on = [google_service_networking_connection.private_services]
}

resource "google_sql_database" "spur" {
  # Terraform refuses any plan that would delete this.
  lifecycle {
    prevent_destroy = true
  }

  name     = local.database_name
  instance = google_sql_database_instance.spur.name
}

resource "google_sql_user" "spur" {
  name     = local.database_user
  instance = google_sql_database_instance.spur.name
  password = random_password.database.result
}

resource "google_service_account" "spur" {
  account_id   = "${var.service_name}-runtime"
  display_name = "Spur Cloud Run runtime"
}

# Secret values other than the database URL are added outside Terraform, so
# they never reach the state file. See README.md.
resource "google_secret_manager_secret" "runtime" {
  # Terraform refuses any plan that would delete this.
  lifecycle {
    prevent_destroy = true
  }

  for_each = toset([
    "database-url",
    "google-client-secret",
    "github-app-private-key",
  ])
  secret_id = "${var.service_name}-${each.value}"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret_version" "database_url" {
  secret = google_secret_manager_secret.runtime["database-url"].id
  # Cloud SQL presents a certificate for its instance name, not its private
  # IP, so libpq semantics are used: encrypted, inside the private network.
  secret_data = "postgresql://${local.database_user}:${random_password.database.result}@${google_sql_database_instance.spur.private_ip_address}:5432/${local.database_name}?uselibpqcompat=true&sslmode=require"
  depends_on  = [google_sql_database.spur, google_sql_user.spur]
}

resource "google_secret_manager_secret_iam_member" "runtime_access" {
  for_each  = google_secret_manager_secret.runtime
  project   = var.project_id
  secret_id = each.value.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.spur.email}"
}

resource "google_cloud_run_v2_job" "migrate" {
  name                = "${var.service_name}-migrate"
  location            = var.region
  deletion_protection = var.deletion_protection

  # Cloud Build sets the image on each deploy (cloudbuild.yaml).
  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }

  template {
    template {
      service_account = google_service_account.spur.email
      max_retries     = 1
      timeout         = "900s"

      containers {
        image   = var.container_image
        command = ["node"]
        args    = ["--import", "tsx", "src/cli.ts", "migrate"]

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.runtime["database-url"].secret_id
              version = "latest"
            }
          }
        }
      }

      vpc_access {
        network_interfaces {
          network    = google_compute_network.spur.name
          subnetwork = google_compute_subnetwork.run.name
        }
        egress = "PRIVATE_RANGES_ONLY"
      }
    }
  }

  depends_on = [
    google_compute_subnetwork_iam_member.cloud_run_network_user,
    google_secret_manager_secret_iam_member.runtime_access,
    google_secret_manager_secret_version.database_url,
  ]
}

resource "google_cloud_run_v2_service" "spur" {
  name                = var.service_name
  location            = var.region
  deletion_protection = var.deletion_protection
  ingress             = "INGRESS_TRAFFIC_ALL"

  # Cloud Build sets the image on each deploy (cloudbuild.yaml).
  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  template {
    service_account = google_service_account.spur.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.container_image

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
        cpu_idle = true
      }

      startup_probe {
        initial_delay_seconds = 2
        timeout_seconds       = 3
        period_seconds        = 5
        failure_threshold     = 24
        http_get {
          path = "/healthz"
          port = 3000
        }
      }

      readiness_probe {
        timeout_seconds   = 3
        period_seconds    = 5
        success_threshold = 1
        failure_threshold = 3
        http_get {
          path = "/healthz"
          port = 3000
        }
      }

      dynamic "env" {
        for_each = {
          DATABASE_URL                = "database-url"
          SPUR_GOOGLE_CLIENT_SECRET   = "google-client-secret"
          SPUR_GITHUB_APP_PRIVATE_KEY = "github-app-private-key"
        }
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.runtime[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      env {
        name  = "SPUR_AUTH"
        value = "google"
      }
      env {
        name  = "SPUR_GOOGLE_CLIENT_ID"
        value = var.google_client_id
      }
      env {
        name  = "SPUR_GITHUB_APP_ID"
        value = var.github_app_id
      }
      env {
        name  = "SPUR_CODE_SEARCH"
        value = "off"
      }
      env {
        name  = "SPUR_APPLICATION_NAME"
        value = var.application_name
      }
      env {
        name  = "SPUR_APPLICATION_ALIASES"
        value = var.application_aliases
      }
      env {
        name  = "SPUR_SECURITY_CONTACT"
        value = var.security_contact
      }
      env {
        name  = "SPUR_PUBLIC_URL"
        value = local.public_url
      }
      env {
        name  = "SPUR_MCP_REDIRECT_HOSTS"
        value = var.mcp_redirect_hosts
      }
      env {
        name  = "SPUR_ORGANIZATION_SLUG"
        value = var.organization_slug
      }
      env {
        name  = "SPUR_ORGANIZATION_NAME"
        value = var.organization_name
      }
      env {
        name  = "SPUR_BOOTSTRAP_ADMINS"
        value = var.bootstrap_admins
      }
      env {
        name  = "SPUR_BOOTSTRAP_SECURITY_OWNERS"
        value = var.bootstrap_security_owners
      }
      env {
        name  = "SPUR_ALLOWED_DOMAINS"
        value = var.allowed_domains
      }
      env {
        name  = "SPUR_SOURCE_PROVIDER"
        value = "github"
      }
      env {
        name  = "SPUR_GITHUB_OWNER"
        value = var.github_owner
      }
      env {
        name  = "SPUR_GITHUB_REPOSITORY"
        value = var.github_repository
      }
      env {
        name  = "SPUR_SYNTHESIS_PROVIDER"
        value = "none"
      }
    }

    vpc_access {
      network_interfaces {
        network    = google_compute_network.spur.name
        subnetwork = google_compute_subnetwork.run.name
      }
      egress = "PRIVATE_RANGES_ONLY"
    }
  }

  depends_on = [
    google_cloud_run_v2_job.migrate,
    google_compute_subnetwork_iam_member.cloud_run_network_user,
    google_secret_manager_secret_iam_member.runtime_access,
  ]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  project  = var.project_id
  location = google_cloud_run_v2_service.spur.location
  name     = google_cloud_run_v2_service.spur.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# One-off upload of an existing Spur database for gcloud sql import. Objects
# are deleted after seven days.
resource "google_storage_bucket" "import" {
  name                        = "${var.project_id}-${var.service_name}-import"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = true

  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_storage_bucket_iam_member" "sql_import" {
  bucket = google_storage_bucket.import.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_sql_database_instance.spur.service_account_email_address}"
}

# Lets the Cloud Build trigger deploy Spur. Granted on Spur's own service, job
# and runtime account only, never project-wide.
resource "google_cloud_run_v2_service_iam_member" "cloudbuild_deploy" {
  count    = var.cloudbuild_service_account == "" ? 0 : 1
  location = google_cloud_run_v2_service.spur.location
  name     = google_cloud_run_v2_service.spur.name
  role     = "roles/run.developer"
  member   = "serviceAccount:${var.cloudbuild_service_account}"
}

resource "google_cloud_run_v2_job_iam_member" "cloudbuild_migrate" {
  count    = var.cloudbuild_service_account == "" ? 0 : 1
  location = google_cloud_run_v2_job.migrate.location
  name     = google_cloud_run_v2_job.migrate.name
  role     = "roles/run.developer"
  member   = "serviceAccount:${var.cloudbuild_service_account}"
}

resource "google_service_account_iam_member" "cloudbuild_act_as_runtime" {
  count              = var.cloudbuild_service_account == "" ? 0 : 1
  service_account_id = google_service_account.spur.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${var.cloudbuild_service_account}"
}
