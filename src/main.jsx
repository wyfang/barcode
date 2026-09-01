import React from "react";
import ReactDOM from "react-dom/client";
import { Toast } from "@heroui/react";
import App from "./App.jsx";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <Toast.Provider
      placement="bottom"
      width="min(320px, calc(100vw - 32px))"
    />
  </React.StrictMode>,
);
