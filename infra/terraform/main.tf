locals {
  name   = "ps-${var.environment}"
  labels = { project = "parkshield", environment = var.environment }
}

resource "hcloud_ssh_key" "admin" {
  for_each   = var.ssh_public_keys
  name       = "${local.name}-${each.key}"
  public_key = each.value
}

# --- Network ---------------------------------------------------------------
resource "hcloud_network" "main" {
  name     = local.name
  ip_range = "10.10.0.0/16"
  labels   = local.labels
}

resource "hcloud_network_subnet" "servers" {
  network_id   = hcloud_network.main.id
  type         = "cloud"
  network_zone = "eu-central"
  ip_range     = "10.10.1.0/24"
}

resource "hcloud_placement_group" "spread" {
  name   = local.name
  type   = "spread"
  labels = local.labels
}

# --- Firewalls (public interface only; private network traffic is unaffected) --
# Nothing is publicly reachable on the servers. The LB reaches Caddy over the private network,
# admins reach SSH and the ops app only through WireGuard on the tools server.
resource "hcloud_firewall" "closed" {
  name   = "${local.name}-closed"
  labels = local.labels
}

resource "hcloud_firewall" "wireguard" {
  name   = "${local.name}-wireguard"
  labels = local.labels
  rule {
    direction  = "in"
    protocol   = "udp"
    port       = "51820"
    source_ips = ["0.0.0.0/0", "::/0"]
  }
}

# --- Servers ---------------------------------------------------------------
resource "hcloud_server" "app" {
  count              = var.app_count
  name               = "${local.name}-app-${count.index + 1}"
  server_type        = var.server_types.app
  image              = var.image
  location           = var.location
  placement_group_id = hcloud_placement_group.spread.id
  ssh_keys           = [for k in hcloud_ssh_key.admin : k.id]
  firewall_ids       = [hcloud_firewall.closed.id]
  labels             = merge(local.labels, { role = "app" })
  user_data          = file("${path.module}/cloud-init.yaml")
  network {
    network_id = hcloud_network.main.id
  }
  depends_on = [hcloud_network_subnet.servers]
}

resource "hcloud_server" "worker" {
  name         = "${local.name}-worker-1"
  server_type  = var.server_types.worker
  image        = var.image
  location     = var.location
  ssh_keys     = [for k in hcloud_ssh_key.admin : k.id]
  firewall_ids = [hcloud_firewall.closed.id]
  labels       = merge(local.labels, { role = "worker" })
  user_data    = file("${path.module}/cloud-init.yaml")
  network {
    network_id = hcloud_network.main.id
  }
  depends_on = [hcloud_network_subnet.servers]
}

resource "hcloud_server" "db" {
  for_each           = toset(["primary", "replica"])
  name               = "${local.name}-db-${each.key}"
  server_type        = var.server_types.db
  image              = var.image
  location           = var.location
  placement_group_id = hcloud_placement_group.spread.id
  ssh_keys           = [for k in hcloud_ssh_key.admin : k.id]
  firewall_ids       = [hcloud_firewall.closed.id]
  labels             = merge(local.labels, { role = "db", db_role = each.key })
  user_data          = file("${path.module}/cloud-init.yaml")
  network {
    network_id = hcloud_network.main.id
  }
  depends_on = [hcloud_network_subnet.servers]
}

resource "hcloud_volume" "db" {
  for_each  = hcloud_server.db
  name      = "${each.value.name}-data"
  size      = var.db_volume_gb
  server_id = each.value.id
  format    = "ext4"
  automount = false # mounted by Ansible on top of LUKS (disk encryption layer, 02-architecture §5)
  labels    = local.labels
}

# Tools: WireGuard gateway, api-ops + ops app, Metabase, Unleash, Zammad, Grafana/Prometheus/Loki.
resource "hcloud_server" "tools" {
  name         = "${local.name}-tools-1"
  server_type  = var.server_types.tools
  image        = var.image
  location     = var.location
  ssh_keys     = [for k in hcloud_ssh_key.admin : k.id]
  firewall_ids = [hcloud_firewall.wireguard.id]
  labels       = merge(local.labels, { role = "tools" })
  user_data    = file("${path.module}/cloud-init.yaml")
  network {
    network_id = hcloud_network.main.id
  }
  depends_on = [hcloud_network_subnet.servers]
}

# --- Load balancer: TCP passthrough to Caddy, which terminates TLS 1.3 -------
resource "hcloud_load_balancer" "web" {
  name               = local.name
  load_balancer_type = "lb11"
  location           = var.location
  labels             = local.labels
}

resource "hcloud_load_balancer_network" "web" {
  load_balancer_id = hcloud_load_balancer.web.id
  network_id       = hcloud_network.main.id
}

resource "hcloud_load_balancer_target" "app" {
  type             = "label_selector"
  load_balancer_id = hcloud_load_balancer.web.id
  label_selector   = "project=parkshield,environment=${var.environment},role=app"
  use_private_ip   = true
  depends_on       = [hcloud_load_balancer_network.web]
}

resource "hcloud_load_balancer_service" "https" {
  load_balancer_id = hcloud_load_balancer.web.id
  protocol         = "tcp"
  listen_port      = 443
  destination_port = 443
  proxyprotocol    = true
  health_check {
    protocol = "tcp"
    port     = 443
    interval = 10
    timeout  = 5
    retries  = 3
  }
}

resource "hcloud_load_balancer_service" "http_redirect" {
  load_balancer_id = hcloud_load_balancer.web.id
  protocol         = "tcp"
  listen_port      = 80
  destination_port = 80
  proxyprotocol    = true
}
