import type React from "react";
import { toastManager } from "@/components/ui/toast";

// Sonner-shaped adapter over the coss/Base UI toastManager so call sites keep
// the familiar `toast.success("…", { description })` surface. Passing the same
// `id` upserts the existing toast (used by the app updater's progress toast).
interface AppToastOptions {
  id?: string;
  description?: React.ReactNode;
  /** Milliseconds, or `Infinity` to keep the toast until dismissed. */
  duration?: number;
  action?: { label: React.ReactNode; onClick: () => void };
}

type AppToastType = "success" | "error" | "warning" | "info" | "loading";

function add(
  type: AppToastType | undefined,
  title: React.ReactNode,
  options: AppToastOptions = {},
): void {
  toastManager.add({
    ...(options.id !== undefined && { id: options.id }),
    title,
    ...(options.description !== undefined && { description: options.description }),
    ...(type !== undefined && { type }),
    ...(options.duration !== undefined && {
      timeout: options.duration === Number.POSITIVE_INFINITY ? 0 : options.duration,
    }),
    ...(options.action !== undefined && {
      actionProps: { children: options.action.label, onClick: options.action.onClick },
    }),
  });
}

type ToastFn = (title: React.ReactNode, options?: AppToastOptions) => void;

export const toast: ToastFn & Record<AppToastType, ToastFn> = Object.assign(
  (title: React.ReactNode, options?: AppToastOptions) => add(undefined, title, options),
  {
    success: (title: React.ReactNode, options?: AppToastOptions) => add("success", title, options),
    error: (title: React.ReactNode, options?: AppToastOptions) => add("error", title, options),
    warning: (title: React.ReactNode, options?: AppToastOptions) => add("warning", title, options),
    info: (title: React.ReactNode, options?: AppToastOptions) => add("info", title, options),
    loading: (title: React.ReactNode, options?: AppToastOptions) => add("loading", title, options),
  },
);
