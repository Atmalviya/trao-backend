import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize as pathNormalize } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { crawlCompanySite, CrawlError } from "../src/core/retrieval/crawl.js";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)), "fixtures", "site");
const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    let filePath = pathNormalize(join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) return void res.writeHead(403).end();
    if (existsSync(filePath) && statSync(filePath).isDirectory()) {
      filePath = join(filePath, "index.html");
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      return void res.writeHead(404).end("Not found");
    }
    res.writeHead(200, { "content-type": TYPES[extname(filePath)] ?? "application/octet-stream" });
    createReadStream(filePath).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const guard = { allowPrivateNetworks: true, minHostIntervalMs: 0 };

describe("crawlCompanySite (integration, fixture server)", () => {
  it("finds the buried hiring page via link ranking, not a hard-coded path", async () => {
    const result = await crawlCompanySite(`${base}/acme/`, guard);
    expect(result.hiringPage).not.toBeNull();
    expect(result.hiringPage!.url).toContain("/handbook/joining/interview-loop.html");
    // The hiring page's process content should have been captured.
    expect(result.hiringPage!.text.toLowerCase()).toContain("system design interview");
    expect(result.pagesUsed.length).toBeGreaterThan(1);
  });

  it("captures an about/what-they-do signal for the brief", async () => {
    const result = await crawlCompanySite(`${base}/acme/`, guard);
    expect(result.aboutPage).not.toBeNull();
    expect(result.aboutPage!.text.toLowerCase()).toContain("acme");
  });

  it("respects robots.txt disallow (contact page is never fetched)", async () => {
    const result = await crawlCompanySite(`${base}/acme/`, guard);
    expect(result.pagesUsed.some((u) => u.endsWith("/contact.html"))).toBe(false);
  });

  it("reports honestly when a site has no hiring page (Nimbus)", async () => {
    const result = await crawlCompanySite(`${base}/nimbus/`, guard);
    expect(result.hiringPage).toBeNull();
    expect(result.notes.some((n) => n.toLowerCase().includes("no hiring"))).toBe(true);
    // Still succeeds and returns an about signal — a missing hiring page is not a failure.
    expect(result.aboutPage).not.toBeNull();
  });

  it("throws COMPANY_UNREACHABLE when the homepage 404s", async () => {
    await expect(crawlCompanySite(`${base}/does-not-exist/`, guard)).rejects.toMatchObject({
      code: "COMPANY_UNREACHABLE",
    });
    await expect(crawlCompanySite(`${base}/does-not-exist/`, guard)).rejects.toBeInstanceOf(
      CrawlError,
    );
  });
});
