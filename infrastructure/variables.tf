variable "subscription_id" { type = string }
variable "tenant_id" { type = string }
variable "location" {
  type    = string
  default = "westus2"
}
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
