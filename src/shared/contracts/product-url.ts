import type { Platform } from "./browser.ts";

export function canonicalCandidateUrl(value: string, platform: Platform): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (platform === "apple") {
    if (
      url.hostname !== "www.apple.com.cn" ||
      !/^\/shop\/(?:buy-[a-z0-9-]+\/[a-z0-9-]+|product\/[a-z0-9-]+)(?:\/|$)/i.test(url.pathname)
    )
      return null;
    return `${url.origin}${url.pathname}`;
  }
  if (platform === "jd") {
    const id =
      url.hostname === "item.jd.com"
        ? url.pathname.match(/^\/(\d+)\.html$/)?.[1]
        : url.hostname === "item.m.jd.com"
          ? url.pathname.match(/^\/product\/(\d+)\.html$/)?.[1]
          : null;
    return id ? `https://item.jd.com/${id}.html` : null;
  }
  if (platform === "douyin" && url.hostname === "www.douyin.com") {
    const id = url.pathname.match(/^\/shopping\/product\/(\d+)\/?$/)?.[1];
    return id ? `https://www.douyin.com/shopping/product/${id}` : null;
  }
  const ids = [...url.searchParams.getAll("id"), ...url.searchParams.getAll("product_id")];
  if (ids.length !== 1 || !/^\d+$/.test(ids[0])) return null;
  if (platform === "douyin") {
    if (
      url.hostname !== "haohuo.jinritemai.com" ||
      !/^\/(?:ecommerce\/trade\/detail\/index.html|views\/product\/detail|commerce\/share\/goodsdetail\/index.html)$/.test(
        url.pathname,
      )
    )
      return null;
    return `${url.origin}${url.pathname}?id=${ids[0]}`;
  }
  const tmall = ["detail.tmall.com", "detail.m.tmall.com"].includes(url.hostname);
  const taobao = ["item.taobao.com", "h5.m.taobao.com", "m.taobao.com"].includes(url.hostname);
  if (
    (!tmall && !(platform === "taobao" && taobao)) ||
    !/^(?:\/item.htm|\/awp\/core\/detail.htm)$/.test(url.pathname)
  )
    return null;
  const canonical = new URL(
    tmall ? "https://detail.tmall.com/item.htm" : "https://item.taobao.com/item.htm",
  );
  canonical.searchParams.set("id", ids[0]);
  const skus = url.searchParams.getAll("skuId");
  if (skus.length > 1 || (skus.length === 1 && !/^\d+$/.test(skus[0]))) return null;
  if (skus[0]) canonical.searchParams.set("skuId", skus[0]);
  return canonical.href;
}
