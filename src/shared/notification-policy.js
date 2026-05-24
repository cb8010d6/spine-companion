import policy from "./notification-policy.cjs";

export const defaultMessageForState = policy.defaultMessageForState;
export const isAiSource = policy.isAiSource;
export const isCompletionState = policy.isCompletionState;
export const notificationForState = policy.notificationForState;
export const normalizeSource = policy.normalizeSource;
export const shouldNotifyState = policy.shouldNotifyState;
export const sourceDisplayName = policy.sourceDisplayName;
