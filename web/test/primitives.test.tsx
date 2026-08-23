import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Hex, LoadingState, EmptyState, ErrorState, ExternalLink } from "../src/components/primitives";

describe("primitives — loading/empty/error states and safe rendering", () => {
  it("LoadingState announces itself via a polite live region", () => {
    render(<LoadingState label="Loading models…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading models…");
  });

  it("EmptyState is a real, distinguishable state, not silently blank output", () => {
    render(<EmptyState label="No models registered yet." />);
    expect(screen.getByText("No models registered yet.")).toBeInTheDocument();
  });

  it("ErrorState uses an alert role and keeps technical detail behind an expander", () => {
    render(<ErrorState label="Could not load." detail="TypeError: fetch failed" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load.");
    expect(screen.queryByText("TypeError: fetch failed")).not.toBeVisible();
  });

  it("Hex truncates long values but keeps the full value in the title attribute — never lossy for assistive tech", () => {
    const full = "0x" + "ab".repeat(32);
    render(<Hex value={full} />);
    const el = screen.getByTitle(full);
    expect(el.textContent).not.toBe(full);
    expect(el.textContent!.length).toBeLessThan(full.length);
  });

  it("user-supplied metadata is rendered as plain text, never interpreted as HTML (XSS safety)", () => {
    const malicious = '<img src=x onerror="window.__pwned = true">';
    render(<ExternalLink href="https://example.test/manifest">{malicious}</ExternalLink>);
    // React's default text rendering escapes this — it must appear as
    // literal text content, and the injected handler must never run.
    expect(screen.getByText(malicious)).toBeInTheDocument();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    expect(document.querySelector("img[onerror]")).toBeNull();
  });

  it("a non-HTTP evidence URI (e.g. 0g-storage://) is shown as raw text, not rendered as a clickable opaque link", () => {
    render(<ExternalLink href="0g-storage://abc123">manifest</ExternalLink>);
    expect(screen.getByText("0g-storage://abc123")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("an https evidence URL is a real, visibly-external link", () => {
    render(<ExternalLink href="https://example.test/manifest.json">manifest</ExternalLink>);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://example.test/manifest.json");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });
});
