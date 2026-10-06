# Provider mocks check graph wiring and profile differences without contacting Azure.
# Supply synthetic dev variables from scripts/ci/security-profile.mjs.
mock_provider "azurerm" {
  mock_data "azurerm_resource_group" {
    defaults = {
      name     = "rg-oscal-scribe-dev"
      location = "westus2"
      id       = "/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/rg-oscal-scribe-dev"
    }
  }
}
mock_provider "azuread" {
  mock_data "azuread_service_principal" {
    defaults = {
      object_id    = "55555555-5555-4555-8555-555555555555"
      app_role_ids = { "User.Read.All" = "44444444-4444-4444-8444-444444444444" }
    }
  }
}
mock_provider "random" {
  mock_resource "random_string" { defaults = { result = "abc123" } }
}
run "work_dev_is_private_and_separated" {
  command = plan
  assert {
    condition     = length(azurerm_private_endpoint.data) == 5 && length(azurerm_private_dns_zone.data) == 4
    error_message = "Work dev needs all host/package/Cosmos private endpoints and DNS zones."
  }
  assert {
    condition     = !azurerm_storage_account.functions.public_network_access_enabled && !azurerm_storage_account.packages.public_network_access_enabled && !azurerm_cosmosdb_account.main.public_network_access_enabled
    error_message = "Work data must not have public networking enabled."
  }
  assert {
    condition     = azurerm_service_plan.api.sku_name == "EP1" && azurerm_linux_function_app.api.site_config[0].vnet_route_all_enabled
    error_message = "Private data needs Premium Functions with outbound VNet routing."
  }
  assert {
    condition     = !azurerm_storage_account.functions.shared_access_key_enabled && !azurerm_storage_account.packages.shared_access_key_enabled && !azurerm_linux_function_app.api.ftp_publish_basic_authentication_enabled && !azurerm_linux_function_app.api.webdeploy_publish_basic_authentication_enabled
    error_message = "Storage keys and publishing basic authentication must stay disabled."
  }
  assert {
    condition     = length(azuread_application.scribe.single_page_application[0].redirect_uris) == 1 && azurerm_linux_function_app.api.app_settings.SCRIBE_ALLOW_RAW_BROWSER == "false" && azurerm_linux_function_app.api.app_settings.SCRIBE_ALLOW_PERMANENT_DELETE == "false"
    error_message = "Work dev must disable localhost redirects and privileged data exploration/deletion."
  }
  assert {
    condition     = azurerm_cosmosdb_sql_container.staging.name == "staging" && azurerm_cosmosdb_sql_container.audit.name == "audit" && azurerm_role_assignment.package_reader.role_definition_name == "Storage Blob Data Reader" && !contains(one(azurerm_cosmosdb_sql_role_definition.audit_writer.permissions).data_actions, "Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers/items/delete")
    error_message = "Staging, published content, audits and executable packages need separate permissions."
  }
}
run "personal_test_preserves_consumption" {
  command = plan
  variables {
    environment              = "test"
    private_data             = false
    function_sku             = "Y1"
    allow_localhost_redirect = true
  }
  assert {
    condition     = length(azurerm_private_endpoint.data) == 0 && length(azurerm_virtual_network.main) == 0 && azurerm_service_plan.api.sku_name == "Y1"
    error_message = "Personal test must not silently create Premium/private networking."
  }
  assert {
    condition     = azurerm_storage_account.packages.public_network_access_enabled && !azurerm_storage_account.packages.allow_nested_items_to_be_public && !azurerm_storage_account.packages.shared_access_key_enabled && length(azurerm_management_lock.cosmos) == 1
    error_message = "Test public reachability still needs Entra-only access and data protection."
  }
}
