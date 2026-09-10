import { describe, expect, it } from "vitest";
import { parseHtml } from "../src/core/retrieval/html.js";
import { assertUrlAllowed, UrlNotAllowedError } from "../src/core/retrieval/urlGuard.js";

const publicGuard = { allowPrivateNetworks: false };
const localGuard = { allowPrivateNetworks: true };

describe("assertUrlAllowed (SSRF guard)", () => {
  it("rejects non-http(s) protocols", async () => {
    await expect(assertUrlAllowed("file:///etc/passwd", publicGuard)).rejects.toMatchObject({
      code: "UNSUPPORTED_PROTOCOL",
    });
  });

  it("rejects malformed URLs", async () => {
    await expect(assertUrlAllowed("not a url", publicGuard)).rejects.toBeInstanceOf(
      UrlNotAllowedError,
    );
  });

  it("rejects literal loopback and private IPs in production mode", async () => {
    await expect(assertUrlAllowed("http://127.0.0.1/x", publicGuard)).rejects.toMatchObject({
      code: "PRIVATE_ADDRESS",
    });
    await expect(assertUrlAllowed("http://10.0.0.5/x", publicGuard)).rejects.toMatchObject({
      code: "PRIVATE_ADDRESS",
    });
    await expect(assertUrlAllowed("http://169.254.1.1/x", publicGuard)).rejects.toMatchObject({
      code: "PRIVATE_ADDRESS",
    });
  });

  it("allows a literal public IP in production mode", async () => {
    const { url } = await assertUrlAllowed("http://8.8.8.8/x", publicGuard);
    expect(url.hostname).toBe("8.8.8.8");
  });

  it("allows localhost when private networks are permitted (batch mode)", async () => {
    const { url } = await assertUrlAllowed("http://localhost:8099/acme/", localGuard);
    expect(url.port).toBe("8099");
  });
});

describe("parseHtml", () => {
  const html = `
    <html><head><title>Acme Careers</title></head>
    <body>
      <script>console.log('x')</script>
      <style>.a{}</style>
      <nav><a href="/about">About</a></nav>
      <main>
        <h1>Join us</h1>
        <p>We build   rockets.</p>
        <a href="jobs/backend">Backend Engineer</a>
        <a href="https://external.test/blog">Blog</a>
        <a href="mailto:hi@acme.test">Email</a>
        <a href="#section">Anchor</a>
      </main>
    </body></html>`;

  it("extracts the title and collapses whitespace in text", () => {
    const { title, text } = parseHtml(html, "https://acme.test/careers");
    expect(title).toBe("Acme Careers");
    expect(text).toContain("We build rockets.");
    expect(text).not.toContain("console.log");
  });

  it("resolves relative links against the base URL and drops non-http schemes", () => {
    const { links } = parseHtml(html, "https://acme.test/careers");
    const hrefs = links.map((l) => l.href);
    expect(hrefs).toContain("https://acme.test/about");
    // "jobs/backend" resolves against "/careers" (no trailing slash) → "/jobs/backend"
    expect(hrefs).toContain("https://acme.test/jobs/backend");
    expect(hrefs).toContain("https://external.test/blog");
    expect(hrefs.some((h) => h.startsWith("mailto:"))).toBe(false);
  });

  it("captures anchor text for link ranking", () => {
    const { links } = parseHtml(html, "https://acme.test/careers");
    const backend = links.find((l) => l.href === "https://acme.test/jobs/backend");
    expect(backend?.text).toBe("Backend Engineer");
  });
});
