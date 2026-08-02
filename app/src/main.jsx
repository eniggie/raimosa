import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { RemoteControlView } from "./views/RemoteView.jsx";
import "./styles.css";

const RootView =
  window.location.pathname === "/remote" ? RemoteControlView : App;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <RootView />
  </React.StrictMode>,
);
