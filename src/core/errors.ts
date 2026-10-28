export class SpurError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SpurError";
  }
}

export class ConfigurationError extends SpurError {
  constructor(message: string, code = "configuration_error") {
    super(message, code, 503);
    this.name = "ConfigurationError";
  }
}

export class AuthenticationError extends SpurError {
  constructor(message: string, code = "authentication_required") {
    super(message, code, 401);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends SpurError {
  constructor(message = "You do not have permission to do that.", code = "permission_denied") {
    super(message, code, 403);
    this.name = "AuthorizationError";
  }
}

export class FeatureDisabledError extends SpurError {
  constructor(readonly feature: string) {
    super("This feature is turned off by your administrator.", "feature_disabled", 403);
    this.name = "FeatureDisabledError";
  }
}

export class RepositoryError extends SpurError {
  constructor(message: string, code = "repository_error") {
    super(message, code, 422);
    this.name = "RepositoryError";
  }
}

export class InputError extends SpurError {
  constructor(message: string) {
    super(message, "invalid_request", 400);
    this.name = "InputError";
  }
}

export class NotFoundError extends SpurError {
  constructor(message: string) {
    super(message, "not_found", 404);
    this.name = "NotFoundError";
  }
}
