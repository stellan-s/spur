export type ApplicationNaming = {
  canonicalName: string;
  aliases: string[];
};

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function protectedSuffix(naming: ApplicationNaming, alias: string): string {
  const suffix = naming.canonicalName.toLowerCase().startsWith(`${alias.toLowerCase()} `)
    ? naming.canonicalName.slice(alias.length).trim()
    : "";
  return [suffix, "API"].filter(Boolean).map(escaped).join("|");
}

/** Business-facing wording only. Never apply this to code or evidence excerpts. */
export function displayBusinessName(value: string, naming?: ApplicationNaming): string {
  if (!naming) return value;
  return naming.aliases.reduce((current, alias) => {
    if (!alias || alias.toLowerCase() === naming.canonicalName.toLowerCase()) return current;
    // Preserve the canonical name and established technical names such as "<alias> API".
    const pattern = new RegExp(
      `\\b${escaped(alias)}\\b(?!\\s+(?:${protectedSuffix(naming, alias)})\\b)`,
      "gi",
    );
    return current.replace(pattern, naming.canonicalName);
  }, value);
}

export function searchNameVariants(query: string, naming?: ApplicationNaming): string[] {
  if (!naming) return [query];
  const variants = [query];
  for (const alias of naming.aliases) {
    const canonicalPattern = new RegExp(`\\b${escaped(naming.canonicalName)}\\b`, "gi");
    if (canonicalPattern.test(query)) {
      variants.push(query.replace(canonicalPattern, alias));
    }
    const aliasPattern = new RegExp(
      `\\b${escaped(alias)}\\b(?!\\s+(?:${protectedSuffix(naming, alias)})\\b)`,
      "gi",
    );
    if (aliasPattern.test(query)) {
      variants.push(query.replace(aliasPattern, naming.canonicalName));
    }
  }
  return [...new Set(variants)];
}
