terraform {
  required_version = ">= 1.7.0"

  # State holds the generated database password. Keep it in a private,
  # versioned bucket: terraform init -backend-config="bucket=BUCKET".
  backend "gcs" {
    prefix = "spur"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 7.0.0, < 8.0.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.6.0, < 4.0.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
