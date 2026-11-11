output "worker_heartbeat_url" {
  description = "Put into the worker's environment as HEARTBEAT_URL_WORKER (SOPS app_env)"
  value       = betteruptime_heartbeat.worker.url
  sensitive   = true
}

output "status_page_url" {
  value = local.production ? "https://status.${var.domain_web}" : null
}
