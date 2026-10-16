/// <reference types="vite/client" />
import { createElement } from "react";
import { mountApp } from "@fungi.computer/agar/react";
import { createQueryClient } from "@fungi.computer/agar/query";
import "./media.css";
import "@fungi.computer/caps/fonts.css";
import { MediaPane } from "./MediaPane.js";

const root = document.getElementById("media-root");
if (!root) throw new Error("Media root is missing");
const queryClient = createQueryClient();
const unmount = mountApp(root, { name: "Prints", queryClient }, ({ app }) =>
  createElement(MediaPane, { connection: app ? { app } : null }),
);
import.meta.hot?.dispose(() => {
  unmount();
  queryClient.clear();
});
