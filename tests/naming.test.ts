import { describe, expect, it } from "vitest";

import { displayBusinessName, searchNameVariants } from "@/core/naming";

const naming = { canonicalName: "Northstar Commerce", aliases: ["Northstar"] };

describe("application naming", () => {
  it("uses the canonical product name without changing technical names", () => {
    expect(displayBusinessName("Northstar optimizes campaigns. Northstar Commerce reports results.", naming))
      .toBe("Northstar Commerce optimizes campaigns. Northstar Commerce reports results.");
    expect(displayBusinessName("Northstar API and NorthstarPortal", naming))
      .toBe("Northstar API and NorthstarPortal");
    expect(displayBusinessName("northstar runs the workflow", naming))
      .toBe("Northstar Commerce runs the workflow");
  });

  it("searches both the canonical name and the legacy alias", () => {
    expect(searchNameVariants("What can Northstar Commerce do?", naming))
      .toEqual(["What can Northstar Commerce do?", "What can Northstar do?"]);
    expect(searchNameVariants("Northstar campaign goals", naming))
      .toEqual(["Northstar campaign goals", "Northstar Commerce campaign goals"]);
    expect(searchNameVariants("Northstar API", naming)).toEqual(["Northstar API"]);
  });
});
