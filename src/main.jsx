import React from "react";
import { createRoot } from "react-dom/client";

// Self-hosted fonts so the app looks right with no connection
import "@fontsource/playfair-display/700.css";
import "@fontsource/playfair-display/900.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
import "./index.css";

import BlackjackTrainer from "./BlackjackTrainer.jsx";

// The trainer was written against a small async key/value API (window.storage).
// Outside the Claude artifact environment that doesn't exist, so back it with
// localStorage. Stats and heat map then persist on the phone, offline.
if (typeof window !== "undefined" && !window.storage) {
  const PREFIX = "bj-trainer:";
  window.storage = {
    async get(key) {
      const value = window.localStorage.getItem(PREFIX + key);
      if (value === null) throw new Error("Key not found");
      return { key, value };
    },
    async set(key, value) {
      window.localStorage.setItem(PREFIX + key, value);
      return { key, value };
    },
    async delete(key) {
      window.localStorage.removeItem(PREFIX + key);
      return { key, deleted: true };
    },
  };
}

createRoot(document.getElementById("root")).render(<BlackjackTrainer />);
