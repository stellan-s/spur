const RETURN_WINDOW_DAYS = 30;

export function canReturn(daysSinceDelivery: number): boolean {
  return daysSinceDelivery >= 0 && daysSinceDelivery <= RETURN_WINDOW_DAYS;
}
