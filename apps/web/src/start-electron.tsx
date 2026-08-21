import { createHashHistory } from "@tanstack/react-router";

import { bootstrapAuth } from "@/lib/auth";
import { completeGoogle } from "@/lib/first-party-auth";
import { electronStore } from "@/lib/store";

import { desktopHostAccess } from "./host-access";
import { mountApp } from "./mount-app";

export const startElectron = async () => {
  const store = electronStore();
  mountApp({
    store,
    initialAuth: await bootstrapAuth(),
    history: createHashHistory(),
    access: desktopHostAccess(),
  });
  window.auth?.onOAuthCallback((url) => {
    void completeGoogle(url);
  });
};
