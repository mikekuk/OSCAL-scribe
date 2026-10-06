resource "azurerm_log_analytics_workspace" "main" {
  name                = local.name
  resource_group_name = data.azurerm_resource_group.main.name
  location            = data.azurerm_resource_group.main.location
  sku                 = "PerGB2018"
  retention_in_days   = var.log_retention_days
  daily_quota_gb      = var.log_daily_cap_gb
}
resource "azurerm_application_insights" "main" {
  name                 = local.name
  resource_group_name  = data.azurerm_resource_group.main.name
  location             = data.azurerm_resource_group.main.location
  workspace_id         = azurerm_log_analytics_workspace.main.id
  application_type     = "web"
  daily_data_cap_in_gb = var.log_daily_cap_gb
}
resource "azurerm_consumption_budget_resource_group" "test" {
  name              = "scribe-${var.environment}-monthly"
  resource_group_id = data.azurerm_resource_group.main.id
  amount            = var.monthly_budget
  time_grain        = "Monthly"
  time_period { start_date = var.budget_start }
  dynamic "notification" {
    for_each = var.budget_email == "" ? [] : [50, 80, 100]
    content {
      enabled        = true
      threshold      = notification.value
      operator       = "GreaterThanOrEqualTo"
      contact_emails = [var.budget_email]
    }
  }
}
