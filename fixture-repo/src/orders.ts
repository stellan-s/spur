export type OrderStatus = "draft" | "paid" | "dispatched" | "delivered";

export type Order = {
  status: OrderStatus;
  shippingAddress: string;
};

export function changeShippingAddress(order: Order, nextAddress: string): Order {
  if (order.status === "dispatched" || order.status === "delivered") {
    throw new Error("Shipping address cannot change after dispatch");
  }

  return { ...order, shippingAddress: nextAddress };
}
