import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import type Database from "better-sqlite3";

const LEGACY_FILES = [
  "workspace.json",
  "settings.json",
  "submission.json",
  "access-state.json",
  "events.ndjson",
  "browser-connection.json",
];
export const hashText = (value: string | Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

export interface LegacySnapshot {
  sourceId: string;
  sourceDirectory: string;
  fingerprint: string;
  files: Map<string, Buffer>;
}

export async function readLegacySnapshot(source: string): Promise<LegacySnapshot> {
  if (!isAbsolute(source)) throw new Error("旧数据目录必须是绝对路径。");
  const sourceDirectory = await realpath(source);
  const files = new Map<string, Buffer>();
  for (const name of LEGACY_FILES) {
    const path = join(sourceDirectory, name);
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size > 100 * 1024 * 1024)
        throw new Error(`旧文件 ${name} 过大或不是普通文件，请先人工检查。`);
      files.set(name, await readFile(path));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  const sourceId = hashText(
    process.platform === "win32" ? sourceDirectory.toLowerCase() : sourceDirectory,
  );
  const fingerprint = hashText(
    JSON.stringify([...files].map(([name, content]) => [name, hashText(content)])),
  );
  return { sourceId, sourceDirectory, fingerprint, files };
}

export async function backupLegacySnapshot(
  snapshot: LegacySnapshot,
  dataDirectory: string,
  database: Database.Database,
): Promise<string> {
  if (resolve(snapshot.sourceDirectory) === resolve(dataDirectory))
    throw new Error("旧数据目录不能是当前桌面数据目录。");
  const backupDirectory = join(dataDirectory, "legacy-backups", snapshot.sourceId, randomUUID());
  await mkdir(backupDirectory, { recursive: true });
  for (const [name, content] of snapshot.files)
    await writeFile(join(backupDirectory, name), content, { encoding: "utf8", flag: "wx" });
  await database.backup(join(backupDirectory, "desktop-before-import.sqlite"));
  const current = await readLegacySnapshot(snapshot.sourceDirectory);
  if (current.fingerprint !== snapshot.fingerprint)
    throw new Error("旧数据在备份期间发生变化，请先停止旧服务后重新导入。");
  await writeFile(
    join(backupDirectory, "manifest.json"),
    JSON.stringify(
      {
        sourceDirectory: snapshot.sourceDirectory,
        fingerprint: snapshot.fingerprint,
        files: [...snapshot.files.keys()],
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
  return backupDirectory;
}
