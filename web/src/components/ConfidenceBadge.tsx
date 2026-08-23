import React, { useState } from "react";
import { ConfidenceLevel, CONFIDENCE_INFO } from "../confidence";

/**
 * Renders one confidence axis. Never color alone: each level gets a
 * distinct icon glyph AND a distinct border pattern class, in addition
 * to its text label — docs/frontend.md §4 / the brief's accessibility
 * requirement that no meaning is conveyed exclusively through color.
 */
const GLYPH: Record<ConfidenceLevel, string> = {
  [ConfidenceLevel.Declared]: "◇", // open — economically backed only
  [ConfidenceLevel.AttestedTraining]: "◈", // half-filled — attested, circumstantial
  [ConfidenceLevel.CryptographicallyBound]: "◆", // filled — cryptographically checked
};

export function ConfidenceBadge({
  axis,
  level,
  compact = false,
}: {
  axis: "Lineage" | "Serving" | "Effective";
  level: ConfidenceLevel;
  compact?: boolean;
}) {
  const info = CONFIDENCE_INFO[level];
  const [showWhy, setShowWhy] = useState(false);
  const badgeId = `confidence-${axis}-${level}`;

  return (
    <div className={`confidence-badge confidence-level-${level}`}>
      <div className="confidence-badge-header">
        <span className="confidence-axis-label">{axis.toUpperCase()}</span>
        <span className="confidence-value" aria-describedby={showWhy ? badgeId : undefined}>
          <span aria-hidden="true" className="confidence-glyph">
            {GLYPH[level]}
          </span>{" "}
          {info.label}
          <span className="confidence-tier"> (Level {info.userFacingLevel})</span>
        </span>
        {!compact && (
          <button
            type="button"
            className="why-button"
            aria-expanded={showWhy}
            onClick={() => setShowWhy((v) => !v)}
          >
            Why?
          </button>
        )}
      </div>
      {!compact && showWhy && (
        <div id={badgeId} className="confidence-why">
          <p>
            <strong>This establishes:</strong> {info.establishes}
          </p>
          <p>
            <strong>This does NOT establish:</strong> {info.doesNotEstablish}
          </p>
        </div>
      )}
    </div>
  );
}
