export const colors = {
  ground: "#FFFFFF",
  ink: "#1A1A1A",
  muted: "#6B6B6B",
  placeholder: "#9A9A9A",
  hairline: "#EBEBEB",
  surface: "#F5F5F5",
  highlight: "#FFE14D",
  error: "#C62828",
  synced: "#1E7B4F",
  camera: "#000000",
  onCamera: "#FFFFFF",
  cameraScrim: "rgba(0,0,0,0.55)",
  cameraChip: "rgba(255,255,255,0.12)",
} as const;

export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  mono: "JetBrainsMono_400Regular",
} as const;

export const type = {
  xs: { fontSize: 12, lineHeight: 16 },
  sm: { fontSize: 14, lineHeight: 20 },
  base: { fontSize: 16, lineHeight: 24 },
  lg: { fontSize: 18, lineHeight: 24 },
  "2xl": { fontSize: 24, lineHeight: 30, letterSpacing: -0.48 },
} as const;

export type TypeSize = keyof typeof type;

export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  6: 24,
  8: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 28,
  full: 999,
} as const;

export const touch = {
  minimum: 48,
  primary: 56,
} as const;

export const motion = {
  quick: 160,
  standard: 240,
  emphasized: 400,
} as const;
