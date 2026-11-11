output "load_balancer_ipv4" {
  description = "Point pkshd.de and parkshield.de A records here"
  value       = hcloud_load_balancer.web.ipv4
}

output "load_balancer_ipv6" {
  value = hcloud_load_balancer.web.ipv6
}

output "wireguard_endpoint" {
  value = hcloud_server.tools.ipv4_address
}

# Consumed by infra/scripts/inventory.sh to build the Ansible inventory.
output "private_ips" {
  value = {
    app     = [for s in hcloud_server.app : one(s.network[*].ip)]
    worker  = one(hcloud_server.worker.network[*].ip)
    db      = { for k, s in hcloud_server.db : k => one(s.network[*].ip) }
    tools   = one(hcloud_server.tools.network[*].ip)
    volumes = { for k, v in hcloud_volume.db : k => v.linux_device }
  }
}

output "buckets" {
  value = {
    backups = minio_s3_bucket.backups.bucket
    audit   = minio_s3_bucket.audit.bucket
    uploads = minio_s3_bucket.uploads.bucket
  }
}
