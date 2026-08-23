import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadAppConfig } from "./config";
import "./styles.css";

const config = loadAppConfig();
const root = document.getElementById("root");
if (!root) throw new Error("#root element not found");

createRoot(root).render(
  <React.StrictMode>
    <App config={config} />
  </React.StrictMode>
);
