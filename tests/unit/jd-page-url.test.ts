import assert from "node:assert/strict";
import test from "node:test";
import { canonicalProductUrl, isPlatformUrl, productId } from "../../server/safety.ts";
import {
  candidateUrlIdentity,
  canonicalCandidateUrl,
} from "../../src/shared/contracts/product-url.ts";
import { purchaseDefinition } from "./purchase-fixture.ts";

const INTERNATIONAL_PRODUCT = "https://npcitem.jd.hk/100020569664.html";

test("京东国际页面可列出，商品链接保留国际站身份并移除跟踪参数", () => {
  const tracked = `${INTERNATIONAL_PRODUCT}?tracking=PRIVATE#details`;
  assert.equal(isPlatformUrl(tracked, "jd"), true);
  assert.equal(productId(tracked, "jd"), "100020569664");
  assert.equal(canonicalProductUrl(tracked, "jd"), INTERNATIONAL_PRODUCT);
  assert.equal(canonicalCandidateUrl(tracked, "jd"), INTERNATIONAL_PRODUCT);
  assert.deepEqual(candidateUrlIdentity(tracked, "jd"), {
    productId: "100020569664",
    skuId: null,
  });
  const definition = purchaseDefinition();
  const task = purchaseDefinition({
    candidates: [{ ...definition.candidates[0], productUrl: tracked, productId: "100020569664" }],
  });
  assert.equal(task.candidates[0].productUrl, INTERNATIONAL_PRODUCT);
  assert.equal(
    canonicalCandidateUrl("https://item.m.jd.com/product/123.html", "jd"),
    "https://item.jd.com/123.html",
  );
});

test("京东国际接入仍拒绝伪造域名、不安全地址及其他平台", () => {
  for (const value of [
    "https://npcitem.jd.hk.evil.example/100020569664.html",
    "https://notjd.hk/100020569664.html",
    "http://npcitem.jd.hk/100020569664.html",
    "https://npcitem.jd.hk:8443/100020569664.html",
    "https://user:secret@npcitem.jd.hk/100020569664.html",
  ]) {
    assert.equal(isPlatformUrl(value, "jd"), false, value);
    assert.equal(productId(value, "jd"), null, value);
    assert.equal(canonicalCandidateUrl(value, "jd"), null, value);
  }
  assert.equal(isPlatformUrl(INTERNATIONAL_PRODUCT, "tmall"), false);
  for (const value of [
    "https://www.jd.hk/",
    "https://npcitem.jd.hk/search?keyword=123",
    `${INTERNATIONAL_PRODUCT}.evil`,
  ]) {
    assert.equal(productId(value, "jd"), null);
    assert.equal(canonicalCandidateUrl(value, "jd"), null);
  }
});
