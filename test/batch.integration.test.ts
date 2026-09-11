import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, normalize as pathNormalize } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runBatch, type BatchCase } from "../src/core/batch.js";
import { validateKit } from "../src/core/schema/kit.js";
import { fakeLlm } from "./helpers/fakeLlm.js";

const ROOT = join(fileURLToPath(new URL("..", import.meta.url)), "fixtures", "site");
let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]!);
    let filePath = pathNormalize(join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) return void res.writeHead(403).end();
    if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, "index.html");
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": extname(filePath) === ".txt" ? "text/plain" : "text/html" });
    createReadStream(filePath).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("runBatch (Section 9 / Appendix B)", () => {
  it("produces one Appendix B entry per case and isolates failures", async () => {
    const cases: BatchCase[] = [
      { id: "case-01", jd: "Senior Backend Engineer. Node.js. Distributed systems. Mentoring.", company_url: `${base}/acme/`, days: 5 },
      { id: "case-02", jd: "FORCE_FAIL this extraction on purpose", company_url: `${base}/acme/`, days: 3 },
      { id: "case-03", jd: "Backend engineer. Node.js.", company_url: `${base}/does-not-exist/`, days: 2 },
    ];

    const out = await runBatch(cases, { llm: fakeLlm(), allowPrivateNetworks: true });

    // Appendix B envelope.
    expect(out.version).toBe("1.0");
    expect(typeof out.generated_at).toBe("string");
    expect(out.kits).toHaveLength(3);
    expect(out.kits.map((k) => k.id)).toEqual(["case-01", "case-02", "case-03"]);

    const byId = Object.fromEntries(out.kits.map((k) => [k.id, k]));

    // case-01: ok, valid Appendix A kit.
    expect(byId["case-01"]!.status).toBe("ok");
    expect(byId["case-01"]!.error).toBeNull();
    expect(validateKit(byId["case-01"]!.kit).issues).toEqual([]);

    // case-02: failed (extraction), recorded with a code — did NOT abort the run.
    expect(byId["case-02"]!.status).toBe("failed");
    expect(byId["case-02"]!.kit).toBeNull();
    expect(byId["case-02"]!.error?.code).toBe("EXTRACTION_FAILED");

    // case-03: unreachable site is still ok (partial research), not failed.
    expect(byId["case-03"]!.status).toBe("ok");
    expect(byId["case-03"]!.kit!.source.pages_used).toEqual([]);
    expect(byId["case-03"]!.kit!.schedule.days).toHaveLength(2);
  });
});
