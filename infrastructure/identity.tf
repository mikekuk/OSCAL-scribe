resource "azuread_application" "scribe" {
  # The URI has a separate resource because it depends on the generated client ID.
  lifecycle { ignore_changes = [identifier_uris] }
  display_name     = "${local.name} ${var.environment}"
  sign_in_audience = "AzureADMyOrg"
  owners           = var.owner_object_ids
  single_page_application { redirect_uris = ["https://${azurerm_static_web_app.web.default_host_name}/", "http://localhost:5173/"] }
  api {
    requested_access_token_version = 2
    oauth2_permission_scope {
      id                         = "e5a11461-e9ce-49d5-bbbc-7d6418f4100e"
      type                       = "Admin"
      value                      = "access_as_user"
      admin_consent_display_name = "Use OSCAL Scribe"
      admin_consent_description  = "Read and edit SSPs subject to server authorization."
      enabled                    = true
    }
  }
  app_role {
    id                   = "c7e1cb24-e405-44a0-bedd-b138ee933377"
    allowed_member_types = ["User"]
    display_name         = "Scribe User"
    description          = "Use SSPs owned by or explicitly shared with this user."
    value                = "User"
    enabled              = true
  }
  app_role {
    id                   = "2e5c837c-e0ce-474b-9c62-313a927a2f1a"
    allowed_member_types = ["User"]
    display_name         = "Security"
    description          = "Security team: administer all SSPs within this tenant."
    value                = "Security"
    enabled              = true
  }
  app_role {
    id                   = "6f2c44dc-96c4-4b5e-a46f-d2e8c654e721"
    allowed_member_types = ["User"]
    display_name         = "App Admin"
    description          = "Explore Scribe storage, permanently delete SSPs and manage staged OSCAL content."
    value                = "AppAdmin"
    enabled              = true
  }
}
resource "azuread_application_identifier_uri" "api" {
  application_id = azuread_application.scribe.id
  identifier_uri = "api://${azuread_application.scribe.client_id}"
}
resource "azuread_service_principal" "scribe" {
  client_id                    = azuread_application.scribe.client_id
  app_role_assignment_required = true
  owners                       = var.owner_object_ids
}
resource "azuread_application_pre_authorized" "spa" {
  # Graph can resolve the client through its service principal when updating
  # pre-authorizations. Keep that principal and the API URI until cleanup ends.
  depends_on           = [azuread_service_principal.scribe, azuread_application_identifier_uri.api]
  application_id       = azuread_application.scribe.id
  authorized_client_id = azuread_application.scribe.client_id
  permission_ids       = ["e5a11461-e9ce-49d5-bbbc-7d6418f4100e"]
}
resource "azuread_app_role_assignment" "security" {
  for_each            = var.security_user_ids
  app_role_id         = "2e5c837c-e0ce-474b-9c62-313a927a2f1a"
  principal_object_id = each.value
  resource_object_id  = azuread_service_principal.scribe.object_id
}
resource "azuread_app_role_assignment" "users" {
  for_each            = var.user_ids
  app_role_id         = "c7e1cb24-e405-44a0-bedd-b138ee933377"
  principal_object_id = each.value
  resource_object_id  = azuread_service_principal.scribe.object_id
}

# Kept separate from Security: no existing user receives destructive rights implicitly.
resource "azuread_app_role_assignment" "app_admins" {
  for_each            = var.app_admin_user_ids
  app_role_id         = "6f2c44dc-96c4-4b5e-a46f-d2e8c654e721"
  principal_object_id = each.value
  resource_object_id  = azuread_service_principal.scribe.object_id
}
