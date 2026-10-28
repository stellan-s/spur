export type AccessRequestNotification = {
  organizationId: string;
  email: string;
  displayName: string;
};

export type AccessDecisionNotification = AccessRequestNotification & {
  decision: "approved" | "rejected";
};

export interface AccessNotifier {
  accessRequested(notification: AccessRequestNotification): Promise<void>;
  accessDecided(notification: AccessDecisionNotification): Promise<void>;
}

export const noOpAccessNotifier: AccessNotifier = {
  async accessRequested() {},
  async accessDecided() {},
};
