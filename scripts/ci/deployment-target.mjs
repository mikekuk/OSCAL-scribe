// A target artifact is emitted by infrastructure and consumed by a different
// identity. Check both its envelope and Terraform outputs before uploading code.
export function assertDeploymentTarget(target, config, commit) {
  const expected = {
    commit,
    environment: config.environment,
    subscription: config.subscription_id,
    tenant: config.tenant_id,
    resourceGroup: config.resource_group_name,
  };
  if (!commit || Object.entries(expected).some(([key, value]) => target?.[key] !== value)) {
    throw Error('Deployment artifact targets a different commit or environment');
  }
  const outputs = target.outputs;
  const outputValues = {
    environment: config.environment,
    subscription_id: config.subscription_id,
    tenant_id: config.tenant_id,
    resource_group: config.resource_group_name,
  };
  if (Object.entries(outputValues).some(([key, value]) => outputs?.[key]?.value !== value)) {
    throw Error('Terraform outputs do not match selected profile');
  }
  return outputs;
}
