terraform {
  required_version = ">= 1.9"

  required_providers {
    hcloud = {
      source  = "hetznercloud/hcloud"
      version = "~> 1.52"
    }
    # Hetzner Object Storage is S3-compatible; buckets, Object Lock and lifecycle are managed via the MinIO provider.
    minio = {
      source  = "aminueza/minio"
      version = "~> 3.3"
    }
  }

  # State in Hetzner Object Storage. Configure with: terraform init -backend-config=backend.hcl
  backend "s3" {}
}

provider "hcloud" {
  token = var.hcloud_token
}

provider "minio" {
  minio_server   = "${var.location}.your-objectstorage.com"
  minio_user     = var.s3_access_key
  minio_password = var.s3_secret_key
  minio_region   = var.location
  minio_ssl      = true
}
