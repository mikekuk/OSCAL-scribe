#!/usr/bin/env bash
# Source inside AzureCLI@2 with addSpnToEnvironment and System.AccessToken mapped.
set -euo pipefail
: "${servicePrincipalId:?Use an Azure Resource Manager WIF service connection}"
: "${tenantId:?AzureCLI task did not expose tenantId}"
: "${SYSTEM_ACCESSTOKEN:?Map System.AccessToken into this task}"
: "${SYSTEM_OIDCREQUESTURI:?This command must run in Azure Pipelines}"
: "${AZURESUBSCRIPTION_SERVICE_CONNECTION_ID:?Missing Azure service connection ID}"
export ARM_CLIENT_ID="$servicePrincipalId" ARM_TENANT_ID="$tenantId"
export ARM_SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
export ARM_USE_OIDC=true ARM_USE_AZUREAD=true ARM_USE_CLI=false
export ARM_ADO_PIPELINE_SERVICE_CONNECTION_ID="$AZURESUBSCRIPTION_SERVICE_CONNECTION_ID"
export ARM_OIDC_AZURE_SERVICE_CONNECTION_ID="$AZURESUBSCRIPTION_SERVICE_CONNECTION_ID"
export ARM_OIDC_REQUEST_TOKEN="$SYSTEM_ACCESSTOKEN"
export ARM_OIDC_REQUEST_URL="$SYSTEM_OIDCREQUESTURI"
# Request fresh federated assertions through the job endpoint, not a saved idToken.
unset ARM_OIDC_TOKEN ARM_CLIENT_SECRET ARM_ACCESS_KEY
export TF_IN_AUTOMATION=true TF_INPUT=false
