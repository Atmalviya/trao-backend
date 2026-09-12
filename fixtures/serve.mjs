// Dependency-free static server for the fixture company sites.
// Used by local crawl tests and as a stand-in for the localhost sites the
// batch evaluator may point at. Run: `node fixtures/serve.mjs [port]`.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "site");
const PORT = Number(process.argv[2] ?? process.env.FIXTURE_PORT ?? 8099);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const server = createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url ?? "/").split("?")[0]);
  // Prevent path traversal outside ROOT.
  let filePath = normalize(join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  // Directory → index.html
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(filePath)] ?? "application/octet-stream" });
  createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Fixture site serving ${ROOT} at http://localhost:${PORT}`);
  console.log(`  Acme (handbook hiring):  http://localhost:${PORT}/acme/`);
  console.log(`  Nimbus (no hiring):      http://localhost:${PORT}/nimbus/`);
  console.log(`  Helix (buried careers):  http://localhost:${PORT}/helix/`);
  console.log(`  Vault (/about/careers):  http://localhost:${PORT}/vault/`);
});
