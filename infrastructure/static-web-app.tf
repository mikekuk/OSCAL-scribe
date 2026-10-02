resource "azurerm_static_web_app" "web" {
  name                = local.name
  resource_group_name = azurerm_resource_group.main.name
  location            = var.web_location
  sku_tier            = "Standard"
  sku_size            = "Standard"
}
resource "azurerm_static_web_app_function_app_registration" "api" {
  static_web_app_id = azurerm_static_web_app.web.id
  function_app_id   = azurerm_linux_function_app.api.id
}
