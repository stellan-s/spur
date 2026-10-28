import { authenticateInstanceRequest } from "./auth";
import { NotFoundError } from "./errors";
import { OrganizationStore } from "./organization-store";

export async function instanceAdminContext(request: Request) {
  const { config, principal } = await authenticateInstanceRequest(request);
  if (config.tenancy !== "multi") throw new NotFoundError("Instance administration is only available in multi-organisation mode.");
  const store = new OrganizationStore(config.databaseUrl, config.encryptionKey);
  await store.requireAdministrator(principal.userId);
  return { store, principal };
}
