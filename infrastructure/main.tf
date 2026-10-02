terraform {
  required_version = ">= 1.5.0"
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
data "azurerm_client_config" "current" {}
resource "random_string" "suffix" {
  length  = 6
  special = false
  upper   = false
}
locals { name = "${var.prefix}-${random_string.suffix.result}" }
resource "azurerm_resource_group" "main" {
  name     = "rg-${var.prefix}-test"
  location = var.location
  tags     = { application = "OSCAL Scribe", environment = "test", owner = "personal" }
}
