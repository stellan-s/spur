import { canReturn } from "../src/returns";

test("the return window closes after day thirty", () => {
  expect(canReturn(30)).toBe(true);
  expect(canReturn(31)).toBe(false);
});
