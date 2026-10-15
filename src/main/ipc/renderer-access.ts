export function isTrustedRendererUrl(actual: string, expected: string): boolean {
  try {
    const actualUrl = new URL(actual);
    const expectedUrl = new URL(expected);
    actualUrl.hash = "";
    expectedUrl.hash = "";
    return actualUrl.href === expectedUrl.href;
  } catch {
    return false;
  }
}

export function rendererContentSecurityPolicy(developmentUrl?: string): string {
  const connection = developmentUrl
    ? `'self' ${new URL(developmentUrl).origin.replace(/^http/, "ws")}`
    : "'none'";
  return [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connection}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
  ].join("; ");
}
