variable "subscription_id" { type = string }
variable "tenant_id" { type = string }
variable "web_location" {
  type    = string
  default = "westus2"
}
variable "prefix" {
  type    = string
  default = "oscal-scribe"
}
variable "security_user_ids" {
  type    = set(string)
  default = []
}
variable "user_ids" {
  type    = set(string)
  default = []
}
variable "publisher_object_id" {
  type        = string
  description = "Controlled-content pipeline identity, or personal signed-in object ID for the test bed."
}
variable "budget_email" {
  type    = string
  default = ""
}
variable "monthly_budget" {
  description = "Monthly alert budget in the subscription billing currency, not necessarily USD."
  type        = number
  default     = 50
}
variable "budget_start" {
  type    = string
  default = "2026-10-01T00:00:00Z"
}

variable "resource_group_name" {
  type        = string
  description = "Existing administrator-owned application resource group."
}
variable "environment" { type = string }
variable "owner_object_ids" {
  type        = set(string)
  description = "Explicit human and pipeline service-principal owners."
}
variable "deployment_object_id" {
  type        = string
  description = "Application package deployment identity, independent of content publisher."
}

variable "app_admin_user_ids" {
  type        = set(string)
  default     = []
  description = "Target-tenant user object IDs assigned the separate, destructive App Admin application role."
}

variable "allow_localhost_redirect" { type = bool }

variable "allow_raw_browser" { type = bool }

variable "allow_permanent_delete" { type = bool }

variable "private_data" { type = bool }

variable "protect_data" { type = bool }

variable "function_sku" { type = string }

variable "requests_per_minute" { type = number }

variable "expensive_requests_per_minute" { type = number }

variable "log_retention_days" { type = number }

variable "log_daily_cap_gb" { type = number }

variable "backup_retention_days" { type = number }

resource "terraform_data" "security_policy" {
  input = var.environment
  lifecycle {
    precondition {
      condition     = contains(["test", "dev", "prod"], var.environment) && (!var.private_data || var.function_sku == "EP1")
      error_message = "Invalid environment or private-data hosting plan."
    }
    precondition {
      condition     = var.environment == "test" || (var.private_data && !var.allow_localhost_redirect && (var.protect_data || var.allow_destroy) && var.deployment_object_id != var.publisher_object_id && !contains(var.owner_object_ids, var.deployment_object_id) && !contains(var.owner_object_ids, var.publisher_object_id))
      error_message = "Work environments require isolated identities, private data, protection and HTTPS-only redirects."
    }
    precondition {
      condition     = var.environment != "prod" || (var.protect_data && !var.allow_destroy && !var.allow_raw_browser && !var.allow_permanent_delete && var.backup_retention_days == 30 && var.log_retention_days >= 90)
      error_message = "Production security minimums are not satisfied."
    }
  }
}

variable "allow_destroy" { type = bool }

variable "vnet_cidr" {
  type = string
  validation {
    condition     = can(cidrhost(var.vnet_cidr, 0)) && endswith(var.vnet_cidr, "/16")
    error_message = "Supply a company-approved IPv4 /16 network."
  }
}
