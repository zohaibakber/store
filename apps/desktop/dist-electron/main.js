import { Database as e } from "@tursodatabase/sync";
import t from "node:crypto";
import n, { existsSync as r, readdirSync as i } from "node:fs";
import a, { join as o } from "node:path";
import { BrowserWindow as s, app as c, ipcMain as l } from "electron";
import { fileURLToPath as u } from "node:url";
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/entity.js
var d = Symbol.for("drizzle:entityKind");
function f(e, t) {
	if (!e || typeof e != "object") return !1;
	if (e instanceof t) return !0;
	if (!Object.prototype.hasOwnProperty.call(t, d)) throw Error(`Class "${t.name ?? "<unknown>"}" doesn't look like a Drizzle entity. If this is incorrect and the class is provided by Drizzle, please report this as a bug.`);
	let n = Object.getPrototypeOf(e)?.constructor;
	if (n) for (; n;) {
		if (d in n && n[d] === t[d]) return !0;
		n = Object.getPrototypeOf(n);
	}
	return !1;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/column-common.js
var p = Symbol.for("drizzle:OriginalColumn"), m = (e) => e;
m.isNoop = !0;
var h = class {
	static [d] = "Column";
	codec;
	name;
	keyAsName;
	primary;
	notNull;
	default;
	defaultFn;
	onUpdateFn;
	hasDefault;
	isUnique;
	uniqueName;
	uniqueType;
	dataType;
	columnType;
	enumValues = void 0;
	generated = void 0;
	generatedIdentity = void 0;
	length;
	isLengthExact;
	isAlias;
	config;
	table;
	onInit() {}
	constructor(e, t) {
		this.config = t, this.onInit(), this.table = e, this.name = t.name, this.isAlias = !1, this.keyAsName = t.keyAsName, this.notNull = t.notNull, this.default = t.default, this.defaultFn = t.defaultFn, this.onUpdateFn = t.onUpdateFn, this.hasDefault = t.hasDefault, this.primary = t.primaryKey, this.isUnique = t.isUnique, this.uniqueName = t.uniqueName, this.uniqueType = t.uniqueType, this.dataType = t.dataType, this.columnType = t.columnType, this.generated = t.generated, this.generatedIdentity = t.generatedIdentity, this.length = t.length, this.isLengthExact = t.isLengthExact;
	}
	mapFromDriverValue = m;
	mapToDriverValue = m;
	postBuild() {
		return this;
	}
	shouldDisableInsert() {
		return this.config.generated !== void 0 && this.config.generated.type !== "byDefault";
	}
	[p]() {
		return this;
	}
};
function g(e) {
	return e.table;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/table.utils.js
var _ = Symbol.for("drizzle:Name"), v = Symbol.for("drizzle:Schema"), y = Symbol.for("drizzle:Columns"), b = Symbol.for("drizzle:ExtraConfigColumns"), x = Symbol.for("drizzle:OriginalName"), S = Symbol.for("drizzle:BaseName"), C = Symbol.for("drizzle:IsAlias"), ee = Symbol.for("drizzle:ExtraConfigBuilder"), te = Symbol.for("drizzle:IsDrizzleTable"), w = class {
	static [d] = "Table";
	static Symbol = {
		Name: _,
		Schema: v,
		OriginalName: x,
		Columns: y,
		ExtraConfigColumns: b,
		BaseName: S,
		IsAlias: C,
		ExtraConfigBuilder: ee
	};
	[_];
	[x];
	[v];
	[y];
	[b];
	[S];
	[C] = !1;
	[te] = !0;
	[ee] = void 0;
	constructor(e, t, n) {
		this[_] = this[x] = e, this[v] = t, this[S] = n;
	}
};
function ne(e) {
	return typeof e == "object" && !!e && te in e;
}
function re(e) {
	return e[_];
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/subquery.js
var T = class {
	static [d] = "Subquery";
	constructor(e, t, n, r = !1, i = []) {
		this._ = {
			brand: "Subquery",
			sql: e,
			selectedFields: t,
			alias: n,
			isWith: r,
			usedTables: i
		};
	}
}, ie = class extends T {
	static [d] = "WithSubquery";
}, ae = { startActiveSpan(e, t) {
	return t();
} }, E = Symbol.for("drizzle:ViewBaseConfig");
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/sql/sql.js
function oe(e) {
	return e != null && typeof e.getSQL == "function";
}
function se(e) {
	let t = {
		sql: "",
		params: []
	};
	for (let n of e) t.sql += n.sql, t.params.push(...n.params);
	return t;
}
function ce(e) {
	let t = {
		sql: "",
		params: []
	}, n = [];
	for (let r of e) n.push(r.sql), t.params.push(...r.params);
	return t._sql = Object.assign(n, { raw: n }), t;
}
var D = class {
	static [d] = "StringChunk";
	value;
	constructor(e) {
		this.value = Array.isArray(e) ? e : [e];
	}
	getSQL() {
		return new O([this]);
	}
}, O = class e {
	static [d] = "SQL";
	decoder = de;
	shouldInlineParams = !1;
	usedTables = [];
	constructor(e) {
		this.queryChunks = e;
		for (let t of e) if (f(t, w)) {
			let e = t[w.Symbol.Schema];
			this.usedTables.push(e === void 0 ? t[w.Symbol.Name] : e + "." + t[w.Symbol.Name]);
		}
	}
	append(e) {
		return this.queryChunks.push(...e.queryChunks), this;
	}
	toQuery(e) {
		return ae.startActiveSpan("drizzle.buildSQL", (t) => {
			let n = this.buildQueryFromSourceParams(this.queryChunks, e);
			return t?.setAttributes({
				"drizzle.query.text": n.sql,
				"drizzle.query.params": JSON.stringify(n.params)
			}), n;
		});
	}
	buildQueryFromSourceParams(t, n) {
		let r = Object.assign({}, n, {
			inlineParams: n.inlineParams || this.shouldInlineParams,
			paramStartIndex: n.paramStartIndex || { value: 0 }
		}), { escapeName: i, escapeParam: a, codecs: o, inlineParams: s, paramStartIndex: c, invokeSource: l } = r, u = t.map((t) => {
			if (f(t, D)) return {
				sql: t.value.join(""),
				params: []
			};
			if (f(t, le)) return {
				sql: i(t.value),
				params: []
			};
			if (t === void 0) return {
				sql: "",
				params: []
			};
			if (Array.isArray(t)) {
				let e = [new D("(")];
				for (let [n, r] of t.entries()) e.push(r), n < t.length - 1 && e.push(new D(", "));
				return e.push(new D(")")), this.buildQueryFromSourceParams(e, r);
			}
			if (f(t, e)) return this.buildQueryFromSourceParams(t.queryChunks, {
				...r,
				inlineParams: s || t.shouldInlineParams
			});
			if (f(t, w)) {
				let e = t[w.Symbol.Schema], n = t[w.Symbol.Name];
				return l === "mssql-view-with-schemabinding" ? {
					sql: i(e === void 0 ? "dbo" : e) + "." + i(n),
					params: []
				} : {
					sql: e === void 0 || t[C] ? i(n) : i(e) + "." + i(n),
					params: []
				};
			}
			if (f(t, h)) {
				let e = t.name;
				if (n.invokeSource === "indexes") return {
					sql: i(e),
					params: []
				};
				let r = l === "mssql-check" ? void 0 : t.table[w.Symbol.Schema];
				return {
					sql: t.isAlias ? i(t.name) : t.table[C] || r === void 0 ? i(t.table[w.Symbol.Name]) + "." + i(e) : i(r) + "." + i(t.table[w.Symbol.Name]) + "." + i(e),
					params: []
				};
			}
			if (f(t, ve)) {
				let e = t[E].schema, n = t[E].name;
				return {
					sql: e === void 0 || t[E].isAlias ? i(n) : i(e) + "." + i(n),
					params: []
				};
			}
			if (f(t, pe)) {
				if (f(t.value, e)) return this.buildQueryFromSourceParams([t.value], r);
				let n = o && f(t.encoder, h);
				if (f(t.value, he)) {
					let e = a(c.value++, t);
					return t.codec = n ? (e) => o.apply(t.encoder, "normalizeParam", e) : void 0, {
						sql: n ? o.apply(t.encoder, "castParam", e) : e,
						params: [t]
					};
				}
				let i;
				if (t.value === null) i = t.value;
				else {
					if (i = t.encoder.mapToDriverValue.isNoop ? t.value : t.encoder.mapToDriverValue(t.value), f(i, e)) return this.buildQueryFromSourceParams([i], r);
					n && (i = o.apply(t.encoder, "normalizeParam", i));
				}
				if (s) return {
					sql: this.mapInlineParam(i, r),
					params: []
				};
				let l = a(c.value++, i);
				return {
					sql: n ? o.apply(t.encoder, "castParam", l) : l,
					params: [i]
				};
			}
			return f(t, he) ? {
				sql: a(c.value++, t),
				params: [t]
			} : f(t, e.Aliased) && t.fieldAlias !== void 0 ? {
				sql: (t.origin === void 0 ? "" : i(t.origin) + ".") + i(t.fieldAlias),
				params: []
			} : f(t, T) ? t._.isWith ? {
				sql: i(t._.alias),
				params: []
			} : this.buildQueryFromSourceParams([
				new D("("),
				t._.sql,
				new D(") "),
				new le(t._.alias)
			], r) : typeof t == "function" && "enumName" in t ? "schema" in t && t.schema ? {
				sql: i(t.schema) + "." + i(t.enumName),
				params: []
			} : {
				sql: i(t.enumName),
				params: []
			} : oe(t) ? t.shouldOmitSQLParens?.() ? this.buildQueryFromSourceParams([t.getSQL()], r) : this.buildQueryFromSourceParams([
				new D("("),
				t.getSQL(),
				new D(")")
			], r) : s ? {
				sql: this.mapInlineParam(t, r),
				params: []
			} : {
				sql: a(c.value++, t),
				params: [t]
			};
		});
		return n.tagged ? ce(u) : se(u);
	}
	mapInlineParam(e, { escapeString: t }) {
		if (e === null) return "null";
		if (typeof e == "number" || typeof e == "boolean" || typeof e == "bigint") return e.toString();
		if (typeof e == "string") return t(e);
		if (typeof e == "object") {
			let n = e.toString();
			return t(n === "[object Object]" ? JSON.stringify(e) : n);
		}
		throw Error("Unexpected param value: " + e);
	}
	getSQL() {
		return this;
	}
	as(t) {
		return t === void 0 ? this : new e.Aliased(this, t);
	}
	mapWith(e) {
		return this.decoder = typeof e == "function" ? { mapFromDriverValue: e } : e, this;
	}
	nullable() {
		return this;
	}
	inlineParams() {
		return this.shouldInlineParams = !0, this;
	}
	if(e) {
		return e ? this : void 0;
	}
}, le = class {
	static [d] = "Name";
	brand;
	constructor(e) {
		this.value = e;
	}
	getSQL() {
		return new O([this]);
	}
};
function ue(e) {
	return typeof e == "object" && !!e && "mapToDriverValue" in e && typeof e.mapToDriverValue == "function";
}
var de = { mapFromDriverValue: (e) => e };
de.mapFromDriverValue.isNoop = !0;
var fe = { mapToDriverValue: (e) => e };
fe.mapToDriverValue.isNoop = !0, {
	...de,
	...fe
};
var pe = class {
	static [d] = "Param";
	brand;
	constructor(e, t = fe, n) {
		this.value = e, this.encoder = t, this.codec = n;
	}
	getSQL() {
		return new O([this]);
	}
};
function k(e, ...t) {
	let n = [];
	(t.length > 0 || e.length > 0 && e[0] !== "") && n.push(new D(e[0]));
	for (let [r, i] of t.entries()) n.push(i, new D(e[r + 1]));
	return new O(n);
}
(function(e) {
	function t() {
		return new O([]);
	}
	e.empty = t;
	function n(e) {
		return new O(e);
	}
	e.fromList = n;
	function r(e) {
		return new O([new D(e)]);
	}
	e.raw = r;
	function i(e, t) {
		let n = [];
		for (let [r, i] of e.entries()) r > 0 && t !== void 0 && n.push(t), n.push(i);
		return new O(n);
	}
	e.join = i;
	function a(e) {
		return new le(e);
	}
	e.identifier = a;
	function o(e) {
		return new he(e);
	}
	e.placeholder = o;
	function s(e, t) {
		return new pe(e, t);
	}
	e.param = s;
	function c(e) {
		let t = me(e);
		if (t.length) return k.raw(t);
	}
	e.comment = c;
})(k ||= {});
function me(e) {
	let t = me.encodeInput(e);
	return t.length ? `/*${t}*/` : "";
}
(function(e) {
	function t(e, t) {
		let r;
		if (typeof e == "object" && typeof t == "object") r = n({
			...e,
			...t
		});
		else if (e && t) r = [n(e), n(t)].filter((e) => e.length).join(",");
		else if (t) r = n(t);
		else if (e) r = n(e);
		else return "";
		return r.length ? `/*${r}*/` : "";
	}
	e.merge = t;
	function n(e) {
		if (typeof e == "string") return e.length ? i(e) : e;
		let t = [];
		for (let [n, i] of Object.entries(e)) {
			if (i == null || i === "") continue;
			let e = r(n), a = r(String(i));
			t.push(`${e}='${a}'`);
		}
		return t.length ? t.sort().join(",") : "";
	}
	e.encodeInput = n;
	function r(e) {
		return encodeURIComponent(e).replace(/'/g, "\\'");
	}
	e.sanitizeObjectElement = r;
	function i(e) {
		return e.replace(/\/\*/g, "/ *").replace(/\*\//g, "* /");
	}
	e.sanitizeStringInput = i;
})(me ||= {}), (function(e) {
	class t {
		static [d] = "SQL.Aliased";
		isSelectionField = !1;
		origin;
		constructor(e, t) {
			this.sql = e, this.fieldAlias = t;
		}
		getSQL() {
			return this.sql;
		}
		clone() {
			return new t(this.sql, this.fieldAlias);
		}
	}
	e.Aliased = t;
})(O ||= {});
var he = class {
	static [d] = "Placeholder";
	constructor(e) {
		this.name = e;
	}
	getSQL() {
		return new O([this]);
	}
};
function ge(e, t) {
	return e.map((e) => {
		if (f(e, he)) {
			if (!(e.name in t)) throw Error(`No value for placeholder "${e.name}" was provided`);
			return t[e.name];
		}
		if (f(e, pe) && f(e.value, he)) {
			if (!(e.value.name in t)) throw Error(`No value for placeholder "${e.value.name}" was provided`);
			let n = t[e.value.name];
			if (n === null) return n;
			let r = e.encoder.mapToDriverValue.isNoop ? n : e.encoder.mapToDriverValue(n);
			return e.codec ? e.codec(r) : r;
		}
		return e;
	});
}
var _e = Symbol.for("drizzle:IsDrizzleView"), ve = class {
	static [d] = "View";
	[E];
	[_e] = !0;
	get [_]() {
		return this[E].name;
	}
	get [v]() {
		return this[E].schema;
	}
	get [C]() {
		return this[E].isAlias;
	}
	get [x]() {
		return this[E].originalName;
	}
	get [y]() {
		return this[E].selectedFields;
	}
	constructor({ name: e, schema: t, selectedFields: n, query: r }) {
		this[E] = {
			name: e,
			originalName: e,
			schema: t,
			selectedFields: n,
			query: r,
			isExisting: !r,
			isAlias: !1
		};
	}
};
function ye(e) {
	return typeof e == "object" && !!e && _e in e;
}
h.prototype.getSQL = function() {
	return new O([this]);
}, T.prototype.getSQL = function() {
	return new O([this]);
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/utils.js
var be = Object.getPrototypeOf(() => null).constructor;
function xe(e, t = {}) {
	let n = [], r = [];
	r.push(`const [ ${e.map((e, t) => `c${t}`).join(", ")} ] = rows[i];`);
	let i = {}, a = {}, o = Array.from({ length: e.length });
	for (let r = 0; r < e.length; ++r) {
		let { field: s, path: c, codec: l, arrayDimensions: u } = e[r], d, p, m, g = !1;
		f(s, h) ? (g = !0, d = s, m = `field: decoder${r}`) : f(s, O) ? (d = s.decoder, m = `field: { decoder: decoder${r} }`) : f(s, T) ? (d = s._.sql.decoder, m = `field: { _: { sql: { decoder: decoder${r} } } }`) : (d = s.sql.decoder, m = `field: { sql: { decoder: decoder${r} } }`), p = `decoder${r}.mapFromDriverValue`, d.mapFromDriverValue.isNoop && (p = ""), p ? n.push(`const { ${m}${l ? `, codec: codec${r}` : ""} } = columns[${r}];`) : l && n.push(`const { codec: codec${r} } = columns[${r}];`);
		let _ = `c${r}`, v = _;
		if (l && (v = `codec${r}(${v}, ${u})`), p && (v = `${p}(${v})`), o[r] = _ === v ? `${_}` : `${_} === null ? ${_} : ${v}`, c.length !== 2 || !g) continue;
		a[c[0]] === void 0 ? a[c[0]] = [`c${r}`] : a[c[0]]?.push(`c${r}`);
		let [y] = c, b = re(s.table);
		i[y] = t[b] ? !1 : typeof i[y] == "string" ? i[y] === b ? b : !1 : b;
	}
	r.push("mapped[i] = {");
	let s = [];
	for (let t = 0; t < e.length; ++t) {
		let { path: n } = e[t], c = n.map((e) => JSON.stringify(e)), l = o[t], u = n.slice(0, -1), d = 0;
		for (; d < s.length && d < u.length && s[d] === u[d];) d++;
		for (let e = s.length - 1; e >= d; --e) r.push(`${"	".repeat(e + 1)}},`);
		for (let e = d; e < u.length; ++e) r.push(`${"	".repeat(e + 1)}${c[e]}: ${e === 0 && u.length === 1 && typeof i[n[0]] == "string" ? `${a[n[0]]?.map((e) => `${e} === null`).join(" && ")} ? null : {` : "{"}`);
		s = u, r.push(`${"	".repeat(n.length)}${c[n.length - 1]}: ${l},`);
	}
	for (let e = s.length - 1; e >= 0; --e) r.push(`${"	".repeat(e + 1)}},`);
	return r.push("};"), `${n.length ? `${n.join("\n	")}\n\t` : ""}for (let i = 0; i < length; ++i) {
		${r.join("\n		")}
	}`;
}
function Se(e, t) {
	let n = `\t"use strict";
	const { columns } = this;
	const { length } = rows;
	const mapped = Array.from({ length });
	${xe(e, t)}
	return mapped;
	//# sourceURL=drizzle:jit-query-mapper`;
	return Object.assign(new be("rows", n).bind({ columns: e }), { body: `function jitQueryMapper (rows) {\n${n}\n}` });
}
function Ce(e) {
	if (!e) return !1;
	try {
		let e = new be("input", "\"use strict\"; return input;")(!0);
		return e !== !0 && (console.warn("Unable to use jit mappers due to incompatibility: corrupted jit function output.\nFalling back to premade mappers.\nError details:"), console.error(`Expected to receive \`true\`, got: ${e}`)), !0;
	} catch (e) {
		return console.warn("Unable to use jit mappers due to incompatibility.\nFalling back to premade mappers.\nError details:"), console.error(e), !1;
	}
}
function we(e, t) {
	let n = e.map(({ field: e, codec: n, arrayDimensions: r, path: i }) => {
		let a, o;
		if (f(e, h)) {
			if (o = e, t && i.length === 2) {
				let t = i[0];
				a = (n, r) => {
					t in n ? typeof n[t] == "string" && n[t] !== re(e.table) && (n[t] = !1) : n[t] = r === null ? re(e.table) : !1;
				};
			}
		} else o = f(e, O) ? e.decoder : f(e, T) ? e._.sql.decoder : e.sql.decoder;
		let s;
		return s = o.mapFromDriverValue.isNoop ? n ? (e) => n(e, r) : void 0 : n ? (e) => o.mapFromDriverValue(n(e, r)) : (e) => o.mapFromDriverValue(e), [s, a];
	});
	return ((r) => r.map((r) => {
		let i = {}, a = e.reduce((e, { path: t }, a) => {
			let o = e;
			for (let [e, s] of t.entries()) if (e < t.length - 1) s in o || (o[s] = {}), o = o[s];
			else {
				let [e, t] = n[a], c = r[a], l = o[s] = c === null ? null : e ? e(c) : c;
				t?.(i, l);
			}
			return e;
		}, {});
		if (t && Object.keys(i).length > 0) for (let [e, n] of Object.entries(i)) typeof n == "string" && !t[n] && (a[e] = null);
		return a;
	}));
}
function Te(e, t, n) {
	return Object.entries(e).reduce((e, [r, i]) => {
		if (typeof r != "string") return e;
		let a = t ? [...t, r] : [r];
		if (f(i, h)) e.push({
			path: a,
			field: i,
			codec: n?.get(i, "normalize"),
			arrayDimensions: i.dimensions,
			column: i
		});
		else if (f(i, O) || f(i, O.Aliased)) {
			let t = Ee(i);
			e.push(t ? {
				path: a,
				field: i,
				codec: n?.get(t, "normalize"),
				arrayDimensions: t.dimensions,
				column: t
			} : {
				path: a,
				field: i
			});
		} else if (f(i, T)) {
			let t, r = Object.values(i._.selectedFields)[0], o;
			f(r, h) ? (t = r, o = r) : f(r, O) ? (t = Ee(r), o = r.decoder) : (t = Ee(r), o = r.sql.decoder), o && (i._.sql.decoder = o), e.push(t ? {
				path: a,
				field: i,
				codec: n?.get(t, "normalize"),
				arrayDimensions: t.dimensions,
				column: t
			} : {
				path: a,
				field: i
			});
		} else f(i, w) ? e.push(...Te(i[w.Symbol.Columns], a, n)) : e.push(...Te(i, a, n));
		return e;
	}, []);
}
function Ee(e) {
	let t = e.getSQL();
	if (f(t.decoder, h)) return t.decoder;
}
function De(e, t) {
	let n = Object.keys(e), r = Object.keys(t);
	if (n.length !== r.length) return !1;
	for (let [e, t] of n.entries()) if (t !== r[e]) return !1;
	return !0;
}
function Oe(e, t) {
	let n = Object.entries(t).filter(([, e]) => e !== void 0).map(([t, n]) => f(n, O) || f(n, h) ? [t, n] : [t, new pe(n, e[w.Symbol.Columns][t])]);
	if (n.length === 0) throw Error("No values to set");
	return Object.fromEntries(n);
}
function ke(e, t) {
	for (let n of t) for (let t of Object.getOwnPropertyNames(n.prototype)) t !== "constructor" && Object.defineProperty(e.prototype, t, Object.getOwnPropertyDescriptor(n.prototype, t) || Object.create(null));
}
function Ae(e) {
	return e[w.Symbol.Columns];
}
function je(e) {
	return f(e, w) ? e[w.Symbol.Columns] : f(e, ve) ? e[E].selectedFields : e._.selectedFields;
}
function Me(e) {
	return f(e, T) ? e._.alias : f(e, ve) ? e[E].name : f(e, O) ? void 0 : e[w.Symbol.IsAlias] ? e[w.Symbol.Name] : e[w.Symbol.BaseName];
}
function Ne(e, t) {
	return {
		name: typeof e == "string" && e.length > 0 ? e : "",
		config: typeof e == "object" ? e : t
	};
}
var Pe = typeof TextDecoder > "u" ? null : new TextDecoder();
function Fe(e) {
	throw Error("Didn't expect to get here");
}
function Ie(e) {
	return (typeof e == "object" && !!e || typeof e == "function") && "enumValues" in e && Array.isArray(e.enumValues) && e.enumValues.length > 0;
}
var A = {
	INT8_MIN: -128,
	INT8_MAX: 127,
	INT8_UNSIGNED_MAX: 255,
	INT16_MIN: -32768,
	INT16_MAX: 32767,
	INT16_UNSIGNED_MAX: 65535,
	INT24_MIN: -8388608,
	INT24_MAX: 8388607,
	INT24_UNSIGNED_MAX: 16777215,
	INT32_MIN: -2147483648,
	INT32_MAX: 2147483647,
	INT32_UNSIGNED_MAX: 4294967295,
	INT48_MIN: -0x800000000000,
	INT48_MAX: 0x7fffffffffff,
	INT48_UNSIGNED_MAX: 0xffffffffffff,
	INT64_MIN: -9223372036854775808n,
	INT64_MAX: 9223372036854775807n,
	INT64_UNSIGNED_MAX: 18446744073709551615n
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/column-builder.js
function Le(e) {
	let [t, n] = e.dataType.split(" ");
	return {
		type: t,
		constraint: n
	};
}
var Re = class {
	static [d] = "ColumnBuilder";
	config;
	constructor(e, t, n) {
		this.config = {
			name: e,
			keyAsName: e === "",
			notNull: !1,
			default: void 0,
			hasDefault: !1,
			primaryKey: !1,
			isUnique: !1,
			uniqueName: void 0,
			uniqueType: void 0,
			dataType: t,
			columnType: n,
			generated: void 0
		};
	}
	$type() {
		return this;
	}
	notNull() {
		return this.config.notNull = !0, this;
	}
	default(e) {
		return this.config.default = e, this.config.hasDefault = !0, this;
	}
	$defaultFn(e) {
		return this.config.defaultFn = e, this.config.hasDefault = !0, this;
	}
	$default = this.$defaultFn;
	$onUpdateFn(e) {
		return this.config.onUpdateFn = e, this.config.hasDefault = !0, this;
	}
	$onUpdate = this.$onUpdateFn;
	primaryKey() {
		return this.config.primaryKey = !0, this.config.notNull = !0, this;
	}
	setName(e, t) {
		this.config.name === "" && (this.config.name = t(e));
	}
}, ze = (e, t) => {
	switch (t.length) {
		case 0: return e;
		case 1: return t[0](e);
		case 2: return t[1](t[0](e));
		case 3: return t[2](t[1](t[0](e)));
		case 4: return t[3](t[2](t[1](t[0](e))));
		case 5: return t[4](t[3](t[2](t[1](t[0](e)))));
		case 6: return t[5](t[4](t[3](t[2](t[1](t[0](e))))));
		case 7: return t[6](t[5](t[4](t[3](t[2](t[1](t[0](e)))))));
		case 8: return t[7](t[6](t[5](t[4](t[3](t[2](t[1](t[0](e))))))));
		case 9: return t[8](t[7](t[6](t[5](t[4](t[3](t[2](t[1](t[0](e)))))))));
		default: {
			let n = e;
			for (let e = 0, r = t.length; e < r; e++) n = t[e](n);
			return n;
		}
	}
}, Be = { pipe() {
	return ze(this, arguments);
} }, Ve = /*#__PURE__*/ function() {
	function e() {}
	return e.prototype = Be, e;
}(), j = function(e, t) {
	if (typeof e == "function") return function() {
		return e(arguments) ? t.apply(this, arguments) : (e) => t(e, ...arguments);
	};
	switch (e) {
		case 0:
		case 1: throw RangeError(`Invalid arity ${e}`);
		case 2: return function(e, n) {
			return arguments.length >= 2 ? t(e, n) : function(n) {
				return t(n, e);
			};
		};
		case 3: return function(e, n, r) {
			return arguments.length >= 3 ? t(e, n, r) : function(r) {
				return t(r, e, n);
			};
		};
		default: return function() {
			if (arguments.length >= e) return t.apply(this, arguments);
			let n = arguments;
			return function(e) {
				return t(e, ...n);
			};
		};
	}
}, M = (e) => e, He = (e) => () => e, Ue = /*#__PURE__*/ He(!0), We = /*#__PURE__*/ He(!1), Ge = /*#__PURE__*/ He(void 0), Ke = Ge;
function qe(e, t, n, r, i, a, o, s, c) {
	switch (arguments.length) {
		case 1: return e;
		case 2: return function() {
			return t(e.apply(this, arguments));
		};
		case 3: return function() {
			return n(t(e.apply(this, arguments)));
		};
		case 4: return function() {
			return r(n(t(e.apply(this, arguments))));
		};
		case 5: return function() {
			return i(r(n(t(e.apply(this, arguments)))));
		};
		case 6: return function() {
			return a(i(r(n(t(e.apply(this, arguments))))));
		};
		case 7: return function() {
			return o(a(i(r(n(t(e.apply(this, arguments)))))));
		};
		case 8: return function() {
			return s(o(a(i(r(n(t(e.apply(this, arguments))))))));
		};
		case 9: return function() {
			return c(s(o(a(i(r(n(t(e.apply(this, arguments)))))))));
		};
	}
}
function Je(e) {
	let t = /* @__PURE__ */ new WeakMap();
	return (n) => {
		if (t.has(n)) return t.get(n);
		let r = e(n);
		return t.set(n, r), r;
	};
}
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/equal.js
var Ye = (e) => {
	let t = new Set(Reflect.ownKeys(e));
	if (e.constructor === Object) return t;
	e instanceof Error && t.delete("stack");
	let n = Object.getPrototypeOf(e), r = n;
	for (; r !== null && r !== Object.prototype;) {
		let e = Reflect.ownKeys(r);
		for (let n = 0; n < e.length; n++) t.add(e[n]);
		r = Object.getPrototypeOf(r);
	}
	return t.has("constructor") && typeof e.constructor == "function" && n === e.constructor.prototype && t.delete("constructor"), t;
}, Xe = /*#__PURE__*/ new WeakSet();
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Predicate.js
function Ze(e) {
	return typeof e == "string";
}
function Qe(e) {
	return typeof e == "number";
}
function $e(e) {
	return typeof e == "boolean";
}
function et(e) {
	return typeof e == "bigint";
}
function tt(e) {
	return typeof e == "symbol";
}
function nt(e) {
	return Ze(e) || Qe(e) || tt(e);
}
function rt(e) {
	return typeof e == "function";
}
function it(e) {
	return e !== void 0;
}
function at(e) {
	return e != null;
}
function ot(e) {
	return !0;
}
function st(e) {
	return typeof e == "object" && !!e || rt(e);
}
var N = /*#__PURE__*/ j(2, (e, t) => st(e) && t in e), P = "~effect/interfaces/Hash", F = (e) => {
	switch (typeof e) {
		case "number": return ft(e);
		case "bigint": return I(e.toString(10));
		case "boolean": return I(String(e));
		case "symbol": return I(String(e));
		case "string": return I(e);
		case "undefined": return I("undefined");
		case "function":
		case "object":
			if (e === null) return I("null");
			if (e instanceof Date) return I(e.toISOString());
			if (e instanceof RegExp) return I(e.toString());
			{
				if (Xe.has(e)) return ct(e);
				if (bt.has(e)) return bt.get(e);
				let t = St(e, () => dt(e) ? e[P]() : typeof e == "function" ? ct(e) : Array.isArray(e) || ArrayBuffer.isView(e) ? gt(e) : e instanceof Map ? _t(e) : e instanceof Set ? vt(e) : mt(e));
				return bt.set(e, t), t;
			}
		default: throw Error(`BUG: unhandled typeof ${typeof e} - please report an issue at https://github.com/Effect-TS/effect/issues`);
	}
}, ct = (e) => (yt.has(e) || yt.set(e, ft(Math.floor(Math.random() * (2 ** 53 - 1)))), yt.get(e)), lt = /*#__PURE__*/ j(2, (e, t) => e * 53 ^ t), ut = (e) => e & 3221225471 | e >>> 1 & 1073741824, dt = (e) => N(e, P), ft = (e) => {
	if (e !== e) return I("NaN");
	if (e === Infinity) return I("Infinity");
	if (e === -Infinity) return I("-Infinity");
	let t = e | 0;
	for (t !== e && (t ^= e * 4294967295); e > 4294967295;) t ^= e /= 4294967295;
	return ut(t);
}, I = (e) => {
	let t = 5381, n = e.length;
	for (; n;) t = t * 33 ^ e.charCodeAt(--n);
	return ut(t);
}, pt = (e, t) => {
	let n = 12289;
	for (let r of t) n ^= lt(F(r), F(e[r]));
	return ut(n);
}, mt = (e) => pt(e, Ye(e)), ht = (e, t) => (n) => {
	let r = e;
	for (let e of n) r ^= t(e);
	return ut(r);
}, gt = /*#__PURE__*/ ht(6151, F), _t = /*#__PURE__*/ ht(/*#__PURE__*/ I("Map"), ([e, t]) => lt(F(e), F(t))), vt = /*#__PURE__*/ ht(/*#__PURE__*/ I("Set"), F), yt = /*#__PURE__*/ new WeakMap(), bt = /*#__PURE__*/ new WeakMap(), xt = /*#__PURE__*/ new WeakSet();
function St(e, t) {
	if (xt.has(e)) return I("[Circular]");
	xt.add(e);
	let n = t();
	return xt.delete(e), n;
}
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Equal.js
var L = "~effect/interfaces/Equal";
function Ct() {
	return arguments.length === 1 ? (e) => wt(e, arguments[0]) : wt(arguments[0], arguments[1]);
}
function wt(e, t) {
	if (e === t) return !0;
	if (e == null || t == null) return !1;
	let n = typeof e;
	return n === typeof t ? n === "number" && e !== e && t !== t ? !0 : n !== "object" && n !== "function" || Xe.has(e) || Xe.has(t) ? !1 : kt(e, t, Ot) : !1;
}
function Tt(e, t, n) {
	let r = Et.has(e), i = Dt.has(t);
	if (r && i) return !0;
	if (r || i) return !1;
	Et.add(e), Dt.add(t);
	let a = n();
	return Et.delete(e), Dt.delete(t), a;
}
var Et = /*#__PURE__*/ new WeakSet(), Dt = /*#__PURE__*/ new WeakSet();
function Ot(e, t) {
	if (F(e) !== F(t)) return !1;
	if (e instanceof Date) return t instanceof Date ? e.toISOString() === t.toISOString() : !1;
	if (e instanceof RegExp) return t instanceof RegExp ? e.toString() === t.toString() : !1;
	let n = Rt(e), r = Rt(t);
	if (n !== r) return !1;
	let i = n && r;
	return typeof e == "function" && !i ? !1 : Tt(e, t, () => i ? e[L](t) : Array.isArray(e) ? !Array.isArray(t) || e.length !== t.length ? !1 : jt(e, t) : ArrayBuffer.isView(e) ? !ArrayBuffer.isView(t) || e.byteLength !== t.byteLength ? !1 : Mt(e, t) : e instanceof Map ? !(t instanceof Map) || e.size !== t.size ? !1 : Ft(e, t) : e instanceof Set ? !(t instanceof Set) || e.size !== t.size ? !1 : Lt(e, t) : Nt(e, t));
}
function kt(e, t, n) {
	let r = At.get(e);
	if (!r) r = /* @__PURE__ */ new WeakMap(), At.set(e, r);
	else if (r.has(t)) return r.get(t);
	let i = n(e, t);
	r.set(t, i);
	let a = At.get(t);
	return a || (a = /* @__PURE__ */ new WeakMap(), At.set(t, a)), a.set(e, i), i;
}
var At = /*#__PURE__*/ new WeakMap();
function jt(e, t) {
	for (let n = 0; n < e.length; n++) if (!wt(e[n], t[n])) return !1;
	return !0;
}
function Mt(e, t) {
	if (e.length !== t.length) return !1;
	for (let n = 0; n < e.length; n++) if (e[n] !== t[n]) return !1;
	return !0;
}
function Nt(e, t) {
	let n = Ye(e), r = Ye(t);
	if (n.size !== r.size) return !1;
	for (let i of n) if (!r.has(i) || !wt(e[i], t[i])) return !1;
	return !0;
}
function Pt(e, t) {
	return function(n, r) {
		for (let [i, a] of n) {
			let n = !1;
			for (let [o, s] of r) if (e(i, o) && t(a, s)) {
				n = !0;
				break;
			}
			if (!n) return !1;
		}
		return !0;
	};
}
var Ft = /*#__PURE__*/ Pt(wt, wt);
function It(e) {
	return function(t, n) {
		for (let r of t) {
			let t = !1;
			for (let i of n) if (e(r, i)) {
				t = !0;
				break;
			}
			if (!t) return !1;
		}
		return !0;
	};
}
var Lt = /*#__PURE__*/ It(wt), Rt = (e) => N(e, L), zt = () => Ct, Bt = (e) => (t, n) => t === n || e(t, n), Vt = (e) => e.length > 0, Ht = /*#__PURE__*/ Symbol.for("~effect/Redactable"), Ut = (e) => N(e, Ht);
function Wt(e) {
	return Ut(e) ? Gt(e) : e;
}
function Gt(e) {
	return e[Ht](globalThis["~effect/Fiber/currentFiber"]?.context ?? qt);
}
var Kt = "~effect/Fiber/currentFiber", qt = {
	"~effect/Context": {},
	mapUnsafe: /*#__PURE__*/ new Map(),
	pipe() {
		return ze(this, arguments);
	}
};
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Formatter.js
function R(e, t) {
	let n = t?.space ?? 0, r = /* @__PURE__ */ new WeakSet(), i = n ? typeof n == "number" ? " ".repeat(n) : n : "", a = (e) => i.repeat(e), o = (e, t) => {
		let n = e?.constructor;
		return n && n !== Object.prototype.constructor && n.name ? `${n.name}(${t})` : t;
	}, s = (e) => {
		try {
			return Reflect.ownKeys(e);
		} catch {
			return ["[ownKeys threw]"];
		}
	};
	function c(e, n = 0) {
		if (Array.isArray(e)) {
			if (r.has(e)) return Jt;
			if (r.add(e), !i || e.length <= 1) return `[${e.map((e) => c(e, n)).join(",")}]`;
			let t = e.map((e) => c(e, n + 1)).join(",\n" + a(n + 1));
			return `[\n${a(n + 1)}${t}\n${a(n)}]`;
		}
		if (e instanceof Date) return Zt(e);
		if (!t?.ignoreToString && N(e, "toString") && typeof e.toString == "function" && e.toString !== Object.prototype.toString && e.toString !== Array.prototype.toString) {
			let t = Qt(e);
			return e instanceof Error && e.cause ? `${t} (cause: ${c(e.cause, n)})` : t;
		}
		if (typeof e == "string") return JSON.stringify(e);
		if (typeof e == "number" || e == null || typeof e == "boolean" || typeof e == "symbol") return String(e);
		if (typeof e == "bigint") return String(e) + "n";
		if (typeof e == "object" || typeof e == "function") {
			if (r.has(e)) return Jt;
			if (r.add(e), Ht in e) return R(Gt(e));
			if (Symbol.iterator in e) return `${e.constructor.name}(${c(Array.from(e), n)})`;
			let t = s(e);
			if (!i || t.length <= 1) {
				let r = `{${t.map((t) => `${Yt(t)}:${c(e[t], n)}`).join(",")}}`;
				return o(e, r);
			}
			let l = `{\n${t.map((t) => `${a(n + 1)}${Yt(t)}: ${c(e[t], n + 1)}`).join(",\n")}\n${a(n)}}`;
			return o(e, l);
		}
		return String(e);
	}
	return c(e, 0);
}
var Jt = "[Circular]";
function Yt(e) {
	return typeof e == "string" ? JSON.stringify(e) : String(e);
}
function Xt(e) {
	return e.map((e) => `[${Yt(e)}]`).join("");
}
function Zt(e) {
	try {
		return e.toISOString();
	} catch {
		return "Invalid Date";
	}
}
function Qt(e) {
	try {
		let t = e.toString();
		return typeof t == "string" ? t : String(t);
	} catch {
		return "[toString threw]";
	}
}
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Inspectable.js
var $t = /*#__PURE__*/ Symbol.for("nodejs.util.inspect.custom"), en = (e) => {
	try {
		if (N(e, "toJSON") && rt(e.toJSON) && e.toJSON.length === 0) return e.toJSON();
		if (Array.isArray(e)) return e.map(en);
	} catch {
		return "[toJSON threw]";
	}
	return Wt(e);
}, tn = class e {
	called = !1;
	self;
	constructor(e) {
		this.self = e;
	}
	next(e) {
		return this.called ? {
			value: e,
			done: !0
		} : (this.called = !0, {
			value: this.self,
			done: !1
		});
	}
	[Symbol.iterator]() {
		return new e(this.self);
	}
}, nn = /*#__PURE__*/ (() => {
	let e = "~effect/Utils/internal", t = { [e]: (e) => e() }, n = { [e]: (e) => {
		try {
			return e();
		} finally {}
	} };
	return t[e](() => (/* @__PURE__ */ Error()).stack)?.includes(e) === !0 ? t[e] : n[e];
})(), rn = "~effect/Effect", an = "~effect/Exit", on = {
	_A: M,
	_E: M,
	_R: M
}, sn = `${rn}/identifier`, z = `${rn}/args`, B = `${rn}/evaluate`, cn = `${rn}/successCont`, ln = `${rn}/failureCont`, un = `${rn}/ensureCont`, dn = /*#__PURE__*/ Symbol.for("effect/Effect/Yield"), fn = {
	pipe() {
		return ze(this, arguments);
	},
	toJSON() {
		return { ...this };
	},
	toString() {
		return R(this.toJSON(), {
			ignoreToString: !0,
			space: 2
		});
	},
	[$t]() {
		return this.toJSON();
	}
}, pn = {
	[rn]: on,
	...fn,
	[Symbol.iterator]() {
		return new tn(this);
	},
	toJSON() {
		return {
			_id: "Effect",
			op: this[sn],
			...z in this ? { args: this[z] } : void 0
		};
	}
}, mn = (e) => N(e, rn), hn = (e) => N(e, an), gn = "~effect/Cause", _n = "~effect/Cause/Reason", vn = (e) => N(e, gn), yn = class {
	[gn];
	reasons;
	constructor(e) {
		this[gn] = gn, this.reasons = e;
	}
	pipe() {
		return ze(this, arguments);
	}
	toJSON() {
		return {
			_id: "Cause",
			failures: this.reasons.map((e) => e.toJSON())
		};
	}
	toString() {
		return `Cause(${R(this.reasons)})`;
	}
	[$t]() {
		return this.toJSON();
	}
	[L](e) {
		return vn(e) && this.reasons.length === e.reasons.length && this.reasons.every((t, n) => Ct(t, e.reasons[n]));
	}
	[P]() {
		return gt(this.reasons);
	}
}, bn = /*#__PURE__*/ new WeakMap(), xn = class {
	[_n];
	annotations;
	_tag;
	constructor(e, t, n) {
		if (this[_n] = _n, this._tag = e, t !== Sn && typeof n == "object" && n && t.size > 0) {
			let e = bn.get(n);
			e && (t = new Map([...e, ...t])), bn.set(n, t);
		}
		this.annotations = t;
	}
	annotate(e, t) {
		if (e.mapUnsafe.size === 0) return this;
		let n = new Map(this.annotations);
		e.mapUnsafe.forEach((e, r) => {
			t?.overwrite !== !0 && n.has(r) || n.set(r, e);
		});
		let r = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
		return r.annotations = n, r;
	}
	pipe() {
		return ze(this, arguments);
	}
	toString() {
		return R(this);
	}
	[$t]() {
		return this.toString();
	}
}, Sn = /*#__PURE__*/ new Map(), Cn = class extends xn {
	error;
	constructor(e, t = Sn) {
		super("Fail", t, e), this.error = e;
	}
	toString() {
		return `Fail(${R(this.error)})`;
	}
	toJSON() {
		return {
			_tag: "Fail",
			error: this.error
		};
	}
	[L](e) {
		return kn(e) && Ct(this.error, e.error) && Ct(this.annotations, e.annotations);
	}
	[P]() {
		return lt(I(this._tag))(lt(F(this.error))(F(this.annotations)));
	}
}, wn = (e) => new yn(e), Tn = (e) => new yn([new Cn(e)]), En = class extends xn {
	defect;
	constructor(e, t = Sn) {
		super("Die", t, e), this.defect = e;
	}
	toString() {
		return `Die(${R(this.defect)})`;
	}
	toJSON() {
		return {
			_tag: "Die",
			defect: this.defect
		};
	}
	[L](e) {
		return An(e) && Ct(this.defect, e.defect) && Ct(this.annotations, e.annotations);
	}
	[P]() {
		return lt(I(this._tag))(lt(F(this.defect))(F(this.annotations)));
	}
}, Dn = (e) => new yn([new En(e)]), On = /*#__PURE__*/ j((e) => vn(e[0]), (e, t, n) => t.mapUnsafe.size === 0 ? e : new yn(e.reasons.map((e) => e.annotate(t, n)))), kn = (e) => e._tag === "Fail", An = (e) => e._tag === "Die", jn = (e) => e._tag === "Interrupt";
function Mn(e) {
	return Bn("Effect.evaluate: Not implemented");
}
var Nn = (e) => ({
	...pn,
	[sn]: e.op,
	[B]: e[B] ?? Mn,
	[cn]: e[cn],
	[ln]: e[ln],
	[un]: e[un]
}), Pn = (e) => {
	let t = Nn(e);
	return function() {
		let n = Object.create(t);
		return n[z] = e.single === !1 ? arguments : arguments[0], n;
	};
}, Fn = (e) => {
	let t = {
		...Nn(e),
		[an]: an,
		_tag: e.op,
		get [e.prop]() {
			return this[z];
		},
		toString() {
			return `${e.op}(${R(this[z])})`;
		},
		toJSON() {
			return {
				_id: "Exit",
				_tag: e.op,
				[e.prop]: this[z]
			};
		},
		[L](e) {
			return hn(e) && e._tag === this._tag && Ct(this[z], e[z]);
		},
		[P]() {
			return lt(I(e.op), F(this[z]));
		}
	};
	return function(e) {
		let n = Object.create(t);
		return n[z] = e, n;
	};
}, In = /*#__PURE__*/ Fn({
	op: "Success",
	prop: "value",
	[B](e) {
		let t = e.getCont(cn);
		return t ? t[cn](this[z], e, this) : e.yieldWith(this);
	}
}), Ln = { key: "effect/Cause/StackTrace" }, Rn = /*#__PURE__*/ Fn({
	op: "Failure",
	prop: "cause",
	[B](e) {
		let t = this[z], n = !1;
		e.currentStackFrame && (t = On(t, { mapUnsafe: /* @__PURE__ */ new Map([[Ln.key, e.currentStackFrame]]) }), n = !0);
		let r = e.getCont(ln);
		for (; e.interruptible && e._interruptedCause && r;) r = e.getCont(ln);
		return r ? r[ln](t, e, n ? void 0 : this) : e.yieldWith(n ? this : Rn(t));
	}
}), zn = (e) => Rn(Tn(e)), Bn = (e) => Rn(Dn(e)), Vn = /*#__PURE__*/ Pn({
	op: "WithFiber",
	[B](e) {
		return this[z](e);
	}
}), Hn = /*#__PURE__*/ function() {
	class e extends globalThis.Error {}
	let t = /*#__PURE__*/ Nn({
		op: "YieldableError",
		[B]() {
			return zn(this);
		}
	});
	return delete t.toString, Object.assign(e.prototype, t), e;
}(), Un = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ Symbol.for("effect/Data/Error/plainArgs");
	return class extends Hn {
		constructor(t) {
			super(t?.message, t?.cause ? { cause: t.cause } : void 0), t && (Object.assign(this, t), Object.defineProperty(this, e, {
				value: t,
				enumerable: !1
			}));
		}
		toJSON() {
			return {
				...this[e],
				...this
			};
		}
	};
}(), Wn = (e) => {
	class t extends Un {
		_tag = e;
	}
	return t.prototype.name = e, t;
};
Wn("NoSuchElementError");
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/option.js
var Gn = "~effect/data/Option", Kn = {
	[Gn]: { _A: (e) => e },
	...fn,
	[Symbol.iterator]() {
		return new tn(this);
	}
}, qn = /*#__PURE__*/ Object.defineProperty(/*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Kn), {
	_tag: "Some",
	_op: "Some",
	[L](e) {
		return Xn(e) && Qn(e) && Ct(this.value, e.value);
	},
	[P]() {
		return lt(F(this._tag))(F(this.value));
	},
	toString() {
		return `some(${R(this.value)})`;
	},
	toJSON() {
		return {
			_id: "Option",
			_tag: this._tag,
			value: en(this.value)
		};
	}
}), "valueOrUndefined", { get() {
	return this.value;
} }), Jn = /*#__PURE__*/ F("None"), Yn = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Kn), {
	_tag: "None",
	_op: "None",
	valueOrUndefined: void 0,
	[L](e) {
		return Xn(e) && Zn(e);
	},
	[P]() {
		return Jn;
	},
	toString() {
		return "none()";
	},
	toJSON() {
		return {
			_id: "Option",
			_tag: this._tag
		};
	}
}), Xn = (e) => N(e, Gn), Zn = (e) => e._tag === "None", Qn = (e) => e._tag === "Some", $n = /*#__PURE__*/ Object.create(Yn), er = (e) => {
	let t = Object.create(qn);
	return t.value = e, t;
}, tr = "~effect/data/Result", nr = {
	[tr]: {
		/* v8 ignore next 2 */
		_A: (e) => e,
		_E: (e) => e
	},
	...fn,
	[Symbol.iterator]() {
		return new tn(this);
	}
}, rr = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(nr), {
	_tag: "Success",
	_op: "Success",
	[L](e) {
		return ar(e) && sr(e) && Ct(this.success, e.success);
	},
	[P]() {
		return lt(F(this._tag))(F(this.success));
	},
	toString() {
		return `success(${R(this.success)})`;
	},
	toJSON() {
		return {
			_id: "Result",
			_tag: this._tag,
			value: en(this.success)
		};
	}
}), ir = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(nr), {
	_tag: "Failure",
	_op: "Failure",
	[L](e) {
		return ar(e) && or(e) && Ct(this.failure, e.failure);
	},
	[P]() {
		return lt(F(this._tag))(F(this.failure));
	},
	toString() {
		return `failure(${R(this.failure)})`;
	},
	toJSON() {
		return {
			_id: "Result",
			_tag: this._tag,
			failure: en(this.failure)
		};
	}
}), ar = (e) => N(e, tr), or = (e) => e._tag === "Failure", sr = (e) => e._tag === "Success", cr = (e) => {
	let t = Object.create(ir);
	return t.failure = e, t;
}, lr = (e) => {
	let t = Object.create(rr);
	return t.success = e, t;
};
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Order.js
function ur(e) {
	return (t, n) => t === n ? 0 : e(t, n);
}
var dr = /*#__PURE__*/ ur((e, t) => globalThis.Number.isNaN(e) && globalThis.Number.isNaN(t) ? 0 : globalThis.Number.isNaN(e) ? -1 : globalThis.Number.isNaN(t) ? 1 : e < t ? -1 : 1), fr = /*#__PURE__*/ ur((e, t) => e < t ? -1 : 1), pr = /*#__PURE__*/ j(2, (e, t) => ur((n, r) => e(t(n), t(r)))), mr = /*#__PURE__*/ pr(dr, (e) => e.getTime()), hr = (e) => j(2, (t, n) => e(t, n) === 1), gr = (e) => j(2, (t, n) => e(t, n) !== 1), _r = (e) => j(2, (t, n) => e(t, n) !== -1), vr = () => $n, V = er, yr = Zn, br = Qn, xr = /*#__PURE__*/ (/* @__PURE__ */ j(2, (e, t) => yr(e) ? t() : e.value))(Ge), Sr = /*#__PURE__*/ j(2, (e, t) => yr(e) ? vr() : V(t(e.value))), Cr = /*#__PURE__*/ j(2, (e, t) => yr(e) ? vr() : t(e.value) ? V(e.value) : vr()), wr = lr, Tr = cr, Er = or, Dr = globalThis.Array, Or = (e) => Dr.isArray(e) ? e : Dr.from(e), kr = /*#__PURE__*/ j(2, (e, t) => [...e, t]), Ar = /*#__PURE__*/ j(2, (e, t) => Or(e).concat(Or(t)));
Dr.isArray;
var jr = Vt, Mr = Vt;
function Nr(e, t) {
	return e < 0 || e >= t.length;
}
var Pr = /*#__PURE__*/ (/* @__PURE__ */ j(2, (e, t) => {
	let n = Math.floor(t);
	if (Nr(n, e)) throw Error(`Index out of bounds: ${n}`);
	return e[n];
}))(0), Fr = (e) => e.slice(1), Ir = /*#__PURE__*/ j(3, (e, t, n) => {
	let r = Or(e), i = Or(t);
	return Mr(r) ? Mr(i) ? Br(n)(Ar(r, i)) : r : i;
}), Lr = /*#__PURE__*/ j(2, (e, t) => Ir(e, t, zt())), Rr = () => [], zr = /*#__PURE__*/ j(2, (e, t) => e.map(t)), Br = /*#__PURE__*/ j(2, (e, t) => {
	let n = Or(e);
	if (Mr(n)) {
		let e = [Pr(n)], r = Fr(n);
		for (let n of r) e.every((e) => !t(n, e)) && e.push(n);
		return e;
	}
	return [];
}), Vr = "~effect/BigDecimal", Hr = {
	[Vr]: Vr,
	[P]() {
		let e = Yr(this);
		return lt(F(e.value), ft(e.scale));
	},
	[L](e) {
		return Ur(e) && $r(this, e);
	},
	toString() {
		return `BigDecimal(${ei(this)})`;
	},
	toJSON() {
		return {
			_id: "BigDecimal",
			value: String(this.value),
			scale: this.scale
		};
	},
	[$t]() {
		return this.toJSON();
	},
	pipe() {
		return ze(this, arguments);
	}
}, Ur = (e) => N(e, Vr), Wr = (e, t) => {
	let n = Object.create(Hr);
	return n.value = e, n.scale = t, n;
}, Gr = (e, t) => {
	if (e !== Kr && e % qr === Kr) throw RangeError("Value must be normalized");
	let n = Wr(e, t);
	return n.normalized = n, n;
}, Kr = /*#__PURE__*/ BigInt(0), qr = /*#__PURE__*/ BigInt(10), Jr = /*#__PURE__*/ Gr(Kr, 0), Yr = (e) => {
	if (e.normalized === void 0) if (e.value === Kr) e.normalized = Jr;
	else {
		let t = `${e.value}`, n = 0;
		for (let e = t.length - 1; e >= 0 && t[e] === "0"; e--) n++;
		n === 0 && (e.normalized = e), e.normalized = Gr(BigInt(t.substring(0, t.length - n)), e.scale - n);
	}
	return e.normalized;
}, Xr = /*#__PURE__*/ j(2, (e, t) => t > e.scale ? Wr(e.value * qr ** BigInt(t - e.scale), t) : t < e.scale ? Wr(e.value / qr ** BigInt(e.scale - t), t) : e), Zr = (e) => e.value < Kr ? Wr(-e.value, e.scale) : e, Qr = /*#__PURE__*/ Bt((e, t) => e.scale > t.scale ? Xr(t, e.scale).value === e.value : e.scale < t.scale ? Xr(e, t.scale).value === t.value : e.value === t.value), $r = /*#__PURE__*/ j(2, (e, t) => Qr(e, t)), ei = (e) => {
	let t = Yr(e);
	if (Math.abs(t.scale) >= 16) return ti(t);
	let n = t.value < Kr, r = n ? `${t.value}`.substring(1) : `${t.value}`, i, a;
	if (t.scale >= r.length) i = "0", a = "0".repeat(t.scale - r.length) + r;
	else {
		let e = r.length - t.scale;
		if (e > r.length) {
			let t = e - r.length;
			i = `${r}${"0".repeat(t)}`, a = "";
		} else a = r.slice(e), i = r.slice(0, e);
	}
	let o = a === "" ? i : `${i}.${a}`;
	return n ? `-${o}` : o;
}, ti = (e) => {
	if (ni(e)) return "0e+0";
	let t = Yr(e), n = `${Zr(t).value}`, r = n.slice(0, 1), i = n.slice(1), a = `${ri(t) ? "-" : ""}${r}`;
	i !== "" && (a += `.${i}`);
	let o = i.length - t.scale;
	return `${a}e${o >= 0 ? "+" : ""}${o}`;
}, ni = (e) => e.value === Kr, ri = (e) => e.value < Kr, ii = (e) => Nn({
	op: e.label,
	[B]: e.evaluate
}), ai = "~effect/Context/Service", oi = function() {
	let e = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let t = /* @__PURE__ */ Error();
	Error.stackTraceLimit = e;
	function n() {}
	let r = n;
	return Object.setPrototypeOf(r, si), Object.defineProperty(r, "stack", { get() {
		return t.stack;
	} }), arguments.length > 0 ? (r.key = arguments[0], arguments[1]?.defaultValue && (r[ci] = ci, r.defaultValue = arguments[1].defaultValue), r) : function(e, t) {
		return r.key = e, t?.make && (r.make = t.make), r;
	};
}, si = {
	[ai]: ai,
	.../*#__PURE__*/ ii({
		label: "Service",
		evaluate(e) {
			return In(bi(e.context, this));
		}
	}),
	toJSON() {
		return {
			_id: "Service",
			key: this.key,
			stack: this.stack
		};
	},
	of(e) {
		return e;
	},
	context(e) {
		return gi(this, e);
	},
	use(e) {
		return Vn((t) => e(bi(t.context, this)));
	},
	useSync(e) {
		return Vn((t) => In(e(bi(t.context, this))));
	}
}, ci = "~effect/Context/Reference", li = "~effect/Context", ui = (e) => {
	let t = Object.create(di);
	return t.mapUnsafe = e, t.mutable = !1, t;
}, di = {
	...fn,
	[li]: { _Services: (e) => e },
	toJSON() {
		return {
			_id: "Context",
			services: Array.from(this.mapUnsafe).map(([e, t]) => ({
				key: e,
				value: t
			}))
		};
	},
	[L](e) {
		if (!fi(e) || this.mapUnsafe.size !== e.mapUnsafe.size) return !1;
		for (let t of this.mapUnsafe.keys()) if (!e.mapUnsafe.has(t) || !Ct(this.mapUnsafe.get(t), e.mapUnsafe.get(t))) return !1;
		return !0;
	},
	[P]() {
		return ft(this.mapUnsafe.size);
	}
}, fi = (e) => N(e, li), pi = (e) => N(e, ci), mi = () => hi, hi = /*#__PURE__*/ ui(/*#__PURE__*/ new Map()), gi = (e, t) => ui(/* @__PURE__ */ new Map([[e.key, t]])), _i = /*#__PURE__*/ j(3, (e, t, n) => Ei(e, (e) => {
	e.set(t.key, n);
})), vi = /*#__PURE__*/ j(3, (e, t, n) => e.mapUnsafe.has(t.key) ? e.mapUnsafe.get(t.key) : pi(t) ? Ci(t) : n()), yi = /*#__PURE__*/ j(2, (e, t) => {
	if (!e.mapUnsafe.has(t.key)) {
		if (ci in t) return Ci(t);
		throw wi(t);
	}
	return e.mapUnsafe.get(t.key);
}), bi = yi, xi = (e, t) => e.mapUnsafe.has(t.key) ? e.mapUnsafe.get(t.key) : Ci(t), Si = "~effect/Context/defaultValue", Ci = (e) => Si in e ? e[Si] : e[Si] = e.defaultValue(), wi = (e) => {
	let t = /* @__PURE__ */ Error(`Service not found${e.key ? `: ${String(e.key)}` : ""}`);
	if (e.stack) {
		let n = e.stack.split("\n");
		if (n.length > 2) {
			let e = n[2].match(/at (.*)/);
			e && (t.message += ` (defined at ${e[1]})`);
		}
	}
	if (t.stack) {
		let e = t.stack.split("\n");
		e.splice(1, 3), t.stack = e.join("\n");
	}
	return t;
}, Ti = /*#__PURE__*/ j(2, (e, t) => e.mapUnsafe.size === 0 ? t : t.mapUnsafe.size === 0 ? e : Ei(e, (e) => {
	t.mapUnsafe.forEach((t, n) => e.set(n, t));
})), Ei = (e, t) => {
	if (e.mutable) return t(e.mapUnsafe), e;
	let n = new Map(e.mapUnsafe);
	return t(n), ui(n);
}, H = oi, Di = "~effect/time/Duration", Oi = /*#__PURE__*/ BigInt(0), ki = /*#__PURE__*/ BigInt(1), Ai = /*#__PURE__*/ BigInt(1e3), ji = (e) => BigInt(e < 0 ? Math.ceil(e - .5) : Math.floor(e + .5)), Mi = (e) => ji(e * 1e6), Ni = (e, t) => e.includes(".") ? ji(Number(e) * Number(t)) : BigInt(e) * t, Pi = /^(-?\d+(?:\.\d+)?)\s+(nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?)$/, Fi = (e) => {
	switch (typeof e) {
		case "number": return qi(e);
		case "bigint": return Ki(e);
		case "string": {
			if (e === "Infinity") return Wi;
			if (e === "-Infinity") return Gi;
			let t = Pi.exec(e);
			if (!t) break;
			let [n, r, i] = t;
			if (i === "nano" || i === "nanos") return Ki(Ni(r, ki));
			if (i === "micro" || i === "micros") return Ki(Ni(r, Ai));
			let a = Number(r);
			switch (i) {
				case "milli":
				case "millis": return qi(a);
				case "second":
				case "seconds": return Ji(a);
				case "minute":
				case "minutes": return Yi(a);
				case "hour":
				case "hours": return Xi(a);
				case "day":
				case "days": return Zi(a);
				case "week":
				case "weeks": return Qi(a);
			}
			break;
		}
		case "object": {
			if (e === null) break;
			if (Di in e) return e;
			if (Array.isArray(e)) return e.length !== 2 || !e.every(Qe) ? Ii(e) : Number.isNaN(e[0]) || Number.isNaN(e[1]) ? Ui : e[0] === -Infinity || e[1] === -Infinity ? Gi : e[0] === Infinity || e[1] === Infinity ? Wi : Vi(ji(e[0] * 1e9 + e[1]));
			let t = e, n = 0;
			return t.weeks && (n += t.weeks * 6048e5), t.days && (n += t.days * 864e5), t.hours && (n += t.hours * 36e5), t.minutes && (n += t.minutes * 6e4), t.seconds && (n += t.seconds * 1e3), t.milliseconds && (n += t.milliseconds), !t.microseconds && !t.nanoseconds ? Vi(n) : Vi(ji(n * 1e6 + (t.microseconds ?? 0) * 1e3 + (t.nanoseconds ?? 0)));
		}
	}
	return Ii(e);
}, Ii = (e) => {
	throw Error(`Invalid Input: ${e}`);
}, Li = {
	_tag: "Millis",
	millis: 0
}, Ri = { _tag: "Infinity" }, zi = { _tag: "NegativeInfinity" }, Bi = {
	[Di]: Di,
	[P]() {
		return mt(this.value);
	},
	[L](e) {
		return Hi(e) && ia(this, e);
	},
	toString() {
		switch (this.value._tag) {
			case "Infinity": return "Infinity";
			case "NegativeInfinity": return "-Infinity";
			case "Nanos": return `${this.value.nanos} nanos`;
			case "Millis": return `${this.value.millis} millis`;
		}
	},
	toJSON() {
		switch (this.value._tag) {
			case "Millis": return {
				_id: "Duration",
				_tag: "Millis",
				millis: this.value.millis
			};
			case "Nanos": return {
				_id: "Duration",
				_tag: "Nanos",
				nanos: String(this.value.nanos)
			};
			case "Infinity": return {
				_id: "Duration",
				_tag: "Infinity"
			};
			case "NegativeInfinity": return {
				_id: "Duration",
				_tag: "NegativeInfinity"
			};
		}
	},
	[$t]() {
		return this.toJSON();
	},
	pipe() {
		return ze(this, arguments);
	}
}, Vi = (e) => {
	let t = Object.create(Bi);
	return typeof e == "number" ? isNaN(e) || e === 0 || Object.is(e, -0) ? t.value = Li : Number.isFinite(e) ? Number.isInteger(e) ? t.value = {
		_tag: "Millis",
		millis: e
	} : t.value = {
		_tag: "Nanos",
		nanos: Mi(e)
	} : t.value = e > 0 ? Ri : zi : e === Oi ? t.value = Li : t.value = {
		_tag: "Nanos",
		nanos: e
	}, t;
}, Hi = (e) => N(e, Di), Ui = /*#__PURE__*/ Vi(0), Wi = /*#__PURE__*/ Vi(Infinity), Gi = /*#__PURE__*/ Vi(-Infinity), Ki = (e) => Vi(e), qi = (e) => Vi(e), Ji = (e) => Vi(e * 1e3), Yi = (e) => Vi(e * 6e4), Xi = (e) => Vi(e * 36e5), Zi = (e) => Vi(e * 864e5), Qi = (e) => Vi(e * 6048e5), $i = (e) => ta(Fi(e), {
	onMillis: M,
	onNanos: (e) => Number(e) / 1e6,
	onInfinity: () => Infinity,
	onNegativeInfinity: () => -Infinity
}), ea = (e) => {
	let t = Fi(e);
	switch (t.value._tag) {
		case "Infinity":
		case "NegativeInfinity": throw Error("Cannot convert infinite duration to nanos");
		case "Nanos": return t.value.nanos;
		case "Millis": return Mi(t.value.millis);
	}
}, ta = /*#__PURE__*/ j(2, (e, t) => {
	switch (e.value._tag) {
		case "Millis": return t.onMillis(e.value.millis);
		case "Nanos": return t.onNanos(e.value.nanos);
		case "Infinity": return t.onInfinity();
		case "NegativeInfinity": return (t.onNegativeInfinity ?? t.onInfinity)();
	}
}), na = /*#__PURE__*/ j(3, (e, t, n) => e.value._tag === "Infinity" || e.value._tag === "NegativeInfinity" || t.value._tag === "Infinity" || t.value._tag === "NegativeInfinity" ? n.onInfinity(e, t) : e.value._tag === "Millis" ? t.value._tag === "Millis" ? n.onMillis(e.value.millis, t.value.millis) : n.onNanos(ea(e), t.value.nanos) : n.onNanos(e.value.nanos, ea(t))), ra = (e, t) => na(e, t, {
	onMillis: (e, t) => e === t,
	onNanos: (e, t) => e === t,
	onInfinity: (e, t) => e.value._tag === t.value._tag
}), ia = /*#__PURE__*/ j(2, (e, t) => ra(e, t)), aa = /*#__PURE__*/ H("effect/Scheduler", { defaultValue: () => new ca() }), oa = "setImmediate" in globalThis ? (e) => {
	let t = globalThis.setImmediate(e);
	return () => globalThis.clearImmediate(t);
} : (e) => {
	let t = setTimeout(e, 0);
	return () => clearTimeout(t);
}, sa = class {
	buckets = [];
	scheduleTask(e, t) {
		let n = this.buckets, r = n.length, i, a = 0;
		for (; a < r && !(n[a][0] > t); a++) i = n[a];
		i && i[0] === t ? i[1].push(e) : a === r ? n.push([t, [e]]) : n.splice(a, 0, [t, [e]]);
	}
	drain() {
		let e = this.buckets;
		return this.buckets = [], e;
	}
}, ca = class {
	executionMode;
	setImmediate;
	constructor(e = "async", t = oa) {
		this.executionMode = e, this.setImmediate = t;
	}
	shouldYield(e) {
		return e.currentOpCount >= e.maxOpsBeforeYield;
	}
	makeDispatcher() {
		return new la(this.setImmediate);
	}
}, la = class {
	tasks = /*#__PURE__*/ new sa();
	running = void 0;
	setImmediate;
	constructor(e = oa) {
		this.setImmediate = e;
	}
	scheduleTask(e, t) {
		this.tasks.scheduleTask(e, t), this.running === void 0 && (this.running = this.setImmediate(this.afterScheduled));
	}
	afterScheduled = () => {
		this.running = void 0, this.runTasks();
	};
	runTasks() {
		let e = this.tasks.drain();
		for (let t = 0; t < e.length; t++) {
			let n = e[t][1];
			for (let e = 0; e < n.length; e++) n[e]();
		}
	}
	flush() {
		for (; this.tasks.buckets.length > 0;) this.running !== void 0 && (this.running(), this.running = void 0), this.runTasks();
	}
}, ua = /*#__PURE__*/ H("effect/Scheduler/MaxOpsBeforeYield", { defaultValue: () => 2048 }), da = /*#__PURE__*/ H("effect/Scheduler/PreventSchedulerYield", { defaultValue: () => !1 }), fa = "effect/Tracer/ParentSpan", pa = class extends oi()(fa) {}, ma = (e) => e, ha = /*#__PURE__*/ H("effect/Tracer/DisablePropagation", { defaultValue: We }), ga = /*#__PURE__*/ H("effect/Tracer/CurrentTraceLevel", { defaultValue: () => "Info" }), _a = /*#__PURE__*/ H("effect/Tracer/MinimumTraceLevel", { defaultValue: () => "All" }), va = "effect/Tracer", ya = /*#__PURE__*/ H(va, { defaultValue: () => ma({ span: (e) => new ba(e) }) }), ba = class {
	_tag = "Span";
	spanId;
	traceId = "native";
	sampled;
	name;
	parent;
	annotations;
	links;
	startTime;
	kind;
	status;
	attributes;
	events = [];
	constructor(e) {
		this.name = e.name, this.parent = e.parent, this.annotations = e.annotations, this.links = e.links, this.startTime = e.startTime, this.kind = e.kind, this.sampled = e.sampled, this.status = {
			_tag: "Started",
			startTime: e.startTime
		}, this.attributes = /* @__PURE__ */ new Map(), this.traceId = xr(e.parent)?.traceId ?? xa(32), this.spanId = xa(16);
	}
	end(e, t) {
		this.status = {
			_tag: "Ended",
			endTime: e,
			exit: t,
			startTime: this.status.startTime
		};
	}
	attribute(e, t) {
		this.attributes.set(e, t);
	}
	event(e, t, n) {
		this.events.push([
			e,
			t,
			n ?? {}
		]);
	}
	addLinks(e) {
		this.links.push(...e);
	}
}, xa = /*#__PURE__*/ function() {
	return function(e) {
		let t = "";
		for (let n = 0; n < e; n++) t += "abcdef0123456789".charAt(Math.floor(Math.random() * 16));
		return t;
	};
}(), Sa = "effect/observability/Metric/FiberRuntimeMetricsKey", Ca = /*#__PURE__*/ H("effect/References/CurrentStackFrame", { defaultValue: Ge }), wa = /*#__PURE__*/ H("effect/References/TracerEnabled", { defaultValue: Ue }), Ta = /*#__PURE__*/ H("effect/References/TracerTimingEnabled", { defaultValue: Ue }), Ea = /*#__PURE__*/ H("effect/References/TracerSpanAnnotations", { defaultValue: () => ({}) }), Da = /*#__PURE__*/ H("effect/References/TracerSpanLinks", { defaultValue: () => [] }), Oa = /*#__PURE__*/ H("effect/References/CurrentLogLevel", { defaultValue: () => "Info" }), ka = /*#__PURE__*/ H("effect/References/MinimumLogLevel", { defaultValue: () => "Info" }), Aa = (e) => (t) => {
	let n;
	return () => {
		if (n !== void 0) return n;
		let r = t();
		if (!r) return;
		let i = r.split("\n");
		if (i[e] !== void 0) return n = i[e].trim(), n;
	};
}, ja = class extends xn {
	fiberId;
	constructor(e, t = Sn) {
		super("Interrupt", t, "Interrupted"), this.fiberId = e;
	}
	toString() {
		return `Interrupt(${this.fiberId})`;
	}
	toJSON() {
		return {
			_tag: "Interrupt",
			fiberId: this.fiberId
		};
	}
	[L](e) {
		return jn(e) && this.fiberId === e.fiberId && this.annotations === e.annotations;
	}
	[P]() {
		return lt(I(`${this._tag}:${this.fiberId}`))(ct(this.annotations));
	}
}, Ma = (e) => new yn([new ja(e)]), Na = (e) => {
	for (let t = 0; t < e.reasons.length; t++) {
		let n = e.reasons[t];
		if (n._tag === "Fail") return wr(n.error);
	}
	return Tr(e);
}, Pa = (e) => e.reasons.some(jn), Fa = /*#__PURE__*/ j(2, (e, t) => {
	if (e.reasons.length === 0) return t;
	if (t.reasons.length === 0) return e;
	let n = new yn(Lr(e.reasons, t.reasons));
	return Ct(e, n) ? e : n;
}), Ia = (e) => {
	let t = {
		Fail: [],
		Die: [],
		Interrupt: []
	};
	for (let n = 0; n < e.reasons.length; n++) t[e.reasons[n]._tag].push(e.reasons[n]);
	return t;
}, La = (e) => {
	let t = Ia(e);
	return t.Fail.length > 0 ? t.Fail[0].error : t.Die.length > 0 ? t.Die[0].defect : t.Interrupt.length > 0 ? new globalThis.Error("All fibers interrupted without error") : new globalThis.Error("Empty cause");
}, Ra = "~effect/Fiber/dev", za = {
	_A: M,
	_E: M
}, Ba = { id: 0 }, Va = () => globalThis[Kt], Ha = class {
	constructor(e, t = !0) {
		this[Ra] = za, this.setContext(e), this.id = ++Ba.id, this.currentOpCount = 0, this.currentLoopCount = 0, this.interruptible = t, this._stack = [], this._observers = [], this._exit = void 0, this._children = void 0, this._interruptedCause = void 0, this._yielded = void 0, this.runtimeMetrics?.recordFiberStart(this.context);
	}
	[Ra];
	id;
	interruptible;
	currentOpCount;
	currentLoopCount;
	_stack;
	_observers;
	_exit;
	_currentExit;
	_children;
	_interruptedCause;
	_yielded;
	context;
	currentScheduler;
	currentTracerContext;
	currentSpan;
	currentLogLevel;
	minimumLogLevel;
	currentStackFrame;
	runtimeMetrics;
	maxOpsBeforeYield;
	currentPreventYield;
	_dispatcher = void 0;
	get currentDispatcher() {
		return this._dispatcher ??= this.currentScheduler.makeDispatcher();
	}
	getRef(e) {
		return xi(this.context, e);
	}
	addObserver(e) {
		return this._exit ? (e(this._exit), Ke) : (this._observers.push(e), () => {
			let t = this._observers.indexOf(e);
			t >= 0 && this._observers.splice(t, 1);
		});
	}
	interruptUnsafe(e, t) {
		if (this._exit) return;
		let n = Ma(e);
		this.currentStackFrame && (n = On(n, gi(Ln, this.currentStackFrame))), t && (n = On(n, t)), this._interruptedCause = this._interruptedCause ? Fa(this._interruptedCause, n) : n, this.interruptible && this.evaluate(Xa(this._interruptedCause));
	}
	pollUnsafe() {
		return this._exit;
	}
	evaluate(e) {
		if (this._exit) return;
		if (this._yielded !== void 0) {
			let e = this._yielded;
			this._yielded = void 0, e();
		}
		let t = this.runLoop(e);
		if (t === dn) return;
		let n = Ua.interruptChildren && Ua.interruptChildren(this);
		if (n !== void 0) return this.evaluate(W(n, () => t));
		this._exit = t, this.runtimeMetrics?.recordFiberEnd(this.context, this._exit);
		for (let e = 0; e < this._observers.length; e++) this._observers[e](t);
		this._observers.length = 0;
	}
	runLoop(e) {
		let t = globalThis[Kt];
		globalThis[Kt] = this;
		let n = !1, r = e;
		this.currentOpCount = 0;
		let i = ++this.currentLoopCount;
		try {
			for (;;) {
				if (this.currentOpCount++, !n && !this.currentPreventYield && this.currentScheduler.shouldYield(this)) {
					n = !0;
					let e = r;
					r = W(eo, () => e);
				}
				if (r = this.currentTracerContext ? this.currentTracerContext(r, this) : r[B](this), i !== this.currentLoopCount) return dn;
				if (r === dn) {
					let e = this._yielded;
					return an in e ? (this._yielded = void 0, e) : dn;
				}
			}
		} catch (e) {
			return N(r, B) ? this.runLoop(Bn(e)) : Bn(`Fiber.runLoop: Not a valid effect: ${String(r)}`);
		} finally {
			globalThis[Kt] = t;
		}
	}
	getCont(e) {
		for (;;) {
			let t = this._stack.pop();
			if (!t) return;
			let n = t[un] && t[un](this);
			if (n) return n[e] = n, n;
			if (t[e]) return t;
		}
	}
	yieldWith(e) {
		return this._yielded = e, dn;
	}
	children() {
		return this._children ??= /* @__PURE__ */ new Set();
	}
	pipe() {
		return ze(this, arguments);
	}
	setContext(e) {
		this.context = e;
		let t = this.getRef(aa);
		t !== this.currentScheduler && (this.currentScheduler = t, this._dispatcher = void 0), this.currentSpan = e.mapUnsafe.get(fa), this.currentLogLevel = this.getRef(Oa), this.minimumLogLevel = this.getRef(ka), this.currentStackFrame = e.mapUnsafe.get(Ca.key), this.maxOpsBeforeYield = this.getRef(ua), this.currentPreventYield = this.getRef(da), this.runtimeMetrics = e.mapUnsafe.get(Sa);
		let n = e.mapUnsafe.get(va);
		this.currentTracerContext = n ? n.context : void 0;
	}
	get currentSpanLocal() {
		return this.currentSpan?._tag === "Span" ? this.currentSpan : void 0;
	}
}, Ua = { interruptChildren: void 0 }, Wa = (e) => {
	if (!e.currentStackFrame) return;
	let t = /* @__PURE__ */ new Map();
	return t.set(Ln.key, e.currentStackFrame), ui(t);
}, Ga = (e) => {
	let t = e;
	return t._exit ? U(t._exit) : lo((n) => t._exit ? n(U(t._exit)) : Qa(e.addObserver((e) => n(U(e)))));
}, Ka = (e) => lo((t) => {
	let n = e[Symbol.iterator](), r = [], i;
	function a() {
		let e = n.next();
		for (; !e.done;) {
			if (e.value._exit) {
				r.push(e.value._exit), e = n.next();
				continue;
			}
			i = e.value.addObserver((e) => {
				r.push(e), a();
			});
			return;
		}
		t(U(r));
	}
	return a(), Qa(() => i?.());
}), qa = (e) => Vn((t) => Ja(e, t.id)), Ja = /*#__PURE__*/ j((e) => N(e[0], Ra), (e, t, n) => Vn((r) => {
	let i = Wa(r);
	return i = i && n ? Ti(i, n) : i ?? n, e.interruptUnsafe(t, i), Co(Ga(e));
})), Ya = (e) => Vn((t) => {
	let n = Wa(t);
	for (let r of e) r.interruptUnsafe(t.id, n);
	return Co(Ka(e));
}), U = In, Xa = Rn, Za = zn, Qa = /*#__PURE__*/ Pn({
	op: "Sync",
	[B](e) {
		let t = this[z](), n = e.getCont(cn);
		return n ? n[cn](t, e) : e.yieldWith(In(t));
	}
}), $a = /*#__PURE__*/ Pn({
	op: "Suspend",
	[B](e) {
		return this[z]();
	}
}), eo = /*#__PURE__*/ (/* @__PURE__ */ Pn({
	op: "Yield",
	[B](e) {
		let t = !1;
		return e.currentDispatcher.scheduleTask(() => {
			t || e.evaluate(No);
		}, this[z] ?? 0), e.yieldWith(() => {
			t = !0;
		});
	}
}))(0), to = (e) => U(V(e)), no = /*#__PURE__*/ U(/*#__PURE__*/ vr()), ro = (e) => Bn(e), io = (e) => $a(() => Za(nn(e))), ao = /*#__PURE__*/ U(void 0), oo = (e) => {
	let t = typeof e == "function" ? e : e.try, n = typeof e == "function" ? (e) => new $s(e, "An error occurred in Effect.tryPromise") : e.catch;
	return so(function(e, r) {
		try {
			nn(() => t(r)).then((t) => e(U(t)), (t) => e(Za(nn(() => n(t)))));
		} catch (t) {
			e(Za(nn(() => n(t))));
		}
	}, eval.length !== 0);
}, so = /*#__PURE__*/ Pn({
	op: "Async",
	single: !1,
	[B](e) {
		let t = nn(() => this[z][0].bind(e.currentScheduler)), n = !1, r = !1, i = this[z][1] ? new AbortController() : void 0, a = t((t) => {
			n || (n = !0, r ? e.evaluate(t) : r = t);
		}, i?.signal);
		return r === !1 ? (r = !0, e._yielded = () => {
			n = !0;
		}, i === void 0 && a === void 0 || e._stack.push(co(() => (n = !0, i?.abort(), a ?? No))), dn) : r;
	}
}), co = /*#__PURE__*/ Pn({
	op: "AsyncFinalizer",
	[un](e) {
		e.interruptible && (e.interruptible = !1, e._stack.push(xs));
	},
	[ln](e, t) {
		return Pa(e) ? W(this[z](), () => Xa(e)) : Xa(e);
	}
}), lo = (e) => so(e, e.length >= 2), uo = (...e) => $a(() => yo(e.length === 1 ? e[0]() : e[1].call(e[0].self))), fo = (e, ...t) => {
	let n = t.length === 0 ? function() {
		return $a(() => yo(e.apply(this, arguments)));
	} : function() {
		let n = $a(() => yo(e.apply(this, arguments)));
		for (let e = 0; e < t.length; e++) n = t[e](n, ...arguments);
		return n;
	};
	return po(e.length, n);
}, po = (e, t) => Object.defineProperty(t, "length", {
	value: e,
	configurable: !0
}), mo = /*#__PURE__*/ Aa(2), ho = function() {
	let e = typeof arguments[0] == "string", t = e ? arguments[0] : "Effect.fn", n = e ? arguments[1] : void 0, r = globalThis.Error.stackTraceLimit;
	globalThis.Error.stackTraceLimit = 2;
	let i = new globalThis.Error();
	return globalThis.Error.stackTraceLimit = r, e ? (r, ...a) => go(t, r, i, a, e, n) : go(t, arguments[0], i, Array.prototype.slice.call(arguments, 1), e, n);
}, go = (e, t, n, r, i, a) => {
	let o = typeof t == "function" ? t : r.pop().bind(t.self);
	return po(o.length, function(...t) {
		let s = $a(() => {
			let e = o.apply(this, arguments);
			return mn(e) ? e : yo(e);
		});
		for (let e = 0; e < r.length; e++) s = r[e](s, ...t);
		if (!mn(s)) return s;
		let c = globalThis.Error.stackTraceLimit;
		globalThis.Error.stackTraceLimit = 2;
		let l = new globalThis.Error();
		return globalThis.Error.stackTraceLimit = c, zo(i ? Us(e, a, (e) => Ws(s, e)) : s, Ca, (t) => ({
			name: e,
			stack: mo(() => l.stack),
			parent: {
				name: `${e} (definition)`,
				stack: mo(() => n.stack),
				parent: t
			}
		}));
	});
}, _o = (e, ...t) => po(e.length, t.length === 0 ? function() {
	return vo(() => e.apply(this, arguments));
} : function() {
	let n = vo(() => e.apply(this, arguments));
	for (let e of t) n = e(n);
	return n;
}), vo = (e) => {
	try {
		let t = e(), n;
		for (;;) {
			let r = t.next(n);
			if (r.done) return U(r.value);
			let i = r.value;
			if (i && i._tag === "Success") {
				n = i.value;
				continue;
			} else if (i && i._tag === "Failure") return r.value;
			else {
				let n = !0;
				return $a(() => n ? (n = !1, W(r.value, (e) => yo(t, e))) : $a(() => yo(e())));
			}
		}
	} catch (e) {
		return ro(e);
	}
}, yo = /*#__PURE__*/ Pn({
	op: "Iterator",
	single: !1,
	[cn](e, t) {
		let n = this[z][0];
		for (;;) {
			let r = n.next(e);
			if (r.done) return U(r.value);
			if (!To(r.value)) return t._stack.push(this), r.value;
			if (r.value._tag === "Failure") return r.value;
			e = r.value.value;
		}
	},
	[B](e) {
		return this[cn](this[z][1], e);
	}
}), bo = /*#__PURE__*/ j(2, (e, t) => {
	let n = U(t);
	return W(e, (e) => n);
}), xo = /*#__PURE__*/ j(2, (e, t) => W(e, (e) => mn(t) ? t : nn(() => t(e)))), So = /*#__PURE__*/ j(2, (e, t) => W(e, (e) => bo(mn(t) ? t : nn(() => t(e)), e))), Co = (e) => W(e, (e) => No), W = /*#__PURE__*/ j(2, (e, t) => {
	let n = Object.create(wo);
	return n[z] = e, n[cn] = t.length === 1 ? t : (e) => t(e), n;
}), wo = /*#__PURE__*/ Nn({
	op: "OnSuccess",
	[B](e) {
		return e._stack.push(this), this[z];
	}
}), To = (e) => an in e, Eo = /*#__PURE__*/ j(2, (e, t) => To(e) ? e._tag === "Success" ? t(e.value) : e : W(e, t)), Do = (e) => W(e, M), Oo = /*#__PURE__*/ j(2, (e, t) => W(e, (e) => U(nn(() => t(e))))), ko = /*#__PURE__*/ j(2, (e, t) => To(e) ? Po(e, t) : Oo(e, t)), Ao = /*#__PURE__*/ j(2, (e, t) => To(e) ? Fo(e, t) : Jo(e, t)), jo = /*#__PURE__*/ j(2, (e, t) => {
	if (To(e)) {
		if (e._tag === "Success") return e;
		let n = Na(e.cause);
		return Er(n) ? e : t(n.success);
	}
	return qo(e, t);
}), Mo = (e) => e._tag === "Success", No = /*#__PURE__*/ In(void 0), Po = /*#__PURE__*/ j(2, (e, t) => e._tag === "Success" ? In(t(e.value)) : e), Fo = /*#__PURE__*/ j(2, (e, t) => {
	if (e._tag === "Success") return e;
	let n = Na(e.cause);
	return Er(n) ? e : zn(t(n.success));
}), Io = (e) => {
	let t = [];
	for (let n of e) n._tag === "Failure" && t.push(...n.cause.reasons);
	return t.length === 0 ? No : Rn(wn(t));
}, Lo = (e) => Mo(e) ? V(e.value) : vr(), Ro = /*#__PURE__*/ j(2, (e, t) => Vn((n) => {
	let r = n.context, i = t(r);
	return r === i ? e : (n.setContext(i), ys(e, () => {
		n.setContext(r);
	}));
})), zo = /*#__PURE__*/ j(3, (e, t, n) => Ro(e, (e) => {
	let r = yi(e, t), i = n(r);
	return r === i ? e : _i(e, t, i);
})), Bo = (e) => Vn((t) => e(t.context)), Vo = /*#__PURE__*/ j(2, (e, t) => To(e) ? e : Ro(e, Ti(t))), Ho = function() {
	return arguments.length === 1 ? j(2, (e, t) => Uo(e, arguments[0], t)) : j(3, (e, t, n) => Uo(e, t, n)).apply(this, arguments);
}, Uo = (e, t, n) => Ro(e, (e) => e.mapUnsafe.get(t.key) === n ? e : _i(e, t, n)), Wo = /*#__PURE__*/ j(2, (e, t) => {
	let n = Object.create(Go);
	return n[z] = e, n[ln] = t.length === 1 ? t : (e) => t(e), n;
}), Go = /*#__PURE__*/ Nn({
	op: "OnFailure",
	[B](e) {
		return e._stack.push(this), this[z];
	}
}), Ko = /*#__PURE__*/ j(3, (e, t, n) => Wo(e, (e) => {
	let r = t(e);
	return Er(r) ? Xa(r.failure) : nn(() => n(r.success, e));
})), qo = /*#__PURE__*/ j(2, (e, t) => Ko(e, Na, (e) => t(e))), Jo = /*#__PURE__*/ j(2, (e, t) => qo(e, (e) => io(() => t(e)))), Yo = (e) => qo(e, ro), Xo = (e) => ts(e, {
	onFailure: Tr,
	onSuccess: wr
}), Zo = /*#__PURE__*/ j(2, (e, t) => {
	let n = Object.create(Qo);
	return n[z] = e, n[cn] = t.onSuccess.length === 1 ? t.onSuccess : (e) => t.onSuccess(e), n[ln] = t.onFailure.length === 1 ? t.onFailure : (e) => t.onFailure(e), n;
}), Qo = /*#__PURE__*/ Nn({
	op: "OnSuccessAndFailure",
	[B](e) {
		return e._stack.push(this), this[z];
	}
}), $o = /*#__PURE__*/ j(2, (e, t) => Zo(e, {
	onFailure: (e) => {
		let n = e.reasons.find(kn);
		return n ? nn(() => t.onFailure(n.error)) : Xa(e);
	},
	onSuccess: t.onSuccess
})), es = /*#__PURE__*/ j(2, (e, t) => $o(e, {
	onFailure: (e) => Qa(() => t.onFailure(e)),
	onSuccess: (e) => Qa(() => t.onSuccess(e))
})), ts = /*#__PURE__*/ j(2, (e, t) => {
	if (To(e)) {
		if (e._tag === "Success") return In(t.onSuccess(e.value));
		let n = Na(e.cause);
		return Er(n) ? e : In(t.onFailure(n.success));
	}
	return es(e, t);
}), ns = (e) => To(e) ? In(e) : rs(e), rs = /*#__PURE__*/ Pn({
	op: "Exit",
	[B](e) {
		return e._stack.push(this), this[z];
	},
	[cn](e, t, n) {
		return U(n ?? In(e));
	},
	[ln](e, t, n) {
		return U(n ?? Rn(e));
	}
}), is = "~effect/Scope", as = "~effect/Scope/Closeable", os = /*#__PURE__*/ oi("effect/Scope"), ss = (e, t) => $a(() => cs(e, t) ?? ao), cs = (e, t) => {
	if (e.state._tag === "Closed") return;
	let n = {
		_tag: "Closed",
		exit: t
	};
	if (e.state._tag === "Empty") {
		e.state = n;
		return;
	}
	let { finalizers: r } = e.state;
	if (e.state = n, r.size !== 0) return r.size === 1 ? r.values().next().value(t) : ls(e, r, t);
}, ls = /*#__PURE__*/ fo(function* (e, t, n) {
	let r = [], i = [], a = Array.from(t.values()), o = Va();
	for (let t = a.length - 1; t >= 0; t--) {
		let s = a[t];
		e.strategy === "sequential" ? r.push(yield* ns(s(n))) : i.push(ws(o, s(n), !0, !0, "inherit"));
	}
	return i.length > 0 && (r = yield* Ka(i)), yield* Io(r);
}), us = (e, t) => {
	let n = ms(t);
	if (e.state._tag === "Closed") return n.state = e.state, n;
	let r = {};
	return fs(e, r, (e) => ss(n, e)), fs(n, r, (t) => Qa(() => ps(e, r))), n;
}, ds = (e, t) => $a(() => e.state._tag === "Closed" ? t(e.state.exit) : (fs(e, {}, t), ao)), fs = (e, t, n) => {
	e.state._tag === "Empty" ? e.state = {
		_tag: "Open",
		finalizers: /* @__PURE__ */ new Map([[t, n]])
	} : e.state._tag === "Open" && e.state.finalizers.set(t, n);
}, ps = (e, t) => {
	e.state._tag === "Open" && e.state.finalizers.delete(t);
}, ms = (e = "sequential") => ({
	[as]: as,
	[is]: is,
	strategy: e,
	state: hs
}), hs = { _tag: "Empty" }, gs = os, _s = /*#__PURE__*/ Ho(os), vs = (e) => W(gs, (t) => Bo((n) => ds(t, (t) => Vo(e(t), n)))), ys = /*#__PURE__*/ Pn({
	op: "OnExit",
	single: !1,
	[B](e) {
		return e._stack.push(this), this[z][0];
	},
	[un](e) {
		e.interruptible && this[z][2] !== !0 && (e._stack.push(xs), e.interruptible = !1);
	},
	[cn](e, t, n) {
		n ??= In(e);
		let r = this[z][1](n);
		return r ? W(r, (e) => n) : n;
	},
	[ln](e, t, n) {
		n ??= Rn(e);
		let r = this[z][1](n);
		return r ? W(r, (e) => n) : n;
	}
}), bs = /*#__PURE__*/ j(2, ys), xs = /*#__PURE__*/ (/* @__PURE__ */ Pn({
	op: "SetInterruptible",
	[un](e) {
		if (e.interruptible = this[z], e._interruptedCause && e.interruptible) return () => Xa(e._interruptedCause);
	}
}))(!0), Ss = (e) => {
	let t = e.onItem, n = e.step;
	return (e, r, i) => {
		let a = i?.start ?? 0, o = i?.end ?? r.length, s = i?.concurrency ?? 1, c = !1, l, u, d, f = !1, p, m, h = () => {
			let i = !1;
			for (; !p && a < o; a++) {
				let o = r[a], g = m ?? t(e, o, a);
				if (To(g)) {
					if (p = n(e, o, g, a), p) break;
				} else if (s === 1) return W(ns(g), (t) => (p = n(e, o, t, a), a++, p ?? h() ?? ao));
				else if (l) {
					m = void 0;
					let t = ws(l, g, !0, !0, "inherit");
					if (t._exit) {
						if (p = n(e, o, t._exit, a), p) break;
						continue;
					}
					u ? u.add(t) : u = /* @__PURE__ */ new Set([t]);
					let r = a;
					if (t.addObserver((a) => {
						if (u.delete(t), p) {
							if (!f && a._tag === "Failure") for (let e of a.cause.reasons) if (e._tag === "Interrupt") continue;
							else p._tag === "Failure" ? p.cause.reasons.push(e) : p = Rn(wn([e]));
						} else {
							let t = n(e, o, a, r);
							t && (p = t._tag === "Failure" ? Rn(wn(t.cause.reasons.slice())) : t, h());
						}
						if (i) {
							let e = h();
							e && d(e);
						} else c && u.size === 0 && d(p ?? ao);
					}), u.size < s) continue;
					i = !0, a++;
					return;
				} else return lo((e) => {
					l = Va(), m = g, d = e;
					let t = h();
					return t ? e(t) : $a(() => (p = No, f = !0, u ? Ya(u) : ao));
				});
			}
			if (c = !0, p) {
				if (u && u.size > 0) {
					let e = Wa(l);
					u.forEach((t) => t.interruptUnsafe(l.id, e));
					return;
				}
				if (d || p._tag === "Failure") return p;
			} else if (d) if (u) u.size === 0 && d(ao);
			else return No;
		};
		return h();
	};
}, Cs = () => Ss, ws = (e, t, n = !1, r = !1, i = !1) => {
	let a = i === "inherit" ? e.interruptible : !i, o = new Ha(e.context, a);
	return n ? o.evaluate(t) : e.currentDispatcher.scheduleTask(() => o.evaluate(t), 0), !r && !o._exit && (e.children().add(o), o.addObserver(() => e._children.delete(o))), o;
}, Ts = (e) => (t, n) => {
	let r = new Ha(n?.scheduler ? _i(e, aa, n.scheduler) : e, n?.uninterruptible !== !0);
	if (r.evaluate(t), r._exit) return r;
	if (n?.signal) if (n.signal.aborted) r.interruptUnsafe();
	else {
		let e = () => r.interruptUnsafe();
		n.signal.addEventListener("abort", e, { once: !0 }), r.addObserver(() => n.signal.removeEventListener("abort", e));
	}
	return n?.onFiberStart && n.onFiberStart(r), r;
}, Es = /*#__PURE__*/ j(2, (e, t) => {
	if (e._exit) return e;
	if (t.state._tag === "Closed") return e.interruptUnsafe(e.id), e;
	let n = {};
	return fs(t, n, () => qa(e)), e.addObserver(() => ps(t, n)), e;
}), Ds = /*#__PURE__*/ Ts(/*#__PURE__*/ mi()), Os = (e) => {
	let t = Ts(e);
	return (e, n) => {
		let r = t(e, n);
		return n?.onExit && r.addObserver(n.onExit), (e) => r.interruptUnsafe(e);
	};
}, ks = /*#__PURE__*/ Os(/*#__PURE__*/ mi()), As = (e) => {
	let t = Ts(e);
	return (e, n) => {
		let r = t(e, n);
		return new Promise((e) => {
			r.addObserver((t) => e(t));
		});
	};
}, js = /*#__PURE__*/ As(/*#__PURE__*/ mi()), Ms = (e) => {
	let t = As(e);
	return (e, n) => t(e, n).then((e) => {
		if (e._tag === "Failure") throw La(e.cause);
		return e.value;
	});
}, Ns = /*#__PURE__*/ Ms(/*#__PURE__*/ mi()), Ps = (e) => {
	let t = Ts(e);
	return (e) => {
		if (To(e)) return e;
		let n = new ca("sync"), r = t(e, { scheduler: n });
		return r.currentDispatcher?.flush(), r._exit ?? Bn(new Zs(r));
	};
}, Fs = /*#__PURE__*/ Ps(/*#__PURE__*/ mi()), Is = (e) => {
	let t = Ps(e);
	return (e) => {
		let n = t(e);
		if (n._tag === "Failure") throw La(n.cause);
		return n.value;
	};
}, Ls = /*#__PURE__*/ Is(/*#__PURE__*/ mi()), Rs = /*#__PURE__*/ BigInt(0), zs = {
	_tag: "Span",
	spanId: "noop",
	traceId: "noop",
	sampled: !1,
	status: {
		_tag: "Ended",
		startTime: Rs,
		endTime: Rs,
		exit: No
	},
	attributes: /*#__PURE__*/ new Map(),
	links: [],
	kind: "internal",
	attribute() {},
	event() {},
	end() {},
	addLinks() {}
}, Bs = (e) => Object.assign(Object.create(zs), e), Vs = (e) => e ? bi(e.annotations, ha) ? e._tag === "Span" ? Vs(xr(e.parent)) : vr() : V(e) : vr(), Hs = (e, t, n) => {
	let r = !e.getRef(wa) || n?.annotations && bi(n.annotations, ha), i = n?.parent === void 0 ? n?.root ? vr() : Vs(e.currentSpan) : V(n.parent), a;
	if (r) a = Bs({
		name: t,
		parent: i,
		annotations: _i(n?.annotations ?? mi(), ha, !0)
	});
	else {
		let r = e.getRef(ya), o = e.getRef(Gs), s = e.getRef(Ta), c = e.getRef(Ea), l = e.getRef(Da), u = n?.level ?? e.getRef(ga), d = n?.links === void 0 ? l.slice() : [...l, ...n.links];
		a = r.span({
			name: t,
			parent: i,
			annotations: n?.annotations ?? mi(),
			links: d,
			startTime: s ? o.currentTimeNanosUnsafe() : BigInt(0),
			kind: n?.kind ?? "internal",
			root: n?.root ?? yr(i),
			sampled: n?.sampled ?? (br(i) && i.value.sampled === !1 ? !1 : !ec(e.getRef(_a), u))
		});
		for (let [e, t] of Object.entries(c)) a.attribute(e, t);
		if (n?.attributes !== void 0) for (let [e, t] of Object.entries(n.attributes)) a.attribute(e, t);
	}
	return a;
}, Us = (e, ...t) => {
	let n = t.length === 1 ? void 0 : t[0], r = t[t.length - 1];
	return Vn((t) => {
		let i = Hs(t, e, n), a = t.getRef(Gs);
		return bs(nn(() => r(i)), (e) => Qa(() => {
			i.status._tag !== "Ended" && i.end(a.currentTimeNanosUnsafe(), e);
		}));
	});
}, Ws = /*#__PURE__*/ Ho(pa), Gs = /*#__PURE__*/ H("effect/Clock", { defaultValue: () => new qs() }), Ks = 2 ** 31 - 1, qs = class {
	currentTimeMillisUnsafe() {
		return Date.now();
	}
	currentTimeMillis = /*#__PURE__*/ Qa(() => this.currentTimeMillisUnsafe());
	currentTimeNanosUnsafe() {
		return Ys();
	}
	currentTimeNanos = /*#__PURE__*/ Qa(() => this.currentTimeNanosUnsafe());
	sleep(e) {
		let t = $i(e);
		return t <= 0 ? eo : lo((e) => {
			if (t > Ks) return;
			let n = setTimeout(() => e(ao), t);
			return Qa(() => clearTimeout(n));
		});
	}
}, Js = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ BigInt(1e6);
	if (typeof performance > "u" || performance.now === void 0) return () => BigInt(Date.now()) * e;
	if (typeof performance.timeOrigin == "number" && performance.timeOrigin === 0) return () => BigInt(Math.round(performance.now() * 1e6));
	let t = /*#__PURE__*/ BigInt(/*#__PURE__*/ Date.now()) * e - /*#__PURE__*/ BigInt(/*#__PURE__*/ Math.round(/*#__PURE__*/ performance.now() * 1e6));
	return () => t + BigInt(Math.round(performance.now() * 1e6));
}(), Ys = /*#__PURE__*/ function() {
	let e = typeof process == "object" && "hrtime" in process && typeof process.hrtime.bigint == "function" ? process.hrtime : void 0;
	if (!e) return Js;
	let t = /*#__PURE__*/ Js() - /*#__PURE__*/ e.bigint();
	return () => t + e.bigint();
}();
Wn("TimeoutError"), Wn("IllegalArgumentError"), Wn("ExceededCapacityError");
var Xs = "~effect/Cause/AsyncFiberError", Zs = class extends Wn("AsyncFiberError") {
	[Xs] = Xs;
	constructor(e) {
		super({
			message: "An asynchronous Effect was executed with Effect.runSync",
			fiber: e
		});
	}
}, Qs = "~effect/Cause/UnknownError", $s = class extends Wn("UnknownError") {
	[Qs] = Qs;
	constructor(e, t) {
		super({
			message: t,
			cause: e
		});
	}
}, ec = /*#__PURE__*/ hr(/* @__PURE__ */ pr(dr, (e) => {
	switch (e) {
		case "All": return -(2 ** 53 - 1);
		case "Fatal": return 5e4;
		case "Error": return 4e4;
		case "Warn": return 3e4;
		case "Info": return 2e4;
		case "Debug": return 1e4;
		case "Trace": return 0;
		case "None": return 2 ** 53 - 1;
	}
})), tc = {
	bold: "1",
	red: "31",
	green: "32",
	yellow: "33",
	blue: "34",
	cyan: "36",
	white: "37",
	gray: "90",
	black: "30",
	bgBrightRed: "101"
};
tc.gray, tc.blue, tc.green, tc.yellow, tc.red, tc.bgBrightRed, tc.black;
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Cause.js
var nc = Na;
oi()("effect/Cause/StackTrace"), oi()("effect/Cause/InterruptorStackTrace");
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Exit.js
var rc = zn, ic = No, ac = Lo, oc = {
	"~effect/Deferred": {
		_A: M,
		_E: M
	},
	pipe() {
		return ze(this, arguments);
	}
}, sc = () => {
	let e = Object.create(oc);
	return e.resumes = void 0, e.effect = void 0, e;
}, cc = (e) => lo((t) => e.effect ? t(e.effect) : (e.resumes ??= [], e.resumes.push(t), Qa(() => {
	let n = e.resumes.indexOf(t);
	e.resumes.splice(n, 1);
}))), lc = /* @__PURE__ */ j(2, (e, t) => Qa(() => uc(e, t))), uc = (e, t) => {
	if (e.effect) return !1;
	if (e.effect = t, e.resumes) {
		for (let n = 0; n < e.resumes.length; n++) e.resumes[n](t);
		e.resumes = void 0;
	}
	return !0;
}, dc = ms, fc = _s, pc = us, mc = ss, hc = "~effect/Layer", gc = "~effect/Layer/MemoMap", _c = (e, t) => (e.observers++, xo(ds(t, (t) => e.finalizer(t)), e.effect)), vc = {
	[hc]: {
		_ROut: M,
		_E: M,
		_RIn: M
	},
	pipe() {
		return ze(this, arguments);
	}
}, yc = (e) => {
	let t = Object.create(vc);
	return t.build = e, t;
}, bc = (e) => yc((t, n) => {
	let r = pc(n);
	return bs(e(t, r), (e) => e._tag === "Failure" ? mc(r, e) : ao);
}), xc = (e) => {
	let t = bc((n, r) => n.getOrElseMemoize(t, r, e));
	return t;
}, Sc = (e, t, n, r) => {
	let i = dc(), a = sc(), o = {
		observers: 1,
		effect: cc(a),
		finalizer: (n) => $a(() => (o.observers--, o.observers === 0 ? (e.map.delete(t), mc(i, n)) : ao))
	};
	return e.map.set(t, o), ds(n, o.finalizer).pipe(W(() => r(e, i)), bs((e) => (o.effect = e, lc(a, e))));
}, Cc = class {
	get [gc]() {
		return gc;
	}
	parent;
	constructor(e) {
		this.parent = e;
	}
	map = /*#__PURE__*/ new Map();
	get(e, t) {
		let n = this.map.get(e);
		return n ? _c(n, t) : this.parent?.get(e, t);
	}
	getOrElseMemoize(e, t, n) {
		return this.get(e, t) || Sc(this, e, t, n);
	}
}, wc = () => new Cc(), Tc = class extends oi()("effect/Layer/CurrentMemoMap") {
	static getOrCreate = /*#__PURE__*/ vi(this, wc);
}, Ec = /*#__PURE__*/ j(3, (e, t, n) => Ho(Oo(e.build(t, n), _i(Tc, t)), Tc, t)), Dc = function() {
	return arguments.length === 1 ? (e) => Oc(arguments[0], e) : Oc(arguments[0], arguments[1]);
}, Oc = (e, t) => kc(Oo(t, (t) => gi(e, t))), kc = (e) => xc((t, n) => fc(e, n)), Ac = Wn, jc = "~effect/time/DateTime", Mc = "~effect/time/DateTime/TimeZone", Nc = {
	[jc]: jc,
	pipe() {
		return ze(this, arguments);
	},
	[$t]() {
		return this.toString();
	},
	toJSON() {
		return Fc(this).toJSON();
	}
};
({ ...Nc }), { ...Nc };
var Pc = {
	[Mc]: Mc,
	[$t]() {
		return this.toString();
	}
};
({ ...Pc }), { ...Pc };
var Fc = (e) => new Date(e.epochMilliseconds), Ic = oo, Lc = U, Rc = no, zc = to, Bc = $a, Vc = Qa, Hc = uo, G = Za, Uc = ro, Wc = Vn, Gc = W, Kc = Do, qc = So, Jc = Xo, Yc = ns, Xc = Oo, Zc = Yo, Qc = Vo, $c = vs, el = Ds, tl = Ts, nl = Os, rl = ks, il = Ns, al = Ms, ol = js, sl = As, cl = Ls, ll = Is, ul = Fs, dl = Ps, fl = ho;
oi()("effect/Effect/Transaction");
var pl = ko, ml = Ao, hl = Eo, gl = jo, _l = _o;
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/record.js
function vl(e, t, n) {
	return t === "__proto__" ? Object.defineProperty(e, t, {
		value: n,
		writable: !0,
		enumerable: !0,
		configurable: !0
	}) : e[t] = n, e;
}
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/schema/annotations.js
function yl(e) {
	return e.checks ? e.checks[e.checks.length - 1].annotations : e.annotations;
}
function bl(e) {
	return (t) => yl(t)?.[e];
}
var xl = /*#__PURE__*/ bl("identifier"), Sl = /*#__PURE__*/ Je((e) => {
	let t = xl(e);
	return typeof t == "string" ? t : e.getExpected(Sl);
});
globalThis.RegExp;
var Cl = (e) => e.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");
oi()("effect/DateTime/CurrentTimeZone"), Ac("EncodingError");
var wl = "~effect/SchemaIssue/Issue";
function Tl(e) {
	return N(e, wl);
}
var El = class {
	[wl] = wl;
	toString() {
		return Kl(this);
	}
}, Dl = class extends El {
	_tag = "Filter";
	actual;
	filter;
	issue;
	constructor(e, t, n) {
		super(), this.actual = e, this.filter = t, this.issue = n;
	}
}, Ol = class extends El {
	_tag = "Encoding";
	ast;
	actual;
	issue;
	constructor(e, t, n) {
		super(), this.ast = e, this.actual = t, this.issue = n;
	}
}, kl = class extends El {
	_tag = "Pointer";
	path;
	issue;
	constructor(e, t) {
		super(), this.path = e, this.issue = t;
	}
}, Al = class extends El {
	_tag = "MissingKey";
	annotations;
	constructor(e) {
		super(), this.annotations = e;
	}
}, jl = class extends El {
	_tag = "UnexpectedKey";
	ast;
	actual;
	constructor(e, t) {
		super(), this.ast = e, this.actual = t;
	}
}, Ml = class extends El {
	_tag = "Composite";
	ast;
	actual;
	issues;
	constructor(e, t, n) {
		super(), this.ast = e, this.actual = t, this.issues = n;
	}
}, Nl = class extends El {
	_tag = "InvalidType";
	ast;
	actual;
	constructor(e, t) {
		super(), this.ast = e, this.actual = t;
	}
}, Pl = class extends El {
	_tag = "InvalidValue";
	actual;
	annotations;
	constructor(e, t) {
		super(), this.actual = e, this.annotations = t;
	}
}, Fl = class extends El {
	_tag = "AnyOf";
	ast;
	actual;
	issues;
	constructor(e, t, n) {
		super(), this.ast = e, this.actual = t, this.issues = n;
	}
}, Il = class extends El {
	_tag = "OneOf";
	ast;
	actual;
	successes;
	constructor(e, t, n) {
		super(), this.ast = e, this.actual = t, this.successes = n;
	}
};
function Ll(e, t) {
	if (Tl(t)) return t;
	if (typeof t == "string") return new Pl(V(e), { message: t });
	let n = typeof t.issue == "string" ? new Pl(V(e), { message: t.issue }) : t.issue;
	return new kl(t.path, n);
}
function Rl(e, t) {
	if (t !== void 0) return typeof t == "boolean" ? t ? void 0 : new Pl(V(e)) : Ll(e, t);
}
function zl(e, t, n) {
	return Array.isArray(n) ? Mr(n) ? n.length === 1 ? Ll(e, n[0]) : new Ml(t, V(e), zr(n, (t) => Ll(e, t))) : void 0 : Rl(e, n);
}
var Bl = (e) => {
	let t = Jl(e);
	if (t !== void 0) return t;
	switch (e._tag) {
		case "InvalidType": return Hl(Sl(e.ast), Xl(e.actual));
		case "InvalidValue": return `Invalid data ${Xl(e.actual)}`;
		case "MissingKey": return "Missing key";
		case "UnexpectedKey": return `Unexpected key with value ${R(e.actual)}`;
		case "Forbidden": return "Forbidden operation";
		case "OneOf": return `Expected exactly one member to match the input ${R(e.actual)}`;
	}
}, Vl = (e) => Jl(e.issue) ?? Jl(e);
function Hl(e, t) {
	return `Expected ${e}, got ${t}`;
}
function Ul(e, t, n, r) {
	switch (e._tag) {
		case "Filter": {
			let i = r(e);
			if (i !== void 0) return [{
				path: t,
				message: i
			}];
			switch (e.issue._tag) {
				case "InvalidValue": return [{
					path: t,
					message: Hl(Wl(e.filter), R(e.actual))
				}];
				default: return Ul(e.issue, t, n, r);
			}
		}
		case "Encoding": return Ul(e.issue, t, n, r);
		case "Pointer": return Ul(e.issue, [...t, ...e.path], n, r);
		case "Composite": return e.issues.flatMap((e) => Ul(e, t, n, r));
		case "AnyOf": {
			let i = Jl(e);
			return e.issues.length === 0 ? i === void 0 ? [{
				path: t,
				message: Hl(Sl(e.ast), R(e.actual))
			}] : [{
				path: t,
				message: i
			}] : e.issues.flatMap((e) => Ul(e, t, n, r));
		}
		default: return [{
			path: t,
			message: n(e)
		}];
	}
}
function Wl(e) {
	let t = e.annotations?.expected;
	if (typeof t == "string") return t;
	switch (e._tag) {
		case "Filter": return "<filter>";
		case "FilterGroup": return e.checks.map((e) => Wl(e)).join(" & ");
	}
}
function Gl() {
	return (e) => Ul(e, [], Bl, Vl).map(ql).join("\n");
}
var Kl = /*#__PURE__*/ Gl();
function ql(e) {
	let t = e.message;
	if (e.path && e.path.length > 0) {
		let n = Xt(e.path);
		t += `\n  at ${n}`;
	}
	return t;
}
function Jl(e) {
	switch (e._tag) {
		case "InvalidType":
		case "OneOf":
		case "Composite":
		case "AnyOf": return Yl(e.ast.annotations);
		case "InvalidValue":
		case "Forbidden": return Yl(e.annotations);
		case "MissingKey": return Yl(e.annotations, "messageMissingKey");
		case "UnexpectedKey": return Yl(e.ast.annotations, "messageUnexpectedKey");
		case "Filter": return Yl(e.filter.annotations);
		case "Encoding": return Jl(e.issue);
	}
}
function Yl(e, t = "message") {
	let n = e?.[t];
	if (typeof n == "string") return n;
}
function Xl(e) {
	return yr(e) ? "no value provided" : R(e.value);
}
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/SchemaGetter.js
var Zl = class e extends Ve {
	run;
	constructor(e) {
		super(), this.run = e;
	}
	map(t) {
		return new e((e, n) => this.run(e, n).pipe(pl(Sr(t))));
	}
	compose(t) {
		return $l(this) ? t : $l(t) ? this : new e((e, n) => this.run(e, n).pipe(hl((e) => t.run(e, n))));
	}
}, Ql = /*#__PURE__*/ new Zl(Lc);
function $l(e) {
	return e.run === Ql.run;
}
function eu() {
	return Ql;
}
function tu(e) {
	return nu(Sr(e));
}
function nu(e) {
	return new Zl((t) => Lc(e(t)));
}
function ru(e) {
	return new Zl((t) => {
		let n = Cr(t, it);
		return br(n) ? Lc(n) : pl(e, V);
	});
}
function iu() {
	return tu(globalThis.String);
}
function au() {
	return tu(globalThis.Number);
}
function ou() {
	return tu(globalThis.BigInt);
}
function su() {
	return tu((e) => new globalThis.Date(e));
}
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/SchemaTransformation.js
var cu = "~effect/SchemaTransformation/Transformation", lu = class e {
	[cu] = cu;
	_tag = "Transformation";
	decode;
	encode;
	constructor(e, t) {
		this.decode = e, this.encode = t;
	}
	flip() {
		return new e(this.encode, this.decode);
	}
	compose(t) {
		return new e(this.decode.compose(t.decode), t.encode.compose(this.encode));
	}
};
function uu(e) {
	return N(e, cu);
}
var du = (e) => uu(e) ? e : new lu(e.decode, e.encode), fu = /*#__PURE__*/ new lu(/*#__PURE__*/ eu(), /*#__PURE__*/ eu());
function pu() {
	return fu;
}
var mu = /*#__PURE__*/ new lu(/*#__PURE__*/ au(), /*#__PURE__*/ iu()), hu = /*#__PURE__*/ new lu(/*#__PURE__*/ ou(), /*#__PURE__*/ iu()), gu = /*#__PURE__*/ new lu(/*#__PURE__*/ su(), /*#__PURE__*/ tu(Zt));
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/SchemaAST.js
function _u(e) {
	return (t) => t._tag === e;
}
var vu = /*#__PURE__*/ _u("Declaration"), yu = /*#__PURE__*/ _u("Never"), bu = /*#__PURE__*/ _u("Literal"), xu = /*#__PURE__*/ _u("UniqueSymbol"), Su = /*#__PURE__*/ _u("Arrays"), Cu = /*#__PURE__*/ _u("Objects"), wu = /*#__PURE__*/ _u("Union"), K = class {
	to;
	transformation;
	constructor(e, t) {
		this.to = e, this.transformation = t;
	}
}, Tu = {}, Eu = class {
	isOptional;
	isMutable;
	defaultValue;
	annotations;
	constructor(e, t, n = void 0, r = void 0) {
		this.isOptional = e, this.isMutable = t, this.defaultValue = n, this.annotations = r;
	}
}, Du = "~effect/Schema", q = class {
	[Du] = Du;
	annotations;
	checks;
	encoding;
	context;
	constructor(e = void 0, t = void 0, n = void 0, r = void 0) {
		this.annotations = e, this.checks = t, this.encoding = n, this.context = r;
	}
	toString() {
		return `<${this._tag}>`;
	}
}, Ou = class e extends q {
	_tag = "Declaration";
	typeParameters;
	run;
	encodingChecks;
	constructor(e, t, n, r, i, a, o) {
		super(n, r, i, a), this.typeParameters = e, this.run = t, this.encodingChecks = o;
	}
	getParser() {
		let e = this.run(this.typeParameters);
		return (t, n) => yr(t) ? Rc : pl(e(t.value, this, n), V);
	}
	rebuild(t, n, r) {
		let i = Md(this.typeParameters, t);
		return i === this.typeParameters ? this : new e(i, this.run, this.annotations, n, void 0, this.context, r);
	}
	recur(e) {
		return this.rebuild(e, this.checks, this.encodingChecks);
	}
	flip(e) {
		return this.rebuild(e, this.encodingChecks, this.checks);
	}
	getExpected() {
		let e = this.annotations?.expected;
		return typeof e == "string" ? e : "<Declaration>";
	}
}, ku = /*#__PURE__*/ new class extends q {
	_tag = "Null";
	getParser() {
		return Xd(this, null);
	}
	getExpected() {
		return "null";
	}
}(), Au = class extends q {
	_tag = "Undefined";
	getParser() {
		return Xd(this, void 0);
	}
	toCodecJson() {
		return J(this, [ju]);
	}
	getExpected() {
		return "undefined";
	}
}, ju = /*#__PURE__*/ new K(ku, /*#__PURE__*/ new lu(/*#__PURE__*/ tu(() => void 0), /*#__PURE__*/ tu(() => null))), Mu = /*#__PURE__*/ new Au(), Nu = /*#__PURE__*/ new class extends q {
	_tag = "Any";
	getParser() {
		return Zd(this, ot);
	}
	getExpected() {
		return "any";
	}
}(), Pu = /*#__PURE__*/ new class extends q {
	_tag = "Unknown";
	getParser() {
		return Zd(this, ot);
	}
	getExpected() {
		return "unknown";
	}
}(), Fu = /*#__PURE__*/ new class extends q {
	_tag = "ObjectKeyword";
	getParser() {
		return Zd(this, st);
	}
	getExpected() {
		return "object | array | function";
	}
}(), Iu = class extends q {
	_tag = "Literal";
	literal;
	constructor(e, t, n, r, i) {
		if (super(t, n, r, i), typeof e == "number" && !globalThis.Number.isFinite(e)) throw Error(`A numeric literal must be finite, got ${R(e)}`);
		this.literal = e;
	}
	getParser() {
		return Xd(this, this.literal);
	}
	toCodecJson() {
		return typeof this.literal == "bigint" ? Lu(this) : this;
	}
	toCodecStringTree() {
		return typeof this.literal == "string" ? this : Lu(this);
	}
	getExpected() {
		return typeof this.literal == "string" ? JSON.stringify(this.literal) : globalThis.String(this.literal);
	}
};
function Lu(e) {
	let t = globalThis.String(e.literal);
	return J(e, [new K(new Iu(t), new lu(tu(() => e.literal), tu(() => t)))]);
}
var Ru = /*#__PURE__*/ new class extends q {
	_tag = "String";
	getParser() {
		return Zd(this, Ze);
	}
	getExpected() {
		return "string";
	}
}(), zu = class extends q {
	_tag = "Number";
	getParser() {
		return Zd(this, Qe);
	}
	toCodecJson() {
		return this.checks && (Bu(this.checks, "isFinite") || Bu(this.checks, "isInt")) ? this : J(this, [gd]);
	}
	toCodecStringTree() {
		return this.checks && (Bu(this.checks, "isFinite") || Bu(this.checks, "isInt")) ? J(this, [af]) : J(this, [of]);
	}
	getExpected() {
		return "number";
	}
};
function Bu(e, t) {
	return e.some((e) => {
		switch (e._tag) {
			case "Filter": return e.annotations?.meta?._tag === t;
			case "FilterGroup": return Bu(e.checks, t);
		}
	});
}
var Vu = /*#__PURE__*/ new zu(), Hu = /*#__PURE__*/ new class extends q {
	_tag = "Boolean";
	getParser() {
		return Zd(this, $e);
	}
	getExpected() {
		return "boolean";
	}
}(), Uu = /*#__PURE__*/ new class extends q {
	_tag = "BigInt";
	getParser() {
		return Zd(this, et);
	}
	toCodecStringTree() {
		return J(this, [uf]);
	}
	getExpected() {
		return "bigint";
	}
}(), Wu = class e extends q {
	_tag = "Arrays";
	isMutable;
	elements;
	rest;
	encodingChecks;
	constructor(e, t, n, r, i, a, o, s) {
		super(r, i, a, o), this.isMutable = e, this.elements = t, this.rest = n, this.encodingChecks = s;
		let c = t.findIndex(Bd);
		if (c !== -1 && (t.slice(c + 1).some((e) => !Bd(e)) || n.length > 1)) throw Error("A required element cannot follow an optional element. ts(1257)");
		if (n.length > 1 && n.slice(1).some(Bd)) throw Error("An optional element cannot follow a rest element. ts(1266)");
	}
	getParser(e) {
		let t = this, n = t.elements.map((t) => ({
			ast: t,
			parser: e(t)
		})), r = t.rest.map((t) => ({
			ast: t,
			parser: e(t)
		})), i = n.length, [a, ...o] = r, s = o.length;
		function c(e, t) {
			return t < i ? n[t] : t >= e ? o[t - e] : a;
		}
		return _l(function* (e, n) {
			if (e._tag === "None") return e;
			let r = e.value;
			if (!Array.isArray(r)) return yield* G(new Nl(t, e));
			let a = r.length, o = {
				ast: t,
				getParser: c,
				oinput: e,
				len: a,
				tailThreshold: Ku(a, i, s),
				output: new globalThis.Array(a),
				issues: void 0,
				options: n
			}, l = Gu(o, r, {
				concurrency: qu(n?.concurrency)?.concurrency,
				end: t.rest.length === 0 ? i : Math.max(a, i + s)
			});
			if (l && (yield* l), t.rest.length === 0 && a > i) for (let s = i; s <= a - 1; s++) {
				let i = new kl([s], new jl(t, r[s]));
				if (n.errors === "all") o.issues ? o.issues.push(i) : o.issues = [i];
				else return yield* G(new Ml(t, e, [i]));
			}
			return o.issues ? yield* G(new Ml(t, e, o.issues)) : V(o.output);
		});
	}
	rebuild(t, n, r) {
		let i = Md(this.elements, t), a = Md(this.rest, t);
		return i === this.elements && a === this.rest ? this : new e(this.isMutable, i, a, this.annotations, n, void 0, this.context, r);
	}
	recur(e) {
		return this.rebuild(e, this.checks, this.encodingChecks);
	}
	flip(e) {
		return this.rebuild(e, this.encodingChecks, this.checks);
	}
	getExpected() {
		return "array";
	}
}, Gu = /*#__PURE__*/ Cs()({
	onItem(e, t, n) {
		let r = n < e.len ? V(t) : vr();
		return e.getParser(e.tailThreshold, n).parser(r, e.options);
	},
	step(e, t, n, r) {
		if (n._tag === "Failure") return Ju(e, e.ast, r, n);
		if (n.value._tag === "Some") e.output[r] = n.value.value;
		else {
			let t = e.getParser(e.tailThreshold, r);
			if (Bd(t.ast)) return;
			let n = new kl([r], new Al(t.ast.context?.annotations));
			if (e.options.errors === "all") e.issues ? e.issues.push(n) : e.issues = [n];
			else return rc(new Ml(e.ast, e.oinput, [n]));
		}
	}
});
function Ku(e, t, n) {
	return Math.max(t, e - n);
}
var qu = (e) => (e = e === "unbounded" ? Infinity : e ?? 1, e > 1 ? { concurrency: e } : void 0), Ju = (e, t, n, r) => {
	let i = nc(r.cause);
	if (Er(i)) return r;
	let a = new kl([n], i.success);
	if (e.options.errors === "all") e.issues ? e.issues.push(a) : e.issues = [a];
	else return rc(new Ml(t, e.oinput, [a]));
}, Yu = "[+-]?\\d*\\.?\\d+(?:[Ee][+-]?\\d+)?", Xu = /*#__PURE__*/ new globalThis.RegExp(`(?:${Yu}|Infinity|-Infinity|NaN)`);
function Zu(e, t) {
	let n = Hd(t);
	switch (n._tag) {
		case "String": return Object.keys(e);
		case "TemplateLiteral": {
			let t = qd(n);
			return Object.keys(e).filter((e) => t.test(e));
		}
		case "Symbol": return Object.getOwnPropertySymbols(e);
		case "Number": return Object.keys(e).filter((e) => Xu.test(e));
		case "Union": return [...new Set(n.types.flatMap((t) => Zu(e, t)))];
		default: return [];
	}
}
var Qu = class {
	name;
	type;
	constructor(e, t) {
		this.name = e, this.type = t;
	}
}, $u = class e {
	decode;
	encode;
	constructor(e, t) {
		this.decode = e, this.encode = t;
	}
	flip() {
		return new e(this.encode, this.decode);
	}
}, ed = class {
	parameter;
	type;
	merge;
	constructor(e, t, n) {
		if (this.parameter = e, this.type = t, this.merge = n, Bd(t) && !Gd(t)) throw Error("Cannot use `Schema.optionalKey` with index signatures, use `Schema.optional` instead.");
	}
}, td = class e extends q {
	_tag = "Objects";
	propertySignatures;
	indexSignatures;
	encodingChecks;
	constructor(e, t, n, r, i, a, o) {
		super(n, r, i, a), this.propertySignatures = e, this.indexSignatures = t, this.encodingChecks = o;
		let s = e.map((e) => e.name).filter((e, t, n) => n.indexOf(e) !== t);
		if (s.length > 0) throw Error(`Duplicate identifiers: ${JSON.stringify(s)}. ts(2300)`);
	}
	getParser(e) {
		let t = this, n = [], r = /* @__PURE__ */ new Set(), i = [];
		for (let a of t.propertySignatures) n.push(a.name), r.add(a.name), i.push({
			ps: a,
			parser: e(a.type),
			name: a.name,
			type: a.type
		});
		let a = t.indexSignatures.length;
		if (t.propertySignatures.length === 0 && t.indexSignatures.length === 0) return Zd(t, at);
		let o = a > 0 ? Cs()({
			onItem: _l(function* (n, [i, a]) {
				let o = e($d(a.parameter))(V(i), n.options), s = To(o) ? o : yield* Yc(o);
				if (s._tag === "Failure") {
					let e = Ju(n, t, i, s);
					e && (yield* e);
					return;
				}
				let c = V(n.input[i]), l = e(a.type)(c, n.options), u = To(l) ? l : yield* Yc(l);
				if (u._tag === "Failure") {
					let e = Ju(n, t, i, u);
					e && (yield* e);
					return;
				} else if (s.value._tag === "Some" && u.value._tag === "Some") {
					let e = s.value.value;
					if (r.has(i) || r.has(e)) return;
					let t = u.value.value;
					if (a.merge && a.merge.decode && Object.hasOwn(n.out, e)) {
						let [r, i] = a.merge.decode.combine([e, n.out[e]], [e, t]);
						vl(n.out, r, i);
					} else vl(n.out, e, t);
				}
			}),
			step: (e, t, n) => n._tag === "Failure" ? n : void 0
		}) : void 0;
		return _l(function* (e, s) {
			if (e._tag === "None") return e;
			let c = e.value;
			if (!(typeof c == "object" && c && !Array.isArray(c))) return yield* G(new Nl(t, e));
			let l = {}, u = {
				ast: t,
				oinput: e,
				input: c,
				out: l,
				issues: void 0,
				options: s
			}, d = s.errors === "all", f = s.onExcessProperty === "error", p = s.onExcessProperty === "preserve", m;
			if (t.indexSignatures.length === 0 && (f || p)) {
				m = Reflect.ownKeys(c);
				for (let n = 0; n < m.length; n++) {
					let i = m[n];
					if (!r.has(i)) if (f) {
						let n = new kl([i], new jl(t, c[i]));
						if (d) {
							u.issues ? u.issues.push(n) : u.issues = [n];
							continue;
						} else return yield* G(new Ml(t, e, [n]));
					} else vl(l, i, c[i]);
				}
			}
			let h = qu(s?.concurrency), g = nd(u, i, h);
			if (g && (yield* g), o) {
				let e = Rr();
				for (let n = 0; n < a; n++) {
					let r = t.indexSignatures[n], i = Zu(c, r.parameter);
					for (let t = 0; t < i.length; t++) {
						let n = i[t];
						e.push([n, r]);
					}
				}
				let n = o(u, e, h);
				n && (yield* n);
			}
			if (u.issues) return yield* G(new Ml(t, e, u.issues));
			if (s.propertyOrder === "original") {
				let e = (m ?? Reflect.ownKeys(c)).concat(n), t = {};
				for (let n of e) Object.hasOwn(l, n) && vl(t, n, l[n]);
				return V(t);
			}
			return V(l);
		});
	}
	rebuild(t, n, r, i) {
		let a = Md(this.propertySignatures, (e) => {
			let n = t(e.type);
			return n === e.type ? e : new Qu(e.name, n);
		}), o = Md(this.indexSignatures, (e) => {
			let r = t(e.parameter), i = t(e.type), a = n ? e.merge?.flip() : e.merge;
			return r === e.parameter && i === e.type && a === e.merge ? e : new ed(r, i, a);
		});
		return a === this.propertySignatures && o === this.indexSignatures ? this : new e(a, o, this.annotations, r, void 0, this.context, i);
	}
	flip(e) {
		return this.rebuild(e, !0, this.encodingChecks, this.checks);
	}
	recur(e) {
		return this.rebuild(e, !1, this.checks, this.encodingChecks);
	}
	getExpected() {
		return this.propertySignatures.length === 0 && this.indexSignatures.length === 0 ? "object | array" : "object";
	}
}, nd = /*#__PURE__*/ Cs()({
	onItem(e, t) {
		let n = Object.hasOwn(e.input, t.name) ? V(e.input[t.name]) : vr();
		return t.parser(n, e.options);
	},
	step(e, t, n) {
		if (n._tag === "Failure") return Ju(e, e.ast, t.name, n);
		if (n.value._tag === "Some") vl(e.out, t.name, n.value.value);
		else if (!Bd(t.type)) {
			let n = new kl([t.name], new Al(t.type.context?.annotations));
			if (e.options.errors === "all") {
				e.issues ? e.issues.push(n) : e.issues = [n];
				return;
			} else return rc(new Ml(e.ast, e.oinput, [n]));
		}
	}
});
function rd(e, t, n) {
	return new td(Reflect.ownKeys(e).map((t) => new Qu(t, e[t].ast)), [], n, t);
}
function id(e) {
	return e.ast;
}
function ad(e, t = void 0) {
	return new Wu(!1, e.map((e) => e.ast), [], void 0, t);
}
function od(e, t, n) {
	return new pd(e.map(id), t, void 0, n);
}
function sd(e) {
	switch (e._tag) {
		case "Null": return ["null"];
		case "Undefined":
		case "Void": return ["undefined"];
		case "String":
		case "TemplateLiteral": return ["string"];
		case "Number": return ["number"];
		case "Boolean": return ["boolean"];
		case "Symbol":
		case "UniqueSymbol": return ["symbol"];
		case "BigInt": return ["bigint"];
		case "Arrays": return ["array"];
		case "ObjectKeyword": return [
			"object",
			"array",
			"function"
		];
		case "Objects": return e.propertySignatures.length || e.indexSignatures.length ? ["object"] : ["object", "array"];
		case "Enum": return Array.from(new Set(e.enums.map(([, e]) => typeof e)));
		case "Literal": return [typeof e.literal];
		case "Union": return Array.from(new Set(e.types.flatMap(sd)));
		default: return [
			"null",
			"undefined",
			"string",
			"number",
			"boolean",
			"symbol",
			"bigint",
			"object",
			"array",
			"function"
		];
	}
}
function cd(e) {
	switch (e._tag) {
		default: return [];
		case "Declaration": {
			let t = e.annotations?.["~sentinels"];
			return Array.isArray(t) ? t : [];
		}
		case "Objects": return e.propertySignatures.flatMap((e) => {
			let t = e.type;
			if (!Bd(t)) {
				if (bu(t)) return [{
					key: e.name,
					literal: t.literal
				}];
				if (xu(t)) return [{
					key: e.name,
					literal: t.symbol
				}];
			}
			return [];
		});
		case "Arrays": return e.elements.flatMap((e, t) => bu(e) && !Bd(e) ? [{
			key: t,
			literal: e.literal
		}] : []);
		case "Suspend": return cd(e.thunk());
	}
}
var ld = /*#__PURE__*/ new WeakMap();
function ud(e) {
	let t = ld.get(e);
	if (t) return t;
	t = {};
	for (let n of e) {
		let e = Hd(n);
		if (yu(e)) continue;
		let r = sd(e), i = cd(e);
		t.byType ??= {};
		for (let e of r) (t.byType[e] ??= []).push(n);
		if (i.length > 0) {
			t.bySentinel ??= /* @__PURE__ */ new Map();
			for (let { key: e, literal: r } of i) {
				let i = t.bySentinel.get(e);
				i || t.bySentinel.set(e, i = /* @__PURE__ */ new Map());
				let a = i.get(r);
				a || i.set(r, a = []), a.push(n);
			}
		} else {
			t.otherwise ??= {};
			for (let e of r) (t.otherwise[e] ??= []).push(n);
		}
	}
	return ld.set(e, t), t;
}
function dd(e) {
	return (t) => {
		let n = Hd(t);
		return n._tag === "Literal" ? n.literal === e : n._tag === "UniqueSymbol" ? n.symbol === e : !0;
	};
}
function fd(e, t) {
	let n = ud(t), r = e === null ? "null" : Array.isArray(e) ? "array" : typeof e;
	if (n.bySentinel) {
		let t = n.otherwise?.[r] ?? [];
		if (r === "object" || r === "array") {
			for (let [r, i] of n.bySentinel) if (Object.hasOwn(e, r)) {
				let n = i.get(e[r]);
				if (n) return [...n, ...t].filter(dd(e));
			}
		}
		return t;
	}
	return (n.byType?.[r] ?? []).filter(dd(e));
}
var pd = class e extends q {
	_tag = "Union";
	types;
	mode;
	encodingChecks;
	constructor(e, t, n, r, i, a, o) {
		super(n, r, i, a), this.types = e, this.mode = t, this.encodingChecks = o;
	}
	getParser(e) {
		let t = this;
		return (n, r) => {
			if (n._tag === "None") return Lc(n);
			let i = n.value, a = fd(i, t.types), o = {
				ast: t,
				recur: e,
				oinput: n,
				input: i,
				out: void 0,
				successes: [],
				issues: void 0,
				options: r
			}, s = md(o, a, qu(r?.concurrency));
			return s ? Gc(s, (e) => o.out ? Lc(o.out) : G(new Fl(t, i, o.issues ?? []))) : o.out ? Lc(o.out) : G(new Fl(t, i, o.issues ?? []));
		};
	}
	rebuild(t, n, r) {
		let i = Md(this.types, t);
		return i === this.types ? this : new e(i, this.mode, this.annotations, n, void 0, this.context, r);
	}
	recur(e) {
		return this.rebuild(e, this.checks, this.encodingChecks);
	}
	flip(e) {
		return this.rebuild(e, this.encodingChecks, this.checks);
	}
	getExpected(e) {
		let t = this.annotations?.expected;
		if (typeof t == "string") return t;
		if (this.types.length === 0) return "never";
		let n = this.types.map((t) => {
			let n = Hd(t);
			switch (n._tag) {
				case "Arrays": {
					let t = n.elements.filter(bu);
					if (t.length > 0) return `${_d(n.isMutable)}[ ${t.map((t) => e(t) + vd(t.context?.isOptional)).join(", ")}, ... ]`;
					break;
				}
				case "Objects": {
					let t = n.propertySignatures.filter((e) => bu(e.type));
					if (t.length > 0) return `{ ${t.map((t) => `${_d(t.type.context?.isMutable)}${Yt(t.name)}${vd(t.type.context?.isOptional)}: ${e(t.type)}`).join(", ")}, ... }`;
					break;
				}
			}
			return e(n);
		});
		return Array.from(new Set(n)).join(" | ");
	}
}, md = /*#__PURE__*/ Cs()({
	onItem(e, t) {
		return e.recur(t)(e.oinput, e.options);
	},
	step(e, t, n) {
		if (n._tag === "Failure") {
			let t = nc(n.cause);
			if (Er(t)) return n;
			e.issues ? e.issues.push(t.success) : e.issues = [t.success];
		} else {
			if (e.out && e.ast.mode === "oneOf") return e.successes.push(t), rc(new Il(e.ast, e.input, e.successes));
			if (e.out = n.value, e.successes.push(t), e.ast.mode === "anyOf") return ic;
		}
	}
}), hd = /*#__PURE__*/ new pd([
	/*#__PURE__*/ new Iu("Infinity"),
	/*#__PURE__*/ new Iu("-Infinity"),
	/*#__PURE__*/ new Iu("NaN")
], "anyOf"), gd = /*#__PURE__*/ new K(/*#__PURE__*/ new pd([Vu, hd], "anyOf"), /*#__PURE__*/ new lu(/*#__PURE__*/ au(), /*#__PURE__*/ tu((e) => globalThis.Number.isFinite(e) ? e : globalThis.String(e))));
function _d(e) {
	return e ? "" : "readonly ";
}
function vd(e) {
	return e ? "?" : "";
}
function yd(e) {
	switch (e._tag) {
		case "Declaration":
		case "Arrays":
		case "Objects":
		case "Union": return e.encodingChecks;
		default: return;
	}
}
var bd = class e extends Ve {
	_tag = "Filter";
	run;
	annotations;
	aborted;
	constructor(e, t = void 0, n = !1) {
		super(), this.run = e, this.annotations = t, this.aborted = n;
	}
	annotate(t) {
		return new e(this.run, {
			...this.annotations,
			...t
		}, this.aborted);
	}
	abort() {
		return new e(this.run, this.annotations, !0);
	}
	and(e, t) {
		return new xd([this, e], t);
	}
}, xd = class e extends Ve {
	_tag = "FilterGroup";
	checks;
	annotations;
	constructor(e, t = void 0) {
		super(), this.checks = e, this.annotations = t;
	}
	annotate(t) {
		return new e(this.checks, {
			...this.annotations,
			...t
		});
	}
	and(t, n) {
		return new e([this, t], n);
	}
};
function Sd(e, t, n = !1) {
	return new bd((t, n, r) => zl(t, n, e(t, n, r)), t, n);
}
function Cd(e, t) {
	let n = e.source;
	return Sd((t) => e.test(t), {
		expected: `a string matching the RegExp ${n}`,
		meta: {
			_tag: "isPattern",
			regExp: e
		},
		arbitrary: { constraint: { patterns: [e.source] } },
		...t
	});
}
function wd(e, t) {
	let n = Object.getOwnPropertyDescriptors(e);
	return t(n), Object.create(Object.getPrototypeOf(e), n);
}
function J(e, t) {
	return e.encoding === t ? e : wd(e, (e) => {
		e.encoding.value = t;
	});
}
function Td(e, t) {
	return e.context === t ? e : wd(e, (e) => {
		e.context.value = t;
	});
}
function Ed(e, t) {
	if (e.checks) {
		let n = e.checks[e.checks.length - 1];
		return Dd(e, kr(e.checks.slice(0, -1), n.annotate(t)));
	}
	return wd(e, (e) => {
		e.annotations.value = {
			...e.annotations.value,
			...t
		};
	});
}
function Dd(e, t) {
	if (e._tag === "Suspend" && t !== void 0) throw Error("Cannot add checks to Suspend");
	return e.checks === t ? e : wd(e, (e) => {
		e.checks.value = t;
	});
}
function Od(e, t) {
	return Dd(e, e.checks ? [...e.checks, ...t] : t);
}
function kd(e, t) {
	let n = e, r = n[n.length - 1], i = t(r.to);
	return i === r.to ? e : kr(e.slice(0, e.length - 1), new K(i, r.transformation));
}
function Ad(e) {
	return (t) => t.encoding ? J(t, kd(t.encoding, e)) : t;
}
function jd(e, t, n) {
	let r = new K(e, t);
	return J(n, n.encoding ? [...n.encoding, r] : [r]);
}
function Md(e, t) {
	let n = !1, r = Array(e.length);
	for (let i = 0; i < e.length; i++) {
		let a = e[i], o = t(a);
		o !== a && (n = !0), r[i] = o;
	}
	return n ? r : e;
}
function Nd(e, t) {
	return Td(e, e.context ? new Eu(e.context.isOptional, e.context.isMutable, e.context.defaultValue, {
		...e.context.annotations,
		...t
	}) : new Eu(!1, !1, void 0, t));
}
var Pd = /*#__PURE__*/ Ad(Fd);
function Fd(e) {
	return Pd(Td(e, e.context ? e.context.isOptional === !1 ? new Eu(!0, e.context.isMutable, e.context.defaultValue, e.context.annotations) : e.context : new Eu(!0, !1)));
}
function Id(e, t) {
	let n = [new K(Pu, new lu(ru(t), eu()))];
	return Td(e, e.context ? new Eu(e.context.isOptional, e.context.isMutable, n, e.context.annotations) : new Eu(!1, !1, n));
}
function Ld(e, t, n) {
	return jd(e, n, t);
}
function Rd(e) {
	switch (e._tag) {
		case "Literal": return {
			literals: nt(e.literal) ? [e.literal] : [],
			parameters: []
		};
		case "UniqueSymbol": return {
			literals: [e.symbol],
			parameters: []
		};
		case "String":
		case "Number":
		case "Symbol":
		case "TemplateLiteral": return {
			literals: [],
			parameters: [e]
		};
		case "Union": {
			let t = {
				literals: [],
				parameters: []
			};
			for (let n = 0; n < e.types.length; n++) {
				let r = Rd(e.types[n]);
				t.literals = t.literals.concat(r.literals), t.parameters = t.parameters.concat(r.parameters);
			}
			return t;
		}
	}
	return {
		literals: [],
		parameters: []
	};
}
function zd(e, t, n) {
	let { literals: r, parameters: i } = Rd(e);
	return new td(r.map((e) => new Qu(e, t)), i.map((e) => new ed(e, t, n)));
}
function Bd(e) {
	return e.context?.isOptional ?? !1;
}
var Vd = /*#__PURE__*/ Je((e) => {
	if (e.encoding) return Vd(J(e, void 0));
	let t = e, n = t.recur?.(Vd) ?? t;
	return yd(n) ? wd(n, (e) => {
		e.encodingChecks.value = void 0;
	}) : n;
}), Hd = /*#__PURE__*/ Je((e) => Vd(Wd(e)));
function Ud(e, t) {
	let n = t, r = n.length, i = n[r - 1], a = [new K(Wd(J(e, void 0)), n[0].transformation.flip())];
	for (let e = 1; e < r; e++) a.unshift(new K(Wd(n[e - 1].to), n[e].transformation.flip()));
	let o = Wd(i.to);
	return o.encoding ? J(o, [...o.encoding, ...a]) : J(o, a);
}
var Wd = /*#__PURE__*/ Je((e) => {
	if (e.encoding) return Ud(e, e.encoding);
	let t = e;
	return t.flip?.(Wd) ?? t.recur?.(Wd) ?? t;
});
function Gd(e) {
	switch (e._tag) {
		case "Undefined": return !0;
		case "Union": return e.types.some(Gd);
		default: return !1;
	}
}
function Kd(e, t) {
	return e.encodedParts.map((e) => Yd(e, Jd(e), t)).join("");
}
var qd = /*#__PURE__*/ Je((e) => new globalThis.RegExp(`^${Kd(e, !0)}$`));
function Jd(e) {
	switch (e._tag) {
		case "Literal": return Cl(globalThis.String(e.literal));
		case "String": return ef;
		case "Number": return Yu;
		case "BigInt": return sf;
		case "TemplateLiteral": return Kd(e, !1);
		case "Union": return e.types.map(Jd).join("|");
	}
}
function Yd(e, t, n) {
	if (wu(e)) {
		if (!n) return `(?:${t})`;
	} else if (!n) return t;
	return `(${t})`;
}
function Xd(e, t) {
	let n = zc(t);
	return (r) => r._tag === "None" ? Rc : r.value === t ? n : G(new Nl(e, r));
}
function Zd(e, t) {
	return (n) => n._tag === "None" ? Rc : t(n.value) ? Lc(n) : G(new Nl(e, n));
}
function Qd(e) {
	function t(n) {
		return n.encoding ? J(n, kd(n.encoding, t)) : e(n);
	}
	return Je(t);
}
var $d = /*#__PURE__*/ Qd((e) => {
	switch (e._tag) {
		default: return e;
		case "Number": return e.toCodecStringTree();
		case "Union": return e.recur($d);
	}
}), ef = "[\\s\\S]*?", tf = /*#__PURE__*/ new globalThis.RegExp(`^${Yu}$`);
function nf(e) {
	return Cd(tf, {
		expected: "a string representing a finite number",
		meta: {
			_tag: "isStringFinite",
			regExp: tf
		},
		...e
	});
}
var rf = /*#__PURE__*/ Od(Ru, [/*#__PURE__*/ nf()]), af = /*#__PURE__*/ new K(rf, mu), of = /*#__PURE__*/ new K(/*#__PURE__*/ new pd([rf, hd], "anyOf"), mu), sf = "-?\\d+", cf = /*#__PURE__*/ new globalThis.RegExp(`^${sf}$`);
function lf(e) {
	return Cd(cf, {
		expected: "a string representing a bigint",
		meta: {
			_tag: "isStringBigInt",
			regExp: cf
		},
		...e
	});
}
var uf = /*#__PURE__*/ new K(/* @__PURE__ */ Od(Ru, [/*#__PURE__*/ lf({ expected: "a string representing a bigint" })]), hu);
function df(e, t, n, r, i) {
	for (let a = 0; a < e.length; a++) {
		let o = e[a];
		if (o._tag === "FilterGroup") df(o.checks, t, n, r, i);
		else {
			let e = o.run(t, r, i);
			if (e && (n.push(new Dl(t, o, e)), o.aborted || i?.errors !== "all")) return;
		}
	}
}
var ff = "~effect/Schema/Class", pf = "~structural", mf = Ga, hf = Es, gf = "~effect/MutableRef", _f = {
	[gf]: gf,
	...fn,
	toJSON() {
		return {
			_id: "MutableRef",
			current: en(this.current)
		};
	}
}, vf = (e) => {
	let t = Object.create(_f);
	return t.current = e, t;
}, yf = /*#__PURE__*/ j(2, (e, t) => (e.current = t, e)), bf = (e) => e, xf = /*#__PURE__*/ Je((e) => {
	switch (e._tag) {
		case "Declaration": {
			let t = e.annotations?.[ff];
			if (rt(t)) {
				let n = t(e.typeParameters), r = xf(n.to);
				return J(e, r === n.to ? [n] : [new K(r, n.transformation)]);
			}
			return e;
		}
		case "Objects":
		case "Arrays": return e.recur((e) => {
			let t = e.context?.defaultValue;
			return t ? J(xf(e), t) : xf(e);
		});
		case "Suspend": return e.recur(xf);
		default: return e;
	}
});
function Sf(e) {
	let t = Df(xf(Vd(e.ast)));
	return (e, n) => t(e, n?.disableChecks ? n?.parseOptions ? {
		...n.parseOptions,
		disableChecks: !0
	} : { disableChecks: !0 } : n?.parseOptions);
}
function Cf(e) {
	let t = Sf(e);
	return (e, n) => ac(ul(t(e, n)));
}
function wf(e) {
	let t = Sf(e);
	return (e, n) => cl(ml(t(e, n), (e) => Error(e.toString(), { cause: e })));
}
function Tf(e, t) {
	let n = Df(e.ast);
	return t === void 0 ? n : (e, r) => n(e, Ef(t, r));
}
var Ef = (e, t) => t === void 0 ? e : {
	...e,
	...t
};
function Df(e) {
	let t = Of(e);
	return (e, n) => hl(t(V(e), n ?? Tu), (e) => e._tag === "None" ? G(new Pl(e)) : Lc(e.value));
}
var Of = /*#__PURE__*/ Je((e) => {
	let t, n = yd(e), r = e.checks ?? n, i = (r ? r[r.length - 1].annotations : e.annotations)?.parseOptions;
	if (!e.context && !e.encoding && !e.checks && !n) return (n, r) => (t ??= e.getParser(Of), i && (r = {
		...r,
		...i
	}), t(n, r));
	let a = Su(e) || Cu(e) || vu(e) && e.typeParameters.length > 0;
	return (r, o) => {
		i && (o = {
			...o,
			...i
		});
		let s = e.encoding, c;
		if (s) {
			let t = s, n = t.length;
			for (let e = n - 1; e >= 0; e--) {
				let n = t[e], i = n.to, a = Of(i);
				if (c = c ? hl(c, (e) => a(e, o)) : a(r, o), n.transformation._tag === "Transformation") {
					let e = n.transformation.decode;
					c = hl(c, (t) => e.run(t, o));
				} else c = n.transformation.decode(c, o);
			}
			c = ml(c, (t) => new Ol(e, r, t));
		}
		t ??= e.getParser(Of);
		let l = c ? hl(c, (e) => t(e, o)) : t(r, o);
		if (n && !o?.disableChecks && (l = hl(l, (t) => {
			if (br(r) && br(t)) {
				let t = [];
				if (df(n, r.value, t, e, o), jr(t)) return G(new Ml(e, r, t));
			}
			return Lc(t);
		})), e.checks && !o?.disableChecks) {
			let t = e.checks;
			o?.errors === "all" && a && br(r) && (l = gl(l, (n) => {
				let i = [];
				return df(t.filter((e) => e.annotations?.[pf]), r.value, i, e, o), G(jr(i) ? n._tag === "Composite" && n.ast === e ? new Ml(e, n.actual, [...n.issues, ...i]) : new Ml(e, r, [n, ...i]) : n);
			})), l = hl(l, (n) => {
				if (br(n)) {
					let r = n.value, i = [];
					if (df(t, r, i, e, o), jr(i)) return G(new Ml(e, n, i));
				}
				return Lc(n);
			});
		}
		return l;
	};
}), kf = "~effect/Schema/Schema", Af = {
	[kf]: kf,
	pipe() {
		return ze(this, arguments);
	},
	annotate(e) {
		return this.rebuild(Ed(this.ast, e));
	},
	annotateKey(e) {
		return this.rebuild(Nd(this.ast, e));
	},
	check(...e) {
		return this.rebuild(Od(this.ast, e));
	}
};
function jf(e, t) {
	let n = Object.create(Af);
	return t && Object.assign(n, t), n.ast = e, n.rebuild = (e) => jf(e, t), n.makeEffect = qe(Sf(n), ml((e) => new Nf(e))), n.make = wf(n), n.makeOption = Cf(n), n;
}
var Mf = "~effect/Schema/SchemaError", Nf = class {
	[Mf] = Mf;
	_tag = "SchemaError";
	name = "SchemaError";
	issue;
	constructor(e) {
		this.issue = e;
	}
	get message() {
		return this.issue.toString();
	}
	toString() {
		return `SchemaError(${this.message})`;
	}
}, Pf = kf;
function Ff() {
	return (e, t, n) => Y(new Ou(e.map(id), (e) => t(e.map((e) => Y(e))), n));
}
function If(e, t) {
	return Ff()([], () => (t, n) => e(t) ? Lc(t) : G(new Nl(n, V(t))), t);
}
function Lf(e, t) {
	let n = Tf(e, t);
	return (e, t) => ml(n(e, t), (e) => new Nf(e));
}
var Y = jf;
function Rf(e) {
	return N(e, Pf) && e[Pf] === Pf;
}
var zf = /*#__PURE__*/ bf((e) => Y(Fd(e.ast), { schema: e })), Bf = /*#__PURE__*/ bf((e) => zf(op(e)));
function Vf(e) {
	let t = Y(new Iu(e), {
		literal: e,
		transform(n) {
			return t.pipe(sp(Vf(n), {
				decode: tu(() => n),
				encode: tu(() => e)
			}));
		}
	});
	return t;
}
var Hf = /*#__PURE__*/ Y(Nu), Uf = /*#__PURE__*/ Y(Pu), Wf = /*#__PURE__*/ Y(ku), Gf = /*#__PURE__*/ Y(Mu), Kf = /*#__PURE__*/ Y(Ru), X = /*#__PURE__*/ Y(Vu), qf = /*#__PURE__*/ Y(Hu), Jf = /*#__PURE__*/ Y(Uu), Yf = /*#__PURE__*/ Y(Fu);
function Xf(e, t) {
	return Y(e, {
		fields: t,
		mapFields(e, t) {
			let n = e(this.fields);
			return Xf(rd(n, t?.unsafePreserveChecks ? this.ast.checks : void 0), n);
		}
	});
}
function Zf(e) {
	return Xf(rd(e, void 0), e);
}
function Qf(e, t, n) {
	let r = n?.keyValueCombiner?.decode || n?.keyValueCombiner?.encode ? new $u(n.keyValueCombiner.decode, n.keyValueCombiner.encode) : void 0;
	return Y(zd(e.ast, t.ast, r), {
		key: e,
		value: t
	});
}
function $f(e, t) {
	return Y(e, {
		elements: t,
		mapElements(e, t) {
			let n = e(this.elements);
			return $f(ad(n, t?.unsafePreserveChecks ? this.ast.checks : void 0), n);
		}
	});
}
function ep(e) {
	return $f(ad(e), e);
}
var tp = /*#__PURE__*/ bf((e) => Y(new Wu(!1, [], [e.ast]), { value: e }));
function np(e, t) {
	return Y(e, {
		members: t,
		mapMembers(e, t) {
			let n = e(this.members);
			return np(od(n, this.ast.mode, t?.unsafePreserveChecks ? this.ast.checks : void 0), n);
		}
	});
}
function rp(e, t) {
	return np(od(e, t?.mode ?? "anyOf", void 0), e);
}
function ip(e) {
	let t = e.map(Vf);
	return Y(od(t, "anyOf", void 0), {
		literals: e,
		members: t,
		mapMembers(e) {
			return rp(e(this.members));
		},
		pick(e) {
			return ip(e);
		},
		transform(e) {
			return rp(t.map((t, n) => t.transform(e[n])));
		}
	});
}
var ap = /*#__PURE__*/ bf((e) => rp([e, Wf])), op = /*#__PURE__*/ bf((e) => rp([e, Gf]));
function sp(e, t) {
	return (n) => Y(Ld(n.ast, e.ast, t ? du(t) : pu()), {
		from: n,
		to: e
	});
}
function cp(e) {
	return (t) => Y(Id(t.ast, ml(e, (e) => e.issue)), { schema: t });
}
function lp(e) {
	return Vf(e).pipe(cp(Lc(e)));
}
function up(e, t) {
	return Zf({
		_tag: lp(e),
		...t
	});
}
function dp(e, t) {
	return If((t) => t instanceof e, t);
}
function fp() {
	return (e, t) => new K(e.ast, du(t));
}
var pp = Sd, mp = Cd, hp = (e) => e ? new globalThis.RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${e}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`) : /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|[fF]{8}-[fF]{4}-[fF]{4}-[fF]{4}-[fF]{12})$/;
function gp(e, t) {
	let n = hp(e);
	return mp(n, {
		expected: e ? `a UUID v${e}` : "a UUID",
		meta: {
			_tag: "isUUID",
			regExp: n,
			version: e
		},
		...t
	});
}
function _p(e) {
	let t = _r(e.order), n = e.formatter ?? R;
	return (r, i) => pp((e) => t(e, r), {
		expected: `a value greater than or equal to ${n(r)}`,
		arbitrary: { constraint: { ordered: {
			order: e.order,
			minimum: r
		} } },
		...e.annotate?.(r),
		...i
	});
}
function vp(e) {
	let t = gr(e.order), n = e.formatter ?? R;
	return (r, i) => pp((e) => t(e, r), {
		expected: `a value less than or equal to ${n(r)}`,
		arbitrary: { constraint: { ordered: {
			order: e.order,
			maximum: r
		} } },
		...e.annotate?.(r),
		...i
	});
}
var yp = /*#__PURE__*/ _p({
	order: dr,
	annotate: (e) => ({ meta: {
		_tag: "isGreaterThanOrEqualTo",
		minimum: e
	} })
}), bp = /*#__PURE__*/ vp({
	order: dr,
	annotate: (e) => ({ meta: {
		_tag: "isLessThanOrEqualTo",
		maximum: e
	} })
});
function xp(e) {
	return pp((e) => globalThis.Number.isSafeInteger(e), {
		expected: "an integer",
		meta: { _tag: "isInt" },
		arbitrary: { constraint: { integer: !0 } },
		...e
	});
}
var Sp = /*#__PURE__*/ _p({
	order: fr,
	annotate: (e) => ({ meta: {
		_tag: "isGreaterThanOrEqualToBigInt",
		minimum: e
	} })
}), Cp = /*#__PURE__*/ vp({
	order: fr,
	annotate: (e) => ({ meta: {
		_tag: "isLessThanOrEqualToBigInt",
		maximum: e
	} })
});
function wp(e, t) {
	return e = Math.max(0, Math.floor(e)), pp((t) => t.length <= e, {
		expected: `a value with a length of at most ${e}`,
		meta: {
			_tag: "isMaxLength",
			maxLength: e
		},
		[pf]: !0,
		arbitrary: { constraint: { maxLength: e } },
		...t
	});
}
function Tp(e, t, n) {
	return e = Math.max(0, Math.floor(e)), t = Math.max(0, Math.floor(t)), pp((n) => n.length >= e && n.length <= t, {
		expected: e === t ? `a value with a length of ${e}` : `a value with a length between ${e} and ${t}`,
		meta: {
			_tag: "isLengthBetween",
			minimum: e,
			maximum: t
		},
		[pf]: !0,
		arbitrary: { constraint: {
			minLength: e,
			maxLength: t
		} },
		...n
	});
}
globalThis.RegExp, globalThis.URL;
function Ep(e, t, n, r) {
	let i = { ...n };
	if (delete i.valid, (n?.valid || e?.valid) && (i.noInvalidDate = !0), t?.minimum !== void 0) {
		let e = r === void 0 ? t.minimum : r(t.minimum), n = t.exclusiveMinimum ? new globalThis.Date(e.getTime() + 1) : e;
		(i.min === void 0 || n.getTime() > i.min.getTime()) && (i.min = n);
	}
	if (t?.maximum !== void 0) {
		let e = r === void 0 ? t.maximum : r(t.maximum), n = t.exclusiveMaximum ? new globalThis.Date(e.getTime() - 1) : e;
		(i.max === void 0 || n.getTime() < i.max.getTime()) && (i.max = n);
	}
	return i;
}
var Dp = /*#__PURE__*/ Kf.annotate({ expected: "a string in ISO 8601 format that will be decoded as a Date" }), Op = /*#__PURE__*/ dp(globalThis.Date, {
	typeConstructor: { _tag: "Date" },
	generation: {
		runtime: "Schema.Date",
		Type: "globalThis.Date"
	},
	expected: "Date",
	toCodecJson: () => fp()(Dp, gu),
	toArbitrary: () => (e, t) => e.date(Ep(t?.constraint, t?.constraint?.ordered?.order === mr ? t.constraint.ordered : void 0))
});
globalThis.File, globalThis.FormData, globalThis.URLSearchParams;
var kp = /*#__PURE__*/ X.check(/*#__PURE__*/ xp());
globalThis.Uint8Array;
var Ap = /*#__PURE__*/ globalThis.Symbol.for("immer-draftable");
function jp(e, t, n, r, i) {
	let a = Pp(n, t, r), o = Np(t), s = class extends e {
		constructor(...[e, t]) {
			e ??= {};
			let r = n.make(e, t);
			super({
				...e,
				...r
			}, {
				...t,
				disableChecks: !0
			});
		}
		static [Pf] = Pf;
		get [o]() {
			return o;
		}
		static [Ap] = !0;
		static identifier = t;
		static fields = n.fields;
		static get ast() {
			return a(this).ast;
		}
		static pipe() {
			return ze(this, arguments);
		}
		static rebuild(e) {
			return a(this).rebuild(e);
		}
		static make(e, t) {
			return new this(e, t);
		}
		static makeOption(e, t) {
			return Cf(a(this))(e ?? {}, t);
		}
		static makeEffect(e, t) {
			return a(this).makeEffect(e ?? {}, t);
		}
		static annotate(e) {
			return this.rebuild(Ed(this.ast, e));
		}
		static annotateKey(e) {
			return this.rebuild(Nd(this.ast, e));
		}
		static check(...e) {
			return this.rebuild(Od(this.ast, e));
		}
		static extend(e) {
			return (t, r) => {
				let a = {
					...n.fields,
					...t
				};
				return jp(this, e, Xf(rd(a, n.ast.checks, { identifier: e }), a), r, i);
			};
		}
		static mapFields(e, t) {
			return n.mapFields(e, t);
		}
	};
	return i !== void 0 && Object.assign(s.prototype, i(t)), s;
}
function Mp(e) {
	return new lu(tu((t) => new e(t)), eu());
}
function Np(e) {
	return `~effect/Schema/Class/${e}`;
}
function Pp(e, t, n) {
	let r;
	return (i) => {
		if (r === void 0) {
			let a = Mp(i), o = Y(new Ou([e.ast], () => (e, n) => e instanceof i || N(e, Np(t)) ? Lc(e) : G(new Nl(n, V(e))), {
				identifier: t,
				[ff]: ([e]) => new K(e, a),
				toCodec: ([e]) => new K(e.ast, a),
				toArbitrary: ([e]) => () => ({
					arbitrary: e.arbitrary.map((e) => new i(e)),
					terminal: e.terminal?.map((e) => new i(e))
				}),
				toFormatter: ([e]) => (t) => `${i.identifier}(${e(t)})`,
				"~sentinels": cd(e.ast),
				...n
			}));
			r = e.pipe(sp(o, a));
		}
		return r;
	};
}
function Fp(e) {
	return Rf(e);
}
var Ip = (e) => (t, n) => jp(Un, e, Fp(t) ? t : Zf(t), n, (e) => ({ name: e })), Lp = (e) => (t, n, r) => {
	let i = Fp(n) ? n.mapFields((e) => ({
		_tag: lp(t),
		...e
	}), { unsafePreserveChecks: !0 }) : up(t, n);
	return Ip(e ?? t)(i, r);
}, Rp = "~effect/ManagedRuntime", zp = (e, t) => {
	let n = t?.memoMap ?? wc(), r = dc("parallel"), i = pc(r, "sequential"), a = { onFiberStart: hf(r) }, o = (e) => e ? {
		...e,
		onFiberStart: e.onFiberStart ? (t) => {
			a.onFiberStart(t), e.onFiberStart(t);
		} : a.onFiberStart
	} : a, s, c = Wc((t) => (s ||= el(qc(Ec(e, n, i), (e) => Vc(() => {
		l.cachedContext = e;
	})), {
		...a,
		scheduler: t.currentScheduler
	}), Kc(mf(s)))), l = {
		[Rp]: Rp,
		memoMap: n,
		scope: r,
		contextEffect: c,
		cachedContext: void 0,
		context() {
			return l.cachedContext === void 0 ? il(l.contextEffect) : Promise.resolve(l.cachedContext);
		},
		dispose() {
			return il(l.disposeEffect);
		},
		disposeEffect: Bc(() => (l.contextEffect = Uc("ManagedRuntime disposed"), l.cachedContext = void 0, mc(l.scope, ic))),
		runFork(e, t) {
			return l.cachedContext === void 0 ? el(Bp(l, e), o(t)) : tl(l.cachedContext)(e, o(t));
		},
		runCallback(e, t) {
			return l.cachedContext === void 0 ? rl(Bp(l, e), o(t)) : nl(l.cachedContext)(e, o(t));
		},
		runSyncExit(e) {
			return l.cachedContext === void 0 ? ul(Bp(l, e)) : dl(l.cachedContext)(e);
		},
		runSync(e) {
			return l.cachedContext === void 0 ? cl(Bp(l, e)) : ll(l.cachedContext)(e);
		},
		runPromiseExit(e, t) {
			return l.cachedContext === void 0 ? ol(Bp(l, e), o(t)) : sl(l.cachedContext)(e, o(t));
		},
		runPromise(e, t) {
			return l.cachedContext === void 0 ? il(Bp(l, e), o(t)) : al(l.cachedContext)(e, o(t));
		}
	};
	return l;
};
function Bp(e, t) {
	return Gc(e.contextEffect, (e) => Qc(t, e));
}
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Ref.js
var Vp = {
	"~effect/Ref": { _A: M },
	...fn,
	toJSON() {
		return {
			_id: "Ref",
			ref: this.ref
		};
	}
}, Hp = (e) => {
	let t = Object.create(Vp);
	return t.ref = vf(e), t;
}, Up = (e) => Vc(() => Hp(e)), Wp = (e) => Vc(() => e.ref.current), Gp = /*#__PURE__*/ j(2, (e, t) => Vc(() => yf(e.ref, t))), Kp = /*#__PURE__*/ j(2, (e, t) => Vc(() => {
	e.ref.current = t(e.ref.current);
})), qp = rp([
	rp([
		Kf,
		X,
		qf,
		Wf
	]),
	Qf(Kf, Hf),
	tp(Hf)
]), Jp = typeof Buffer > "u" ? Uf : dp(Buffer);
function Yp(e) {
	let t, n = e.dimensions;
	if (typeof n == "number" && n > 0) return em(e, n);
	let { type: r, constraint: i } = Le(e);
	switch (r) {
		case "array":
			t = tm(e, i);
			break;
		case "object":
			t = nm(e, i);
			break;
		case "number":
			t = Xp(e, i);
			break;
		case "bigint":
			t = $p(e, i);
			break;
		case "boolean":
			t = qf;
			break;
		case "string":
			t = rm(e, i);
			break;
		case "custom":
			t = Hf;
			break;
		default: t = Hf;
	}
	return t;
}
function Xp(e, t) {
	let n, r, i = !1;
	switch (t) {
		case "int8":
			n = A.INT8_MIN, r = A.INT8_MAX, i = !0;
			break;
		case "uint8":
			n = 0, r = A.INT8_UNSIGNED_MAX, i = !0;
			break;
		case "int16":
			n = A.INT16_MIN, r = A.INT16_MAX, i = !0;
			break;
		case "uint16":
			n = 0, r = A.INT16_UNSIGNED_MAX, i = !0;
			break;
		case "int24":
			n = A.INT24_MIN, r = A.INT24_MAX, i = !0;
			break;
		case "uint24":
			n = 0, r = A.INT24_UNSIGNED_MAX, i = !0;
			break;
		case "int32":
			n = A.INT32_MIN, r = A.INT32_MAX, i = !0;
			break;
		case "uint32":
			n = 0, r = A.INT32_UNSIGNED_MAX, i = !0;
			break;
		case "int53":
			n = -(2 ** 53 - 1), r = 2 ** 53 - 1, i = !0;
			break;
		case "uint53":
			n = 0, r = 2 ** 53 - 1, i = !0;
			break;
		case "float":
			n = A.INT24_MIN, r = A.INT24_MAX;
			break;
		case "ufloat":
			n = 0, r = A.INT24_UNSIGNED_MAX;
			break;
		case "double":
			n = A.INT48_MIN, r = A.INT48_MAX;
			break;
		case "udouble":
			n = 0, r = A.INT48_UNSIGNED_MAX;
			break;
		case "year":
			n = 1901, r = 2155, i = !0;
			break;
		case "unsigned":
			n = 0, r = 2 ** 53 - 1;
			break;
		default:
			n = -(2 ** 53 - 1), r = 2 ** 53 - 1;
			break;
	}
	let a = i ? kp : X;
	return a = a.check(yp(n), bp(r)), a;
}
var Zp = Jf.check(Sp(A.INT64_MIN), Cp(A.INT64_MAX)), Qp = Jf.check(Sp(0n), Cp(A.INT64_UNSIGNED_MAX));
function $p(e, t) {
	let n, r;
	switch (t) {
		case "int64":
			n = A.INT64_MIN, r = A.INT64_MAX;
			break;
		case "uint64":
			n = 0n, r = A.INT64_UNSIGNED_MAX;
			break;
	}
	let i = Jf;
	return n !== void 0 && (i = i.check(Sp(n))), r !== void 0 && (i = i.check(Cp(r))), i;
}
function em(e, t) {
	let [n, r] = e.dataType.split(" "), i;
	switch (n) {
		case "number":
			i = Xp(e, r);
			break;
		case "bigint":
			i = $p(e, r);
			break;
		case "boolean":
			i = qf;
			break;
		case "string":
			i = rm(e, r);
			break;
		case "object":
			i = nm(e, r);
			break;
		case "array":
			i = tm(e, r);
			break;
		default: i = Hf;
	}
	let a = tp(i);
	for (let e = 1; e < t; e++) a = tp(a);
	return a;
}
function tm(e, t) {
	switch (t) {
		case "geometry":
		case "point": return ep([X, X]);
		case "line": return ep([
			X,
			X,
			X
		]);
		case "vector":
		case "halfvector": {
			let t = e.length, n = tp(X);
			return t ? n.check(Tp(t, t)) : n;
		}
		case "int64vector": {
			let t = e.length, n = tp(Jf.check(Sp(A.INT64_MIN), Cp(A.INT64_MAX)));
			return t ? n.check(Tp(t, t)) : n;
		}
		case "basecolumn": {
			let t = e.baseColumn;
			if (t) {
				let n = Yp(t), r = e.length, i = tp(n);
				return r ? i.check(Tp(r, r)) : i;
			}
			return tp(Hf);
		}
		default: return tp(Hf);
	}
}
function nm(e, t) {
	switch (t) {
		case "buffer": return Jp;
		case "date": return Op;
		case "geometry":
		case "point": return Zf({
			x: X,
			y: X
		});
		case "json": return qp;
		case "line": return Zf({
			a: X,
			b: X,
			c: X
		});
		default: return Yf;
	}
}
function rm(e, t) {
	let { name: n, length: r, isLengthExact: i } = e, a;
	if (t === "binary" && (a = /^[01]*$/), t === "uuid") return Kf.check(gp());
	if (t === "enum") {
		let t = e.enumValues;
		if (!t) throw Error(`Column "${re(g(e))}"."${n}" is of 'enum' type, but lacks enum values`);
		return ip(t);
	}
	if (t === "int64") return Zp;
	if (t === "uint64") return Qp;
	let o = Kf;
	return o = a ? o.check(mp(a)) : o, r && i ? o.check(Tp(r, r)) : r ? o.check(wp(r)) : o;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/effect-schema/schema.js
function im(e) {
	return (typeof e != "object" || !e) && typeof e != "function" ? !1 : Rf(e) && e.ast?.context?.isOptional === !0;
}
function am(e) {
	return Rf(e) ? !0 : im(e);
}
function om(e, t, n) {
	let r = {};
	for (let [i, a] of Object.entries(e)) {
		if (!f(a, h) && !f(a, O) && !f(a, O.Aliased) && typeof a == "object") {
			r[i] = om(ne(a) || ye(a) ? je(a) : a, t[i] ?? {}, n);
			continue;
		}
		let e = t[i];
		if (e !== void 0 && !(typeof e == "function" && !am(e))) {
			r[i] = e;
			continue;
		}
		let o = f(a, h) ? a : void 0, s = o ? Yp(o) : Hf, c = am(e) || typeof e != "function" ? s : e(s), l = im(c) ? c.schema : c;
		n.never(o) || (r[i] = l, o && (n.nullable(o) && (r[i] = ap(r[i])), n.optional(o) && (r[i] = Bf(op(r[i])))));
	}
	return Zf(r);
}
function sm(e) {
	return ip(e.enumValues);
}
var cm = {
	never: () => !1,
	optional: () => !1,
	nullable: (e) => !e.notNull
}, lm = {
	never: (e) => e?.generated?.type === "always" || e?.generatedIdentity?.type === "always" || "identity" in (e ?? {}) && e?.identity !== void 0,
	optional: (e) => !e.notNull || e.notNull && e.hasDefault,
	nullable: (e) => !e.notNull
}, um = (e, t) => Ie(e) ? sm(e) : om(je(e), t ?? {}, cm), dm = (e, t) => om(je(e), t ?? {}, lm), fm = class {
	static [d] = "SQLiteForeignKeyBuilder";
	reference;
	_onUpdate;
	_onDelete;
	constructor(e, t) {
		this.reference = () => {
			let { name: t, columns: n, foreignColumns: r } = e();
			return {
				name: t,
				columns: n,
				foreignTable: r[0].table,
				foreignColumns: r
			};
		}, t && (this._onUpdate = t.onUpdate, this._onDelete = t.onDelete);
	}
	onUpdate(e) {
		return this._onUpdate = e, this;
	}
	onDelete(e) {
		return this._onDelete = e, this;
	}
	build(e) {
		return new pm(e, this);
	}
}, pm = class {
	static [d] = "SQLiteForeignKey";
	reference;
	onUpdate;
	onDelete;
	constructor(e, t) {
		this.table = e, this.reference = t.reference, this.onUpdate = t._onUpdate, this.onDelete = t._onDelete;
	}
	getName() {
		let { name: e, columns: t, foreignColumns: n } = this.reference(), r = t.map((e) => e.name), i = n.map((e) => e.name), a = [
			this.table[_],
			...r,
			n[0].table[_],
			...i
		];
		return e ?? `${a.join("_")}_fk`;
	}
	isNameExplicit() {
		return !!this.reference().name;
	}
}, mm = class extends Re {
	static [d] = "SQLiteColumnBuilder";
	foreignKeyConfigs = [];
	references(e, t = {}) {
		return this.foreignKeyConfigs.push({
			ref: e,
			actions: t
		}), this;
	}
	unique(e) {
		return this.config.isUnique = !0, this.config.uniqueName = e, this;
	}
	generatedAlwaysAs(e, t) {
		return this.config.generated = {
			as: e,
			type: "always",
			mode: t?.mode ?? "virtual"
		}, this;
	}
	buildForeignKeys(e, t) {
		return this.foreignKeyConfigs.map(({ ref: n, actions: r }) => ((n, r) => {
			let i = new fm(() => {
				let t = n();
				return {
					columns: [e],
					foreignColumns: [t]
				};
			});
			return r.onUpdate && i.onUpdate(r.onUpdate), r.onDelete && i.onDelete(r.onDelete), i.build(t);
		})(n, r));
	}
}, hm = class extends h {
	static [d] = "SQLiteColumn";
	table;
	constructor(e, t) {
		super(e, t), this.table = e;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/sqlite-core/columns/blob.js
function gm(e) {
	let t = "";
	for (let n = 0; n < e.length; n += 2) {
		let r = e.slice(n, n + 2), i = Number.parseInt(r, 16);
		t += String.fromCodePoint(i);
	}
	return t;
}
var _m = class extends mm {
	static [d] = "SQLiteBigIntBuilder";
	constructor(e) {
		super(e, "bigint int64", "SQLiteBigInt");
	}
	build(e) {
		return new vm(e, this.config);
	}
}, vm = class extends hm {
	static [d] = "SQLiteBigInt";
	getSQLType() {
		return "blob";
	}
	mapFromDriverValue = (e) => {
		if (typeof e == "string") return BigInt(gm(e));
		if (typeof Buffer < "u" && Buffer.from) {
			let t = Buffer.isBuffer(e) ? e : e instanceof ArrayBuffer ? Buffer.from(e) : e.buffer ? Buffer.from(e.buffer, e.byteOffset, e.byteLength) : Buffer.from(e);
			return BigInt(t.toString("utf8"));
		}
		return BigInt(Pe.decode(e));
	};
	mapToDriverValue = (e) => Buffer.from(e.toString());
}, ym = class extends mm {
	static [d] = "SQLiteBlobJsonBuilder";
	constructor(e) {
		super(e, "object json", "SQLiteBlobJson");
	}
	build(e) {
		return new bm(e, this.config);
	}
}, bm = class extends hm {
	static [d] = "SQLiteBlobJson";
	getSQLType() {
		return "blob";
	}
	mapFromDriverValue = (e) => {
		if (typeof e == "string") return JSON.parse(gm(e));
		if (typeof Buffer < "u" && Buffer.from) {
			let t = Buffer.isBuffer(e) ? e : e instanceof ArrayBuffer ? Buffer.from(e) : e.buffer ? Buffer.from(e.buffer, e.byteOffset, e.byteLength) : Buffer.from(e);
			return JSON.parse(t.toString("utf8"));
		}
		return JSON.parse(Pe.decode(e));
	};
	mapToDriverValue = (e) => Buffer.from(JSON.stringify(e));
}, xm = class extends mm {
	static [d] = "SQLiteBlobBufferBuilder";
	constructor(e) {
		super(e, "object buffer", "SQLiteBlobBuffer");
	}
	build(e) {
		return new Sm(e, this.config);
	}
}, Sm = class extends hm {
	static [d] = "SQLiteBlobBuffer";
	mapFromDriverValue = (e) => Buffer.isBuffer(e) ? e : typeof e == "string" ? Buffer.from(e, "hex") : Buffer.from(e);
	getSQLType() {
		return "blob";
	}
};
function Cm(e, t) {
	let { name: n, config: r } = Ne(e, t);
	return r?.mode === "bigint" ? new _m(n) : r?.mode === "buffer" ? new xm(n) : new ym(n);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/sqlite-core/columns/custom.js
var wm = class extends mm {
	static [d] = "SQLiteCustomColumnBuilder";
	constructor(e, t, n) {
		super(e, "custom", "SQLiteCustomColumn"), this.config.fieldConfig = t, this.config.customTypeParams = n;
	}
	build(e) {
		return new Tm(e, this.config);
	}
}, Tm = class extends hm {
	static [d] = "SQLiteCustomColumn";
	sqlName;
	mapTo;
	mapFrom;
	mapJson;
	forJsonSelect;
	constructor(e, t) {
		super(e, t), this.sqlName = t.customTypeParams.dataType(t.fieldConfig), this.mapTo = t.customTypeParams.toDriver, this.mapFrom = t.customTypeParams.fromDriver, this.mapJson = t.customTypeParams.fromJson, this.forJsonSelect = t.customTypeParams.forJsonSelect;
	}
	getSQLType() {
		return this.sqlName;
	}
	mapFromDriverValue = (e) => typeof this.mapFrom == "function" ? this.mapFrom(e) : e;
	mapFromJsonValue(e) {
		return typeof this.mapJson == "function" ? this.mapJson(e) : this.mapFromDriverValue(e);
	}
	jsonSelectIdentifier(e, t) {
		if (typeof this.forJsonSelect == "function") return this.forJsonSelect(e, t);
		let n = this.getSQLType().toLowerCase(), r = n.indexOf("(");
		switch (r + 1 ? n.slice(0, r) : n) {
			case "numeric":
			case "decimal":
			case "bigint": return t`cast(${e} as text)`;
			case "blob": return t`hex(${e})`;
			default: return e;
		}
	}
	mapToDriverValue = (e) => typeof this.mapTo == "function" ? this.mapTo(e) : e;
};
function Em(e) {
	return (t, n) => {
		let { name: r, config: i } = Ne(t, n);
		return new wm(r, i, e);
	};
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/sqlite-core/columns/integer.js
var Dm = class extends mm {
	static [d] = "SQLiteBaseIntegerBuilder";
	constructor(e, t, n) {
		super(e, t, n), this.config.autoIncrement = !1;
	}
	primaryKey(e) {
		return e?.autoIncrement && (this.config.autoIncrement = !0), this.config.hasDefault = !0, super.primaryKey();
	}
}, Om = class extends hm {
	static [d] = "SQLiteBaseInteger";
	autoIncrement = this.config.autoIncrement;
	getSQLType() {
		return "integer";
	}
}, km = class extends Dm {
	static [d] = "SQLiteIntegerBuilder";
	constructor(e) {
		super(e, "number int53", "SQLiteInteger");
	}
	build(e) {
		return new Am(e, this.config);
	}
}, Am = class extends Om {
	static [d] = "SQLiteInteger";
}, jm = class extends Dm {
	static [d] = "SQLiteTimestampBuilder";
	constructor(e, t) {
		super(e, "object date", "SQLiteTimestamp"), this.config.mode = t;
	}
	defaultNow() {
		return this.default(k`(cast((julianday('now') - 2440587.5)*86400000 as integer))`);
	}
	build(e) {
		return new Mm(e, this.config);
	}
}, Mm = class extends Om {
	static [d] = "SQLiteTimestamp";
	mode = this.config.mode;
	mapFromDriverValue = (e) => typeof e == "string" ? new Date(e.replaceAll("\"", "")) : this.config.mode === "timestamp" ? /* @__PURE__ */ new Date(e * 1e3) : new Date(e);
	mapToDriverValue = (e) => {
		if (typeof e == "number") return e;
		let t = e.getTime();
		return this.config.mode === "timestamp" ? Math.floor(t / 1e3) : t;
	};
}, Nm = class extends Dm {
	static [d] = "SQLiteBooleanBuilder";
	constructor(e, t) {
		super(e, "boolean", "SQLiteBoolean"), this.config.mode = t;
	}
	build(e) {
		return new Pm(e, this.config);
	}
}, Pm = class extends Om {
	static [d] = "SQLiteBoolean";
	mode = this.config.mode;
	mapFromDriverValue = (e) => Number(e) === 1;
	mapToDriverValue = (e) => +!!e;
};
function Fm(e, t) {
	let { name: n, config: r } = Ne(e, t);
	return r?.mode === "timestamp" || r?.mode === "timestamp_ms" ? new jm(n, r.mode) : r?.mode === "boolean" ? new Nm(n, r.mode) : new km(n);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/sqlite-core/columns/numeric.js
var Im = class extends mm {
	static [d] = "SQLiteNumericBuilder";
	constructor(e) {
		super(e, "string numeric", "SQLiteNumeric");
	}
	build(e) {
		return new Lm(e, this.config);
	}
}, Lm = class extends hm {
	static [d] = "SQLiteNumeric";
	mapFromDriverValue = (e) => typeof e == "string" ? e : String(e);
	getSQLType() {
		return "numeric";
	}
}, Rm = class extends mm {
	static [d] = "SQLiteNumericNumberBuilder";
	constructor(e) {
		super(e, "number", "SQLiteNumericNumber");
	}
	build(e) {
		return new zm(e, this.config);
	}
}, zm = class extends hm {
	static [d] = "SQLiteNumericNumber";
	mapFromDriverValue = (e) => typeof e == "number" ? e : Number(e);
	mapToDriverValue = String;
	getSQLType() {
		return "numeric";
	}
}, Bm = class extends mm {
	static [d] = "SQLiteNumericBigIntBuilder";
	constructor(e) {
		super(e, "bigint int64", "SQLiteNumericBigInt");
	}
	build(e) {
		return new Vm(e, this.config);
	}
}, Vm = class extends hm {
	static [d] = "SQLiteNumericBigInt";
	mapFromDriverValue = BigInt;
	mapToDriverValue = String;
	getSQLType() {
		return "numeric";
	}
};
function Hm(e, t) {
	let { name: n, config: r } = Ne(e, t), i = r?.mode;
	return i === "number" ? new Rm(n) : i === "bigint" ? new Bm(n) : new Im(n);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/sqlite-core/columns/real.js
var Um = class extends mm {
	static [d] = "SQLiteRealBuilder";
	constructor(e) {
		super(e, "number double", "SQLiteReal");
	}
	build(e) {
		return new Wm(e, this.config);
	}
}, Wm = class extends hm {
	static [d] = "SQLiteReal";
	getSQLType() {
		return "real";
	}
};
function Gm(e) {
	return new Um(e ?? "");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/sqlite-core/columns/text.js
var Km = class extends mm {
	static [d] = "SQLiteTextBuilder";
	constructor(e, t) {
		super(e, t.enum?.length ? "string enum" : "string", "SQLiteText"), this.config.enumValues = t.enum, this.config.length = t.length;
	}
	build(e) {
		return new qm(e, this.config);
	}
}, qm = class extends hm {
	static [d] = "SQLiteText";
	enumValues = this.config.enumValues;
	constructor(e, t) {
		super(e, t);
	}
	getSQLType() {
		return `text${this.config.length ? `(${this.config.length})` : ""}`;
	}
}, Jm = class extends mm {
	static [d] = "SQLiteTextJsonBuilder";
	constructor(e) {
		super(e, "object json", "SQLiteTextJson");
	}
	build(e) {
		return new Ym(e, this.config);
	}
}, Ym = class extends hm {
	static [d] = "SQLiteTextJson";
	getSQLType() {
		return "text";
	}
	mapFromDriverValue = (e) => JSON.parse(e);
	mapToDriverValue = (e) => JSON.stringify(e);
};
function Xm(e, t = {}) {
	let { name: n, config: r } = Ne(e, t);
	return r.mode === "json" ? new Jm(n) : new Km(n, r);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/sqlite-core/columns/all.js
function Zm() {
	return {
		blob: Cm,
		customType: Em,
		integer: Fm,
		numeric: Hm,
		real: Gm,
		text: Xm
	};
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/casing.js
function Qm(e) {
	return (e.replace(/['\u2019]/g, "").match(/[\da-z]+|[A-Z]+(?![a-z])|[A-Z][\da-z]+/g) ?? []).map((e) => e.toLowerCase()).join("_");
}
function $m(e) {
	return (e.replace(/['\u2019]/g, "").match(/[\da-z]+|[A-Z]+(?![a-z])|[A-Z][\da-z]+/g) ?? []).reduce((e, t, n) => e + (n === 0 ? t.toLowerCase() : `${t[0].toUpperCase()}${t.slice(1)}`), "");
}
function eh(e) {
	return e === "snake_case" ? Qm : e === "camelCase" ? $m : (e) => e;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/sqlite-core/table.js
var th = Symbol.for("drizzle:SQLiteInlineForeignKeys"), nh = class extends w {
	static [d] = "SQLiteTable";
	static Symbol = Object.assign({}, w.Symbol, { InlineForeignKeys: th });
	[w.Symbol.Columns];
	[th] = [];
	[w.Symbol.ExtraConfigBuilder] = void 0;
};
function rh(e, t, n, r, i, a = e) {
	let o = eh(i), s = new nh(e, r, a), c = typeof t == "function" ? t(Zm()) : t, l = Object.fromEntries(Object.entries(c).map(([e, t]) => {
		let n = t;
		n.setName(e, o);
		let r = n.build(s).postBuild();
		return s[th].push(...n.buildForeignKeys(r, s)), [e, r];
	})), u = Object.assign(s, l);
	return u[w.Symbol.Columns] = l, u[w.Symbol.ExtraConfigColumns] = l, n && (u[nh.Symbol.ExtraConfigBuilder] = n), u;
}
function ih(e) {
	return (t, n, r) => rh(t, n, r, void 0, e);
}
var ah = ih(void 0);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/sqlite-core/utils.js
function oh(e) {
	return f(e, nh) ? [`${e[w.Symbol.BaseName]}`] : f(e, T) ? e._.usedTables ?? [] : f(e, O) ? e.usedTables ?? [] : [];
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/sqlite-core/view-base.js
var sh = class extends ve {
	static [d] = "SQLiteViewBase";
}, ch = class {
	static [d] = "ColumnTableAliasProxyHandler";
	constructor(e, t) {
		this.table = e, this.ignoreColumnAlias = t;
	}
	get(e, t) {
		return t === "table" ? this.table : t === "isAlias" && this.ignoreColumnAlias ? !1 : e[t];
	}
}, lh = class {
	static [d] = "ViewSelectionAliasProxyHandler";
	constructor(e, t, n) {
		this.view = e, this.selection = t, this.ignoreColumnAlias = n;
	}
	get(e, t) {
		let n = e[t];
		return f(n, h) ? new Proxy(n, new ch(this.view, this.ignoreColumnAlias)) : f(n, T) || f(n, O) || f(n, O.Aliased) || oe(n) || typeof n != "object" || !n ? n : new Proxy(n, this);
	}
}, uh = class {
	static [d] = "TableAliasProxyHandler";
	constructor(e, t, n) {
		this.alias = e, this.replaceOriginalName = t, this.ignoreColumnAlias = n;
	}
	get(e, t) {
		if (t === w.Symbol.IsAlias) return !0;
		if (t === w.Symbol.Name || this.replaceOriginalName && t === w.Symbol.OriginalName) return this.alias;
		if (t === E) return {
			...e[E],
			name: this.alias,
			isAlias: !0,
			selectedFields: new Proxy(e[E].selectedFields, new lh(new Proxy(e, this), e[E].selectedFields, this.ignoreColumnAlias))
		};
		if (t === w.Symbol.Columns) {
			let t = e[w.Symbol.Columns];
			if (!t) return t;
			if (f(e, ve)) return new Proxy(e[w.Symbol.Columns], new lh(new Proxy(e, this), e[w.Symbol.Columns], this.ignoreColumnAlias));
			let n = {};
			return Object.keys(t).map((r) => {
				n[r] = new Proxy(t[r], new ch(new Proxy(e, this), this.ignoreColumnAlias));
			}), n;
		}
		let n = e[t];
		return f(n, h) ? new Proxy(n, new ch(new Proxy(e, this), this.ignoreColumnAlias)) : n;
	}
}, dh = class {
	static [d] = "ColumnAliasProxyHandler";
	constructor(e) {
		this.alias = e;
	}
	get(e, t) {
		return t === "isAlias" ? !0 : t === "name" ? this.alias : t === "keyAsName" ? !1 : t === p ? () => e : e[t];
	}
};
function fh(e, t) {
	return new Proxy(e, new uh(t, !1, !1));
}
function ph(e, t) {
	return new Proxy(e, new dh(t));
}
h.prototype.as = function(e) {
	return ph(this, e);
};
function mh(e) {
	return e[p]();
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/selection-proxy.js
var Z = class e {
	static [d] = "SelectionProxyHandler";
	config;
	constructor(e) {
		this.config = { ...e };
	}
	get(t, n) {
		if (n === "_") return {
			...t._,
			selectedFields: new Proxy(t._.selectedFields, this)
		};
		if (n === E) return {
			...t[E],
			selectedFields: new Proxy(t[E].selectedFields, this)
		};
		if (typeof n == "symbol") return t[n];
		let r = (f(t, T) ? t._.selectedFields : f(t, ve) ? t[E].selectedFields : t)[n];
		if (f(r, O.Aliased)) {
			if (this.config.sqlAliasedBehavior === "sql" && !r.isSelectionField) return r.sql;
			let e = r.clone();
			return e.isSelectionField = !0, e.origin = this.config.alias, e;
		}
		if (f(r, O)) {
			if (this.config.sqlBehavior === "sql") return r;
			throw Error(`You tried to reference "${n}" field from a subquery, which is a raw SQL field, but it doesn't have an alias declared. Please add an alias to the field using ".as('alias')" method.`);
		}
		return f(r, h) ? this.config.alias ? new Proxy(r, new ch(new Proxy(r.table, new uh(this.config.alias, this.config.replaceOriginalName ?? !1, !0)), !0)) : r : typeof r != "object" || !r ? r : new Proxy(r, new e(this.config));
	}
}, hh = class {
	static [d] = "TypedQueryBuilder";
	getSelectedFields() {
		return this._.selectedFields;
	}
	withoutSelectionCastCodecs() {
		return this;
	}
}, gh = class {
	static [d] = "SQLiteSelectBuilder";
	fields;
	session;
	dialect;
	withList;
	distinct;
	constructor(e, t = _h) {
		this.builder = t, this.fields = e.fields, this.session = e.session, this.dialect = e.dialect, this.withList = e.withList, this.distinct = e.distinct;
	}
	from(e) {
		let t = !!this.fields, n;
		return n = this.fields ? this.fields : f(e, T) ? Object.fromEntries(Object.keys(e._.selectedFields).map((t) => [t, e[t]])) : f(e, sh) ? e[E].selectedFields : f(e, O) ? {} : Ae(e), new this.builder({
			table: e,
			fields: n,
			isPartialSelect: t,
			session: this.session,
			dialect: this.dialect,
			withList: this.withList ?? [],
			distinct: this.distinct
		});
	}
}, _h = class extends hh {
	static [d] = "SQLiteSelectQueryBuilder";
	_;
	config;
	joinsNotNullableMap;
	tableName;
	isPartialSelect;
	session;
	dialect;
	cacheConfig = void 0;
	usedTables = /* @__PURE__ */ new Set();
	constructor({ table: e, fields: t, isPartialSelect: n, session: r, dialect: i, withList: a, distinct: o }) {
		super(), this.config = {
			withList: a,
			table: e,
			fields: { ...t },
			distinct: o,
			setOperators: []
		}, this.isPartialSelect = n, this.session = r, this.dialect = i, this._ = {
			selectedFields: t,
			config: this.config
		}, this.tableName = Me(e), this.joinsNotNullableMap = typeof this.tableName == "string" ? { [this.tableName]: !0 } : {};
		for (let t of oh(e)) this.usedTables.add(t);
	}
	getUsedTables() {
		return [...this.usedTables];
	}
	createJoin(e) {
		return (t, n) => {
			let r = this.tableName, i = Me(t);
			for (let e of oh(t)) this.usedTables.add(e);
			if (typeof i == "string" && this.config.joins?.some((e) => e.alias === i)) throw Error(`Alias "${i}" is already used in this query`);
			if (!this.isPartialSelect && (Object.keys(this.joinsNotNullableMap).length === 1 && typeof r == "string" && (this.config.fields = { [r]: this.config.fields }), typeof i == "string" && !f(t, O))) {
				let e = f(t, T) ? t._.selectedFields : f(t, ve) ? t[E].selectedFields : t[w.Symbol.Columns];
				this.config.fields[i] = e;
			}
			if (typeof n == "function" && (n = n(new Proxy(this.config.fields, new Z({
				sqlAliasedBehavior: "sql",
				sqlBehavior: "sql"
			})))), this.config.joins || (this.config.joins = []), this.config.joins.push({
				on: n,
				table: t,
				joinType: e,
				alias: i
			}), typeof i == "string") switch (e) {
				case "left":
					this.joinsNotNullableMap[i] = !1;
					break;
				case "right":
					this.joinsNotNullableMap = Object.fromEntries(Object.entries(this.joinsNotNullableMap).map(([e]) => [e, !1])), this.joinsNotNullableMap[i] = !0;
					break;
				case "cross":
				case "inner":
					this.joinsNotNullableMap[i] = !0;
					break;
				case "full":
					this.joinsNotNullableMap = Object.fromEntries(Object.entries(this.joinsNotNullableMap).map(([e]) => [e, !1])), this.joinsNotNullableMap[i] = !1;
					break;
			}
			return this;
		};
	}
	leftJoin = this.createJoin("left");
	rightJoin = this.createJoin("right");
	innerJoin = this.createJoin("inner");
	fullJoin = this.createJoin("full");
	crossJoin = this.createJoin("cross");
	createSetOperator(e, t) {
		return (n) => {
			let r = typeof n == "function" ? n(yh()) : n;
			if (!De(this.getSelectedFields(), r.getSelectedFields())) throw Error("Set operator error (union / intersect / except): selected fields are not the same or are in a different order");
			return this.config.setOperators.push({
				type: e,
				isAll: t,
				rightSelect: r
			}), this;
		};
	}
	union = this.createSetOperator("union", !1);
	unionAll = this.createSetOperator("union", !0);
	intersect = this.createSetOperator("intersect", !1);
	except = this.createSetOperator("except", !1);
	addSetOperators(e) {
		return this.config.setOperators.push(...e), this;
	}
	where(e) {
		return typeof e == "function" && (e = e(new Proxy(this.config.fields, new Z({
			sqlAliasedBehavior: "sql",
			sqlBehavior: "sql"
		})))), this.config.where = e, this;
	}
	having(e) {
		return typeof e == "function" && (e = e(new Proxy(this.config.fields, new Z({
			sqlAliasedBehavior: "sql",
			sqlBehavior: "sql"
		})))), this.config.having = e, this;
	}
	groupBy(...e) {
		if (typeof e[0] == "function") {
			let t = e[0](new Proxy(this.config.fields, new Z({
				sqlAliasedBehavior: "alias",
				sqlBehavior: "sql"
			})));
			this.config.groupBy = Array.isArray(t) ? t : [t];
		} else this.config.groupBy = e;
		return this;
	}
	orderBy(...e) {
		if (typeof e[0] == "function") {
			let t = e[0](new Proxy(this.config.fields, new Z({
				sqlAliasedBehavior: "alias",
				sqlBehavior: "sql"
			}))), n = Array.isArray(t) ? t : [t];
			this.config.setOperators.length > 0 ? this.config.setOperators.at(-1).orderBy = n : this.config.orderBy = n;
		} else {
			let t = e;
			this.config.setOperators.length > 0 ? this.config.setOperators.at(-1).orderBy = t : this.config.orderBy = t;
		}
		return this;
	}
	limit(e) {
		return this.config.setOperators.length > 0 ? this.config.setOperators.at(-1).limit = e : this.config.limit = e, this;
	}
	offset(e) {
		return this.config.setOperators.length > 0 ? this.config.setOperators.at(-1).offset = e : this.config.offset = e, this;
	}
	$withCache(e) {
		return this.cacheConfig = e === void 0 ? {
			config: {},
			enabled: !0,
			autoInvalidate: !0
		} : e === !1 ? { enabled: !1 } : {
			enabled: !0,
			autoInvalidate: !0,
			...e
		}, this;
	}
	getSQL() {
		return this.config.fieldsFlat = Te(this.config.fields), this.dialect.buildSelectQuery(this.config);
	}
	toSQL() {
		return this.dialect.sqlToQuery(this.getSQL());
	}
	as(e) {
		let t = [];
		if (t.push(...oh(this.config.table)), this.config.joins) for (let e of this.config.joins) t.push(...oh(e.table));
		return new Proxy(new T(this.getSQL(), this.config.fields, e, !1, [...new Set(t)]), new Z({
			alias: e,
			sqlAliasedBehavior: "alias",
			sqlBehavior: "error"
		}));
	}
	getSelectedFields() {
		return new Proxy(this.config.fields, new Z({
			alias: this.tableName,
			sqlAliasedBehavior: "alias",
			sqlBehavior: "error"
		}));
	}
	withoutSelectionCastCodecs() {
		return this;
	}
	$dynamic() {
		return this;
	}
};
function vh(e, t) {
	return (n, r, ...i) => {
		let a = [r, ...i].map((n) => ({
			type: e,
			isAll: t,
			rightSelect: n
		}));
		for (let e of a) if (!De(n.getSelectedFields(), e.rightSelect.getSelectedFields())) throw Error("Set operator error (union / intersect / except): selected fields are not the same or are in a different order");
		return n.addSetOperators(a);
	};
}
var yh = () => ({
	union: bh,
	unionAll: xh,
	intersect: Sh,
	except: Ch
}), bh = vh("union", !1), xh = vh("union", !0), Sh = vh("intersect", !1), Ch = vh("except", !1), wh = class extends Error {
	static [d] = "DrizzleError";
	constructor({ message: e, cause: t }) {
		super(e), this.name = "DrizzleError", this.cause = t;
	}
}, Th = class e extends Error {
	static [d] = "DrizzleQueryError";
	constructor(t, n, r) {
		super(`Failed query: ${t}\nparams: ${n}`), this.query = t, this.params = n, this.cause = r, this.name = "DrizzleQueryError", Error.captureStackTrace(this, e), r && (this.cause = r);
	}
}, Eh = class extends wh {
	static [d] = "TransactionRollbackError";
	constructor() {
		super({ message: "Rollback" }), this.name = "TransactionRollbackError";
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/sql/expressions/conditions.js
function Q(e, t) {
	return ue(t) && !oe(e) && !f(e, pe) && !f(e, he) && !f(e, h) && !f(e, w) && !f(e, ve) ? new pe(e, t) : e;
}
var Dh = (e, t) => k`${e} = ${Q(t, e)}`, Oh = (e, t) => k`${e} <> ${Q(t, e)}`;
function kh(...e) {
	let t = e.filter((e) => e !== void 0);
	if (t.length !== 0) return t.length === 1 ? new O(t) : new O([
		new D("("),
		k.join(t.map((e) => k`(${e})`), new D(" and ")),
		new D(")")
	]);
}
function Ah(...e) {
	let t = e.filter((e) => e !== void 0);
	if (t.length !== 0) return t.length === 1 ? new O(t) : new O([
		new D("("),
		k.join(t.map((e) => k`(${e})`), new D(" or ")),
		new D(")")
	]);
}
function jh(e) {
	return f(e, O) ? k`not (${e})` : k`not ${e}`;
}
var Mh = (e, t) => k`${e} > ${Q(t, e)}`, Nh = (e, t) => k`${e} >= ${Q(t, e)}`, Ph = (e, t) => k`${e} < ${Q(t, e)}`, Fh = (e, t) => k`${e} <= ${Q(t, e)}`;
function Ih(e, t) {
	return Array.isArray(t) ? t.length === 0 ? k`false` : k`${e} in ${t.map((t) => Q(t, e))}` : k`${e} in ${Q(t, e)}`;
}
function Lh(e, t) {
	return Array.isArray(t) ? t.length === 0 ? k`true` : k`${e} not in ${t.map((t) => Q(t, e))}` : k`${e} not in ${Q(t, e)}`;
}
function Rh(e) {
	return k`(${e} is null)`;
}
function zh(e) {
	return k`(${e} is not null)`;
}
function Bh(e) {
	return k`exists ${e}`;
}
function Vh(e) {
	return k`not exists ${e}`;
}
function Hh(e, t, n) {
	return k`${e} between ${Q(t, e)} and ${Q(n, e)}`;
}
function Uh(e, t, n) {
	return k`${e} not between ${Q(t, e)} and ${Q(n, e)}`;
}
function Wh(e, t) {
	return k`${e} like ${t}`;
}
function Gh(e, t) {
	return k`${e} not like ${t}`;
}
function Kh(e, t) {
	return k`${e} ilike ${t}`;
}
function qh(e, t) {
	return k`${e} not ilike ${t}`;
}
function Jh(e, t) {
	if (Array.isArray(t)) {
		if (t.length === 0) throw Error("arrayContains requires at least one value");
		let n = Q(t, e);
		return k`${e} @> ${k`${Array.isArray(n) ? new pe(n) : n}`}`;
	}
	return k`${e} @> ${Q(t, e)}`;
}
function Yh(e, t) {
	if (Array.isArray(t)) {
		if (t.length === 0) throw Error("arrayContained requires at least one value");
		let n = Q(t, e);
		return k`${e} <@ ${k`${Array.isArray(n) ? new pe(n) : n}`}`;
	}
	return k`${e} <@ ${Q(t, e)}`;
}
function Xh(e, t) {
	if (Array.isArray(t)) {
		if (t.length === 0) throw Error("arrayOverlaps requires at least one value");
		let n = Q(t, e);
		return k`${e} && ${k`${Array.isArray(n) ? new pe(n) : n}`}`;
	}
	return k`${e} && ${Q(t, e)}`;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/sql/expressions/select.js
function Zh(e) {
	return k`${e} asc`;
}
function Qh(e) {
	return k`${e} desc`;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/relations.js
var $h = class {
	static [d] = "RelationV2";
	fieldName;
	sourceColumns;
	targetColumns;
	alias;
	where;
	sourceTable;
	targetTable;
	through;
	throughTable;
	isReversed;
	sourceColumnTableNames = [];
	targetColumnTableNames = [];
	constructor(e, t) {
		this.targetTableName = t, this.targetTable = e;
	}
}, eg = class extends $h {
	static [d] = "OneV2";
	relationType = "one";
	optional;
	constructor(e, t, n, r) {
		super(t, n), this.alias = r?.alias, this.where = r?.where, r?.from && (this.sourceColumns = (Array.isArray(r.from) ? r.from : [r.from]).map((t) => (this.throughTable ??= t._.through ? e[t._.through._.tableName] : void 0, this.sourceColumnTableNames.push(t._.tableName), t._.column))), r?.to && (this.targetColumns = (Array.isArray(r.to) ? r.to : [r.to]).map((t) => (this.throughTable ??= t._.through ? e[t._.through._.tableName] : void 0, this.targetColumnTableNames.push(t._.tableName), t._.column))), this.throughTable && (this.through = {
			source: (Array.isArray(r?.from) ? r.from : r?.from ? [r.from] : []).map((e) => e._.through),
			target: (Array.isArray(r?.to) ? r.to : r?.to ? [r.to] : []).map((e) => e._.through)
		}), this.optional = r?.optional ?? !0;
	}
}, tg = {
	and: kh,
	between: Hh,
	eq: Dh,
	exists: Bh,
	gt: Mh,
	gte: Nh,
	ilike: Kh,
	inArray: Ih,
	arrayContains: Jh,
	arrayContained: Yh,
	arrayOverlaps: Xh,
	isNull: Rh,
	isNotNull: zh,
	like: Wh,
	lt: Ph,
	lte: Fh,
	ne: Oh,
	not: jh,
	notBetween: Uh,
	notExists: Vh,
	notLike: Gh,
	notIlike: qh,
	notInArray: Lh,
	or: Ah,
	sql: k
}, ng = {
	sql: k,
	asc: Zh,
	desc: Qh
};
function rg(e, t, n, r = !1, i = !1, a = !0) {
	let o = t ? 1 : e.length, s = n.map(({ field: e, codec: t, arrayDimensions: n }) => {
		let r;
		return r = f(e, h) ? e : f(e, O) ? e.decoder : f(e, O.Aliased) ? e.sql.decoder : f(e, w) || f(e, ve) ? de : e.getSQL().decoder, a && e.mapFromJsonValue ? (t) => e.mapFromJsonValue(t) : r.mapFromDriverValue.isNoop ? t ? (e) => t(e, n) : void 0 : t ? (e) => r.mapFromDriverValue(t(e, n)) : (e) => r.mapFromDriverValue(e);
	});
	for (let a = 0; a < o; ++a) {
		let o = t ? e : e[a];
		for (let e = 0; e < n.length; ++e) {
			let t = n[e];
			if (t.selection) {
				if (o[t.key] === null) continue;
				if (r) {
					if (o[t.key] = JSON.parse(o[t.key]), o[t.key] === null) continue;
				} else i && typeof o[t.key] == "string" && (o[t.key] = JSON.parse(o[t.key]));
				if (t.isArray) {
					rg(o[t.key], !1, t.selection, !1, i);
					continue;
				}
				rg(o[t.key], !0, t.selection, !1, i);
				continue;
			}
			if (o[t.key] === null) continue;
			let a = s[e];
			a && (o[t.key] = a(o[t.key]));
		}
	}
	return e;
}
function ig(e, t, n, r = !1, i = !1) {
	let a = t ? 1 : e.length, o = n.map(({ field: e, codec: t, arrayDimensions: n }) => {
		let r;
		return r = f(e, h) ? e : f(e, O) ? e.decoder : f(e, O.Aliased) ? e.sql.decoder : f(e, w) || f(e, ve) ? de : e.getSQL().decoder, r.mapFromDriverValue.isNoop ? t ? (e) => t(e, n) : void 0 : t ? (e) => r.mapFromDriverValue(t(e, n)) : (e) => r.mapFromDriverValue(e);
	}), s = Array.from({ length: a });
	for (let c = 0; c < a; ++c) {
		let a = t ? e : e[c], l = {};
		for (let e = 0; e < n.length; ++e) {
			let t = n[e], s = a[e];
			if (t.selection) {
				if (s === null) {
					l[t.key] = null;
					continue;
				}
				if (r) {
					if (s = JSON.parse(s), s === null) {
						l[t.key] = null;
						continue;
					}
				} else i && typeof s == "string" && (s = JSON.parse(s));
				t.isArray ? rg(s, !1, t.selection, !1, i) : rg(s, !0, t.selection, !1, i), l[t.key] = s;
				continue;
			}
			if (s === null) {
				l[t.key] = null;
				continue;
			}
			let c = o[e];
			l[t.key] = c ? c(s) : s;
		}
		s[c] = l;
	}
	return t ? s[0] : s;
}
function ag({ selection: e, isFirst: t, parseJson: n, parseJsonIfString: r, rootJsonMappers: i, arrayModeRoot: a }) {
	return ((o) => t && !o[0] ? o[0] : a ? ig(t ? o[0] : o, t, e, n, r) : rg(t ? o[0] : o, t, e, n, r, i));
}
function og(e, t, n, r, i, a, o, s, c) {
	let l = [], u = [], d = !1, p = e.map(() => `c${s.n++}`), m = e.map((e, t) => c ? p[t] : `${JSON.stringify(e.key)}: ${p[t]}`);
	l.push(c ? `let [ ${m.join(", ")} ] = ${t};` : `let { ${m.join(", ")} } = ${t};`);
	for (let [t, { field: c, key: m, codec: g, isArray: _, selection: v, arrayDimensions: y }] of e.entries()) {
		let e = `${n}[${t}]`, b = JSON.stringify(m), x = p[t];
		if (v) {
			r ? (l.push(`if (${x} !== null) ${x} = JSON.parse(${x});`), d = !0) : i && (l.push(`if (typeof ${x} === 'string') ${x} = JSON.parse(${x});`), d = !0);
			let t = `s${s.n++}`, n = o.length;
			if (o.push(`const { selection: ${t} } = ${e};`), _) {
				let e = `j${s.n++}`, r = og(v, `${x}[${e}]`, t, !1, i, !0, o, s, !1);
				if (r.hasWork) {
					d = !0, l.push(`if (${x} !== null) {`), l.push(`\tfor (let ${e} = 0; ${e} < ${x}.length; ++${e}) {`);
					for (let e of r.bodyStmts) l.push(`\t\t${e}`);
					l.push(`\t\t${x}[${e}] = ${r.literal};`), l.push("	}"), l.push("}");
				} else o.splice(n, 1);
			} else {
				let e = og(v, x, t, !1, i, !0, o, s, !1);
				if (e.hasWork) {
					d = !0, l.push(`if (${x} !== null) {`);
					for (let t of e.bodyStmts) l.push(`\t${t}`);
					l.push(`\t${x} = ${e.literal};`), l.push("}");
				} else o.splice(n, 1);
			}
			u.push(`${b}: ${x}`);
			continue;
		}
		let S = "", C = "", ee = !1;
		if (f(c, h)) {
			if (a && c.mapFromJsonValue) {
				ee = !0;
				let e = s.n++;
				C = `field: dec${e}`, S = `dec${e}.mapFromJsonValue`;
			} else if (!c.mapFromDriverValue.isNoop) {
				let e = s.n++;
				C = `field: dec${e}`, S = `dec${e}.mapFromDriverValue`;
			}
		} else if (f(c, O)) {
			if (a && c.decoder.mapFromJsonValue) {
				ee = !0;
				let e = s.n++;
				C = `field: { decoder: dec${e} }`, S = `dec${e}.mapFromJsonValue`;
			} else if (!c.decoder.mapFromDriverValue.isNoop) {
				let e = s.n++;
				C = `field: { decoder: dec${e} }`, S = `dec${e}.mapFromDriverValue`;
			}
		} else if (f(c, O.Aliased)) {
			if (a && c.sql.decoder.mapFromJsonValue) {
				ee = !0;
				let e = s.n++;
				C = `field: { sql: { decoder: dec${e} } }`, S = `dec${e}.mapFromJsonValue`;
			} else if (!c.sql.decoder.mapFromDriverValue.isNoop) {
				let e = s.n++;
				C = `field: { sql: { decoder: dec${e} } }`, S = `dec${e}.mapFromDriverValue`;
			}
		} else if (!(f(c, w) || f(c, ve))) {
			let t = c.getSQL();
			if (a && t.decoder.mapFromJsonValue) {
				ee = !0;
				let t = s.n++;
				o.push(`const dec${t} = ${e}.field.getSQL().decoder;`), S = `dec${t}.mapFromJsonValue`;
			} else if (!t.decoder.mapFromDriverValue.isNoop) {
				let t = s.n++;
				o.push(`const dec${t} = ${e}.field.getSQL().decoder;`), S = `dec${t}.mapFromDriverValue`;
			}
		}
		let te = "";
		if (!ee && g && (te = `codec${s.n++}`), C || te) {
			let t = [];
			C && t.push(C), te && t.push(`codec: ${te}`), o.push(`const { ${t.join(", ")} } = ${e};`);
		}
		if (S || te) {
			d = !0;
			let e = x;
			te && (e = `${te}(${e}, ${y})`), S && (e = `${S}(${e})`), u.push(`${b}: ${x} === null ? null : ${e}`);
		} else u.push(`${b}: ${x}`);
	}
	return {
		bodyStmts: l,
		literal: `{ ${u.join(", ")} }`,
		hasWork: d
	};
}
function sg({ selection: e, isFirst: t, parseJson: n, parseJsonIfString: r, rootJsonMappers: i, arrayModeRoot: a }) {
	let o = [], s = og(e, "row", "selection", n, r, a ? !1 : i, o, { n: 0 }, !!a), c = [];
	c.push("	\"use strict\";\n	const { selection } = this;");
	for (let e of o) c.push(`\t${e}`);
	if (a) if (t) {
		c.push("	const row = rows[0];"), c.push("	if (!row) return undefined;");
		for (let e of s.bodyStmts) c.push(`\t${e}`);
		c.push(`\treturn ${s.literal};`);
	} else {
		c.push("	const { length } = rows;"), c.push("	const mapped = Array.from({ length });"), c.push("	for (let i = 0; i < length; ++i) {"), c.push("		const row = rows[i];");
		for (let e of s.bodyStmts) c.push(`\t\t${e}`);
		c.push(`\t\tmapped[i] = ${s.literal};`), c.push("	}"), c.push("	return mapped;");
	}
	else if (!s.hasWork) c.push(t ? "	return rows[0];" : "	return rows;");
	else if (t) {
		c.push("	const row = rows[0];"), c.push("	if (!row) return undefined;");
		for (let e of s.bodyStmts) c.push(`\t${e}`);
		c.push(`\trows[0] = ${s.literal};`), c.push("	return rows[0];");
	} else {
		c.push("	for (let i = 0; i < rows.length; ++i) {"), c.push("		const row = rows[i];");
		for (let e of s.bodyStmts) c.push(`\t\t${e}`);
		c.push(`\t\trows[i] = ${s.literal};`), c.push("	}"), c.push("	return rows;");
	}
	c.push("	//# sourceURL=drizzle:jit-relational-query-mapper");
	let l = c.join("\n");
	return Object.assign(new be("rows", l).bind({ selection: e }), { body: `function jitRqbMapper (rows) {\n${l}\n}` });
}
function cg(e, t) {
	let n = e[y][t];
	return n ? f(n, h) ? n : f(n, O.Aliased) ? k`${e}.${k.identifier(n.fieldAlias)}` : k`${e}.${k.identifier(t)}` : k`${e}.${k.identifier(t)}`;
}
function lg(e, t) {
	if (typeof t != "object" || f(t, he)) return Dh(e, t);
	let n = Object.entries(t);
	if (!n.length) return;
	let r = [];
	for (let [t, i] of n) if (i !== void 0) switch (t) {
		case "NOT": {
			let t = lg(e, i);
			if (!t) continue;
			r.push(jh(t));
			continue;
		}
		case "OR":
			if (!i.length) continue;
			r.push(Ah(...i.map((t) => lg(e, t))));
			continue;
		case "AND":
			if (!i.length) continue;
			r.push(kh(...i.map((t) => lg(e, t))));
			continue;
		case "isNotNull":
		case "isNull":
			if (!i) continue;
			r.push(tg[t](e));
			continue;
		case "in":
			r.push(tg.inArray(e, i));
			continue;
		case "notIn":
			r.push(tg.notInArray(e, i));
			continue;
		default:
			r.push(tg[t](e, i));
			continue;
	}
	if (r.length) return kh(...r);
}
function ug(e, t, n = {}, r = {}, i = 0) {
	let a = Object.entries(t);
	if (!a.length) return;
	let o = [];
	for (let [t, s] of a) if (s !== void 0) switch (t) {
		case "RAW": {
			let t = typeof s == "function" ? s(e, tg) : s.getSQL();
			o.push(t);
			continue;
		}
		case "OR":
			if (!s?.length) continue;
			o.push(Ah(...s.map((t) => ug(e, t, n, r, i))));
			continue;
		case "AND":
			if (!s?.length) continue;
			o.push(kh(...s.map((t) => ug(e, t, n, r, i))));
			continue;
		case "NOT": {
			if (s === void 0) continue;
			let t = ug(e, s, n, r, i);
			if (!t) continue;
			o.push(jh(t));
			continue;
		}
		default: {
			if (e[y][t]) {
				let n = lg(cg(e, t), s);
				n && o.push(n);
				continue;
			}
			let a = n[t];
			if (!a) throw new wh({ message: `Unknown relational filter field: "${t}"` });
			let c = fh(a.targetTable, `f${i}`), l = a.throughTable ? fh(a.throughTable, `ft${i}`) : void 0, u = r[a.targetTableName], { filter: d, joinCondition: f } = pg(a, e, c, l), p = kh(d, typeof s == "boolean" ? void 0 : ug(c, s, u.relations, r, i + 1)), m = l ? k`(select * from ${mg(c)} inner join ${mg(l)} on ${f}${k` where ${p}`.if(p)} limit 1)` : k`(select * from ${mg(c)}${k` where ${p}`.if(p)} limit 1)`;
			p && o.push((s ? Bh : Vh)(m));
		}
	}
	return kh(...o);
}
function dg(e, t) {
	if (typeof t == "function") {
		let n = t(e, ng);
		return f(n, O) ? n : Array.isArray(n) ? n.length ? k.join(n.map((e) => f(e, O) ? e : Zh(e)), k`, `) : void 0 : f(n, h) ? Zh(n) : void 0;
	}
	let n = Object.entries(t).filter(([e, t]) => t);
	if (n.length) return k.join(n.map(([t, n]) => (n === "asc" ? Zh : Qh)(cg(e, t))), k`, `);
}
function fg(e, t, n, r) {
	let i = [], a = [];
	for (let [o, s] of Object.entries(t)) {
		if (!s) continue;
		let t = (typeof s == "function" ? s(e, { sql: tg.sql }) : s).getSQL(), c = n ? Ee(t) : void 0, l = c && (!r || !c.jsonSelectIdentifier) ? k`${n.apply(c, r ? "castInJson" : "cast", k`(${t})`)} as ${k.identifier(o)}` : k`(${t}) as ${k.identifier(o)}`;
		l.decoder = t.decoder, i.push(l), a.push(c && (!r || !c.mapFromJsonValue) ? {
			key: o,
			field: l,
			codec: n.get(c, r ? "normalizeInJson" : "normalize"),
			arrayDimensions: c.dimensions
		} : {
			key: o,
			field: l
		});
	}
	return {
		sql: i.length ? k.join(i, k`, `) : void 0,
		selection: a
	};
}
function pg(e, t, n, r) {
	if (e.through) {
		let i = e.sourceColumns.map((n, i) => {
			let a = e.through.source[i];
			return Dh(k`${t}.${k.identifier(n.name)}`, k`${r}.${k.identifier(f(a._.column, h) ? a._.column.name : a._.key)}`);
		}), a = e.targetColumns.map((t, i) => {
			let a = e.through.target[i];
			return Dh(k`${r}.${k.identifier(f(a._.column, h) ? a._.column.name : a._.key)}`, k`${n}.${k.identifier(t.name)}`);
		});
		return {
			filter: kh(e.where ? ug(e.isReversed ? t : n, e.where) : void 0, ...i),
			joinCondition: kh(...a)
		};
	}
	return { filter: kh(...e.sourceColumns.map((r, i) => {
		let a = e.targetColumns[i];
		return Dh(k`${t}.${k.identifier(r.name)}`, k`${n}.${k.identifier(a.name)}`);
	}), e.where ? ug(e.isReversed ? t : n, e.where) : void 0) };
}
function mg(e) {
	return k`${e[C] ? k`${k`${k.identifier(e[v] ?? "")}.`.if(e[v])}${k.identifier(e[x])} as ${e}` : e}`;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/sqlite-core/dialect.js
var hg = class {
	static [d] = "SQLiteDialect";
	mapperGenerators;
	constructor(e) {
		this.mapperGenerators = e?.useJitMappers ? {
			rows: Se,
			relationalRows: sg
		} : {
			rows: we,
			relationalRows: ag
		};
	}
	escapeName(e) {
		return `"${e.replace(/"/g, "\"\"")}"`;
	}
	escapeParam(e) {
		return "?";
	}
	escapeString(e) {
		return `'${e.replace(/'/g, "''")}'`;
	}
	buildWithCTE(e) {
		if (!e?.length) return;
		let t = [k`with `];
		for (let [n, r] of e.entries()) t.push(k`${k.identifier(r._.alias)} as (${r._.sql})`), n < e.length - 1 && t.push(k`, `);
		return t.push(k` `), k.join(t);
	}
	buildDeleteQuery({ table: e, where: t, returning: n, withList: r, limit: i, orderBy: a }) {
		let o = this.buildWithCTE(r), s = n ? k` returning ${this.buildSelection(n, { isSingleTable: !0 })}` : void 0;
		return k`${o}delete from ${e}${t ? k` where ${t}` : void 0}${s}${this.buildOrderBy(a)}${this.buildLimit(i)}`;
	}
	buildUpdateSet(e, t) {
		let n = e[w.Symbol.Columns], r = Object.keys(n).filter((e) => t[e] !== void 0 || n[e]?.onUpdateFn !== void 0), i = r.length;
		return k.join(r.flatMap((e, r) => {
			let a = n[e], o = a.onUpdateFn?.(), s = t[e] ?? (f(o, O) ? o : k.param(o, a)), c = k`${k.identifier(a.name)} = ${s}`;
			return r < i - 1 ? [c, k.raw(", ")] : [c];
		}));
	}
	buildUpdateQuery({ table: e, set: t, where: n, returning: r, withList: i, joins: a, from: o, limit: s, orderBy: c }) {
		let l = this.buildWithCTE(i), u = this.buildUpdateSet(e, t), d = o && k.join([k.raw(" from "), this.buildFromTable(o)]), f = this.buildJoins(a), p = r ? k` returning ${this.buildSelection(r, { isSingleTable: !0 })}` : void 0;
		return k`${l}update ${e} set ${u}${d}${f}${n ? k` where ${n}` : void 0}${p}${this.buildOrderBy(c)}${this.buildLimit(s)}`;
	}
	buildSelection(e, { isSingleTable: t = !1 } = {}) {
		let n = e.length, r = e.flatMap(({ field: e }, r) => {
			let i = [];
			if (f(e, O.Aliased)) if (e.isSelectionField) !t && e.origin !== void 0 && i.push(k.identifier(e.origin), k.raw(".")), i.push(k.identifier(e.fieldAlias));
			else {
				let n = e.sql;
				if (t) {
					let e = new O(n.queryChunks.map((e) => f(e, h) ? k.identifier(e.name) : e));
					i.push(n.shouldInlineParams ? e.inlineParams() : e);
				} else i.push(n);
				i.push(k` as ${k.identifier(e.fieldAlias)}`);
			}
			else if (f(e, O)) {
				let n = e;
				if (t) {
					let e = new O(n.queryChunks.map((e) => f(e, h) ? k.identifier(e.name) : e));
					i.push(n.shouldInlineParams ? e.inlineParams() : e);
				} else i.push(n);
			} else f(e, h) ? e.columnType === "SQLiteNumericBigInt" || e.columnType === "SQLiteNumeric" ? t ? i.push(e.isAlias ? k`cast(${k.identifier(mh(e).name)} as text) as ${e}` : k`cast(${k.identifier(e.name)} as text)`) : i.push(e.isAlias ? k`cast(${mh(e)} as text) as ${e}` : k`cast(${e} as text)`) : t ? i.push(e.isAlias ? k`${k.identifier(mh(e).name)} as ${e}` : k.identifier(e.name)) : i.push(e.isAlias ? k`${mh(e)} as ${e}` : e) : f(e, T) && (e._.isWith ? i.push(e) : i.push(k`(${e._.sql}) ${k.identifier(e._.alias)}`));
			return r < n - 1 && i.push(k`, `), i;
		});
		return k.join(r);
	}
	buildJoins(e) {
		if (!e || e.length === 0) return;
		let t = [];
		if (e) for (let [n, r] of e.entries()) {
			n === 0 && t.push(k` `);
			let i = r.table, a = r.on ? k` on ${r.on}` : void 0;
			if (f(i, nh)) {
				let e = i[nh.Symbol.Name], n = i[nh.Symbol.Schema], o = i[nh.Symbol.OriginalName], s = e === o ? void 0 : r.alias;
				t.push(k`${k.raw(r.joinType)} join ${n ? k`${k.identifier(n)}.` : void 0}${k.identifier(o)}${s && k` ${k.identifier(s)}`}${a}`);
			} else t.push(k`${k.raw(r.joinType)} join ${i}${a}`);
			n < e.length - 1 && t.push(k` `);
		}
		return k.join(t);
	}
	buildLimit(e) {
		return typeof e == "object" || typeof e == "number" && e >= 0 ? k` limit ${e}` : void 0;
	}
	buildOrderBy(e) {
		let t = [];
		if (e) for (let [n, r] of e.entries()) t.push(r), n < e.length - 1 && t.push(k`, `);
		return t.length > 0 ? k` order by ${k.join(t)}` : void 0;
	}
	buildFromTable(e) {
		if (f(e, w) && e[w.Symbol.IsAlias]) return k`${k`${k.identifier(e[w.Symbol.Schema] ?? "")}.`.if(e[w.Symbol.Schema])}${k.identifier(e[w.Symbol.OriginalName])} ${k.identifier(e[w.Symbol.Name])}`;
		if (f(e, ve) && e[E].isAlias) {
			let t = k`${k.identifier(e[E].originalName)}`;
			return e[E].schema && (t = k`${k.identifier(e[E].schema)}.${t}`), k`${t} ${k.identifier(e[E].name)}`;
		}
		return e;
	}
	buildSelectQuery({ withList: e, fields: t, fieldsFlat: n, where: r, having: i, table: a, joins: o, orderBy: s, groupBy: c, limit: l, offset: u, distinct: d, setOperators: p }) {
		let m = n ?? Te(t);
		for (let e of m) if (f(e.field, h) && re(e.field.table) !== (f(a, T) ? a._.alias : f(a, sh) ? a[E].name : f(a, O) ? void 0 : re(a)) && !((e) => o?.some(({ alias: t }) => t === (e[w.Symbol.IsAlias] ? re(e) : e[w.Symbol.BaseName])))(e.field.table)) {
			let t = re(e.field.table);
			throw Error(`Your "${e.path.join("->")}" field references a column "${t}"."${e.field.name}", but the table "${t}" is not part of the query! Did you forget to join it?`);
		}
		let g = !o || o.length === 0, _ = this.buildWithCTE(e), v = d ? k` distinct` : void 0, y = this.buildSelection(m, { isSingleTable: g }), b = this.buildFromTable(a), x = this.buildJoins(o), S = r ? k` where ${r}` : void 0, C = i ? k` having ${i}` : void 0, ee = [];
		if (c) for (let [e, t] of c.entries()) ee.push(t), e < c.length - 1 && ee.push(k`, `);
		let te = k`${_}select${v} ${y} from ${b}${x}${S}${ee.length > 0 ? k` group by ${k.join(ee)}` : void 0}${C}${this.buildOrderBy(s)}${this.buildLimit(l)}${u ? k` offset ${u}` : void 0}`;
		return p.length > 0 ? this.buildSetOperations(te, p) : te;
	}
	buildSetOperations(e, t) {
		let [n, ...r] = t;
		if (!n) throw Error("Cannot pass undefined values to any set operator");
		return r.length === 0 ? this.buildSetOperationQuery({
			leftSelect: e,
			setOperator: n
		}) : this.buildSetOperations(this.buildSetOperationQuery({
			leftSelect: e,
			setOperator: n
		}), r);
	}
	buildSetOperationQuery({ leftSelect: e, setOperator: { type: t, isAll: n, rightSelect: r, limit: i, orderBy: a, offset: o } }) {
		let s = k`${e.getSQL()} `, c = k`${r.getSQL()}`, l;
		if (a && a.length > 0) {
			let e = [];
			for (let t of a) if (f(t, hm)) e.push(k.identifier(t.name));
			else if (f(t, O)) {
				for (let e = 0; e < t.queryChunks.length; e++) {
					let n = t.queryChunks[e];
					f(n, hm) && (t.queryChunks[e] = k.identifier(n.name));
				}
				e.push(k`${t}`);
			} else e.push(k`${t}`);
			l = k` order by ${k.join(e, k`, `)}`;
		}
		let u = typeof i == "object" || typeof i == "number" && i >= 0 ? k` limit ${i}` : void 0, d = k.raw(`${t} ${n ? "all " : ""}`), p = o ? k` offset ${o}` : void 0;
		return k`${s}${d}${c}${l}${u}${p}`;
	}
	buildInsertQuery({ table: e, values: t, onConflict: n, returning: r, withList: i, select: a }) {
		let o = [], s = e[w.Symbol.Columns], c = Object.entries(s), l = a && !f(t, O) ? Object.keys(t.getSelectedFields()).map((e) => [e, s[e]]) : c.filter(([e, t]) => !t.shouldDisableInsert()), u = l.map(([, e]) => k.identifier(e.name));
		if (a) {
			let e = t;
			f(e, O) ? o.push(e) : o.push(e.getSQL());
		} else {
			let e = t;
			o.push(k.raw("values "));
			for (let [t, n] of e.entries()) {
				let r = [];
				for (let [e, t] of l) {
					let i = n[e];
					if (i === void 0 || f(i, pe) && i.value === void 0) {
						let e;
						if (t.default !== null && t.default !== void 0) e = f(t.default, O) ? t.default : k.param(t.default, t);
						else if (t.defaultFn !== void 0) {
							let n = t.defaultFn();
							e = f(n, O) ? n : k.param(n, t);
						} else if (!t.default && t.onUpdateFn !== void 0) {
							let n = t.onUpdateFn();
							e = f(n, O) ? n : k.param(n, t);
						} else e = k`null`;
						r.push(e);
					} else r.push(i);
				}
				o.push(r), t < e.length - 1 && o.push(k`, `);
			}
		}
		let d = this.buildWithCTE(i), p = k.join(o), m = r ? k` returning ${this.buildSelection(r, { isSingleTable: !0 })}` : void 0;
		return k`${d}insert into ${e} ${u} ${p}${n?.length ? k.join(n) : void 0}${m}`;
	}
	sqlToQuery(e, t) {
		return e.toQuery({
			escapeName: this.escapeName,
			escapeParam: this.escapeParam,
			escapeString: this.escapeString,
			invokeSource: t
		});
	}
	nestedSelectionerror() {
		throw new wh({ message: "Views with nested selections are not supported by the relational query builder" });
	}
	buildRqbColumn(e, t, n, r) {
		if (f(t, h)) {
			let i = k`${e}.${k.identifier(t.name)}`;
			switch (t.columnType) {
				case "SQLiteBigInt":
				case "SQLiteBlobJson":
				case "SQLiteBlobBuffer": return r ? k`hex(${i}) as ${k.identifier(n)}` : k`${i} as ${k.identifier(n)}`;
				case "SQLiteNumeric":
				case "SQLiteNumericNumber":
				case "SQLiteNumericBigInt": return k`cast(${i} as text) as ${k.identifier(n)}`;
				case "SQLiteCustomColumn": return r ? k`${t.jsonSelectIdentifier(i, k)} as ${k.identifier(n)}` : k`${i} as ${k.identifier(n)}`;
				default: return k`${i} as ${k.identifier(n)}`;
			}
		}
		return k`${e}.${f(t, O.Aliased) ? k.identifier(t.fieldAlias) : oe(t) ? k.identifier(n) : this.nestedSelectionerror()} as ${k.identifier(n)}`;
	}
	unwrapAllColumns = (e, t, n) => k.join(Object.entries(e[y]).map(([r, i]) => (t.push({
		key: r,
		field: i
	}), this.buildRqbColumn(e, i, r, n))), k`, `);
	getSelectedTableColumns = (e, t) => {
		let n = [], r = e[y], i = Object.entries(t), a;
		for (let [e, t] of i) if (t !== void 0 && (a ||= t, t)) {
			let t = r[e];
			n.push({
				column: t,
				tsName: e
			});
		}
		if (a === !1) for (let [e, i] of Object.entries(r)) t[e] !== !1 && n.push({
			column: i,
			tsName: e
		});
		return n;
	};
	buildColumns = (e, t, n, r) => r?.columns ? (() => {
		let i = [], a = this.getSelectedTableColumns(e, r?.columns);
		for (let { column: r, tsName: o } of a) i.push(this.buildRqbColumn(e, r, o, n)), t.push({
			key: o,
			field: r
		});
		return i.length ? k.join(i, k`, `) : void 0;
	})() : this.unwrapAllColumns(e, t, n);
	buildRelationalQuery({ schema: e, table: t, tableConfig: n, queryConfig: r, relationWhere: i, mode: a, isNested: o, errorPath: s, depth: c, throughJoin: l, jsonb: u }) {
		let d = [], p = a === "first", m = r === !0 ? void 0 : r, h = s ?? "", g = c ?? 0;
		g || (t = fh(t, `d${g}`));
		let _ = p ? 1 : m?.limit, v = m?.offset, y = this.buildColumns(t, d, !!o, m), b = m?.where && i ? kh(ug(t, m.where, n.relations, e), i) : m?.where ? ug(t, m.where, n.relations, e) : i, x = m?.orderBy ? dg(t, m.orderBy) : void 0, S = m?.extras ? fg(t, m.extras) : void 0;
		S && d.push(...S.selection);
		let C = m ? (() => {
			let { with: r } = m;
			if (!r) return;
			let i = Object.entries(r).filter(([e, t]) => t);
			if (i.length) return k.join(i.map(([r, i]) => {
				let a = n.relations[r], s = f(a, eg), c = fh(a.targetTable, `d${g + 1}`), l = a.throughTable ? fh(a.throughTable, `tr${g}`) : void 0, { filter: p, joinCondition: m } = pg(a, t, c, l), _ = l ? k` inner join ${mg(l)} on ${m}` : void 0, v = this.buildRelationalQuery({
					table: c,
					mode: s ? "first" : "many",
					schema: e,
					queryConfig: i,
					tableConfig: e[a.targetTableName],
					relationWhere: p,
					isNested: !0,
					errorPath: `${h.length ? `${h}.` : ""}${r}`,
					depth: g + 1,
					throughJoin: _,
					jsonb: u
				});
				d.push({
					field: c,
					key: r,
					selection: v.selection,
					isArray: !s,
					isOptional: (a.optional ?? !1) || i !== !0 && !!i.where
				});
				let y = k.join(v.selection.map((e) => k`${k.raw(this.escapeString(e.key))}, ${e.selection ? k`${u}(${k.identifier(e.key)})` : k.identifier(e.key)}`), k`, `), b = o ? u : k`json`;
				return s ? k`(select ${b}_object(${y}) as ${k.identifier("r")} from (${v.sql}) as ${k.identifier("t")}) as ${k.identifier(r)}` : k`coalesce((select ${b}_group_array(json_object(${y})) as ${k.identifier("r")} from (${v.sql}) as ${k.identifier("t")}), ${u}_array()) as ${k.identifier(r)}`;
			}), k`, `);
		})() : void 0, ee = [
			y,
			S?.sql,
			C
		].filter((e) => e !== void 0);
		if (!ee.length) throw new wh({ message: `No fields selected for table "${n.name}"${h ? ` ("${h}")` : ""}` });
		return {
			sql: k`select ${k.join(ee, k`, `)} from ${mg(t)}${l}${k` where ${b}`.if(b)}${k` order by ${x}`.if(x)}${k` limit ${_}`.if(_ !== void 0)}${k` offset ${v}`.if(v !== void 0)}`,
			selection: d
		};
	}
}, gg = class {
	static [d] = "SQLiteQueryBuilder";
	dialect;
	dialectConfig;
	constructor(e) {
		this.dialect = f(e, hg) ? e : void 0, this.dialectConfig = f(e, hg) ? void 0 : e;
	}
	$with = (e, t) => {
		let n = this;
		return { as: (r) => (typeof r == "function" && (r = r(n)), new Proxy(new ie(r.getSQL(), t ?? ("getSelectedFields" in r ? r.getSelectedFields() ?? {} : {}), e, !0), new Z({
			alias: e,
			sqlAliasedBehavior: "alias",
			sqlBehavior: "error"
		}))) };
	};
	with(...e) {
		let t = this;
		function n(n) {
			return new gh({
				fields: n ?? void 0,
				session: void 0,
				dialect: t.getDialect(),
				withList: e
			});
		}
		function r(n) {
			return new gh({
				fields: n ?? void 0,
				session: void 0,
				dialect: t.getDialect(),
				withList: e,
				distinct: !0
			});
		}
		return {
			select: n,
			selectDistinct: r
		};
	}
	select(e) {
		return new gh({
			fields: e ?? void 0,
			session: void 0,
			dialect: this.getDialect()
		});
	}
	selectDistinct(e) {
		return new gh({
			fields: e ?? void 0,
			session: void 0,
			dialect: this.getDialect(),
			distinct: !0
		});
	}
	getDialect() {
		return this.dialect ||= new hg(this.dialectConfig), this.dialect;
	}
}, _g = class {
	static [d] = "QueryPromise";
	[Symbol.toStringTag] = "QueryPromise";
	catch(e) {
		return this.then(void 0, e);
	}
	finally(e) {
		return this.then((t) => (e?.(), t), (t) => {
			throw e?.(), t;
		});
	}
	then(e, t) {
		return this.execute().then(e, t);
	}
}, vg = class e extends O {
	static [d] = "SQLiteCountBuilder";
	dialect;
	session;
	static buildCount(e, t, n) {
		let r = k`select count(*) from ${e}${k` where ${t}`.if(t)}`;
		return n ? k`(${r})` : r;
	}
	constructor(t) {
		super(e.buildCount(t.source, t.filters, !0).queryChunks), this.countConfig = t, this.dialect = t.dialect, this.session = t.session, this.mapWith((e) => typeof e == "number" ? e : Number(e ?? 0));
	}
	executableSql;
	build() {
		if (!this.executableSql) {
			let { source: t, filters: n } = this.countConfig;
			this.executableSql = e.buildCount(t, n);
		}
		return this.dialect.sqlToQuery(this.executableSql);
	}
}, yg = class extends vg {
	static [d] = "SQLiteAsyncCountBuilder";
	constructor(e) {
		super(e);
	}
	executeRaw(e) {
		return this.session.prepareQuery(this.build(), "arrays", !1, "all", (e) => {
			let t = e[0]?.[0];
			return typeof t == "number" ? t : t ? Number(t) : 0;
		}).execute(e);
	}
	async execute(e) {
		return await this.executeRaw(e);
	}
};
ke(yg, [_g]);
var bg = class extends yg {
	static [d] = "SQLiteSyncCountBuilder";
	sync(e) {
		return this.executeRaw(e).sync();
	}
}, xg = class {
	static [d] = "SQLiteRelationalQueryBuilderV2";
	constructor(e, t, n, r, i, a, o, s = Sg) {
		this.mode = e, this.schema = t, this.table = n, this.tableConfig = r, this.dialect = i, this.session = a, this.forbidJsonb = o, this.builder = s;
	}
	findMany(e) {
		return new this.builder(this.mode, this.schema, this.table, this.tableConfig, this.dialect, this.session, e ?? !0, "many", this.forbidJsonb);
	}
	findFirst(e) {
		return new this.builder(this.mode, this.schema, this.table, this.tableConfig, this.dialect, this.session, e ?? !0, "first", this.forbidJsonb);
	}
}, Sg = class {
	static [d] = "SQLiteRelationalQueryV2";
	mode;
	table;
	resultKind;
	constructor(e, t, n, r, i, a, o, s, c) {
		this.schema = t, this.tableConfig = r, this.dialect = i, this.session = a, this.config = o, this.forbidJsonb = c, this.resultKind = e, this.mode = s, this.table = n;
	}
	getSQL() {
		return this._getQuery().sql;
	}
	_getQuery() {
		let e = this.forbidJsonb ? k`json` : k`jsonb`;
		return this.dialect.buildRelationalQuery({
			schema: this.schema,
			table: this.table,
			tableConfig: this.tableConfig,
			queryConfig: this.config,
			mode: this.mode,
			jsonb: e
		});
	}
	_toSQL() {
		let e = this._getQuery();
		return {
			query: e,
			builtQuery: this.dialect.sqlToQuery(e.sql)
		};
	}
	toSQL() {
		return this._toSQL().builtQuery;
	}
}, Cg = class extends Sg {
	static [d] = "SQLiteAsyncRelationalQueryV2";
	_prepare(e = !1) {
		let { query: t, builtQuery: n } = this._toSQL(), r = this.dialect.mapperGenerators.relationalRows({
			isFirst: this.mode === "first",
			parseJson: !0,
			parseJsonIfString: !1,
			rootJsonMappers: !1,
			selection: t.selection,
			arrayModeRoot: !0
		});
		return this.session.prepareQuery(n, "arrays", e, "all", r);
	}
	prepare() {
		return this._prepare(!0);
	}
	async execute(e) {
		return this._prepare().execute(e);
	}
}, wg = class extends Cg {
	static [d] = "SQLiteSyncRelationalQueryV2";
	sync(e) {
		return this._prepare().execute(e).sync();
	}
};
ke(Cg, [_g]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/sqlite-core/query-builders/delete.js
var Tg = class {
	static [d] = "SQLiteDelete";
	config;
	constructor(e, t, n, r) {
		this.table = e, this.session = t, this.dialect = n, this.config = {
			table: e,
			withList: r
		};
	}
	where(e) {
		return this.config.where = e, this;
	}
	orderBy(...e) {
		if (typeof e[0] == "function") {
			let t = e[0](new Proxy(this.config.table[w.Symbol.Columns], new Z({
				sqlAliasedBehavior: "alias",
				sqlBehavior: "sql"
			}))), n = Array.isArray(t) ? t : [t];
			this.config.orderBy = n;
		} else {
			let t = e;
			this.config.orderBy = t;
		}
		return this;
	}
	limit(e) {
		return this.config.limit = e, this;
	}
	returning(e = this.table[nh.Symbol.Columns]) {
		return this.config.returning = Te(e), this;
	}
	getSQL() {
		return this.dialect.buildDeleteQuery(this.config);
	}
	toSQL() {
		return this.dialect.sqlToQuery(this.getSQL());
	}
	$dynamic() {
		return this;
	}
}, Eg = class extends Tg {
	static [d] = "SQLiteAsyncDelete";
	_prepare(e = !1) {
		return this.session.prepareQuery(this.dialect.sqlToQuery(this.getSQL()), "arrays", e, this.config.returning ? "all" : "run", this.config.returning ? this.dialect.mapperGenerators.rows(this.config.returning, void 0) : void 0, {
			type: "delete",
			tables: oh(this.config.table)
		});
	}
	prepare() {
		return this._prepare(!0);
	}
	run = (e) => this._prepare().run(e);
	all = (e) => this._prepare().all(e);
	get = (e) => this._prepare().get(e);
	values = (e) => this._prepare().values(e);
	async execute(e) {
		return this._prepare().execute(e);
	}
};
ke(Eg, [_g]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/sqlite-core/query-builders/insert.js
var Dg = class {
	static [d] = "SQLiteInsertBuilder";
	constructor(e, t, n, r, i = Og) {
		this.table = e, this.session = t, this.dialect = n, this.withList = r, this.builder = i;
	}
	values(e) {
		if (e = Array.isArray(e) ? e : [e], e.length === 0) throw Error("values() must be called with at least one value");
		let t = e.map((e) => {
			let t = {}, n = this.table[w.Symbol.Columns];
			for (let r of Object.keys(e)) {
				let i = e[r];
				t[r] = f(i, O) ? i : new pe(i, n[r]);
			}
			return t;
		});
		return new this.builder(this.table, t, this.session, this.dialect, this.withList);
	}
	select(e) {
		let t = typeof e == "function" ? e(new gg()) : e;
		if (!f(t, O)) {
			let e = Object.keys(this.table[w.Symbol.Columns]), n = Object.keys(t._.selectedFields);
			for (let t of n) if (!e.includes(t)) throw Error(`Insert select error: column "${t}" does not exist in table "${this.table[w.Symbol.Name]}"`);
		}
		return new this.builder(this.table, t, this.session, this.dialect, this.withList, !0);
	}
}, Og = class {
	static [d] = "SQLiteInsert";
	config;
	constructor(e, t, n, r, i, a) {
		this.session = n, this.dialect = r, this.config = {
			table: e,
			values: t,
			withList: i,
			select: a
		};
	}
	returning(e = this.config.table[nh.Symbol.Columns]) {
		return this.config.returning = Te(e), this;
	}
	onConflictDoNothing(e = {}) {
		if (this.config.onConflict || (this.config.onConflict = []), e.target === void 0) this.config.onConflict.push(k` on conflict do nothing`);
		else {
			let t = Array.isArray(e.target) ? k`${e.target}` : k`${[e.target]}`, n = e.where ? k` where ${e.where}` : k``;
			this.config.onConflict.push(k` on conflict ${t} do nothing${n}`);
		}
		return this;
	}
	onConflictDoUpdate(e) {
		if (e.where && (e.targetWhere || e.setWhere)) throw Error("You cannot use both \"where\" and \"targetWhere\"/\"setWhere\" at the same time - \"where\" is deprecated, use \"targetWhere\" or \"setWhere\" instead.");
		this.config.onConflict || (this.config.onConflict = []);
		let t = e.where ? k` where ${e.where}` : void 0, n = e.targetWhere ? k` where ${e.targetWhere}` : void 0, r = e.setWhere ? k` where ${e.setWhere}` : void 0, i = Array.isArray(e.target) ? k`${e.target}` : k`${[e.target]}`, a = this.dialect.buildUpdateSet(this.config.table, Oe(this.config.table, e.set));
		return this.config.onConflict.push(k` on conflict ${i}${n} do update set ${a}${t}${r}`), this;
	}
	getSQL() {
		return this.dialect.buildInsertQuery(this.config);
	}
	toSQL() {
		return this.dialect.sqlToQuery(this.getSQL());
	}
	$dynamic() {
		return this;
	}
}, kg = class extends Og {
	static [d] = "SQLiteAsyncInsert";
	_prepare(e = !1) {
		return this.session.prepareQuery(this.dialect.sqlToQuery(this.getSQL()), "arrays", e, this.config.returning ? "all" : "run", this.config.returning ? this.dialect.mapperGenerators.rows(this.config.returning, void 0) : void 0, {
			type: "insert",
			tables: oh(this.config.table)
		});
	}
	prepare() {
		return this._prepare(!0);
	}
	run = (e) => this._prepare().run(e);
	all = (e) => this._prepare().all(e);
	get = (e) => this._prepare().get(e);
	values = (e) => this._prepare().values(e);
	async execute() {
		return this._prepare().execute();
	}
};
ke(kg, [_g]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/sqlite-core/query-builders/raw.js
var Ag = class {
	static [d] = "SQLiteRaw";
	constructor(e, t, n) {
		this.prepared = e, this.sql = t, this.query = n;
	}
	getSQL() {
		return this.sql;
	}
	getQuery() {
		return this.query;
	}
	_prepare() {
		return this.prepared;
	}
}, jg = class extends Ag {
	static [d] = "SQLiteAsyncRaw";
	constructor(e, t, n) {
		super(e, t, n);
	}
	execute(e) {
		return this.prepared.execute(e);
	}
};
ke(jg, [_g]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/sqlite-core/async/select.js
var Mg = class extends _h {
	static [d] = "SQLiteAsyncSelect";
	_prepare(e = !1) {
		let t = this.dialect.sqlToQuery(this.getSQL()), n = this.config.fieldsFlat, r = this.dialect.mapperGenerators.rows(n, this.joinsNotNullableMap);
		return this.session.prepareQuery(t, "arrays", e, "all", r, {
			type: "select",
			tables: [...this.usedTables]
		}, this.cacheConfig);
	}
	prepare() {
		return this._prepare(!0);
	}
	run = (e) => this._prepare().run(e);
	all = (e) => this._prepare().all(e);
	get = (e) => this._prepare().get(e);
	values = (e) => this._prepare().values(e);
	async execute() {
		return this._prepare().execute();
	}
};
ke(Mg, [_g]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/sqlite-core/query-builders/update.js
var Ng = class {
	static [d] = "SQLiteUpdateBuilder";
	constructor(e, t, n, r, i = Pg) {
		this.table = e, this.session = t, this.dialect = n, this.withList = r, this.builder = i;
	}
	set(e) {
		return new this.builder(this.table, Oe(this.table, e), this.session, this.dialect, this.withList);
	}
}, Pg = class {
	static [d] = "SQLiteUpdate";
	config;
	constructor(e, t, n, r, i) {
		this.session = n, this.dialect = r, this.config = {
			set: t,
			table: e,
			withList: i,
			joins: []
		};
	}
	from(e) {
		return this.config.from = e, this;
	}
	createJoin(e) {
		return ((t, n) => {
			let r = Me(t);
			if (typeof r == "string" && this.config.joins.some((e) => e.alias === r)) throw Error(`Alias "${r}" is already used in this query`);
			if (typeof n == "function") {
				let e = this.config.from ? f(t, nh) ? t[w.Symbol.Columns] : f(t, T) ? t._.selectedFields : f(t, sh) ? t[E].selectedFields : void 0 : void 0;
				n = n(new Proxy(this.config.table[w.Symbol.Columns], new Z({
					sqlAliasedBehavior: "sql",
					sqlBehavior: "sql"
				})), e && new Proxy(e, new Z({
					sqlAliasedBehavior: "sql",
					sqlBehavior: "sql"
				})));
			}
			return this.config.joins.push({
				on: n,
				table: t,
				joinType: e,
				alias: r
			}), this;
		});
	}
	leftJoin = this.createJoin("left");
	rightJoin = this.createJoin("right");
	innerJoin = this.createJoin("inner");
	fullJoin = this.createJoin("full");
	where(e) {
		return this.config.where = e, this;
	}
	orderBy(...e) {
		if (typeof e[0] == "function") {
			let t = e[0](new Proxy(this.config.table[w.Symbol.Columns], new Z({
				sqlAliasedBehavior: "alias",
				sqlBehavior: "sql"
			}))), n = Array.isArray(t) ? t : [t];
			this.config.orderBy = n;
		} else {
			let t = e;
			this.config.orderBy = t;
		}
		return this;
	}
	limit(e) {
		return this.config.limit = e, this;
	}
	returning(e = this.config.table[nh.Symbol.Columns]) {
		return this.config.returning = Te(e), this;
	}
	getSQL() {
		return this.dialect.buildUpdateQuery(this.config);
	}
	toSQL() {
		return this.dialect.sqlToQuery(this.getSQL());
	}
	$dynamic() {
		return this;
	}
}, Fg = class extends Pg {
	static [d] = "SQLiteAsyncUpdate";
	_prepare(e = !1) {
		return this.session.prepareQuery(this.dialect.sqlToQuery(this.getSQL()), "arrays", e, this.config.returning ? "all" : "run", this.config.returning ? this.dialect.mapperGenerators.rows(this.config.returning, void 0) : void 0, {
			type: "update",
			tables: oh(this.config.table)
		});
	}
	prepare() {
		return this._prepare(!0);
	}
	run = (e) => this._prepare().run(e);
	all = (e) => this._prepare().all(e);
	get = (e) => this._prepare().get(e);
	values = (e) => this._prepare().values(e);
	async execute() {
		return this.config.returning ? this.all() : this.run();
	}
};
ke(Fg, [_g]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/sqlite-core/async/db.js
var Ig = class {
	static [d] = "BaseSQLiteDatabase";
	query;
	constructor(e, t, n, r, i) {
		this.resultKind = e, this.dialect = t, this.session = n, this.forbidJsonb = i, this._ = {
			relations: r,
			session: n,
			resultKind: e
		}, this.query = {};
		for (let [a, o] of Object.entries(r)) this.query[a] = new xg(e, r, r[o.name].table, o, t, n, i, e === "sync" ? wg : Cg);
		this.$cache = { invalidate: async (e) => {} };
	}
	$with = (e, t) => {
		let n = this;
		return { as: (r) => (typeof r == "function" && (r = r(new gg(n.dialect))), new Proxy(new ie(r.getSQL(), t ?? ("getSelectedFields" in r ? r.getSelectedFields() ?? {} : {}), e, !0), new Z({
			alias: e,
			sqlAliasedBehavior: "alias",
			sqlBehavior: "error"
		}))) };
	};
	$count(e, t) {
		return this.resultKind === "async" ? new yg({
			source: e,
			filters: t,
			session: this.session,
			dialect: this.dialect
		}) : new bg({
			source: e,
			filters: t,
			session: this.session,
			dialect: this.dialect
		});
	}
	with(...e) {
		let t = this;
		function n(n) {
			return new gh({
				fields: n ?? void 0,
				session: t.session,
				dialect: t.dialect,
				withList: e
			}, Mg);
		}
		function r(n) {
			return new gh({
				fields: n ?? void 0,
				session: t.session,
				dialect: t.dialect,
				withList: e,
				distinct: !0
			}, Mg);
		}
		function i(n) {
			return new Ng(n, t.session, t.dialect, e, Fg);
		}
		function a(n) {
			return new Dg(n, t.session, t.dialect, e, kg);
		}
		function o(n) {
			return new Eg(n, t.session, t.dialect, e);
		}
		return {
			select: n,
			selectDistinct: r,
			update: i,
			insert: a,
			delete: o
		};
	}
	select(e) {
		return new gh({
			fields: e ?? void 0,
			session: this.session,
			dialect: this.dialect
		}, Mg);
	}
	selectDistinct(e) {
		return new gh({
			fields: e ?? void 0,
			session: this.session,
			dialect: this.dialect,
			distinct: !0
		}, Mg);
	}
	update(e) {
		return new Ng(e, this.session, this.dialect, void 0, Fg);
	}
	$cache;
	insert(e) {
		return new Dg(e, this.session, this.dialect, void 0, kg);
	}
	delete(e) {
		return new Eg(e, this.session, this.dialect);
	}
	run(e) {
		let t = typeof e == "string" ? k.raw(e) : e.getSQL(), n = this.dialect.sqlToQuery(t), r = this.session.prepareQuery(n, "raw", !1, "run");
		return this.resultKind === "async" ? new jg(r, t, n) : this.session.run(t);
	}
	all(e) {
		let t = typeof e == "string" ? k.raw(e) : e.getSQL(), n = this.dialect.sqlToQuery(t), r = this.session.prepareQuery(n, "objects", !1, "all");
		return this.resultKind === "async" ? new jg(r, t, n) : this.session.objects(t);
	}
	get(e) {
		let t = typeof e == "string" ? k.raw(e) : e.getSQL(), n = this.dialect.sqlToQuery(t), r = this.session.prepareQuery(n, "objects", !1, "get");
		return this.resultKind === "async" ? new jg(r, t, n) : this.session.object(t);
	}
	values(e) {
		let t = typeof e == "string" ? k.raw(e) : e.getSQL(), n = this.dialect.sqlToQuery(t), r = this.session.prepareQuery(n, "objects", !1, "values");
		return this.resultKind === "async" ? new jg(r, t, n) : this.session.arrays(t);
	}
	transaction(e, t) {
		return this.session.transaction(e, t);
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/migrator.utils.js
function Lg(e) {
	let t = parseInt(e.slice(0, 4), 10), n = parseInt(e.slice(4, 6), 10) - 1, r = parseInt(e.slice(6, 8), 10), i = parseInt(e.slice(8, 10), 10), a = parseInt(e.slice(10, 12), 10), o = parseInt(e.slice(12, 14), 10);
	return Date.UTC(t, n, r, i, a, o);
}
function Rg(e) {
	let { localMigrations: t, dbMigrations: n } = e, r = new Set(n.map((e) => e.name).filter((e) => e !== null));
	return t.filter((e) => !e.name || !r.has(e.name));
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/up-migrations/utils.js
var zg = {
	sqlite: 1,
	pg: 1,
	effect: 1,
	mysql: 1,
	mssql: 1,
	cockroach: 1,
	singlestore: 1
}, Bg = {
	mysql: (e) => +!!e.includes("name"),
	pg: (e) => +!!e.includes("name"),
	effect: (e) => +!!e.includes("name"),
	mssql: (e) => +!!e.includes("name"),
	cockroach: (e) => +!!e.includes("name"),
	singlestore: (e) => +!!e.includes("name"),
	sqlite: (e) => +!!e.includes("name")
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/up-migrations/sqlite.js
async function Vg(e, t, n) {
	if ((await t.session.objects(k`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${e}`)).length === 0) return { newDb: !0 };
	let r = await t.session.objects(k`SELECT name as column_name FROM pragma_table_info(${e})`), i = Bg.sqlite(r.map((e) => e.column_name));
	for (let r = i; r < zg.sqlite; r++) {
		let i = Hg[r];
		if (!i) throw Error(`No upgrade path from migration table version ${r} to ${r + 1}`);
		await i(e, t, n);
	}
	return { newDb: !1 };
}
var Hg = { 0: async (e, t, n) => {
	let r = k`${k.identifier(e)}`, i = await t.session.objects(k`SELECT id, hash, created_at FROM ${r} ORDER BY id ASC`);
	n.sort((e, t) => e.folderMillis === t.folderMillis ? (e.name ?? "").localeCompare(t.name ?? "") : e.folderMillis - t.folderMillis);
	let a = /* @__PURE__ */ new Map(), o = /* @__PURE__ */ new Map();
	for (let e of n) a.has(e.folderMillis) || a.set(e.folderMillis, []), a.get(e.folderMillis).push(e), o.set(e.hash, e);
	let s = [], c = [];
	for (let e of i) {
		let t = String(e.created_at), n = Number(t.substring(0, t.length - 3) + "000"), r = a.get(n), i, l = null;
		r && r.length === 1 ? (i = r[0], l = "millis") : r && r.length > 1 ? (i = r.find((t) => t.hash && e.hash && t.hash === e.hash), i && (l = "hash")) : (i = o.get(e.hash), i && (l = "hash")), i ? s.push({
			id: e.id,
			name: i.name,
			hash: e.hash,
			created_at: t,
			matchedBy: e.id ? "id" : l
		}) : c.push(e);
	}
	if (c.length > 0) throw Error(`While upgrading your database migrations table we found ${c.length} (${c.map((e) => `[id: ${e.id}, created_at: ${e.created_at}]`).join(", ")}) migrations in the database that do not match any local migration. This means that some migrations were applied to the database but are missing from the local environment`);
	let l = [k`ALTER TABLE ${r} ADD COLUMN ${k.identifier("name")} text`, k`ALTER TABLE ${r} ADD COLUMN ${k.identifier("applied_at")} TEXT`];
	for (let e of s) {
		let t = k`UPDATE ${r} SET ${k.identifier("name")} = ${e.name}, ${k.identifier("applied_at")} = NULL WHERE`;
		e.id ? t.append(k` ${k.identifier("id")} = ${e.id}`) : e.matchedBy === "millis" ? t.append(k` ${k.identifier("created_at")} = ${e.created_at}`) : t.append(k` ${k.identifier("hash")} = ${e.hash}`), l.push(t);
	}
	await t.transaction(async (e) => {
		for (let t of l) await e.run(t);
	});
} }, Ug = class {
	static [d] = "Cache";
}, Wg = class extends Ug {
	static [d] = "NoopCache";
	strategy() {
		return "all";
	}
	async get(e) {}
	async put(e, t, n, r) {}
	async onMutate(e) {}
}, Gg = async (e, t, n, r) => {
	if (!n) return { type: "skip" };
	let { type: i, tables: a } = n;
	return (i === "insert" || i === "update" || i === "delete") && a.length > 0 ? {
		type: "invalidate",
		tables: a
	} : !r || !r.enabled ? { type: "skip" } : i === "select" ? {
		type: "try",
		key: r.tag ?? await Kg(e, t),
		isTag: r.tag !== void 0,
		autoInvalidate: r.autoInvalidate,
		tables: n.tables,
		config: r.config
	} : { type: "skip" };
};
async function Kg(e, t) {
	let n = `${e}-${JSON.stringify(t, (e, t) => typeof t == "bigint" ? `${t}n` : t)}`, r = new TextEncoder().encode(n), i = await crypto.subtle.digest("SHA-256", r);
	return [...new Uint8Array(i)].map((e) => e.toString(16).padStart(2, "0")).join("");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/sqlite-core/session.js
var qg = class {
	static [d] = "SQLiteBasePreparedQuery";
	mapper;
	executeMethod;
	constructor(e, t, n, r) {
		this.query = t, this.mode = r, this.mapper = n, this.executeMethod = e;
	}
	getQuery() {
		return this.query;
	}
}, Jg = class {
	static [d] = "SQLiteSession";
	constructor(e) {
		this.dialect = e;
	}
}, Yg = class extends _g {
	static [d] = "ExecuteResultSync";
	constructor(e) {
		super(), this.resultCb = e;
	}
	async execute() {
		return this.resultCb();
	}
	sync() {
		return this.resultCb();
	}
}, Xg = class extends qg {
	static [d] = "SQLiteAsyncPreparedQuery";
	fastPath;
	constructor(e, t = "all", n, r, i, a, o, s, c, l) {
		super(t, r, i, a), this.resultKind = e, this.executors = n, this.logger = o, this.cache = s, this.queryMetadata = c, this.cacheConfig = l, s && s.strategy() === "all" && l === void 0 && (this.cacheConfig = {
			enabled: !0,
			autoInvalidate: !0
		}), this.cacheConfig?.enabled || (this.cacheConfig = void 0), this.fastPath = l === void 0 && (s === void 0 || f(s, Wg));
	}
	async queryWithCache(e, t, n, r) {
		let i = this.cache !== void 0 && !f(this.cache, Wg) ? await Gg(e, t, this.queryMetadata, this.cacheConfig) : { type: "skip" };
		if (i.type === "skip") return r().catch((n) => {
			throw new Th(e, t, n);
		});
		let a = this.cache;
		if (i.type === "invalidate") return Promise.all([r(), a.onMutate({ tables: i.tables })]).then((e) => e[0]).catch((n) => {
			throw new Th(e, t, n);
		});
		if (i.type === "try") {
			let { tables: o, key: s, isTag: c, autoInvalidate: l, config: u } = i, d = `${n}_${s}`, f = await a.get(d, o, c, l);
			if (f === void 0) {
				let n = await r().catch((n) => {
					throw new Th(e, t, n);
				});
				return await a.put(d, n, l ? o : [], c, u), n;
			}
			return f;
		}
		Fe(i);
	}
	run(e = {}) {
		let { query: t, logger: n, executors: r, fastPath: i, resultKind: a } = this, o = t._sql ? t._sql.join(" ") : t.sql, s = t.params.length === 0 ? t.params : ge(t.params, e);
		if (n.logQuery(o, s), a === "sync") try {
			return r.run(s);
		} catch (e) {
			throw new Th(o, s, e);
		}
		return i ? r.run(s).catch((e) => {
			throw new Th(o, s, e);
		}) : this.queryWithCache(o, s, "run", () => r.run(s));
	}
	all(e = {}) {
		let { query: t, logger: n, executors: r, mapper: i, fastPath: a, resultKind: o } = this, s = t._sql ? t._sql.join(" ") : t.sql, c = t.params.length === 0 ? t.params : ge(t.params, e);
		if (n.logQuery(s, c), o === "sync") {
			let e;
			try {
				e = r.all(c);
			} catch (e) {
				throw new Th(s, c, e);
			}
			return i ? i(e) : e;
		}
		let l = a ? r.all(c).catch((e) => {
			throw new Th(s, c, e);
		}) : this.queryWithCache(s, c, "all", () => r.all(c));
		return i ? l.then((e) => i(e)) : l;
	}
	get(e = {}) {
		let { query: t, logger: n, executors: r, mapper: i, fastPath: a, resultKind: o } = this, s = t._sql ? t._sql.join(" ") : t.sql, c = t.params.length === 0 ? t.params : ge(t.params, e);
		if (n.logQuery(s, c), o === "sync") {
			let e;
			try {
				e = r.get(c);
			} catch (e) {
				throw new Th(s, c, e);
			}
			return e ? i ? i([e])[0] : e : void 0;
		}
		let l = a ? r.get(c).catch((e) => {
			throw new Th(s, c, e);
		}) : this.queryWithCache(s, c, "get", () => r.get(c));
		return i ? l.then((e) => e ? i([e])[0] : void 0) : l.then((e) => e || void 0);
	}
	values(e = {}) {
		let { query: t, logger: n, executors: r, fastPath: i, resultKind: a } = this, o = t._sql ? t._sql.join(" ") : t.sql, s = t.params.length === 0 ? t.params : ge(t.params, e);
		if (n.logQuery(o, s), a === "sync") try {
			return r.values(s);
		} catch (e) {
			throw new Th(o, s, e);
		}
		return i ? r.values(s).catch((e) => {
			throw new Th(o, s, e);
		}) : this.queryWithCache(o, s, "values", () => r.values(s));
	}
	execute(e) {
		return this.resultKind === "async" ? this[this.executeMethod](e) : new Yg(() => this[this.executeMethod](e));
	}
}, Zg = class extends Jg {
	static [d] = "SQLiteAsyncSession";
	constructor(e, t) {
		super(e), this.resultKind = t;
	}
	run(e) {
		return this.prepareQuery(this.dialect.sqlToQuery(e), "raw", !1).run();
	}
	objects(e) {
		return this.prepareQuery(this.dialect.sqlToQuery(e), "objects", !1).all();
	}
	object(e) {
		return this.prepareQuery(this.dialect.sqlToQuery(e), "objects", !1).get();
	}
	arrays(e) {
		return this.prepareQuery(this.dialect.sqlToQuery(e), "arrays", !1).all();
	}
	array(e) {
		return this.prepareQuery(this.dialect.sqlToQuery(e), "arrays", !1).get();
	}
}, Qg = class extends Ig {
	static [d] = "SQLiteAsyncTransaction";
	constructor(e, t, n, r, i = 0, a) {
		super(e, t, n, r, a), this.nestedIndex = i;
	}
	rollback() {
		throw new Eh();
	}
};
async function $g(e, t, n) {
	let r = n === void 0 || typeof n == "string" ? "__drizzle_migrations" : n.migrationsTable ?? "__drizzle_migrations", { newDb: i } = await Vg(r, t, e);
	if (i) {
		let e = k`
			CREATE TABLE IF NOT EXISTS ${k.identifier(r)} (
				id INTEGER PRIMARY KEY,
				hash text NOT NULL,
				created_at numeric,
				name text,
				applied_at TEXT
			)
		`;
		await t.session.run(e);
	}
	let a = await t.session.objects(k`SELECT id, hash, created_at, name FROM ${k.identifier(r)};`);
	if (typeof n == "object" && n.init) {
		if (a.length) return { exitCode: "databaseMigrations" };
		if (e.length > 1) return { exitCode: "localMigrations" };
		let [n] = e;
		if (!n) return;
		await t.session.run(k`insert into ${k.identifier(r)} ("hash", "created_at", "name", "applied_at") values(${n.hash}, ${n.folderMillis}, ${n.name}, ${(/* @__PURE__ */ new Date()).toISOString()})`);
		return;
	}
	let o = Rg({
		localMigrations: e,
		dbMigrations: a
	});
	await t.session.transaction(async (e) => {
		for (let t of o) {
			for (let n of t.sql) await e.run(k.raw(n));
			await e.run(k`insert into ${k.identifier(r)} ("hash", "created_at", "name", "applied_at") values(${t.hash}, ${t.folderMillis}, ${t.name}, ${(/* @__PURE__ */ new Date()).toISOString()})`);
		}
	});
}
var $ = ah("products", {
	id: Xm("id").primaryKey(),
	name: Xm("name").notNull(),
	category: Xm("category", { enum: [
		"medicine",
		"cosmetics",
		"general"
	] }).notNull().default("general"),
	barcode: Xm("barcode"),
	composition: Xm("composition"),
	strength: Xm("strength"),
	unitsPerPack: Fm("units_per_pack").notNull().default(1),
	costPrice: Fm("cost_price"),
	packPrice: Fm("pack_price"),
	unitPrice: Fm("unit_price"),
	createdAt: Fm("created_at").notNull(),
	updatedAt: Fm("updated_at").notNull(),
	deletedAt: Fm("deleted_at")
}), e_ = ah("batches", {
	id: Xm("id").primaryKey(),
	productId: Xm("product_id").notNull().references(() => $.id),
	batchNumber: Xm("batch_number"),
	expiresAt: Fm("expires_at"),
	quantity: Fm("quantity").notNull().default(0),
	createdAt: Fm("created_at").notNull(),
	updatedAt: Fm("updated_at").notNull(),
	deletedAt: Fm("deleted_at")
}), t_ = um($), n_ = dm($), { deletedAt: r_, ...i_ } = t_.fields;
Zf(i_);
var { id: a_, createdAt: o_, updatedAt: s_, deletedAt: c_, ...l_ } = n_.fields, u_ = Zf(l_), d_ = Zf({
	id: Kf,
	...l_
}), f_ = Zf({ id: Kf }), p_ = um(e_), m_ = dm(e_), { deletedAt: h_, ...g_ } = p_.fields;
Zf(g_);
var { id: __, createdAt: v_, updatedAt: y_, deletedAt: b_, ...x_ } = m_.fields;
Zf(x_);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/logger.js
var S_ = class {
	static [d] = "ConsoleLogWriter";
	write(e) {
		console.log(e);
	}
}, C_ = class {
	static [d] = "DefaultLogger";
	writer;
	constructor(e) {
		this.writer = e?.writer ?? new S_();
	}
	logQuery(e, t) {
		let n = t.map((e) => {
			try {
				return JSON.stringify(e);
			} catch {
				return String(e);
			}
		}), r = n.length ? ` -- params: [${n.join(", ")}]` : "";
		this.writer.write(`Query: ${e}${r}`);
	}
}, w_ = class {
	static [d] = "NoopLogger";
	logQuery() {}
}, T_ = class e extends Zg {
	static [d] = "TursoDatabaseSyncSession";
	logger;
	cache;
	constructor(e, t, n, r) {
		super(t, "async"), this.client = e, this.relations = n, this.options = r, this.logger = r.logger ?? new w_(), this.cache = r.cache ?? new Wg();
	}
	prepareQuery(e, t, n, r, i, a, o) {
		let s;
		return new Xg("async", r, n ? {
			all: async (n) => (s ??= await this.client.prepare(e.sql), s.raw(t === "arrays").all(n)),
			get: async (n) => (s ??= await this.client.prepare(e.sql), s.raw(t === "arrays").get(n)),
			run: async (t) => (s ??= await this.client.prepare(e.sql), s.run(t)),
			values: async (t) => (s ??= await this.client.prepare(e.sql), s.raw(!0).all(t))
		} : {
			all: async (n) => s || t === "arrays" ? (s ??= await this.client.prepare(e.sql), s.raw(t === "arrays").all(n)) : this.client.all(e.sql, ...n),
			get: async (n) => s || t === "arrays" ? (s ??= await this.client.prepare(e.sql), s.raw(t === "arrays").get(n)) : this.client.get(e.sql, ...n),
			run: (t) => s ? s.run(t) : this.client.run(e.sql, ...t),
			values: async (t) => (s ??= await this.client.prepare(e.sql), s.raw(!0).all(t))
		}, e, i, t, this.logger, this.cache, a, o);
	}
	async transaction(t, n) {
		let r = new e(this.client, this.dialect, this.relations, this.options), i = new E_("async", this.dialect, r, this.relations);
		return await this.client.transaction(async () => await t(i))();
	}
}, E_ = class e extends Qg {
	static [d] = "TursoDatabaseSyncTransaction";
	async transaction(t) {
		let n = `sp${this.nestedIndex}`, r = new e("async", this.dialect, this.session, this._.relations, this.nestedIndex + 1);
		await this.session.run(k.raw(`savepoint ${n}`));
		try {
			let e = await t(r);
			return await this.session.run(k.raw(`release savepoint ${n}`)), e;
		} catch (e) {
			throw await this.session.run(k.raw(`rollback to savepoint ${n}`)), e;
		}
	}
}, D_ = class extends Ig {
	static [d] = "TursoDatabaseSyncDatabase";
};
function O_(e, t = {}) {
	let n = new hg({ useJitMappers: Ce(t.jit) }), r;
	t.logger === !0 ? r = new C_() : t.logger !== !1 && (r = t.logger);
	let i = t.relations ?? {}, a = new D_("async", n, new T_(e, n, i, {
		logger: r,
		cache: t.cache
	}), i);
	return a.$client = e, a.$cache = t.cache, a.$cache && (a.$cache.invalidate = t.cache?.onMutate), a;
}
function k_(...t) {
	if (typeof t[0] == "string") return O_(new e({ path: t[0] }), t[1]);
	let { connection: n, client: r, ...i } = t[0];
	return O_(r || (typeof n == "string" ? new e({ path: n }) : new e(n)), i);
}
(function(e) {
	function t(e) {
		return O_({}, e);
	}
	e.mock = t;
})(k_ ||= {});
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/migrator.js
function A_(e) {
	if (n.existsSync(`${e.migrationsFolder}/meta/_journal.json`)) throw Error("We detected that you have old drizzle-kit migration folders. You must upgrade drizzle-kit and run \"drizzle-kit up\"");
	let a = e.migrationsFolder, s = [], c = i(a).map((e) => ({
		path: o(a, e, "migration.sql"),
		name: e
	})).filter((e) => r(e.path));
	c.sort((e, t) => e.name.localeCompare(t.name));
	for (let e of c) {
		let r = e.path, i = e.name.slice(0, 14), a = n.readFileSync(r).toString(), o = a.split("--> statement-breakpoint").map((e) => e), c = Lg(i);
		s.push({
			sql: o,
			bps: !0,
			folderMillis: c,
			hash: t.createHash("sha256").update(a).digest("hex"),
			name: e.name
		});
	}
	return s;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+aec6109dbc861c24/node_modules/drizzle-orm/tursodatabase-sync/migrator.js
async function j_(e, t) {
	return $g(A_(t), e, t);
}
//#endregion
//#region ../../packages/persistence/src/index.ts
var M_ = class extends Lp()("PersistenceError", {
	operation: Kf,
	message: Kf
}) {}, N_ = class extends Lp()("ProductNotFoundError", { id: Kf }) {}, P_ = class extends oi()("@store/persistence/OfflineStore") {}, F_ = (e) => e instanceof Error ? e.message : String(e), I_ = (e, t) => Ic({
	try: () => Promise.resolve(t()),
	catch: (t) => new M_({
		operation: e,
		message: F_(t)
	})
}), L_ = ({ deletedAt: e, ...t }) => t, R_ = (e) => Hc(function* () {
	let t = !!e.syncUrl, n = !1, r = k_({ connection: t ? {
		path: e.path,
		url: () => n ? e.syncUrl : null,
		...e.authToken ? { authToken: e.authToken } : {},
		clientName: "store-electron"
	} : { path: e.path } });
	yield* I_("connect database", () => r.$client.connect()), yield* I_("migrate database", () => j_(r, { migrationsFolder: e.migrationsFolder }));
	let i = yield* Up({
		phase: t ? "idle" : "local-only",
		configured: t,
		lastSyncedAt: null,
		message: t ? "Ready to sync" : "Add Turso credentials to enable cloud sync"
	});
	yield* $c(() => I_("close database", () => r.$client.close()).pipe(Zc));
	let a = I_("list products", () => r.select().from($).where(Rh($.deletedAt)).orderBy(Zh($.name)).all()).pipe(Xc((e) => e.map(L_))), o = fl("OfflineStore.getProduct")(function* (e) {
		let t = yield* I_("find product", () => r.select().from($).where(kh(Dh($.id, e), Rh($.deletedAt))).get());
		return t ? L_(t) : yield* new N_({ id: e });
	}), s = fl("OfflineStore.createProduct")(function* (e) {
		let t = Date.now();
		return L_(yield* I_("create product", () => r.insert($).values({
			...e,
			id: crypto.randomUUID(),
			name: e.name.trim(),
			createdAt: t,
			updatedAt: t
		}).returning().get()));
	}), c = fl("OfflineStore.updateProduct")(function* (e) {
		let { id: t, ...n } = e, i = yield* I_("update product", () => r.update($).set({
			...n,
			name: n.name.trim(),
			updatedAt: Date.now()
		}).where(kh(Dh($.id, t), Rh($.deletedAt))).returning().get());
		return i ? L_(i) : yield* new N_({ id: t });
	}), l = fl("OfflineStore.deleteProduct")(function* (e) {
		if (!(yield* I_("delete product", () => r.update($).set({
			deletedAt: Date.now(),
			updatedAt: Date.now()
		}).where(kh(Dh($.id, e), Rh($.deletedAt))).returning({ id: $.id }).get()))) return yield* new N_({ id: e });
	}), u = fl("OfflineStore.sync")(function* () {
		if (!t) return yield* Wp(i);
		yield* Kp(i, (e) => ({
			...e,
			phase: "syncing",
			message: "Pushing local changes…"
		})), n = !0;
		let e = yield* I_("sync with Turso", async () => {
			await r.$client.push(), await r.$client.pull();
		}).pipe(Jc);
		if (e._tag === "Failure") return yield* Kp(i, (t) => ({
			...t,
			phase: "error",
			message: e.failure.message
		})), yield* e.failure;
		let a = {
			phase: "idle",
			configured: !0,
			lastSyncedAt: Date.now(),
			message: "Local and cloud data are in sync"
		};
		return yield* Gp(i, a), a;
	});
	return P_.of({
		listProducts: a,
		getProduct: o,
		createProduct: s,
		updateProduct: c,
		deleteProduct: l,
		getSyncStatus: Wp(i),
		sync: u()
	});
}), z_ = (e) => Dc(P_, R_(e)), B_ = {
	listProducts: Gc(P_, (e) => e.listProducts),
	getProduct: (e) => Gc(P_, (t) => t.getProduct(e)),
	createProduct: (e) => Gc(P_, (t) => t.createProduct(e)),
	updateProduct: (e) => Gc(P_, (t) => t.updateProduct(e)),
	deleteProduct: (e) => Gc(P_, (t) => t.deleteProduct(e)),
	getSyncStatus: Gc(P_, (e) => e.getSyncStatus),
	sync: Gc(P_, (e) => e.sync)
}, V_ = a.dirname(u(import.meta.url));
process.env.APP_ROOT = a.join(V_, "..");
var H_ = process.env.VITE_DEV_SERVER_URL, U_ = a.join(process.env.APP_ROOT, "dist-electron"), W_ = a.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = H_ ? a.join(process.env.APP_ROOT, "public") : W_;
var G_ = [
	a.join(process.env.APP_ROOT, ".env"),
	a.join(process.env.APP_ROOT, "..", "..", ".env"),
	a.join(process.env.APP_ROOT, "..", "..", "packages", "persistence", ".env")
];
for (let e of G_) try {
	process.loadEnvFile(e);
} catch {}
var K_, q_, J_ = (e) => q_ ? q_.runPromise(e).catch((e) => {
	let t = typeof e == "object" && e && "message" in e ? String(e.message) : String(e);
	throw Error(t);
}) : Promise.reject(/* @__PURE__ */ Error("The local store is not ready"));
function Y_() {
	l.handle("store:products:list", () => J_(B_.listProducts)), l.handle("store:products:get", (e, t) => J_(Lf(f_)(t).pipe(Gc(({ id: e }) => B_.getProduct(e))))), l.handle("store:products:create", (e, t) => J_(Lf(u_)(t).pipe(Gc(B_.createProduct)))), l.handle("store:products:update", (e, t) => J_(Lf(d_)(t).pipe(Gc(B_.updateProduct)))), l.handle("store:products:delete", (e, t) => J_(Lf(f_)(t).pipe(Gc(({ id: e }) => B_.deleteProduct(e))))), l.handle("store:sync:status", () => J_(B_.getSyncStatus)), l.handle("store:sync:run", () => J_(B_.sync));
}
function X_() {
	K_ = new s({
		icon: a.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
		frame: !1,
		webPreferences: { preload: a.join(V_, "preload.mjs") }
	}), K_.webContents.on("did-finish-load", () => {
		K_?.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
	}), K_.on("enter-full-screen", () => {
		K_?.webContents.send("window-controls:full-screen-changed", !0);
	}), K_.on("leave-full-screen", () => {
		K_?.webContents.send("window-controls:full-screen-changed", !1);
	}), H_ ? K_.loadURL(H_) : K_.loadFile(a.join(W_, "index.html"));
}
l.on("window-controls:minimize", (e) => {
	s.fromWebContents(e.sender)?.minimize();
}), l.handle("window-controls:toggle-maximize", (e) => {
	let t = s.fromWebContents(e.sender);
	return t ? (t.isMaximized() ? t.unmaximize() : t.maximize(), t.isMaximized()) : !1;
}), l.handle("window-controls:is-maximized", (e) => s.fromWebContents(e.sender)?.isMaximized() ?? !1), l.handle("window-controls:is-full-screen", (e) => s.fromWebContents(e.sender)?.isFullScreen() ?? !1), l.on("window-controls:close", (e) => {
	s.fromWebContents(e.sender)?.close();
}), c.on("window-all-closed", () => {
	process.platform !== "darwin" && (c.quit(), K_ = null);
}), c.on("activate", () => {
	s.getAllWindows().length === 0 && X_();
}), c.on("before-quit", () => {
	q_ && q_.dispose();
}), c.whenReady().then(() => {
	q_ = zp(z_({
		path: a.join(c.getPath("userData"), "store-v2.db"),
		migrationsFolder: c.isPackaged ? a.join(process.resourcesPath, "database-migrations") : a.join(process.env.APP_ROOT, "..", "..", "packages", "database", "drizzle"),
		syncUrl: process.env.TURSO_SYNC_URL ?? process.env.TURSO_DATABASE_URL,
		authToken: process.env.TURSO_AUTH_TOKEN
	})), Y_(), X_();
});
//#endregion
export { U_ as MAIN_DIST, W_ as RENDERER_DIST, H_ as VITE_DEV_SERVER_URL };
