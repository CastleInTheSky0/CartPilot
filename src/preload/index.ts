import { contextBridge, ipcRenderer } from "electron";
import {
  DESKTOP_CHANNELS,
  RuntimeInfoSchema,
  type DesktopApi,
} from "../shared/contracts/desktop.ts";

const api: DesktopApi = {
  async getRuntimeInfo() {
    const result: unknown = await ipcRenderer.invoke(DESKTOP_CHANNELS.runtime);
    return RuntimeInfoSchema.parse(result);
  },
};

contextBridge.exposeInMainWorld("cartPilot", Object.freeze(api));
