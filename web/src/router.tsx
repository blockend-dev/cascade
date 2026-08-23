import React, { createContext, useContext, useEffect, useState } from "react";

/**
 * Minimal hash-based client-side router (ADR 0015 — no routing
 * library). Hash-based specifically so the static build (docs/frontend.md
 * §10: "deployable behind any static host") needs zero server-side
 * rewrite configuration for deep links to work on refresh.
 *
 * Route pattern: "/models/:modelId" style segments, matched against
 * `location.hash` (minus the leading "#").
 */

export interface RouteMatch {
  path: string;
  params: Record<string, string>;
}

function currentPath(): string {
  const hash = window.location.hash.replace(/^#/, "");
  return hash || "/";
}

const RouterContext = createContext<{ path: string; navigate: (path: string) => void } | null>(null);

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [path, setPath] = useState(currentPath());

  useEffect(() => {
    const onHashChange = () => setPath(currentPath());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigate = (next: string) => {
    window.location.hash = next;
  };

  return <RouterContext.Provider value={{ path, navigate }}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter() called outside <RouterProvider>");
  return ctx;
}

export function useNavigate() {
  return useRouter().navigate;
}

export function Link({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) {
  const { navigate } = useRouter();
  return (
    <a
      href={`#${to}`}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

function matchPattern(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];
    if (p.startsWith(":")) params[p.slice(1)] = decodeURIComponent(pathParts[i]);
    else if (p !== pathParts[i]) return null;
  }
  return params;
}

export interface RouteDef {
  pattern: string;
  render: (params: Record<string, string>) => React.ReactNode;
}

export function Routes({ routes, notFound }: { routes: RouteDef[]; notFound: React.ReactNode }) {
  const { path } = useRouter();
  for (const route of routes) {
    const params = matchPattern(route.pattern, path);
    if (params) return <>{route.render(params)}</>;
  }
  return <>{notFound}</>;
}
