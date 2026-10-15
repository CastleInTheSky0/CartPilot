import assert from "node:assert/strict";
import test from "node:test";
import { BrowserCommandSchema, ConnectBrowserSchema } from "../../src/shared/contracts/browser.ts";

test("浏览器命令不提供脚本、购买动作、任意 URL 或资料路径入口", () => {
  for (const input of [
    { type: "evaluate", script: "location.href" },
    { type: "submit" },
    { type: "focus", platform: "other", url: "https://example.com/" },
    { type: "connect", input: { profileDirectory: null }, script: "alert(1)" },
  ])
    assert.equal(BrowserCommandSchema.safeParse(input).success, false);
  for (const profileDirectory of ["../Default", "C:\\Users\\Profile", "Profile 1 --flag", ""]) {
    assert.equal(ConnectBrowserSchema.safeParse({ profileDirectory }).success, false);
  }
  for (const profileDirectory of [null, "Default", "Profile 1"]) {
    assert.equal(ConnectBrowserSchema.safeParse({ profileDirectory }).success, true);
  }
});
