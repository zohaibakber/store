let electron = require("electron");
//#region electron/preload.ts
electron.contextBridge.exposeInMainWorld("ipcRenderer", {
	on(...args) {
		const [channel, listener] = args;
		return electron.ipcRenderer.on(channel, (event, ...args) => listener(event, ...args));
	},
	off(...args) {
		const [channel, ...omit] = args;
		return electron.ipcRenderer.off(channel, ...omit);
	},
	send(...args) {
		const [channel, ...omit] = args;
		return electron.ipcRenderer.send(channel, ...omit);
	},
	invoke(...args) {
		const [channel, ...omit] = args;
		return electron.ipcRenderer.invoke(channel, ...omit);
	}
});
electron.contextBridge.exposeInMainWorld("windowControls", {
	minimize() {
		electron.ipcRenderer.send("window-controls:minimize");
	},
	toggleMaximize() {
		return electron.ipcRenderer.invoke("window-controls:toggle-maximize");
	},
	isMaximized() {
		return electron.ipcRenderer.invoke("window-controls:is-maximized");
	},
	isFullScreen() {
		return electron.ipcRenderer.invoke("window-controls:is-full-screen");
	},
	onFullScreenChange(callback) {
		const listener = (_event, isFullScreen) => {
			callback(isFullScreen);
		};
		electron.ipcRenderer.on("window-controls:full-screen-changed", listener);
		return () => electron.ipcRenderer.off("window-controls:full-screen-changed", listener);
	},
	close() {
		electron.ipcRenderer.send("window-controls:close");
	}
});
electron.contextBridge.exposeInMainWorld("offlineStore", {
	listNotes: () => electron.ipcRenderer.invoke("store:notes:list"),
	createNote: (input) => electron.ipcRenderer.invoke("store:notes:create", input),
	updateNote: (input) => electron.ipcRenderer.invoke("store:notes:update", input),
	deleteNote: (input) => electron.ipcRenderer.invoke("store:notes:delete", input),
	getSyncStatus: () => electron.ipcRenderer.invoke("store:sync:status"),
	sync: () => electron.ipcRenderer.invoke("store:sync:run")
});
//#endregion
