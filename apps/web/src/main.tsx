import "@fontsource-variable/inter/index.css";
import "@fontsource-variable/geist-mono/index.css";
import "@/styles.css";
import { startWeb } from "./start-web";

void startWeb().catch((cause: unknown) => {
  console.error("Web startup failed.", cause);
  const root = document.getElementById("root");
  if (!root) return;
  const message = document.createElement("p");
  message.className = "p-4 text-sm";
  message.textContent = "Tabaaq could not start. Reload the page to try again.";
  root.replaceChildren(message);
});
