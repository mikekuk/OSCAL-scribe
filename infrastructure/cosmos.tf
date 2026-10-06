resource "azurerm_cosmosdb_account" "main" {
  name                          = local.name
  location                      = data.azurerm_resource_group.main.location
  resource_group_name           = data.azurerm_resource_group.main.name
  offer_type                    = "Standard"
  kind                          = "GlobalDocumentDB"
  local_authentication_enabled  = false
  public_network_access_enabled = !var.private_data
  minimal_tls_version           = "Tls12"
  backup {
    type = "Continuous"
    tier = var.backup_retention_days == 30 ? "Continuous30Days" : "Continuous7Days"
  }
  capabilities { name = "EnableServerless" }
  consistency_policy { consistency_level = "Session" }
  geo_location {
    location          = data.azurerm_resource_group.main.location
    failover_priority = 0
  }
}
resource "azurerm_cosmosdb_sql_database" "main" {
  name                = "scribe"
  resource_group_name = data.azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
}
resource "azurerm_cosmosdb_sql_container" "ssps" {
  name                = "ssps"
  resource_group_name = data.azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  database_name       = azurerm_cosmosdb_sql_database.main.name
  partition_key_paths = ["/sspId"]
  indexing_policy {
    indexing_mode = "consistent"
    included_path { path = "/*" }
    # Index only the plan title within the otherwise excluded OSCAL document.
    included_path { path = "/oscal/\"system-security-plan\"/metadata/title/?" }
    excluded_path { path = "/oscal/*" }
  }
}
resource "azurerm_cosmosdb_sql_container" "content" {
  name                = "content"
  resource_group_name = data.azurerm_resource_group.main.name
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
  resource_group_name = data.azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  role_definition_id  = "${azurerm_cosmosdb_account.main.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = azurerm_linux_function_app.api.identity[0].principal_id
  scope               = "${azurerm_cosmosdb_account.main.id}/dbs/scribe/colls/ssps"
}
resource "azurerm_cosmosdb_sql_role_assignment" "content_reader" {
  # Published releases are read-only to the application; staging and audits are separate.
  depends_on          = [azurerm_cosmosdb_sql_container.content]
  resource_group_name = data.azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  role_definition_id  = "${azurerm_cosmosdb_account.main.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000001"
  principal_id        = azurerm_linux_function_app.api.identity[0].principal_id
  scope               = "${azurerm_cosmosdb_account.main.id}/dbs/scribe/colls/content"
}
resource "azurerm_cosmosdb_sql_role_assignment" "publisher" {
  depends_on          = [azurerm_cosmosdb_sql_container.content]
  resource_group_name = data.azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  role_definition_id  = "${azurerm_cosmosdb_account.main.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = var.publisher_object_id
  scope               = "${azurerm_cosmosdb_account.main.id}/dbs/scribe/colls/content"
}

resource "azurerm_cosmosdb_sql_container" "staging" {
  name                = "staging"
  resource_group_name = data.azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  database_name       = azurerm_cosmosdb_sql_database.main.name
  partition_key_paths = ["/releaseId"]
  indexing_policy {
    indexing_mode = "consistent"
    included_path { path = "/*" }
    excluded_path { path = "/data/?" }
  }
}
resource "azurerm_cosmosdb_sql_container" "audit" {
  name                = "audit"
  resource_group_name = data.azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  database_name       = azurerm_cosmosdb_sql_database.main.name
  partition_key_paths = ["/releaseId"]
}
resource "azurerm_cosmosdb_sql_role_assignment" "staging" {
  depends_on          = [azurerm_cosmosdb_sql_container.staging]
  resource_group_name = data.azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  role_definition_id  = "${azurerm_cosmosdb_account.main.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002"
  principal_id        = azurerm_linux_function_app.api.identity[0].principal_id
  scope               = "${azurerm_cosmosdb_account.main.id}/dbs/scribe/colls/staging"
}
resource "azurerm_cosmosdb_sql_role_definition" "audit_writer" {
  name                = "${local.name}-audit-create-only"
  resource_group_name = data.azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  type                = "CustomRole"
  assignable_scopes   = [azurerm_cosmosdb_account.main.id]
  permissions {
    data_actions = ["Microsoft.DocumentDB/databaseAccounts/readMetadata", "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/items/create"]
  }
}
resource "azurerm_cosmosdb_sql_role_assignment" "audit_writer" {
  depends_on          = [azurerm_cosmosdb_sql_container.audit]
  resource_group_name = data.azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  role_definition_id  = azurerm_cosmosdb_sql_role_definition.audit_writer.id
  principal_id        = azurerm_linux_function_app.api.identity[0].principal_id
  scope               = "${azurerm_cosmosdb_account.main.id}/dbs/scribe/colls/audit"
}
resource "azurerm_management_lock" "cosmos" {
  count      = var.protect_data ? 1 : 0
  name       = "protect-scribe-data"
  scope      = azurerm_cosmosdb_account.main.id
  lock_level = "CanNotDelete"
  notes      = "Remove only through reviewed Terraform change after testing backups. A lock does not protect individual data items."
}
resource "azurerm_role_assignment" "publisher_discovery" {
  scope                = data.azurerm_resource_group.main.id
  role_definition_name = "Reader"
  principal_id         = var.publisher_object_id
}
