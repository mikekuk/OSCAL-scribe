# Public SWA-linked API ingress is retained. Only data/host/package services are private.
# Work deployment agents must join this network (or a peered network with DNS forwarding).
resource "azurerm_virtual_network" "main" {
  count               = var.private_data ? 1 : 0
  name                = "${local.name}-vnet"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = data.azurerm_resource_group.main.location
  address_space       = [var.vnet_cidr]
}
resource "azurerm_subnet" "functions" {
  count                = var.private_data ? 1 : 0
  name                 = "functions"
  resource_group_name  = data.azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main[0].name
  address_prefixes     = [cidrsubnet(var.vnet_cidr, 8, 0)]
  delegation {
    name = "functions"
    service_delegation { name = "Microsoft.Web/serverFarms" }
  }
}
resource "azurerm_subnet" "endpoints" {
  count                = var.private_data ? 1 : 0
  name                 = "private-endpoints"
  resource_group_name  = data.azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main[0].name
  address_prefixes     = [cidrsubnet(var.vnet_cidr, 8, 1)]
}
resource "azurerm_subnet" "agents" {
  count                = var.private_data ? 1 : 0
  name                 = "deployment-agents"
  resource_group_name  = data.azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main[0].name
  address_prefixes     = [cidrsubnet(var.vnet_cidr, 8, 2)]
}
locals {
  private_zones = var.private_data ? toset(["blob.core.windows.net", "queue.core.windows.net", "table.core.windows.net", "documents.azure.com"]) : toset([])
  endpoints = var.private_data ? {
    host_blob  = { resource = azurerm_storage_account.functions.id, group = "blob", zone = "blob.core.windows.net" }
    host_queue = { resource = azurerm_storage_account.functions.id, group = "queue", zone = "queue.core.windows.net" }
    host_table = { resource = azurerm_storage_account.functions.id, group = "table", zone = "table.core.windows.net" }
    packages   = { resource = azurerm_storage_account.packages.id, group = "blob", zone = "blob.core.windows.net" }
    cosmos     = { resource = azurerm_cosmosdb_account.main.id, group = "Sql", zone = "documents.azure.com" }
  } : {}
}
resource "azurerm_private_dns_zone" "data" {
  for_each            = local.private_zones
  name                = "privatelink.${each.key}"
  resource_group_name = data.azurerm_resource_group.main.name
}
resource "azurerm_private_dns_zone_virtual_network_link" "data" {
  for_each              = local.private_zones
  name                  = "scribe"
  resource_group_name   = data.azurerm_resource_group.main.name
  private_dns_zone_name = azurerm_private_dns_zone.data[each.key].name
  virtual_network_id    = azurerm_virtual_network.main[0].id
}
resource "azurerm_private_endpoint" "data" {
  for_each            = local.endpoints
  name                = "${local.name}-${each.key}"
  resource_group_name = data.azurerm_resource_group.main.name
  location            = data.azurerm_resource_group.main.location
  subnet_id           = azurerm_subnet.endpoints[0].id
  private_service_connection {
    name                           = "data"
    private_connection_resource_id = each.value.resource
    subresource_names              = [each.value.group]
    is_manual_connection           = false
  }
  private_dns_zone_group {
    name                 = "default"
    private_dns_zone_ids = [azurerm_private_dns_zone.data[each.value.zone].id]
  }
}
