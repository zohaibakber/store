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
electron.contextBridge.exposeInMainWorld("offlineStore", {
	listCategories: () => electron.ipcRenderer.invoke("store:categories:list"),
	listProducts: () => electron.ipcRenderer.invoke("store:products:list"),
	searchProducts: (input) => electron.ipcRenderer.invoke("store:products:search", input),
	getProduct: (input) => electron.ipcRenderer.invoke("store:products:get", input),
	createProduct: (input) => electron.ipcRenderer.invoke("store:products:create", input),
	updateProduct: (input) => electron.ipcRenderer.invoke("store:products:update", input),
	deleteProduct: (input) => electron.ipcRenderer.invoke("store:products:delete", input),
	createBatch: (input) => electron.ipcRenderer.invoke("store:batches:create", input),
	listStockMovements: (input) => electron.ipcRenderer.invoke("store:stock-movements:list", input),
	listInvoices: () => electron.ipcRenderer.invoke("store:invoices:list"),
	getInvoice: (input) => electron.ipcRenderer.invoke("store:invoices:get", input),
	createInvoice: (input) => electron.ipcRenderer.invoke("store:invoices:create", input),
	getSyncStatus: () => electron.ipcRenderer.invoke("store:sync:status"),
	sync: () => electron.ipcRenderer.invoke("store:sync:run")
});
//#endregion
