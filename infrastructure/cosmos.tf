resource "azurerm_cosmosdb_account" "main" {
  name                         = local.name
  location                     = azurerm_resource_group.main.location
  resource_group_name          = azurerm_resource_group.main.name
  offer_type                   = "Standard"
  kind                         = "GlobalDocumentDB"
  local_authentication_enabled = false
  capabilities { name = "EnableServerless" }
  consistency_policy { consistency_level = "Session" }
  geo_location {
    location          = azurerm_resource_group.main.location
    failover_priority = 0
  }
}
resource "azurerm_cosmosdb_sql_database" "main" {
  name                = "scribe"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
}
resource "azurerm_cosmosdb_sql_container" "ssps" {
  name                = "ssps"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  database_name       = azurerm_cosmosdb_sql_database.main.name
  partition_key_paths = ["/sspId"]
  indexing_policy {
    indexing_mode = "consistent"
    included_path { path = "/*" }
    excluded_path { path = "/oscal/*" }
  }
}
resource "azurerm_cosmosdb_sql_container" "content" {
  name                = "content"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  database_name       = azurerm_cosmosdb_sql_database.main.name
  partition_key_paths = ["/releaseId"]
  indexing_policy {
    indexing_mode = "consistent"
    included_path { path = "/*" }
    excluded_path { path = "/data/?" }
  }
}
resource "azurerm_cosmosdb_sql_role_assignment" "ssp" {
  depends_on          = [azurerm_cosmosdb_sql_container.ssps]
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  role_definition_id  = "${azurerm_cosmosdb_account.main.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = azurerm_linux_function_app.api.identity[0].principal_id
  scope               = "${azurerm_cosmosdb_account.main.id}/dbs/scribe/colls/ssps"
}
resource "azurerm_cosmosdb_sql_role_assignment" "content_reader" {
  depends_on          = [azurerm_cosmosdb_sql_container.content]
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  role_definition_id  = "${azurerm_cosmosdb_account.main.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000001"
  principal_id        = azurerm_linux_function_app.api.identity[0].principal_id
  scope               = "${azurerm_cosmosdb_account.main.id}/dbs/scribe/colls/content"
}
resource "azurerm_cosmosdb_sql_role_assignment" "publisher" {
  depends_on          = [azurerm_cosmosdb_sql_container.content]
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  role_definition_id  = "${azurerm_cosmosdb_account.main.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = var.publisher_object_id
  scope               = "${azurerm_cosmosdb_account.main.id}/dbs/scribe/colls/content"
}
