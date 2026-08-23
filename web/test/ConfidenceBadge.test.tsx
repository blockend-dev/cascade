import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfidenceBadge } from "../src/components/ConfidenceBadge";
import { ConfidenceLevel } from "../src/confidence";

describe("ConfidenceBadge", () => {
  it("labels the axis and the level distinctly — lineage and serving never collapse into one badge", () => {
    render(
      <>
        <ConfidenceBadge axis="Lineage" level={ConfidenceLevel.CryptographicallyBound} />
        <ConfidenceBadge axis="Serving" level={ConfidenceLevel.AttestedTraining} />
      </>
    );
    expect(screen.getByText("LINEAGE")).toBeInTheDocument();
    expect(screen.getByText("SERVING")).toBeInTheDocument();
    expect(screen.getByText(/Cryptographically Bound/)).toBeInTheDocument();
    expect(screen.getByText(/Attested Training/)).toBeInTheDocument();
  });

  it("shows the effective-confidence axis when explicitly asked to, distinct from lineage/serving", () => {
    render(<ConfidenceBadge axis="Effective" level={ConfidenceLevel.Declared} />);
    expect(screen.getByText("EFFECTIVE")).toBeInTheDocument();
    expect(screen.getByText(/Declared/)).toBeInTheDocument();
  });

  it("'Why?' reveals what the level does and does not establish, on demand", () => {
    render(<ConfidenceBadge axis="Lineage" level={ConfidenceLevel.AttestedTraining} />);
    expect(screen.queryByText(/does NOT establish/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Why?" }));
    expect(screen.getByText(/does NOT establish/)).toBeInTheDocument();
  });

  it("compact mode omits the 'Why?' expander (used in dense list/table contexts)", () => {
    render(<ConfidenceBadge axis="Serving" level={ConfidenceLevel.Declared} compact />);
    expect(screen.queryByRole("button", { name: "Why?" })).not.toBeInTheDocument();
  });

  it("conveys the level through more than color: a distinct glyph and text label are always present", () => {
    render(<ConfidenceBadge axis="Lineage" level={ConfidenceLevel.CryptographicallyBound} />);
    // The glyph is aria-hidden (decorative) but the text label carries
    // the same information for assistive technology.
    expect(screen.getByText(/Cryptographically Bound/)).toBeVisible();
  });
});
