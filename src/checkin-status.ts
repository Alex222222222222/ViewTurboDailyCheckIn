export const CHECKED_IN_TEXT = "今日已领";
export const UNCHECKED_TEXT = "签到领";
export const SEVENTH_DAY_TEXT = "签到挚会员";

export type CheckInControlState = "checked" | "unchecked" | "seventh_day" | "unsettled";

export function classifyCheckInTitle(title: string): CheckInControlState {
  if (title.includes(CHECKED_IN_TEXT)) return "checked";
  if (title.includes(UNCHECKED_TEXT)) return "unchecked";
  if (title.includes(SEVENTH_DAY_TEXT)) return "seventh_day";
  return "unsettled";
}
