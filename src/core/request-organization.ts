import { authenticateRequest, authorizePrincipalForApiRequest } from "./auth";
import { InputError } from "./errors";
import { applyFeatures, features, requireFeature } from "./features";
import { apiRouteFeatures } from "./permissions";
import { createSpurService } from "./spur-service";

export async function createAuthenticatedRequestSpurService(request: Request) {
  return (await createAuthenticatedRequestContext(request)).service;
}

export async function createAuthenticatedRequestContext(request: Request) {
  const { config, principal } = await authenticateRequest(request);
  if (!config.organization.slug) throw new InputError("Choose an organisation to continue.");
  const featureSet = await features(config.organization.slug);
  for (const feature of apiRouteFeatures(request.method, new URL(request.url).pathname)) {
    requireFeature(featureSet, feature);
  }
  authorizePrincipalForApiRequest(request, principal);
  const effectiveConfig = applyFeatures(config, featureSet);
  return {
    config: effectiveConfig,
    features: featureSet,
    principal,
    service: createSpurService(effectiveConfig, principal),
  };
}
