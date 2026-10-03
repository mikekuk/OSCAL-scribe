resource "azurerm_storage_account" "functions" {
  name                            = "scribefn${random_string.suffix.result}"
  resource_group_name             = data.azurerm_resource_group.main.name
  location                        = data.azurerm_resource_group.main.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
}
resource "azurerm_service_plan" "api" {
  name                = local.name
  resource_group_name = data.azurerm_resource_group.main.name
  location            = data.azurerm_resource_group.main.location
  os_type             = "Linux"
  sku_name            = "Y1"
}
resource "azurerm_linux_function_app" "api" {
  name                          = local.name
  resource_group_name           = data.azurerm_resource_group.main.name
  location                      = data.azurerm_resource_group.main.location
  service_plan_id               = azurerm_service_plan.api.id
  storage_account_name          = azurerm_storage_account.functions.name
  storage_uses_managed_identity = true
  # Managed-identity storage uses accountName settings and does not create an Azure Files share.
  https_only                  = true
  functions_extension_version = "~4"
  identity { type = "SystemAssigned" }
  site_config {
    application_stack { node_version = "22" }
    application_insights_connection_string = azurerm_application_insights.main.connection_string
    application_insights_key               = azurerm_application_insights.main.instrumentation_key
    ftps_state                             = "Disabled"
    minimum_tls_version                    = "1.2"
    app_scale_limit                        = 2
  }
  app_settings = {
    ENTRA_TENANT_ID                              = var.tenant_id
    ENTRA_CLIENT_ID                              = azuread_application.scribe.client_id
    COSMOS_ENDPOINT                              = azurerm_cosmosdb_account.main.endpoint
    COSMOS_DATABASE                              = azurerm_cosmosdb_sql_database.main.name
    AzureWebJobsStorage__credential              = "managedidentity"
    WEBSITE_RUN_FROM_PACKAGE_BLOB_MI_RESOURCE_ID = "SystemAssigned"
    FUNCTIONS_REQUEST_BODY_SIZE_LIMIT            = "1000000"
  }
  lifecycle {
    ignore_changes = [auth_settings_v2, app_settings["WEBSITE_RUN_FROM_PACKAGE"], tags["hidden-link: /app-insights-resource-id"]]
  }
}
resource "azurerm_role_assignment" "runtime_storage" {
  for_each             = toset(["Storage Blob Data Owner", "Storage Queue Data Contributor", "Storage Account Contributor"])
  scope                = azurerm_storage_account.functions.id
  role_definition_name = each.value
  principal_id         = azurerm_linux_function_app.api.identity[0].principal_id
}
resource "azurerm_role_assignment" "package_deployer" {
  scope                = azurerm_storage_account.functions.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = var.deployment_object_id
}
