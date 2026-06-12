import registry from "./source-registry.cjs";

export const GENERIC_AI_PATTERNS = registry.GENERIC_AI_PATTERNS;
export const KNOWN_SOURCES = registry.KNOWN_SOURCES;
export const isAiSource = registry.isAiSource;
export const knownSource = registry.knownSource;
export const normalizeSource = registry.normalizeSource;
export const sourceDisplayName = registry.sourceDisplayName;
export const sourceFromClientInfo = registry.sourceFromClientInfo;
export const titleCaseSource = registry.titleCaseSource;

export default registry;
