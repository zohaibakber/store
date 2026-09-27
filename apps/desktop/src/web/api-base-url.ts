const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();

export const apiBaseUrl = (configuredApiUrl || "http://localhost:8787").replace(/\/+$/u, "");
