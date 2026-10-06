# Illustrative values only; these IDs are not deployable.
# Pipelines generate the real var file from protected config/test.json values.
# Prefer the deployment runbook; do not commit a populated copy.
subscription_id               = "11111111-1111-4111-8111-111111111111"
tenant_id                     = "22222222-2222-4222-8222-222222222222"
resource_group_name           = "rg-oscal-scribe-test"
web_location                  = "westus2"
prefix                        = "oscal-scribe"
environment                   = "test"
security_user_ids             = ["33333333-3333-4333-8333-333333333333"]
user_ids                      = []
app_admin_user_ids            = []
monthly_budget                = 35
budget_email                  = "alerts@example.com"
budget_start                  = "2026-10-01T00:00:00Z"
vnet_cidr                     = "10.42.0.0/16"
allow_localhost_redirect      = true
allow_raw_browser             = false
allow_permanent_delete        = false
allow_destroy                 = false
private_data                  = false
function_sku                  = "Y1"
requests_per_minute           = 120
expensive_requests_per_minute = 10
log_retention_days            = 30
log_daily_cap_gb              = 0.1
backup_retention_days         = 7
protect_data                  = true
owner_object_ids              = ["33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"]
deployment_object_id          = "44444444-4444-4444-8444-444444444444"
publisher_object_id           = "44444444-4444-4444-8444-444444444444"
