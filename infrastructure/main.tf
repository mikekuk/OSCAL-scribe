terraform {
  required_version = "~> 1.11.0"
  required_providers {
    azurerm = { source = "hashicorp/azurerm", version = "~> 4.0" }
    azuread = { source = "hashicorp/azuread", version = "~> 3.0" }
    random  = { source = "hashicorp/random", version = "~> 3.6" }
  }
}
provider "azurerm" {
  features {}
  resource_provider_registrations = "none"
  subscription_id                 = var.subscription_id
  tenant_id                       = var.tenant_id
}
provider "azuread" { tenant_id = var.tenant_id }
resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}
locals { name = "${var.prefix}-${random_string.suffix.result}" }
# Administrator-owned scope: the pipeline needs no subscription-wide create permission.
data "azurerm_resource_group" "main" {
  name = var.resource_group_name
}
