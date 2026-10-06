output "web_url" { value = "https://${azurerm_static_web_app.web.default_host_name}" }
output "web_name" { value = azurerm_static_web_app.web.name }
output "function_name" { value = azurerm_linux_function_app.api.name }
output "function_url" { value = "https://${azurerm_linux_function_app.api.default_hostname}" }
output "resource_group" { value = data.azurerm_resource_group.main.name }
output "cosmos_endpoint" { value = azurerm_cosmosdb_account.main.endpoint }
output "storage_account" { value = azurerm_storage_account.packages.name }
output "client_id" { value = azuread_application.scribe.client_id }
output "tenant_id" { value = var.tenant_id }

output "environment" { value = var.environment }
output "subscription_id" { value = var.subscription_id }
output "cosmos_name" { value = azurerm_cosmosdb_account.main.name }
output "dev_vnet_id" { value = var.private_data ? azurerm_virtual_network.main[0].id : null }
