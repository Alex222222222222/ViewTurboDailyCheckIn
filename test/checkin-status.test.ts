import assert from "node:assert/strict";
import test from "node:test";
import { classifyCheckInTitle } from "../src/checkin-status.js";

test("classifies regular and seventh-day check-in titles", () => {
  assert.equal(classifyCheckInTitle("今日已领 100MB"), "checked");
  assert.equal(classifyCheckInTitle("今日已领 200MB"), "checked");
  assert.equal(classifyCheckInTitle("签到领 100MB"), "unchecked");
  assert.equal(classifyCheckInTitle("签到挚会员"), "seventh_day");
  assert.equal(classifyCheckInTitle("正在加载"), "unsettled");
});
