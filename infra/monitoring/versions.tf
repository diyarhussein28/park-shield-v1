terraform {
  required_version = ">= 1.9"

  required_providers {
    # Better Stack Uptime: external monitors, heartbeats, on-call escalation and the public status page.
    betteruptime = {
      source  = "BetterStackHQ/better-uptime"
      version = "~> 0.20"
    }
  }

  # Same state bucket as infra/terraform, separate key. terraform init -backend-config=backend.hcl
  backend "s3" {}
}

provider "betteruptime" {
  api_token = var.betterstack_api_token
}
