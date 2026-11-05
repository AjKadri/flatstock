import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);
if (import.meta.env.DEV && new URLSearchParams(window.location.search).get("demo") === "dots") {
  // Dev-only visual test page for the dot line (stripped from production builds).
  void import("./dev-demo").then(({ default: Demo }) => root.render(<Demo />));
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
