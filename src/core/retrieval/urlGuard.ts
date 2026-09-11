import dns from "node:dns/promises";
import ipaddr from "ipaddr.js";

export class UrlNotAllowedError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "UrlNotAllowedError";
  }
}

export interface UrlGuardOptions {
  allowPrivateNetworks: boolean;
  allowedRanges?: string[];
}

const PUBLIC_RANGES = new Set(["unicast"]);

function isPublicAddress(ip: string): boolean {
  try {
    const addr = ipaddr.parse(ip);
    const range = addr.range();
    return PUBLIC_RANGES.has(range);
  } catch {
    return false;
  }
}

/** Validate an external URL before we fetch it. */
export async function assertUrlAllowed(
  rawUrl: string,
  opts: UrlGuardOptions,
): Promise<{ url: URL; addresses: string[] }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UrlNotAllowedError("INVALID_URL", `Not a valid URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlNotAllowedError(
      "UNSUPPORTED_PROTOCOL",
      `Only http/https are allowed, got ${url.protocol}`,
    );
  }

  if (opts.allowPrivateNetworks) {
    // skip IP checks entirely (localhost is expected)
    return { url, addresses: [] };
  }

  // check it directly if the host is already a literal IP
  if (ipaddr.isValid(url.hostname)) {
    if (!isPublicAddress(url.hostname)) {
      throw new UrlNotAllowedError(
        "PRIVATE_ADDRESS",
        `Refusing to fetch a non-public address: ${url.hostname}`,
      );
    }
    return { url, addresses: [url.hostname] };
  }

  let resolved: { address: string }[];
  try {
    resolved = await dns.lookup(url.hostname, { all: true });
  } catch {
    throw new UrlNotAllowedError("DNS_FAILURE", `Could not resolve host: ${url.hostname}`);
  }

  if (resolved.length === 0) {
    throw new UrlNotAllowedError("DNS_FAILURE", `Host resolved to no addresses: ${url.hostname}`);
  }

  for (const { address } of resolved) {
    const extraAllowed = opts.allowedRanges?.includes(ipaddr.parse(address).range());
    if (!isPublicAddress(address) && !extraAllowed) {
      throw new UrlNotAllowedError(
        "PRIVATE_ADDRESS",
        `Host ${url.hostname} resolves to a non-public address (${address})`,
      );
    }
  }

  return { url, addresses: resolved.map((r) => r.address) };
}
