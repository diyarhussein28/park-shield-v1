variable "environment" {
  description = "staging or production"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "location" {
  description = "Hetzner location (Germany only: nbg1 or fsn1)"
  type        = string
  default     = "nbg1"
  validation {
    condition     = contains(["nbg1", "fsn1"], var.location)
    error_message = "Data must stay in Germany: use nbg1 or fsn1."
  }
}

variable "hcloud_token" {
  type      = string
  sensitive = true
}

variable "s3_access_key" {
  type      = string
  sensitive = true
}

variable "s3_secret_key" {
  type      = string
  sensitive = true
}

variable "ssh_public_keys" {
  description = "Admin SSH public keys (key login only, reachable via WireGuard)"
  type        = map(string)
}

variable "image" {
  type    = string
  default = "ubuntu-24.04"
}

variable "app_count" {
  description = "Web + public API servers behind the load balancer"
  type        = number
  default     = 2
}

variable "server_types" {
  type = object({
    app    = string
    worker = string
    db     = string
    tools  = string
  })
  default = {
    app    = "cx32"
    worker = "cx22"
    db     = "cx32"
    tools  = "cx32"
  }
}

variable "db_volume_gb" {
  type    = number
  default = 50
}

variable "backup_retention_days" {
  description = "pgBackRest + object lifecycle; deleted data leaves backups within this window (04-legal §5)"
  type        = number
  default     = 35
}

variable "audit_retention_days" {
  description = "Object Lock (COMPLIANCE) retention of the audit log stream (AD-17)"
  type        = number
  default     = 365
}
