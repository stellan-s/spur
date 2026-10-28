export type DiscountRequest = {
  percentage: number;
  managerApproved: boolean;
};

export function approveDiscount(request: DiscountRequest): boolean {
  if (request.percentage > 20 && !request.managerApproved) {
    return false;
  }

  return request.percentage > 0 && request.percentage <= 40;
}
