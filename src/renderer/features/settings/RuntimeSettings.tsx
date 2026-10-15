import { CheckCheck, Database, Folder, Monitor } from "lucide-react";
import type { RuntimeInfo } from "../../../shared/contracts/desktop.ts";
import styles from "./settings.module.css";

interface Props {
  runtime: RuntimeInfo | null;
  error: string;
}

export function RuntimeSettings({ runtime, error }: Props) {
  return (
    <section className={styles.settings} aria-labelledby="runtime-heading">
      <div className={styles.heading}>
        <Monitor size={17} />
        <h2 id="runtime-heading">本机状态</h2>
        {runtime && (
          <span>
            <CheckCheck size={14} />
            已就绪
          </span>
        )}
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {!runtime && !error && (
        <p className={styles.loading} role="status">
          正在读取…
        </p>
      )}
      {runtime && (
        <>
          <dl>
            <div>
              <dt>应用版本</dt>
              <dd>
                CartPilot {runtime.version}
                <small>{runtime.isPackaged ? "Windows 桌面安装版" : "本地开发构建"}</small>
              </dd>
            </div>
            <div>
              <dt>运行环境</dt>
              <dd>
                Electron {runtime.electron}
                <small>Chromium {runtime.chromium}</small>
              </dd>
            </div>
            <div>
              <dt>
                <Database size={14} />
                本地数据库
              </dt>
              <dd>
                SQLite {runtime.storage.sqliteVersion}
                <small>迁移版本 {runtime.storage.schemaVersion}</small>
              </dd>
            </div>
            <div>
              <dt>
                <Folder size={14} />
                数据位置
              </dt>
              <dd className={styles.path}>{runtime.dataDirectory}</dd>
            </div>
          </dl>
          <p className={styles.note}>
            配置保存在本机。浏览器会话与标签页标识不会作为登录凭据保存。
          </p>
        </>
      )}
    </section>
  );
}
