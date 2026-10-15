import assert from "node:assert/strict";
import test from "node:test";
import { isTrustedRendererUrl } from "../../src/main/ipc/renderer-access.ts";

test("桌面接口只接受指定页面，拒绝外站、相邻文件与伪造端口", () => {
  const expected = "file:///C:/CartPilot/out/renderer/index.html";
  assert.equal(isTrustedRendererUrl(`${expected}#connections`, expected), true);
  for (const url of [
    "https://example.com/",
    "file:///C:/CartPilot/out/renderer/other.html",
    `${expected}?other`,
    "invalid",
  ]) {
    assert.equal(isTrustedRendererUrl(url, expected), false);
  }
  assert.equal(isTrustedRendererUrl("http://127.0.0.1:5174/", "http://127.0.0.1:5174/"), true);
  assert.equal(isTrustedRendererUrl("http://127.0.0.1:5173/", "http://127.0.0.1:5174/"), false);
});
