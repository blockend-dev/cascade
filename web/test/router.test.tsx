import { describe, it, expect, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RouterProvider, Routes, Link, useNavigate } from "../src/router";

afterEach(() => {
  window.location.hash = "";
});

describe("router — malicious/malformed hash parameters never reach an unsafe code path", () => {
  it("renders the matching route for a normal path", () => {
    window.location.hash = "#/models/0xabc";
    render(
      <RouterProvider>
        <Routes routes={[{ pattern: "/models/:modelId", render: (p) => <div>model:{p.modelId}</div> }]} notFound={<div>404</div>} />
      </RouterProvider>
    );
    expect(screen.getByText("model:0xabc")).toBeInTheDocument();
  });

  it("falls back to notFound for an unmatched or garbage path, rather than crashing", () => {
    window.location.hash = "#/this/does/not/exist/at/all";
    render(
      <RouterProvider>
        <Routes routes={[{ pattern: "/models/:modelId", render: (p) => <div>model:{p.modelId}</div> }]} notFound={<div>Not found</div>} />
      </RouterProvider>
    );
    expect(screen.getByText("Not found")).toBeInTheDocument();
  });

  it("a script-injection attempt in a route param is rendered as inert text, not executed or injected as markup", () => {
    window.location.hash = `#/models/${encodeURIComponent('<img src=x onerror=window.__pwned=true>')}`;
    render(
      <RouterProvider>
        <Routes routes={[{ pattern: "/models/:modelId", render: (p) => <div data-testid="param">{p.modelId}</div> }]} notFound={<div>404</div>} />
      </RouterProvider>
    );
    expect(screen.getByTestId("param").textContent).toContain("<img");
    expect(document.querySelector("img[onerror]")).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it("Link navigates via the router rather than a full page load, and never executes a javascript: URL", () => {
    function Nav() {
      const navigate = useNavigate();
      return (
        <>
          <Link to="/about">About</Link>
          <button onClick={() => navigate("/dashboard")}>Go</button>
        </>
      );
    }
    render(
      <RouterProvider>
        <Nav />
      </RouterProvider>
    );
    const link = screen.getByRole("link", { name: "About" });
    expect(link).toHaveAttribute("href", "#/about");
  });
});
