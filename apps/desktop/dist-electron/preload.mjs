let electron = require("electron");
//#region electron/preload.ts
electron.contextBridge.exposeInMainWorld("auth", {
	getSession: () => electron.ipcRenderer.invoke("auth:get-session"),
	signIn: (input) => electron.ipcRenderer.invoke("auth:sign-in", input),
	signUp: (input) => electron.ipcRenderer.invoke("auth:sign-up", input),
	signOut: () => electron.ipcRenderer.invoke("auth:sign-out"),
	switchOrganization: (input) => electron.ipcRenderer.invoke("auth:organization:switch", input),
	createOrganization: (input) => electron.ipcRenderer.invoke("auth:organization:create", input),
	onSessionChange(callback) {
		const listener = (_event, snapshot) => callback(snapshot);
		electron.ipcRenderer.on("auth:session-changed", listener);
		return () => electron.ipcRenderer.off("auth:session-changed", listener);
	}
});
electron.contextBridge.exposeInMainWorld("serverApi", {
	getModels: () => electron.ipcRenderer.invoke("server:models"),
	analyseInvoices: (input) => electron.ipcRenderer.invoke("server:uploads", input)
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
electron.contextBridge.exposeInMainWorld("updater", {
	getVersion: () => electron.ipcRenderer.invoke("updater:version"),
	check: () => electron.ipcRenderer.invoke("updater:check"),
	download: () => electron.ipcRenderer.invoke("updater:download"),
	install() {
		electron.ipcRenderer.send("updater:install");
	},
	onEvent(callback) {
		const listener = (_event, updaterEvent) => callback(updaterEvent);
		electron.ipcRenderer.on("updater:event", listener);
		return () => electron.ipcRenderer.off("updater:event", listener);
	}
});
var invokeStore = async (channel, input) => {
	const result = await electron.ipcRenderer.invoke(channel, input);
	if (result.ok) return result.value;
	throw result.error;
};
electron.contextBridge.exposeInMainWorld("offlineStore", {
	listCategories: () => invokeStore("store:categories:list"),
	listProducts: () => invokeStore("store:products:list"),
	searchProducts: (input) => invokeStore("store:products:search", input),
	getProduct: (input) => invokeStore("store:products:get", input),
	createProduct: (input) => invokeStore("store:products:create", input),
	updateProduct: (input) => invokeStore("store:products:update", input),
	deleteProduct: (input) => invokeStore("store:products:delete", input),
	createBatch: (input) => invokeStore("store:batches:create", input),
	importInventory: (input) => invokeStore("store:inventory:import", input),
	listStockMovements: (input) => invokeStore("store:stock-movements:list", input),
	listInvoices: () => invokeStore("store:invoices:list"),
	getInvoice: (input) => invokeStore("store:invoices:get", input),
	createInvoice: (input) => invokeStore("store:invoices:create", input),
	getSyncStatus: () => invokeStore("store:sync:status"),
	sync: () => invokeStore("store:sync:run")
});
//#endregion
