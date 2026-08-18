import "@fontsource-variable/inter/index.css";
import "@fontsource-variable/geist-mono/index.css";
import "@/styles.css";

if (import.meta.env.VITE_ELECTRON) {
  const { startElectron } = await import("./start-electron");
  void startElectron();
} else {
  const { startWeb } = await import("./start-web");
  void startWeb();
}
