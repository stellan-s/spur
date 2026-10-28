import { changeShippingAddress } from "../src/orders";

test("an address is locked once an order has shipped", () => {
  expect(() =>
    changeShippingAddress(
      { status: "dispatched", shippingAddress: "1 Old Road" },
      "2 New Road",
    ),
  ).toThrow("Shipping address cannot change after dispatch");
});
