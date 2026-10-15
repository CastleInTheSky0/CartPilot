import { useEffect, useState } from "react";
import { ShoppingBag } from "lucide-react";
import type { RuntimeInfo } from "../../shared/contracts/desktop.ts";

export function App() {
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void window.cartPilot.getRuntimeInfo().then(
      (result) => {
        if (active) setRuntime(result);
      },
      () => {
        if (active) setError("无法读取桌面状态，请重新启动应用。");
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="workspace">
      <header className="app-header">
        <div className="brand">
          <ShoppingBag size={23} aria-hidden="true" />
          <strong>CartPilot</strong>
        </div>
        <span className="stage">桌面接入验证</span>
      </header>
      <section className="intro">
        <p className="eyebrow">购买工作台</p>
        <h1>先连接你的日常浏览器</h1>
        <p>通过官方扩展接入 Chrome，在你选择的页面中读取商品与登录状态。</p>
      </section>
      <section className="connection-section" aria-labelledby="connection-heading">
        <h2 id="connection-heading">浏览器接入</h2>
        <p>正在接入桌面扩展桥。完成验证后，可在这里连接并选择标签页。</p>
      </section>
      <section className="runtime-section" aria-labelledby="runtime-heading">
        <h2 id="runtime-heading">本机状态</h2>
        {error && <p role="alert">{error}</p>}
        {!runtime && !error && <p role="status">正在读取…</p>}
        {runtime && (
          <dl>
            <div>
              <dt>应用版本</dt>
              <dd>{runtime.version}</dd>
            </div>
            <div>
              <dt>运行环境</dt>
              <dd>
                Electron {runtime.electron} · Chromium {runtime.chromium}
              </dd>
            </div>
            <div>
              <dt>数据位置</dt>
              <dd>{runtime.dataDirectory}</dd>
            </div>
          </dl>
        )}
      </section>
      <footer>通用商品任务正在迁移，当前版本提供桌面接入验证。</footer>
    </main>
  );
}
