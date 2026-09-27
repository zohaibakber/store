import "@fontsource-variable/inter/index.css";
import "@fontsource-variable/geist-mono/index.css";
import "@/styles.css";

const start = async () => {
  if (window.inventoryHttp !== undefined) {
    const { startElectron } = await import("./start-electron");
    return startElectron();
  }
  const { startWeb } = await import("./start-web");
  return startWeb();
};

void start().catch((cause: unknown) => {
  console.error("Desktop startup failed.", cause);
  const root = document.getElementById("root");
  if (!root) return;
  const message = document.createElement("p");
  message.className = "p-4 text-sm";
  message.textContent = "Tabaaq could not start. Reload the page to try again.";
  root.replaceChildren(message);
});
