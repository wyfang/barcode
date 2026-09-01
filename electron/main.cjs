const path = require("node:path");
const { app, BrowserWindow, shell } = require("electron");

const APP_NAME = "欧阳骏条码工作台";

function openExternal(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      shell.openExternal(parsed.href);
    }
  } catch {
    // Ignore malformed external URLs.
  }
}

function createWindow() {
  const window = new BrowserWindow({
    autoHideMenuBar: true,
    backgroundColor: "#f4f4f5",
    height: 760,
    icon: path.join(__dirname, "..", "build", "icon.ico"),
    minHeight: 580,
    minWidth: 900,
    show: false,
    title: APP_NAME,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
    width: 1200,
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!/^https?:/i.test(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  window.once("ready-to-show", () => window.show());
  window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}

app.setName(APP_NAME);
app.setAppUserModelId("com.wangyifang.barcode");
app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
