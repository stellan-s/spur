output "service_url" {
  description = "Public Spur URL. Register service_url/api/auth/google/callback in the Google OAuth client."
  value       = local.public_url
}

output "migration_job_name" {
  description = "Cloud Run job to execute before sending traffic to a new schema version."
  value       = google_cloud_run_v2_job.migrate.name
}

output "database_instance" {
  description = "Cloud SQL instance name used by gcloud backup and restore commands."
  value       = google_sql_database_instance.spur.name
}

output "database_connection_name" {
  description = "Cloud SQL project, region and instance connection name."
  value       = google_sql_database_instance.spur.connection_name
}

output "database_private_ip" {
  description = "Cloud SQL private address."
  value       = google_sql_database_instance.spur.private_ip_address
  sensitive   = true
}

output "image_repository" {
  description = "Artifact Registry path to push the Spur image to."
  value       = local.image_repository
}

output "import_bucket" {
  description = "Private bucket for a one-off database import."
  value       = google_storage_bucket.import.name
}
