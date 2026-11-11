variable "environment" {
  description = "staging or production"
  type        = string
  validation {
    condition     = contains(["staging", "production"], var.environment)
    error_message = "environment must be staging or production."
  }
}

variable "betterstack_api_token" {
  description = "Better Stack Uptime API token (team scope)"
  type        = string
  sensitive   = true
}

variable "domain_web" {
  description = "Public website and owner portal, e.g. parkshield.de"
  type        = string
}

variable "domain_scanner" {
  description = "Host the decal QR codes point to, e.g. s.parkshield.de"
  type        = string
}

variable "canary_code" {
  description = "Decal code of the internal status-check vehicle (paid test account, never shown to anyone)"
  type        = string
  sensitive   = true
}

variable "status_page_subdomain" {
  description = "Better Stack subdomain; the custom domain status.<domain_web> points to it"
  type        = string
  default     = "parkshield"
}
