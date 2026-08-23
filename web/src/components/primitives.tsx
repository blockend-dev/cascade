import React from "react";

/** Truncated monospace hash/address display. Full value always in
 *  `title` (hover) and copyable via selection — never only visible on
 *  hover, so it's available to keyboard/screen-reader users too. */
export function Hex({ value, chars = 6 }: { value: string; chars?: number }) {
  const short = value.length > chars * 2 + 2 ? `${value.slice(0, chars + 2)}…${value.slice(-chars)}` : value;
  return (
    <span className="hex" title={value}>
      {short}
    </span>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="state state-loading" role="status" aria-live="polite">
      {label}
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="state state-empty" role="status">
      {label}
    </div>
  );
}

export function ErrorState({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="state state-error" role="alert">
      <p>{label}</p>
      {detail && (
        <details>
          <summary>Technical details</summary>
          <pre>{detail}</pre>
        </details>
      )}
    </div>
  );
}

/** External evidence/manifest links (0g-storage://, IPFS, etc.) are
 *  visibly external — never a bare clickable label (docs/frontend.md
 *  §8's "external evidence URLs clearly identified" requirement). */
export function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  const isHttp = /^https?:\/\//i.test(href);
  return (
    <span className="external-link">
      {children}
      {isHttp ? (
        <a href={href} target="_blank" rel="noopener noreferrer">
          ↗ open
        </a>
      ) : (
        <span className="external-link-nonhttp" title="Not directly openable from a browser — a non-HTTP evidence pointer.">
          <code>{href}</code>
        </span>
      )}
    </span>
  );
}

export function Panel({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section className="panel" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {children}
    </section>
  );
}
