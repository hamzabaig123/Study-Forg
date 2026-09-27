import {
  contentSecurityPolicy,
  securityHeaders,
} from "@/lib/security/contentSecurityPolicy";
import { describe, expect, it } from "vitest";

/**
 * The policy the built `index.html` ships with.
 *
 * These are not style assertions. Every one of them is a decision about which
 * host this page is allowed to hand its session, its provider keys and its study
 * data to, so a change here that looks cosmetic either breaks a feature that
 * runs from the browser or quietly opens a door.
 */
describe("contentSecurityPolicy", () => {
  const policy = contentSecurityPolicy({
    supabaseUrl: "https://demo_project.supabase.co",
  });
  const directive = (name: string) =>
    policy
      .split("; ")
      .find((part) => part.startsWith(`${name} `))
      ?.slice(name.length + 1)
      .split(" ") ?? [];

  it("names the project origin rather than every Supabase project", () => {
    expect(directive("connect-src")).toContain(
      "https://demo_project.supabase.co",
    );
    expect(directive("connect-src")).not.toContain("https://*.supabase.co");
  });

  it("falls back to the platform wildcard when the build has no usable URL", () => {
    for (const supabaseUrl of [undefined, "", "not a url"]) {
      const fallback = contentSecurityPolicy({ supabaseUrl });
      expect(fallback).toContain("https://*.supabase.co");
      // A missing env value must not reach the tag as the word "undefined".
      expect(fallback).not.toContain("undefined");
    }
  });

  it("allows the hosts the browser itself calls", () => {
    for (const origin of [
      "https://generativelanguage.googleapis.com",
      "https://openrouter.ai",
      "https://api.emailjs.com",
      "https://cdnjs.cloudflare.com",
      "http://localhost:11434",
    ]) {
      expect(directive("connect-src"), origin).toContain(origin);
    }
  });

  it("grants scripts no inline exemption", () => {
    // The theme bootstrap in `index.html` is a `<script src>` because of this
    // line: an inline block would be refused at runtime, not at build time.
    expect(directive("script-src")).not.toContain("'unsafe-inline'");
    expect(directive("script-src")).toContain("https://cdnjs.cloudflare.com");
  });

  it("carries the resource types the pages actually generate", () => {
    // QR codes and file previews are data/blob URLs made in this page, and
    // styles arrive as inline `style` attributes all over the layout.
    expect(directive("img-src")).toEqual(["'self'", "data:", "blob:"]);
    expect(directive("style-src")).toContain("'unsafe-inline'");
    expect(directive("worker-src")).toContain("blob:");
    expect(directive("font-src")).toEqual(["'self'"]);
  });

  it("closes the load paths nothing in the app uses", () => {
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("default-src 'self'");
  });

  it("has no directive an attacker could widen by injection", () => {
    // A `;` inside a source expression would end the directive and start a new
    // one, so nothing here may carry a separator of its own.
    for (const part of policy.split("; ")) {
      const [, ...sources] = part.split(" ");
      expect(sources.join(" ")).not.toMatch(/[;,]/);
    }
  });

  it("carries no frame-ancestors, because a meta would ignore it anyway", () => {
    // Asserted rather than assumed: the real directive lives in the header file
    // below, and putting it here would read as protection while the browser
    // silently drops it.
    expect(policy).not.toContain("frame-ancestors");
  });
});

/**
 * The header file the build writes next to the bundle.
 *
 * These directives are the reason a generator exists at all: a `<meta>` cannot
 * carry them, and a hand-maintained copy of the policy would drift from the one
 * the page declares within a deploy or two.
 */
describe("securityHeaders", () => {
  const text = securityHeaders({
    supabaseUrl: "https://demo_project.supabase.co",
  });
  const ruleLines = text
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.startsWith("#"));

  it("sends the same policy as the meta, plus the directive a meta ignores", () => {
    const header = text.match(/Content-Security-Policy: (.+)/)?.[1];
    expect(header).toBe(
      `${contentSecurityPolicy({ supabaseUrl: "https://demo_project.supabase.co" })}; frame-ancestors 'none'`,
    );
    expect(header).toContain("https://demo_project.supabase.co");
  });

  it("refuses to be framed in every dialect a client might read", () => {
    expect(text).toContain("frame-ancestors 'none'");
    expect(text).toContain("X-Frame-Options: DENY");
  });

  it("carries the headers only a host can send", () => {
    expect(text).toContain(
      "Strict-Transport-Security: max-age=31536000; includeSubDomains",
    );
    expect(text).toContain("X-Content-Type-Options: nosniff");
    expect(text).toContain("Referrer-Policy: strict-origin-when-cross-origin");
  });

  it("does not switch off a feature the app uses", () => {
    const permissions = text.match(/Permissions-Policy: (.+)/)?.[1] ?? "";
    // clipboard-write: the share flow copies its own link. notifications: the
    // reminder scheduler. Blocking either turns a working page into a broken
    // one with no build error to point at.
    for (const feature of [
      "clipboard-write",
      "notifications",
      "display-capture",
    ]) {
      expect(permissions, feature).not.toContain(feature);
    }
    expect(permissions).toContain("camera=()");
  });

  it("parses as a header file, with no prose inside a rule block", () => {
    // Cloudflare Pages documents no comment syntax, so every line after the
    // file header has to be a path pattern or an indented `Name: value`.
    for (const line of ruleLines) {
      const isPath = /^\/\S*$/.test(line);
      const isHeader = /^ {2}[A-Za-z][A-Za-z-]*: \S/.test(line);
      expect(isPath || isHeader, `unparseable line: ${line}`).toBe(true);
    }
    expect(ruleLines.some((line) => /^\/\S*$/.test(line))).toBe(true);
  });

  it("keeps hashed assets cacheable and the entry point revalidated", () => {
    expect(text).toMatch(
      /\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable/,
    );
    expect(text).toMatch(/\/index\.html\n {2}Cache-Control: no-cache/);
    expect(text).toMatch(/\/sw\.js\n {2}Cache-Control: no-cache/);
  });
});
