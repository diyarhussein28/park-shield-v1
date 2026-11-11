# pgBackRest repository (encrypted client-side with AES-256 by pgBackRest itself).
resource "minio_s3_bucket" "backups" {
  bucket = "${local.name}-backups"
  acl    = "private"
}

resource "minio_ilm_policy" "backups" {
  bucket = minio_s3_bucket.backups.bucket
  rule {
    id         = "expire-after-retention"
    expiration = "${var.backup_retention_days + 1}d"
  }
}

# Audit log stream (AD-17): Object Lock in COMPLIANCE mode, so nobody, including root
# credentials, can delete or overwrite entries before the retention period ends.
resource "minio_s3_bucket" "audit" {
  bucket         = "${local.name}-audit"
  acl            = "private"
  object_locking = true
}

resource "minio_s3_bucket_versioning" "audit" {
  bucket = minio_s3_bucket.audit.bucket
  versioning_configuration {
    status = "Enabled"
  }
}

resource "minio_s3_bucket_retention" "audit" {
  bucket          = minio_s3_bucket.audit.bucket
  mode            = "COMPLIANCE"
  unit            = "DAYS"
  validity_period = var.audit_retention_days
  depends_on      = [minio_s3_bucket_versioning.audit]
}

resource "minio_ilm_policy" "audit" {
  bucket = minio_s3_bucket.audit.bucket
  rule {
    id         = "expire-after-lock"
    expiration = "${var.audit_retention_days + 1}d"
  }
}

# Phase 2 scanner photos (SC-17): deleted after 30 days unless the owner saves them.
resource "minio_s3_bucket" "uploads" {
  bucket = "${local.name}-uploads"
  acl    = "private"
}

resource "minio_ilm_policy" "uploads" {
  bucket = minio_s3_bucket.uploads.bucket
  rule {
    id         = "expire-unsaved-photos"
    expiration = "30d"
    filter     = "scanner-photos/"
  }
}
