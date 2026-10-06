resource "azurerm_storage_account" "functions" {
  name                            = "scribefn${random_string.suffix.result}"
  resource_group_name             = data.azurerm_resource_group.main.name
  location                        = data.azurerm_resource_group.main.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  allow_nested_items_to_be_public = false
  shared_access_key_enabled       = false
  public_network_access_enabled   = !var.private_data
  network_rules {
    default_action = var.private_data ? "Deny" : "Allow"
    bypass         = ["None"]
  }
}
resource "azurerm_service_plan" "api" {
  name                = local.name
  resource_group_name = data.azurerm_resource_group.main.name
  location            = data.azurerm_resource_group.main.location
  os_type             = "Linux"
  sku_name            = var.function_sku
}
resource "azurerm_linux_function_app" "api" {
  name                          = local.name
  resource_group_name           = data.azurerm_resource_group.main.name
  location                      = data.azurerm_resource_group.main.location
  service_plan_id               = azurerm_service_plan.api.id
  storage_account_name          = azurerm_storage_account.functions.name
  storage_uses_managed_identity = true
  # Managed-identity storage uses accountName settings and does not create an Azure Files share.
  virtual_network_subnet_id                      = var.private_data ? azurerm_subnet.functions[0].id : null
  ftp_publish_basic_authentication_enabled       = false
  webdeploy_publish_basic_authentication_enabled = false
  https_only                                     = true
  functions_extension_version                    = "~4"
  identity { type = "SystemAssigned" }
  site_config {
    vnet_route_all_enabled = var.private_data
    always_on              = var.function_sku == "EP1"
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
    FUNCTIONS_REQUEST_BODY_SIZE_LIMIT            = "20001000"
    SCRIBE_ALLOW_RAW_BROWSER                     = tostring(var.allow_raw_browser)
    SCRIBE_ALLOW_PERMANENT_DELETE                = tostring(var.allow_permanent_delete)
    SCRIBE_REQUESTS_PER_MINUTE                   = tostring(var.requests_per_minute)
    SCRIBE_EXPENSIVE_REQUESTS_PER_MINUTE         = tostring(var.expensive_requests_per_minute)
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
  depends_on           = [azurerm_storage_container.packages]
  scope                = "${azurerm_storage_account.packages.id}/blobServices/default/containers/packages"
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = var.deployment_object_id
}

# Host storage and executable packages must never share a writable runtime boundary.
resource "azurerm_storage_account" "packages" {
  name                            = "scribepkg${random_string.suffix.result}"
  resource_group_name             = data.azurerm_resource_group.main.name
  location                        = data.azurerm_resource_group.main.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  min_tls_version                 = "TLS1_2"
  shared_access_key_enabled       = false
  allow_nested_items_to_be_public = false
  public_network_access_enabled   = !var.private_data
  network_rules {
    default_action = var.private_data ? "Deny" : "Allow"
    bypass         = ["None"]
  }
  blob_properties {
    versioning_enabled = true
    delete_retention_policy { days = 30 }
    container_delete_retention_policy { days = 30 }
  }
}
resource "azurerm_storage_container" "packages" {
  name                  = "packages"
  storage_account_id    = azurerm_storage_account.packages.id
  container_access_type = "private"
}
resource "azurerm_role_assignment" "package_reader" {
  depends_on           = [azurerm_storage_container.packages]
  scope                = "${azurerm_storage_account.packages.id}/blobServices/default/containers/packages"
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = azurerm_linux_function_app.api.identity[0].principal_id
}
# Routine code deployment has no Entra ownership or role-assignment permission.
resource "azurerm_role_definition" "deployer" {
  name              = "${local.name}-code-deployer"
  scope             = data.azurerm_resource_group.main.id
  assignable_scopes = [data.azurerm_resource_group.main.id]
  permissions {
    actions = ["Microsoft.Resources/subscriptions/resourceGroups/read", "Microsoft.Web/sites/read", "Microsoft.Web/sites/config/read", "Microsoft.Web/sites/config/write", "Microsoft.Web/sites/restart/action", "Microsoft.Web/sites/syncfunctiontriggers/action", "Microsoft.Web/staticSites/read", "Microsoft.Web/staticSites/listSecrets/action"]
  }
}
resource "azurerm_role_assignment" "code_deployer" {
  scope              = data.azurerm_resource_group.main.id
  role_definition_id = azurerm_role_definition.deployer.role_definition_resource_id
  principal_id       = var.deployment_object_id
}
