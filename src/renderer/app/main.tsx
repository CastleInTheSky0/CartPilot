import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "../styles/base.css";

const root = document.getElementById("root");
if (!root) throw new Error("未找到应用挂载节点。");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
