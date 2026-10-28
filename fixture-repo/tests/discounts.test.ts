import { approveDiscount } from "../src/discounts";

test("a discount above twenty percent requires a manager", () => {
  expect(approveDiscount({ percentage: 25, managerApproved: false })).toBe(false);
  expect(approveDiscount({ percentage: 25, managerApproved: true })).toBe(true);
});
