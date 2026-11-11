locals {
  production = var.environment == "production"
  prefix     = local.production ? "" : "[${var.environment}] "
  # 01-requirements §8: 99.9 % scanner path, 99.5 % portal. Production checks every 30 s from the EU.
  frequency = local.production ? 30 : 180
  regions   = ["eu"]
}

# --- Escalation (docs/runbooks/on-call.md) ---------------------------------------------------
resource "betteruptime_policy" "on_call" {
  name         = "${local.prefix}ParkShield on-call"
  repeat_count = 3
  repeat_delay = 300

  # 1. whoever is on call right now (push + call), 2. after 10 min everyone on the list.
  steps {
    type        = "escalation"
    wait_before = 0
    step_members { type = "current_on_call" }
  }
  steps {
    type        = "escalation"
    wait_before = 600
    step_members { type = "all_team_members" }
  }
}

# --- Monitors ---------------------------------------------------------------------------------
# The scanner path end to end: the HTML page of a real (status-check) decal, which itself calls the
# API and the database. Keyword check, so an error page with HTTP 200 still counts as down.
resource "betteruptime_monitor" "scanner_page" {
  pronounceable_name  = "${local.prefix}Scanner page"
  url                 = "https://${var.domain_scanner}/s/${var.canary_code}"
  monitor_type        = "keyword"
  required_keyword    = "ParkShield"
  check_frequency     = local.frequency
  request_timeout     = 10
  confirmation_period = 60
  regions             = local.regions
  policy_id           = betteruptime_policy.on_call.id
  call                = local.production
  push                = true
  email               = true
}

resource "betteruptime_monitor" "api_ready" {
  pronounceable_name    = "${local.prefix}API (database and Valkey)"
  url                   = "https://${var.domain_scanner}/v1/ready"
  monitor_type          = "expected_status_code"
  expected_status_codes = [200]
  check_frequency       = local.frequency
  request_timeout       = 10
  confirmation_period   = 60
  regions               = local.regions
  policy_id             = betteruptime_policy.on_call.id
  call                  = local.production
  push                  = true
  email                 = true
}

resource "betteruptime_monitor" "portal" {
  pronounceable_name  = "${local.prefix}Website and owner portal"
  url                 = "https://${var.domain_web}/anmelden"
  monitor_type        = "keyword"
  required_keyword    = "ParkShield"
  check_frequency     = local.frequency
  request_timeout     = 15
  confirmation_period = 120
  regions             = local.regions
  policy_id           = betteruptime_policy.on_call.id
  push                = true
  email               = true
}

resource "betteruptime_monitor" "tls" {
  pronounceable_name = "${local.prefix}TLS certificate"
  url                = "https://${var.domain_web}"
  monitor_type       = "status"
  check_frequency    = 3600
  ssl_expiration     = 14
  domain_expiration  = 30
  regions            = local.regions
  policy_id          = betteruptime_policy.on_call.id
  email              = true
}

# The worker sends alerts; nothing on the internet can probe it, so it reports in every minute
# (HEARTBEAT_URL_WORKER). A missing beat means alerts are queuing up.
resource "betteruptime_heartbeat" "worker" {
  name      = "${local.prefix}Alert worker"
  period    = 60
  grace     = 120
  policy_id = betteruptime_policy.on_call.id
  call      = local.production
  push      = true
  email     = true
}

# --- Public status page (production only) -----------------------------------------------------
resource "betteruptime_status_page" "public" {
  count                    = local.production ? 1 : 0
  company_name             = "ParkShield"
  company_url              = "https://${var.domain_web}"
  contact_url              = "https://${var.domain_web}/hilfe/kontakt"
  subdomain                = var.status_page_subdomain
  custom_domain            = "status.${var.domain_web}"
  timezone                 = "Berlin"
  announcement             = ""
  hide_from_search_engines = false
}

resource "betteruptime_status_page_section" "alerts" {
  count          = local.production ? 1 : 0
  status_page_id = betteruptime_status_page.public[0].id
  name           = "Warnungen / Alerts"
  position       = 0
}

resource "betteruptime_status_page_section" "account" {
  count          = local.production ? 1 : 0
  status_page_id = betteruptime_status_page.public[0].id
  name           = "Konto und Website / Account and website"
  position       = 1
}

resource "betteruptime_status_page_resource" "scanner" {
  count                  = local.production ? 1 : 0
  status_page_id         = betteruptime_status_page.public[0].id
  status_page_section_id = betteruptime_status_page_section.alerts[0].id
  resource_id            = betteruptime_monitor.scanner_page.id
  resource_type          = "Monitor"
  public_name            = "Scan-Seite / Scanner page"
  position               = 0
}

resource "betteruptime_status_page_resource" "delivery" {
  count                  = local.production ? 1 : 0
  status_page_id         = betteruptime_status_page.public[0].id
  status_page_section_id = betteruptime_status_page_section.alerts[0].id
  resource_id            = betteruptime_heartbeat.worker.id
  resource_type          = "Heartbeat"
  public_name            = "Zustellung der Warnungen / Alert delivery"
  position               = 1
}

resource "betteruptime_status_page_resource" "portal" {
  count                  = local.production ? 1 : 0
  status_page_id         = betteruptime_status_page.public[0].id
  status_page_section_id = betteruptime_status_page_section.account[0].id
  resource_id            = betteruptime_monitor.portal.id
  resource_type          = "Monitor"
  public_name            = "Website und Kundenkonto / Website and account"
  position               = 0
}
