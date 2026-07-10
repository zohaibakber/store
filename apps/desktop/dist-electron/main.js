import { Database as e } from "@tursodatabase/sync";
import { BrowserWindow as t, app as n, ipcMain as r } from "electron";
import { fileURLToPath as i } from "node:url";
import a from "node:path";
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Pipeable.js
var o = (e, t) => {
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
}, s = { pipe() {
	return o(this, arguments);
} }, c = /*#__PURE__*/ function() {
	function e() {}
	return e.prototype = s, e;
}(), l = function(e, t) {
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
}, u = (e) => e, d = (e) => () => e, f = /*#__PURE__*/ d(!0), p = /*#__PURE__*/ d(!1), m = /*#__PURE__*/ d(void 0), h = m;
function g(e, t, n, r, i, a, o, s, c) {
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
function _(e) {
	let t = /* @__PURE__ */ new WeakMap();
	return (n) => {
		if (t.has(n)) return t.get(n);
		let r = e(n);
		return t.set(n, r), r;
	};
}
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/equal.js
var v = (e) => {
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
}, y = /*#__PURE__*/ new WeakSet();
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Predicate.js
function b(e) {
	return typeof e == "string";
}
function x(e) {
	return typeof e == "number";
}
function S(e) {
	return typeof e == "function";
}
function C(e) {
	return e !== void 0;
}
function ee(e) {
	return e != null;
}
function te(e) {
	return !0;
}
function ne(e) {
	return typeof e == "object" && !!e || S(e);
}
var w = /*#__PURE__*/ l(2, (e, t) => ne(e) && t in e), T = "~effect/interfaces/Hash", E = (e) => {
	switch (typeof e) {
		case "number": return se(e);
		case "bigint": return D(e.toString(10));
		case "boolean": return D(String(e));
		case "symbol": return D(String(e));
		case "string": return D(e);
		case "undefined": return D("undefined");
		case "function":
		case "object":
			if (e === null) return D("null");
			if (e instanceof Date) return D(e.toISOString());
			if (e instanceof RegExp) return D(e.toString());
			{
				if (y.has(e)) return re(e);
				if (he.has(e)) return he.get(e);
				let t = _e(e, () => oe(e) ? e[T]() : typeof e == "function" ? re(e) : Array.isArray(e) || ArrayBuffer.isView(e) ? de(e) : e instanceof Map ? fe(e) : e instanceof Set ? pe(e) : le(e));
				return he.set(e, t), t;
			}
		default: throw Error(`BUG: unhandled typeof ${typeof e} - please report an issue at https://github.com/Effect-TS/effect/issues`);
	}
}, re = (e) => (me.has(e) || me.set(e, se(Math.floor(Math.random() * (2 ** 53 - 1)))), me.get(e)), ie = /*#__PURE__*/ l(2, (e, t) => e * 53 ^ t), ae = (e) => e & 3221225471 | e >>> 1 & 1073741824, oe = (e) => w(e, T), se = (e) => {
	if (e !== e) return D("NaN");
	if (e === Infinity) return D("Infinity");
	if (e === -Infinity) return D("-Infinity");
	let t = e | 0;
	for (t !== e && (t ^= e * 4294967295); e > 4294967295;) t ^= e /= 4294967295;
	return ae(t);
}, D = (e) => {
	let t = 5381, n = e.length;
	for (; n;) t = t * 33 ^ e.charCodeAt(--n);
	return ae(t);
}, ce = (e, t) => {
	let n = 12289;
	for (let r of t) n ^= ie(E(r), E(e[r]));
	return ae(n);
}, le = (e) => ce(e, v(e)), ue = (e, t) => (n) => {
	let r = e;
	for (let e of n) r ^= t(e);
	return ae(r);
}, de = /*#__PURE__*/ ue(6151, E), fe = /*#__PURE__*/ ue(/*#__PURE__*/ D("Map"), ([e, t]) => ie(E(e), E(t))), pe = /*#__PURE__*/ ue(/*#__PURE__*/ D("Set"), E), me = /*#__PURE__*/ new WeakMap(), he = /*#__PURE__*/ new WeakMap(), ge = /*#__PURE__*/ new WeakSet();
function _e(e, t) {
	if (ge.has(e)) return D("[Circular]");
	ge.add(e);
	let n = t();
	return ge.delete(e), n;
}
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Equal.js
var O = "~effect/interfaces/Equal";
function k() {
	return arguments.length === 1 ? (e) => ve(e, arguments[0]) : ve(arguments[0], arguments[1]);
}
function ve(e, t) {
	if (e === t) return !0;
	if (e == null || t == null) return !1;
	let n = typeof e;
	return n === typeof t ? n === "number" && e !== e && t !== t ? !0 : n !== "object" && n !== "function" || y.has(e) || y.has(t) ? !1 : Ce(e, t, Se) : !1;
}
function ye(e, t, n) {
	let r = be.has(e), i = xe.has(t);
	if (r && i) return !0;
	if (r || i) return !1;
	be.add(e), xe.add(t);
	let a = n();
	return be.delete(e), xe.delete(t), a;
}
var be = /*#__PURE__*/ new WeakSet(), xe = /*#__PURE__*/ new WeakSet();
function Se(e, t) {
	if (E(e) !== E(t)) return !1;
	if (e instanceof Date) return t instanceof Date ? e.toISOString() === t.toISOString() : !1;
	if (e instanceof RegExp) return t instanceof RegExp ? e.toString() === t.toString() : !1;
	let n = Me(e), r = Me(t);
	if (n !== r) return !1;
	let i = n && r;
	return typeof e == "function" && !i ? !1 : ye(e, t, () => i ? e[O](t) : Array.isArray(e) ? !Array.isArray(t) || e.length !== t.length ? !1 : Te(e, t) : ArrayBuffer.isView(e) ? !ArrayBuffer.isView(t) || e.byteLength !== t.byteLength ? !1 : Ee(e, t) : e instanceof Map ? !(t instanceof Map) || e.size !== t.size ? !1 : ke(e, t) : e instanceof Set ? !(t instanceof Set) || e.size !== t.size ? !1 : je(e, t) : De(e, t));
}
function Ce(e, t, n) {
	let r = we.get(e);
	if (!r) r = /* @__PURE__ */ new WeakMap(), we.set(e, r);
	else if (r.has(t)) return r.get(t);
	let i = n(e, t);
	r.set(t, i);
	let a = we.get(t);
	return a || (a = /* @__PURE__ */ new WeakMap(), we.set(t, a)), a.set(e, i), i;
}
var we = /*#__PURE__*/ new WeakMap();
function Te(e, t) {
	for (let n = 0; n < e.length; n++) if (!ve(e[n], t[n])) return !1;
	return !0;
}
function Ee(e, t) {
	if (e.length !== t.length) return !1;
	for (let n = 0; n < e.length; n++) if (e[n] !== t[n]) return !1;
	return !0;
}
function De(e, t) {
	let n = v(e), r = v(t);
	if (n.size !== r.size) return !1;
	for (let i of n) if (!r.has(i) || !ve(e[i], t[i])) return !1;
	return !0;
}
function Oe(e, t) {
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
var ke = /*#__PURE__*/ Oe(ve, ve);
function Ae(e) {
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
var je = /*#__PURE__*/ Ae(ve), Me = (e) => w(e, O), Ne = () => k, Pe = (e) => (t, n) => t === n || e(t, n), Fe = (e) => e.length > 0, Ie = /*#__PURE__*/ Symbol.for("~effect/Redactable"), Le = (e) => w(e, Ie);
function Re(e) {
	return Le(e) ? ze(e) : e;
}
function ze(e) {
	return e[Ie](globalThis["~effect/Fiber/currentFiber"]?.context ?? Ve);
}
var Be = "~effect/Fiber/currentFiber", Ve = {
	"~effect/Context": {},
	mapUnsafe: /*#__PURE__*/ new Map(),
	pipe() {
		return o(this, arguments);
	}
};
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Formatter.js
function A(e, t) {
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
			if (r.has(e)) return He;
			if (r.add(e), !i || e.length <= 1) return `[${e.map((e) => c(e, n)).join(",")}]`;
			let t = e.map((e) => c(e, n + 1)).join(",\n" + a(n + 1));
			return `[\n${a(n + 1)}${t}\n${a(n)}]`;
		}
		if (e instanceof Date) return Ge(e);
		if (!t?.ignoreToString && w(e, "toString") && typeof e.toString == "function" && e.toString !== Object.prototype.toString && e.toString !== Array.prototype.toString) {
			let t = Ke(e);
			return e instanceof Error && e.cause ? `${t} (cause: ${c(e.cause, n)})` : t;
		}
		if (typeof e == "string") return JSON.stringify(e);
		if (typeof e == "number" || e == null || typeof e == "boolean" || typeof e == "symbol") return String(e);
		if (typeof e == "bigint") return String(e) + "n";
		if (typeof e == "object" || typeof e == "function") {
			if (r.has(e)) return He;
			if (r.add(e), Ie in e) return A(ze(e));
			if (Symbol.iterator in e) return `${e.constructor.name}(${c(Array.from(e), n)})`;
			let t = s(e);
			if (!i || t.length <= 1) {
				let r = `{${t.map((t) => `${Ue(t)}:${c(e[t], n)}`).join(",")}}`;
				return o(e, r);
			}
			let l = `{\n${t.map((t) => `${a(n + 1)}${Ue(t)}: ${c(e[t], n + 1)}`).join(",\n")}\n${a(n)}}`;
			return o(e, l);
		}
		return String(e);
	}
	return c(e, 0);
}
var He = "[Circular]";
function Ue(e) {
	return typeof e == "string" ? JSON.stringify(e) : String(e);
}
function We(e) {
	return e.map((e) => `[${Ue(e)}]`).join("");
}
function Ge(e) {
	try {
		return e.toISOString();
	} catch {
		return "Invalid Date";
	}
}
function Ke(e) {
	try {
		let t = e.toString();
		return typeof t == "string" ? t : String(t);
	} catch {
		return "[toString threw]";
	}
}
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Inspectable.js
var qe = /*#__PURE__*/ Symbol.for("nodejs.util.inspect.custom"), Je = (e) => {
	try {
		if (w(e, "toJSON") && S(e.toJSON) && e.toJSON.length === 0) return e.toJSON();
		if (Array.isArray(e)) return e.map(Je);
	} catch {
		return "[toJSON threw]";
	}
	return Re(e);
}, Ye = class e {
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
}, Xe = /*#__PURE__*/ (() => {
	let e = "~effect/Utils/internal", t = { [e]: (e) => e() }, n = { [e]: (e) => {
		try {
			return e();
		} finally {}
	} };
	return t[e](() => (/* @__PURE__ */ Error()).stack)?.includes(e) === !0 ? t[e] : n[e];
})(), Ze = "~effect/Effect", Qe = "~effect/Exit", $e = {
	_A: u,
	_E: u,
	_R: u
}, et = `${Ze}/identifier`, j = `${Ze}/args`, M = `${Ze}/evaluate`, tt = `${Ze}/successCont`, nt = `${Ze}/failureCont`, rt = `${Ze}/ensureCont`, it = /*#__PURE__*/ Symbol.for("effect/Effect/Yield"), at = {
	pipe() {
		return o(this, arguments);
	},
	toJSON() {
		return { ...this };
	},
	toString() {
		return A(this.toJSON(), {
			ignoreToString: !0,
			space: 2
		});
	},
	[qe]() {
		return this.toJSON();
	}
}, ot = {
	[Ze]: $e,
	...at,
	[Symbol.iterator]() {
		return new Ye(this);
	},
	toJSON() {
		return {
			_id: "Effect",
			op: this[et],
			...j in this ? { args: this[j] } : void 0
		};
	}
}, st = (e) => w(e, Ze), ct = (e) => w(e, Qe), lt = "~effect/Cause", ut = "~effect/Cause/Reason", dt = (e) => w(e, lt), ft = class {
	[lt];
	reasons;
	constructor(e) {
		this[lt] = lt, this.reasons = e;
	}
	pipe() {
		return o(this, arguments);
	}
	toJSON() {
		return {
			_id: "Cause",
			failures: this.reasons.map((e) => e.toJSON())
		};
	}
	toString() {
		return `Cause(${A(this.reasons)})`;
	}
	[qe]() {
		return this.toJSON();
	}
	[O](e) {
		return dt(e) && this.reasons.length === e.reasons.length && this.reasons.every((t, n) => k(t, e.reasons[n]));
	}
	[T]() {
		return de(this.reasons);
	}
}, pt = /*#__PURE__*/ new WeakMap(), mt = class {
	[ut];
	annotations;
	_tag;
	constructor(e, t, n) {
		if (this[ut] = ut, this._tag = e, t !== ht && typeof n == "object" && n && t.size > 0) {
			let e = pt.get(n);
			e && (t = new Map([...e, ...t])), pt.set(n, t);
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
		return o(this, arguments);
	}
	toString() {
		return A(this);
	}
	[qe]() {
		return this.toString();
	}
}, ht = /*#__PURE__*/ new Map(), gt = class extends mt {
	error;
	constructor(e, t = ht) {
		super("Fail", t, e), this.error = e;
	}
	toString() {
		return `Fail(${A(this.error)})`;
	}
	toJSON() {
		return {
			_tag: "Fail",
			error: this.error
		};
	}
	[O](e) {
		return St(e) && k(this.error, e.error) && k(this.annotations, e.annotations);
	}
	[T]() {
		return ie(D(this._tag))(ie(E(this.error))(E(this.annotations)));
	}
}, _t = (e) => new ft(e), vt = (e) => new ft([new gt(e)]), yt = class extends mt {
	defect;
	constructor(e, t = ht) {
		super("Die", t, e), this.defect = e;
	}
	toString() {
		return `Die(${A(this.defect)})`;
	}
	toJSON() {
		return {
			_tag: "Die",
			defect: this.defect
		};
	}
	[O](e) {
		return Ct(e) && k(this.defect, e.defect) && k(this.annotations, e.annotations);
	}
	[T]() {
		return ie(D(this._tag))(ie(E(this.defect))(E(this.annotations)));
	}
}, bt = (e) => new ft([new yt(e)]), xt = /*#__PURE__*/ l((e) => dt(e[0]), (e, t, n) => t.mapUnsafe.size === 0 ? e : new ft(e.reasons.map((e) => e.annotate(t, n)))), St = (e) => e._tag === "Fail", Ct = (e) => e._tag === "Die", wt = (e) => e._tag === "Interrupt";
function Tt(e) {
	return Nt("Effect.evaluate: Not implemented");
}
var Et = (e) => ({
	...ot,
	[et]: e.op,
	[M]: e[M] ?? Tt,
	[tt]: e[tt],
	[nt]: e[nt],
	[rt]: e[rt]
}), Dt = (e) => {
	let t = Et(e);
	return function() {
		let n = Object.create(t);
		return n[j] = e.single === !1 ? arguments : arguments[0], n;
	};
}, Ot = (e) => {
	let t = {
		...Et(e),
		[Qe]: Qe,
		_tag: e.op,
		get [e.prop]() {
			return this[j];
		},
		toString() {
			return `${e.op}(${A(this[j])})`;
		},
		toJSON() {
			return {
				_id: "Exit",
				_tag: e.op,
				[e.prop]: this[j]
			};
		},
		[O](e) {
			return ct(e) && e._tag === this._tag && k(this[j], e[j]);
		},
		[T]() {
			return ie(D(e.op), E(this[j]));
		}
	};
	return function(e) {
		let n = Object.create(t);
		return n[j] = e, n;
	};
}, kt = /*#__PURE__*/ Ot({
	op: "Success",
	prop: "value",
	[M](e) {
		let t = e.getCont(tt);
		return t ? t[tt](this[j], e, this) : e.yieldWith(this);
	}
}), At = { key: "effect/Cause/StackTrace" }, jt = /*#__PURE__*/ Ot({
	op: "Failure",
	prop: "cause",
	[M](e) {
		let t = this[j], n = !1;
		e.currentStackFrame && (t = xt(t, { mapUnsafe: /* @__PURE__ */ new Map([[At.key, e.currentStackFrame]]) }), n = !0);
		let r = e.getCont(nt);
		for (; e.interruptible && e._interruptedCause && r;) r = e.getCont(nt);
		return r ? r[nt](t, e, n ? void 0 : this) : e.yieldWith(n ? this : jt(t));
	}
}), Mt = (e) => jt(vt(e)), Nt = (e) => jt(bt(e)), Pt = /*#__PURE__*/ Dt({
	op: "WithFiber",
	[M](e) {
		return this[j](e);
	}
}), Ft = /*#__PURE__*/ function() {
	class e extends globalThis.Error {}
	let t = /*#__PURE__*/ Et({
		op: "YieldableError",
		[M]() {
			return Mt(this);
		}
	});
	return delete t.toString, Object.assign(e.prototype, t), e;
}(), It = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ Symbol.for("effect/Data/Error/plainArgs");
	return class extends Ft {
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
}(), Lt = (e) => {
	class t extends It {
		_tag = e;
	}
	return t.prototype.name = e, t;
};
Lt("NoSuchElementError");
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/option.js
var Rt = "~effect/data/Option", zt = {
	[Rt]: { _A: (e) => e },
	...at,
	[Symbol.iterator]() {
		return new Ye(this);
	}
}, Bt = /*#__PURE__*/ Object.defineProperty(/*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(zt), {
	_tag: "Some",
	_op: "Some",
	[O](e) {
		return Ut(e) && Gt(e) && k(this.value, e.value);
	},
	[T]() {
		return ie(E(this._tag))(E(this.value));
	},
	toString() {
		return `some(${A(this.value)})`;
	},
	toJSON() {
		return {
			_id: "Option",
			_tag: this._tag,
			value: Je(this.value)
		};
	}
}), "valueOrUndefined", { get() {
	return this.value;
} }), Vt = /*#__PURE__*/ E("None"), Ht = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(zt), {
	_tag: "None",
	_op: "None",
	valueOrUndefined: void 0,
	[O](e) {
		return Ut(e) && Wt(e);
	},
	[T]() {
		return Vt;
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
}), Ut = (e) => w(e, Rt), Wt = (e) => e._tag === "None", Gt = (e) => e._tag === "Some", Kt = /*#__PURE__*/ Object.create(Ht), qt = (e) => {
	let t = Object.create(Bt);
	return t.value = e, t;
}, Jt = "~effect/data/Result", Yt = {
	[Jt]: {
		/* v8 ignore next 2 */
		_A: (e) => e,
		_E: (e) => e
	},
	...at,
	[Symbol.iterator]() {
		return new Ye(this);
	}
}, Xt = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Yt), {
	_tag: "Success",
	_op: "Success",
	[O](e) {
		return Qt(e) && en(e) && k(this.success, e.success);
	},
	[T]() {
		return ie(E(this._tag))(E(this.success));
	},
	toString() {
		return `success(${A(this.success)})`;
	},
	toJSON() {
		return {
			_id: "Result",
			_tag: this._tag,
			value: Je(this.success)
		};
	}
}), Zt = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(Yt), {
	_tag: "Failure",
	_op: "Failure",
	[O](e) {
		return Qt(e) && $t(e) && k(this.failure, e.failure);
	},
	[T]() {
		return ie(E(this._tag))(E(this.failure));
	},
	toString() {
		return `failure(${A(this.failure)})`;
	},
	toJSON() {
		return {
			_id: "Result",
			_tag: this._tag,
			failure: Je(this.failure)
		};
	}
}), Qt = (e) => w(e, Jt), $t = (e) => e._tag === "Failure", en = (e) => e._tag === "Success", tn = (e) => {
	let t = Object.create(Zt);
	return t.failure = e, t;
}, nn = (e) => {
	let t = Object.create(Xt);
	return t.success = e, t;
};
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Order.js
function rn(e) {
	return (t, n) => t === n ? 0 : e(t, n);
}
var an = /*#__PURE__*/ rn((e, t) => globalThis.Number.isNaN(e) && globalThis.Number.isNaN(t) ? 0 : globalThis.Number.isNaN(e) ? -1 : globalThis.Number.isNaN(t) ? 1 : e < t ? -1 : 1), on = /*#__PURE__*/ l(2, (e, t) => rn((n, r) => e(t(n), t(r)))), sn = (e) => l(2, (t, n) => e(t, n) === 1), cn = () => Kt, N = qt, ln = Wt, un = Gt, dn = /*#__PURE__*/ (/* @__PURE__ */ l(2, (e, t) => ln(e) ? t() : e.value))(m), fn = /*#__PURE__*/ l(2, (e, t) => ln(e) ? cn() : N(t(e.value))), pn = /*#__PURE__*/ l(2, (e, t) => ln(e) ? cn() : t(e.value) ? N(e.value) : cn()), mn = nn, hn = tn, gn = $t, _n = globalThis.Array, vn = (e) => _n.isArray(e) ? e : _n.from(e), yn = /*#__PURE__*/ l(2, (e, t) => [...e, t]), bn = /*#__PURE__*/ l(2, (e, t) => vn(e).concat(vn(t)));
_n.isArray;
var xn = Fe, Sn = Fe;
function Cn(e, t) {
	return e < 0 || e >= t.length;
}
var wn = /*#__PURE__*/ (/* @__PURE__ */ l(2, (e, t) => {
	let n = Math.floor(t);
	if (Cn(n, e)) throw Error(`Index out of bounds: ${n}`);
	return e[n];
}))(0), Tn = (e) => e.slice(1), En = /*#__PURE__*/ l(3, (e, t, n) => {
	let r = vn(e), i = vn(t);
	return Sn(r) ? Sn(i) ? An(n)(bn(r, i)) : r : i;
}), Dn = /*#__PURE__*/ l(2, (e, t) => En(e, t, Ne())), On = () => [], kn = /*#__PURE__*/ l(2, (e, t) => e.map(t)), An = /*#__PURE__*/ l(2, (e, t) => {
	let n = vn(e);
	if (Sn(n)) {
		let e = [wn(n)], r = Tn(n);
		for (let n of r) e.every((e) => !t(n, e)) && e.push(n);
		return e;
	}
	return [];
}), jn = "~effect/BigDecimal", Mn = {
	[jn]: jn,
	[T]() {
		let e = zn(this);
		return ie(E(e.value), se(e.scale));
	},
	[O](e) {
		return Nn(e) && Un(this, e);
	},
	toString() {
		return `BigDecimal(${Wn(this)})`;
	},
	toJSON() {
		return {
			_id: "BigDecimal",
			value: String(this.value),
			scale: this.scale
		};
	},
	[qe]() {
		return this.toJSON();
	},
	pipe() {
		return o(this, arguments);
	}
}, Nn = (e) => w(e, jn), Pn = (e, t) => {
	let n = Object.create(Mn);
	return n.value = e, n.scale = t, n;
}, Fn = (e, t) => {
	if (e !== In && e % Ln === In) throw RangeError("Value must be normalized");
	let n = Pn(e, t);
	return n.normalized = n, n;
}, In = /*#__PURE__*/ BigInt(0), Ln = /*#__PURE__*/ BigInt(10), Rn = /*#__PURE__*/ Fn(In, 0), zn = (e) => {
	if (e.normalized === void 0) if (e.value === In) e.normalized = Rn;
	else {
		let t = `${e.value}`, n = 0;
		for (let e = t.length - 1; e >= 0 && t[e] === "0"; e--) n++;
		n === 0 && (e.normalized = e), e.normalized = Fn(BigInt(t.substring(0, t.length - n)), e.scale - n);
	}
	return e.normalized;
}, Bn = /*#__PURE__*/ l(2, (e, t) => t > e.scale ? Pn(e.value * Ln ** BigInt(t - e.scale), t) : t < e.scale ? Pn(e.value / Ln ** BigInt(e.scale - t), t) : e), Vn = (e) => e.value < In ? Pn(-e.value, e.scale) : e, Hn = /*#__PURE__*/ Pe((e, t) => e.scale > t.scale ? Bn(t, e.scale).value === e.value : e.scale < t.scale ? Bn(e, t.scale).value === t.value : e.value === t.value), Un = /*#__PURE__*/ l(2, (e, t) => Hn(e, t)), Wn = (e) => {
	let t = zn(e);
	if (Math.abs(t.scale) >= 16) return Gn(t);
	let n = t.value < In, r = n ? `${t.value}`.substring(1) : `${t.value}`, i, a;
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
}, Gn = (e) => {
	if (Kn(e)) return "0e+0";
	let t = zn(e), n = `${Vn(t).value}`, r = n.slice(0, 1), i = n.slice(1), a = `${qn(t) ? "-" : ""}${r}`;
	i !== "" && (a += `.${i}`);
	let o = i.length - t.scale;
	return `${a}e${o >= 0 ? "+" : ""}${o}`;
}, Kn = (e) => e.value === In, qn = (e) => e.value < In, Jn = (e) => Et({
	op: e.label,
	[M]: e.evaluate
}), Yn = "~effect/Context/Service", Xn = function() {
	let e = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	let t = /* @__PURE__ */ Error();
	Error.stackTraceLimit = e;
	function n() {}
	let r = n;
	return Object.setPrototypeOf(r, Zn), Object.defineProperty(r, "stack", { get() {
		return t.stack;
	} }), arguments.length > 0 ? (r.key = arguments[0], arguments[1]?.defaultValue && (r[Qn] = Qn, r.defaultValue = arguments[1].defaultValue), r) : function(e, t) {
		return r.key = e, t?.make && (r.make = t.make), r;
	};
}, Zn = {
	[Yn]: Yn,
	.../*#__PURE__*/ Jn({
		label: "Service",
		evaluate(e) {
			return kt(ur(e.context, this));
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
		return or(this, e);
	},
	use(e) {
		return Pt((t) => e(ur(t.context, this)));
	},
	useSync(e) {
		return Pt((t) => kt(e(ur(t.context, this))));
	}
}, Qn = "~effect/Context/Reference", $n = "~effect/Context", er = (e) => {
	let t = Object.create(tr);
	return t.mapUnsafe = e, t.mutable = !1, t;
}, tr = {
	...at,
	[$n]: { _Services: (e) => e },
	toJSON() {
		return {
			_id: "Context",
			services: Array.from(this.mapUnsafe).map(([e, t]) => ({
				key: e,
				value: t
			}))
		};
	},
	[O](e) {
		if (!nr(e) || this.mapUnsafe.size !== e.mapUnsafe.size) return !1;
		for (let t of this.mapUnsafe.keys()) if (!e.mapUnsafe.has(t) || !k(this.mapUnsafe.get(t), e.mapUnsafe.get(t))) return !1;
		return !0;
	},
	[T]() {
		return se(this.mapUnsafe.size);
	}
}, nr = (e) => w(e, $n), rr = (e) => w(e, Qn), ir = () => ar, ar = /*#__PURE__*/ er(/*#__PURE__*/ new Map()), or = (e, t) => er(/* @__PURE__ */ new Map([[e.key, t]])), sr = /*#__PURE__*/ l(3, (e, t, n) => gr(e, (e) => {
	e.set(t.key, n);
})), cr = /*#__PURE__*/ l(3, (e, t, n) => e.mapUnsafe.has(t.key) ? e.mapUnsafe.get(t.key) : rr(t) ? pr(t) : n()), lr = /*#__PURE__*/ l(2, (e, t) => {
	if (!e.mapUnsafe.has(t.key)) {
		if (Qn in t) return pr(t);
		throw mr(t);
	}
	return e.mapUnsafe.get(t.key);
}), ur = lr, dr = (e, t) => e.mapUnsafe.has(t.key) ? e.mapUnsafe.get(t.key) : pr(t), fr = "~effect/Context/defaultValue", pr = (e) => fr in e ? e[fr] : e[fr] = e.defaultValue(), mr = (e) => {
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
}, hr = /*#__PURE__*/ l(2, (e, t) => e.mapUnsafe.size === 0 ? t : t.mapUnsafe.size === 0 ? e : gr(e, (e) => {
	t.mapUnsafe.forEach((t, n) => e.set(n, t));
})), gr = (e, t) => {
	if (e.mutable) return t(e.mapUnsafe), e;
	let n = new Map(e.mapUnsafe);
	return t(n), er(n);
}, P = Xn, _r = "~effect/time/Duration", vr = /*#__PURE__*/ BigInt(0), yr = /*#__PURE__*/ BigInt(1), br = /*#__PURE__*/ BigInt(1e3), xr = (e) => BigInt(e < 0 ? Math.ceil(e - .5) : Math.floor(e + .5)), Sr = (e) => xr(e * 1e6), Cr = (e, t) => e.includes(".") ? xr(Number(e) * Number(t)) : BigInt(e) * t, wr = /^(-?\d+(?:\.\d+)?)\s+(nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?)$/, Tr = (e) => {
	switch (typeof e) {
		case "number": return Ir(e);
		case "bigint": return Fr(e);
		case "string": {
			if (e === "Infinity") return Nr;
			if (e === "-Infinity") return Pr;
			let t = wr.exec(e);
			if (!t) break;
			let [n, r, i] = t;
			if (i === "nano" || i === "nanos") return Fr(Cr(r, yr));
			if (i === "micro" || i === "micros") return Fr(Cr(r, br));
			let a = Number(r);
			switch (i) {
				case "milli":
				case "millis": return Ir(a);
				case "second":
				case "seconds": return Lr(a);
				case "minute":
				case "minutes": return Rr(a);
				case "hour":
				case "hours": return zr(a);
				case "day":
				case "days": return Br(a);
				case "week":
				case "weeks": return Vr(a);
			}
			break;
		}
		case "object": {
			if (e === null) break;
			if (_r in e) return e;
			if (Array.isArray(e)) return e.length !== 2 || !e.every(x) ? Er(e) : Number.isNaN(e[0]) || Number.isNaN(e[1]) ? Mr : e[0] === -Infinity || e[1] === -Infinity ? Pr : e[0] === Infinity || e[1] === Infinity ? Nr : F(xr(e[0] * 1e9 + e[1]));
			let t = e, n = 0;
			return t.weeks && (n += t.weeks * 6048e5), t.days && (n += t.days * 864e5), t.hours && (n += t.hours * 36e5), t.minutes && (n += t.minutes * 6e4), t.seconds && (n += t.seconds * 1e3), t.milliseconds && (n += t.milliseconds), !t.microseconds && !t.nanoseconds ? F(n) : F(xr(n * 1e6 + (t.microseconds ?? 0) * 1e3 + (t.nanoseconds ?? 0)));
		}
	}
	return Er(e);
}, Er = (e) => {
	throw Error(`Invalid Input: ${e}`);
}, Dr = {
	_tag: "Millis",
	millis: 0
}, Or = { _tag: "Infinity" }, kr = { _tag: "NegativeInfinity" }, Ar = {
	[_r]: _r,
	[T]() {
		return le(this.value);
	},
	[O](e) {
		return jr(e) && qr(this, e);
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
	[qe]() {
		return this.toJSON();
	},
	pipe() {
		return o(this, arguments);
	}
}, F = (e) => {
	let t = Object.create(Ar);
	return typeof e == "number" ? isNaN(e) || e === 0 || Object.is(e, -0) ? t.value = Dr : Number.isFinite(e) ? Number.isInteger(e) ? t.value = {
		_tag: "Millis",
		millis: e
	} : t.value = {
		_tag: "Nanos",
		nanos: Sr(e)
	} : t.value = e > 0 ? Or : kr : e === vr ? t.value = Dr : t.value = {
		_tag: "Nanos",
		nanos: e
	}, t;
}, jr = (e) => w(e, _r), Mr = /*#__PURE__*/ F(0), Nr = /*#__PURE__*/ F(Infinity), Pr = /*#__PURE__*/ F(-Infinity), Fr = (e) => F(e), Ir = (e) => F(e), Lr = (e) => F(e * 1e3), Rr = (e) => F(e * 6e4), zr = (e) => F(e * 36e5), Br = (e) => F(e * 864e5), Vr = (e) => F(e * 6048e5), Hr = (e) => Wr(Tr(e), {
	onMillis: u,
	onNanos: (e) => Number(e) / 1e6,
	onInfinity: () => Infinity,
	onNegativeInfinity: () => -Infinity
}), Ur = (e) => {
	let t = Tr(e);
	switch (t.value._tag) {
		case "Infinity":
		case "NegativeInfinity": throw Error("Cannot convert infinite duration to nanos");
		case "Nanos": return t.value.nanos;
		case "Millis": return Sr(t.value.millis);
	}
}, Wr = /*#__PURE__*/ l(2, (e, t) => {
	switch (e.value._tag) {
		case "Millis": return t.onMillis(e.value.millis);
		case "Nanos": return t.onNanos(e.value.nanos);
		case "Infinity": return t.onInfinity();
		case "NegativeInfinity": return (t.onNegativeInfinity ?? t.onInfinity)();
	}
}), Gr = /*#__PURE__*/ l(3, (e, t, n) => e.value._tag === "Infinity" || e.value._tag === "NegativeInfinity" || t.value._tag === "Infinity" || t.value._tag === "NegativeInfinity" ? n.onInfinity(e, t) : e.value._tag === "Millis" ? t.value._tag === "Millis" ? n.onMillis(e.value.millis, t.value.millis) : n.onNanos(Ur(e), t.value.nanos) : n.onNanos(e.value.nanos, Ur(t))), Kr = (e, t) => Gr(e, t, {
	onMillis: (e, t) => e === t,
	onNanos: (e, t) => e === t,
	onInfinity: (e, t) => e.value._tag === t.value._tag
}), qr = /*#__PURE__*/ l(2, (e, t) => Kr(e, t)), Jr = /*#__PURE__*/ P("effect/Scheduler", { defaultValue: () => new Zr() }), Yr = "setImmediate" in globalThis ? (e) => {
	let t = globalThis.setImmediate(e);
	return () => globalThis.clearImmediate(t);
} : (e) => {
	let t = setTimeout(e, 0);
	return () => clearTimeout(t);
}, Xr = class {
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
}, Zr = class {
	executionMode;
	setImmediate;
	constructor(e = "async", t = Yr) {
		this.executionMode = e, this.setImmediate = t;
	}
	shouldYield(e) {
		return e.currentOpCount >= e.maxOpsBeforeYield;
	}
	makeDispatcher() {
		return new Qr(this.setImmediate);
	}
}, Qr = class {
	tasks = /*#__PURE__*/ new Xr();
	running = void 0;
	setImmediate;
	constructor(e = Yr) {
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
}, $r = /*#__PURE__*/ P("effect/Scheduler/MaxOpsBeforeYield", { defaultValue: () => 2048 }), ei = /*#__PURE__*/ P("effect/Scheduler/PreventSchedulerYield", { defaultValue: () => !1 }), ti = "effect/Tracer/ParentSpan", ni = class extends Xn()(ti) {}, ri = (e) => e, ii = /*#__PURE__*/ P("effect/Tracer/DisablePropagation", { defaultValue: p }), ai = /*#__PURE__*/ P("effect/Tracer/CurrentTraceLevel", { defaultValue: () => "Info" }), oi = /*#__PURE__*/ P("effect/Tracer/MinimumTraceLevel", { defaultValue: () => "All" }), si = "effect/Tracer", ci = /*#__PURE__*/ P(si, { defaultValue: () => ri({ span: (e) => new li(e) }) }), li = class {
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
		}, this.attributes = /* @__PURE__ */ new Map(), this.traceId = dn(e.parent)?.traceId ?? ui(32), this.spanId = ui(16);
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
}, ui = /*#__PURE__*/ function() {
	return function(e) {
		let t = "";
		for (let n = 0; n < e; n++) t += "abcdef0123456789".charAt(Math.floor(Math.random() * 16));
		return t;
	};
}(), di = "effect/observability/Metric/FiberRuntimeMetricsKey", fi = /*#__PURE__*/ P("effect/References/CurrentStackFrame", { defaultValue: m }), pi = /*#__PURE__*/ P("effect/References/TracerEnabled", { defaultValue: f }), mi = /*#__PURE__*/ P("effect/References/TracerTimingEnabled", { defaultValue: f }), hi = /*#__PURE__*/ P("effect/References/TracerSpanAnnotations", { defaultValue: () => ({}) }), gi = /*#__PURE__*/ P("effect/References/TracerSpanLinks", { defaultValue: () => [] }), _i = /*#__PURE__*/ P("effect/References/CurrentLogLevel", { defaultValue: () => "Info" }), vi = /*#__PURE__*/ P("effect/References/MinimumLogLevel", { defaultValue: () => "Info" }), yi = (e) => (t) => {
	let n;
	return () => {
		if (n !== void 0) return n;
		let r = t();
		if (!r) return;
		let i = r.split("\n");
		if (i[e] !== void 0) return n = i[e].trim(), n;
	};
}, bi = class extends mt {
	fiberId;
	constructor(e, t = ht) {
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
	[O](e) {
		return wt(e) && this.fiberId === e.fiberId && this.annotations === e.annotations;
	}
	[T]() {
		return ie(D(`${this._tag}:${this.fiberId}`))(re(this.annotations));
	}
}, xi = (e) => new ft([new bi(e)]), Si = (e) => {
	for (let t = 0; t < e.reasons.length; t++) {
		let n = e.reasons[t];
		if (n._tag === "Fail") return mn(n.error);
	}
	return hn(e);
}, Ci = (e) => e.reasons.some(wt), wi = /*#__PURE__*/ l(2, (e, t) => {
	if (e.reasons.length === 0) return t;
	if (t.reasons.length === 0) return e;
	let n = new ft(Dn(e.reasons, t.reasons));
	return k(e, n) ? e : n;
}), Ti = (e) => {
	let t = {
		Fail: [],
		Die: [],
		Interrupt: []
	};
	for (let n = 0; n < e.reasons.length; n++) t[e.reasons[n]._tag].push(e.reasons[n]);
	return t;
}, Ei = (e) => {
	let t = Ti(e);
	return t.Fail.length > 0 ? t.Fail[0].error : t.Die.length > 0 ? t.Die[0].defect : t.Interrupt.length > 0 ? new globalThis.Error("All fibers interrupted without error") : new globalThis.Error("Empty cause");
}, Di = "~effect/Fiber/dev", Oi = {
	_A: u,
	_E: u
}, ki = { id: 0 }, Ai = () => globalThis[Be], ji = class {
	constructor(e, t = !0) {
		this[Di] = Oi, this.setContext(e), this.id = ++ki.id, this.currentOpCount = 0, this.currentLoopCount = 0, this.interruptible = t, this._stack = [], this._observers = [], this._exit = void 0, this._children = void 0, this._interruptedCause = void 0, this._yielded = void 0, this.runtimeMetrics?.recordFiberStart(this.context);
	}
	[Di];
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
		return dr(this.context, e);
	}
	addObserver(e) {
		return this._exit ? (e(this._exit), h) : (this._observers.push(e), () => {
			let t = this._observers.indexOf(e);
			t >= 0 && this._observers.splice(t, 1);
		});
	}
	interruptUnsafe(e, t) {
		if (this._exit) return;
		let n = xi(e);
		this.currentStackFrame && (n = xt(n, or(At, this.currentStackFrame))), t && (n = xt(n, t)), this._interruptedCause = this._interruptedCause ? wi(this._interruptedCause, n) : n, this.interruptible && this.evaluate(zi(this._interruptedCause));
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
		if (t === it) return;
		let n = Mi.interruptChildren && Mi.interruptChildren(this);
		if (n !== void 0) return this.evaluate(z(n, () => t));
		this._exit = t, this.runtimeMetrics?.recordFiberEnd(this.context, this._exit);
		for (let e = 0; e < this._observers.length; e++) this._observers[e](t);
		this._observers.length = 0;
	}
	runLoop(e) {
		let t = globalThis[Be];
		globalThis[Be] = this;
		let n = !1, r = e;
		this.currentOpCount = 0;
		let i = ++this.currentLoopCount;
		try {
			for (;;) {
				if (this.currentOpCount++, !n && !this.currentPreventYield && this.currentScheduler.shouldYield(this)) {
					n = !0;
					let e = r;
					r = z(Vi, () => e);
				}
				if (r = this.currentTracerContext ? this.currentTracerContext(r, this) : r[M](this), i !== this.currentLoopCount) return it;
				if (r === it) {
					let e = this._yielded;
					return Qe in e ? (this._yielded = void 0, e) : it;
				}
			}
		} catch (e) {
			return w(r, M) ? this.runLoop(Nt(e)) : Nt(`Fiber.runLoop: Not a valid effect: ${String(r)}`);
		} finally {
			globalThis[Be] = t;
		}
	}
	getCont(e) {
		for (;;) {
			let t = this._stack.pop();
			if (!t) return;
			let n = t[rt] && t[rt](this);
			if (n) return n[e] = n, n;
			if (t[e]) return t;
		}
	}
	yieldWith(e) {
		return this._yielded = e, it;
	}
	children() {
		return this._children ??= /* @__PURE__ */ new Set();
	}
	pipe() {
		return o(this, arguments);
	}
	setContext(e) {
		this.context = e;
		let t = this.getRef(Jr);
		t !== this.currentScheduler && (this.currentScheduler = t, this._dispatcher = void 0), this.currentSpan = e.mapUnsafe.get(ti), this.currentLogLevel = this.getRef(_i), this.minimumLogLevel = this.getRef(vi), this.currentStackFrame = e.mapUnsafe.get(fi.key), this.maxOpsBeforeYield = this.getRef($r), this.currentPreventYield = this.getRef(ei), this.runtimeMetrics = e.mapUnsafe.get(di);
		let n = e.mapUnsafe.get(si);
		this.currentTracerContext = n ? n.context : void 0;
	}
	get currentSpanLocal() {
		return this.currentSpan?._tag === "Span" ? this.currentSpan : void 0;
	}
}, Mi = { interruptChildren: void 0 }, Ni = (e) => {
	if (!e.currentStackFrame) return;
	let t = /* @__PURE__ */ new Map();
	return t.set(At.key, e.currentStackFrame), er(t);
}, Pi = (e) => {
	let t = e;
	return t._exit ? I(t._exit) : Xi((n) => t._exit ? n(I(t._exit)) : L(e.addObserver((e) => n(I(e)))));
}, Fi = (e) => Xi((t) => {
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
		t(I(r));
	}
	return a(), L(() => i?.());
}), Ii = (e) => Pt((t) => Li(e, t.id)), Li = /*#__PURE__*/ l((e) => w(e[0], Di), (e, t, n) => Pt((r) => {
	let i = Ni(r);
	return i = i && n ? hr(i, n) : i ?? n, e.interruptUnsafe(t, i), la(Pi(e));
})), Ri = (e) => Pt((t) => {
	let n = Ni(t);
	for (let r of e) r.interruptUnsafe(t.id, n);
	return la(Fi(e));
}), I = kt, zi = jt, Bi = Mt, L = /*#__PURE__*/ Dt({
	op: "Sync",
	[M](e) {
		let t = this[j](), n = e.getCont(tt);
		return n ? n[tt](t, e) : e.yieldWith(kt(t));
	}
}), R = /*#__PURE__*/ Dt({
	op: "Suspend",
	[M](e) {
		return this[j]();
	}
}), Vi = /*#__PURE__*/ (/* @__PURE__ */ Dt({
	op: "Yield",
	[M](e) {
		let t = !1;
		return e.currentDispatcher.scheduleTask(() => {
			t || e.evaluate(ya);
		}, this[j] ?? 0), e.yieldWith(() => {
			t = !0;
		});
	}
}))(0), Hi = (e) => I(N(e)), Ui = /*#__PURE__*/ I(/*#__PURE__*/ cn()), Wi = (e) => Nt(e), Gi = (e) => R(() => Bi(Xe(e))), Ki = /*#__PURE__*/ I(void 0), qi = (e) => {
	let t = typeof e == "function" ? e : e.try, n = typeof e == "function" ? (e) => new Bo(e, "An error occurred in Effect.tryPromise") : e.catch;
	return Ji(function(e, r) {
		try {
			Xe(() => t(r)).then((t) => e(I(t)), (t) => e(Bi(Xe(() => n(t)))));
		} catch (t) {
			e(Bi(Xe(() => n(t))));
		}
	}, eval.length !== 0);
}, Ji = /*#__PURE__*/ Dt({
	op: "Async",
	single: !1,
	[M](e) {
		let t = Xe(() => this[j][0].bind(e.currentScheduler)), n = !1, r = !1, i = this[j][1] ? new AbortController() : void 0, a = t((t) => {
			n || (n = !0, r ? e.evaluate(t) : r = t);
		}, i?.signal);
		return r === !1 ? (r = !0, e._yielded = () => {
			n = !0;
		}, i === void 0 && a === void 0 || e._stack.push(Yi(() => (n = !0, i?.abort(), a ?? ya))), it) : r;
	}
}), Yi = /*#__PURE__*/ Dt({
	op: "AsyncFinalizer",
	[rt](e) {
		e.interruptible && (e.interruptible = !1, e._stack.push(so));
	},
	[nt](e, t) {
		return Ci(e) ? z(this[j](), () => zi(e)) : zi(e);
	}
}), Xi = (e) => Ji(e, e.length >= 2), Zi = (...e) => R(() => aa(e.length === 1 ? e[0]() : e[1].call(e[0].self))), Qi = (e, ...t) => {
	let n = t.length === 0 ? function() {
		return R(() => aa(e.apply(this, arguments)));
	} : function() {
		let n = R(() => aa(e.apply(this, arguments)));
		for (let e = 0; e < t.length; e++) n = t[e](n, ...arguments);
		return n;
	};
	return $i(e.length, n);
}, $i = (e, t) => Object.defineProperty(t, "length", {
	value: e,
	configurable: !0
}), ea = /*#__PURE__*/ yi(2), ta = function() {
	let e = typeof arguments[0] == "string", t = e ? arguments[0] : "Effect.fn", n = e ? arguments[1] : void 0, r = globalThis.Error.stackTraceLimit;
	globalThis.Error.stackTraceLimit = 2;
	let i = new globalThis.Error();
	return globalThis.Error.stackTraceLimit = r, e ? (r, ...a) => na(t, r, i, a, e, n) : na(t, arguments[0], i, Array.prototype.slice.call(arguments, 1), e, n);
}, na = (e, t, n, r, i, a) => {
	let o = typeof t == "function" ? t : r.pop().bind(t.self);
	return $i(o.length, function(...t) {
		let s = R(() => {
			let e = o.apply(this, arguments);
			return st(e) ? e : aa(e);
		});
		for (let e = 0; e < r.length; e++) s = r[e](s, ...t);
		if (!st(s)) return s;
		let c = globalThis.Error.stackTraceLimit;
		globalThis.Error.stackTraceLimit = 2;
		let l = new globalThis.Error();
		return globalThis.Error.stackTraceLimit = c, Ta(i ? Ao(e, a, (e) => jo(s, e)) : s, fi, (t) => ({
			name: e,
			stack: ea(() => l.stack),
			parent: {
				name: `${e} (definition)`,
				stack: ea(() => n.stack),
				parent: t
			}
		}));
	});
}, ra = (e, ...t) => $i(e.length, t.length === 0 ? function() {
	return ia(() => e.apply(this, arguments));
} : function() {
	let n = ia(() => e.apply(this, arguments));
	for (let e of t) n = e(n);
	return n;
}), ia = (e) => {
	try {
		let t = e(), n;
		for (;;) {
			let r = t.next(n);
			if (r.done) return I(r.value);
			let i = r.value;
			if (i && i._tag === "Success") {
				n = i.value;
				continue;
			} else if (i && i._tag === "Failure") return r.value;
			else {
				let n = !0;
				return R(() => n ? (n = !1, z(r.value, (e) => aa(t, e))) : R(() => aa(e())));
			}
		}
	} catch (e) {
		return Wi(e);
	}
}, aa = /*#__PURE__*/ Dt({
	op: "Iterator",
	single: !1,
	[tt](e, t) {
		let n = this[j][0];
		for (;;) {
			let r = n.next(e);
			if (r.done) return I(r.value);
			if (!da(r.value)) return t._stack.push(this), r.value;
			if (r.value._tag === "Failure") return r.value;
			e = r.value.value;
		}
	},
	[M](e) {
		return this[tt](this[j][1], e);
	}
}), oa = /*#__PURE__*/ l(2, (e, t) => {
	let n = I(t);
	return z(e, (e) => n);
}), sa = /*#__PURE__*/ l(2, (e, t) => z(e, (e) => st(t) ? t : Xe(() => t(e)))), ca = /*#__PURE__*/ l(2, (e, t) => z(e, (e) => oa(st(t) ? t : Xe(() => t(e)), e))), la = (e) => z(e, (e) => ya), z = /*#__PURE__*/ l(2, (e, t) => {
	let n = Object.create(ua);
	return n[j] = e, n[tt] = t.length === 1 ? t : (e) => t(e), n;
}), ua = /*#__PURE__*/ Et({
	op: "OnSuccess",
	[M](e) {
		return e._stack.push(this), this[j];
	}
}), da = (e) => Qe in e, fa = /*#__PURE__*/ l(2, (e, t) => da(e) ? e._tag === "Success" ? t(e.value) : e : z(e, t)), pa = (e) => z(e, u), ma = /*#__PURE__*/ l(2, (e, t) => z(e, (e) => I(Xe(() => t(e))))), ha = /*#__PURE__*/ l(2, (e, t) => da(e) ? ba(e, t) : ma(e, t)), ga = /*#__PURE__*/ l(2, (e, t) => da(e) ? xa(e, t) : Pa(e, t)), _a = /*#__PURE__*/ l(2, (e, t) => {
	if (da(e)) {
		if (e._tag === "Success") return e;
		let n = Si(e.cause);
		return gn(n) ? e : t(n.success);
	}
	return Na(e, t);
}), va = (e) => e._tag === "Success", ya = /*#__PURE__*/ kt(void 0), ba = /*#__PURE__*/ l(2, (e, t) => e._tag === "Success" ? kt(t(e.value)) : e), xa = /*#__PURE__*/ l(2, (e, t) => {
	if (e._tag === "Success") return e;
	let n = Si(e.cause);
	return gn(n) ? e : Mt(t(n.success));
}), Sa = (e) => {
	let t = [];
	for (let n of e) n._tag === "Failure" && t.push(...n.cause.reasons);
	return t.length === 0 ? ya : jt(_t(t));
}, Ca = (e) => va(e) ? N(e.value) : cn(), wa = /*#__PURE__*/ l(2, (e, t) => Pt((n) => {
	let r = n.context, i = t(r);
	return r === i ? e : (n.setContext(i), ao(e, () => {
		n.setContext(r);
	}));
})), Ta = /*#__PURE__*/ l(3, (e, t, n) => wa(e, (e) => {
	let r = lr(e, t), i = n(r);
	return r === i ? e : sr(e, t, i);
})), Ea = (e) => Pt((t) => e(t.context)), Da = /*#__PURE__*/ l(2, (e, t) => da(e) ? e : wa(e, hr(t))), Oa = function() {
	return arguments.length === 1 ? l(2, (e, t) => ka(e, arguments[0], t)) : l(3, (e, t, n) => ka(e, t, n)).apply(this, arguments);
}, ka = (e, t, n) => wa(e, (e) => e.mapUnsafe.get(t.key) === n ? e : sr(e, t, n)), Aa = /*#__PURE__*/ l(2, (e, t) => {
	let n = Object.create(ja);
	return n[j] = e, n[nt] = t.length === 1 ? t : (e) => t(e), n;
}), ja = /*#__PURE__*/ Et({
	op: "OnFailure",
	[M](e) {
		return e._stack.push(this), this[j];
	}
}), Ma = /*#__PURE__*/ l(3, (e, t, n) => Aa(e, (e) => {
	let r = t(e);
	return gn(r) ? zi(r.failure) : Xe(() => n(r.success, e));
})), Na = /*#__PURE__*/ l(2, (e, t) => Ma(e, Si, (e) => t(e))), Pa = /*#__PURE__*/ l(2, (e, t) => Na(e, (e) => Gi(() => t(e)))), Fa = (e) => Na(e, Wi), Ia = (e) => Va(e, {
	onFailure: hn,
	onSuccess: mn
}), La = /*#__PURE__*/ l(2, (e, t) => {
	let n = Object.create(Ra);
	return n[j] = e, n[tt] = t.onSuccess.length === 1 ? t.onSuccess : (e) => t.onSuccess(e), n[nt] = t.onFailure.length === 1 ? t.onFailure : (e) => t.onFailure(e), n;
}), Ra = /*#__PURE__*/ Et({
	op: "OnSuccessAndFailure",
	[M](e) {
		return e._stack.push(this), this[j];
	}
}), za = /*#__PURE__*/ l(2, (e, t) => La(e, {
	onFailure: (e) => {
		let n = e.reasons.find(St);
		return n ? Xe(() => t.onFailure(n.error)) : zi(e);
	},
	onSuccess: t.onSuccess
})), Ba = /*#__PURE__*/ l(2, (e, t) => za(e, {
	onFailure: (e) => L(() => t.onFailure(e)),
	onSuccess: (e) => L(() => t.onSuccess(e))
})), Va = /*#__PURE__*/ l(2, (e, t) => {
	if (da(e)) {
		if (e._tag === "Success") return kt(t.onSuccess(e.value));
		let n = Si(e.cause);
		return gn(n) ? e : kt(t.onFailure(n.success));
	}
	return Ba(e, t);
}), Ha = (e) => da(e) ? kt(e) : Ua(e), Ua = /*#__PURE__*/ Dt({
	op: "Exit",
	[M](e) {
		return e._stack.push(this), this[j];
	},
	[tt](e, t, n) {
		return I(n ?? kt(e));
	},
	[nt](e, t, n) {
		return I(n ?? jt(e));
	}
}), Wa = "~effect/Scope", Ga = "~effect/Scope/Closeable", Ka = /*#__PURE__*/ Xn("effect/Scope"), qa = (e, t) => R(() => Ja(e, t) ?? Ki), Ja = (e, t) => {
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
	if (e.state = n, r.size !== 0) return r.size === 1 ? r.values().next().value(t) : Ya(e, r, t);
}, Ya = /*#__PURE__*/ Qi(function* (e, t, n) {
	let r = [], i = [], a = Array.from(t.values()), o = Ai();
	for (let t = a.length - 1; t >= 0; t--) {
		let s = a[t];
		e.strategy === "sequential" ? r.push(yield* Ha(s(n))) : i.push(uo(o, s(n), !0, !0, "inherit"));
	}
	return i.length > 0 && (r = yield* Fi(i)), yield* Sa(r);
}), Xa = (e, t) => {
	let n = eo(t);
	if (e.state._tag === "Closed") return n.state = e.state, n;
	let r = {};
	return Qa(e, r, (e) => qa(n, e)), Qa(n, r, (t) => L(() => $a(e, r))), n;
}, Za = (e, t) => R(() => e.state._tag === "Closed" ? t(e.state.exit) : (Qa(e, {}, t), Ki)), Qa = (e, t, n) => {
	e.state._tag === "Empty" ? e.state = {
		_tag: "Open",
		finalizers: /* @__PURE__ */ new Map([[t, n]])
	} : e.state._tag === "Open" && e.state.finalizers.set(t, n);
}, $a = (e, t) => {
	e.state._tag === "Open" && e.state.finalizers.delete(t);
}, eo = (e = "sequential") => ({
	[Ga]: Ga,
	[Wa]: Wa,
	strategy: e,
	state: to
}), to = { _tag: "Empty" }, no = Ka, ro = /*#__PURE__*/ Oa(Ka), io = (e) => z(no, (t) => Ea((n) => Za(t, (t) => Da(e(t), n)))), ao = /*#__PURE__*/ Dt({
	op: "OnExit",
	single: !1,
	[M](e) {
		return e._stack.push(this), this[j][0];
	},
	[rt](e) {
		e.interruptible && this[j][2] !== !0 && (e._stack.push(so), e.interruptible = !1);
	},
	[tt](e, t, n) {
		n ??= kt(e);
		let r = this[j][1](n);
		return r ? z(r, (e) => n) : n;
	},
	[nt](e, t, n) {
		n ??= jt(e);
		let r = this[j][1](n);
		return r ? z(r, (e) => n) : n;
	}
}), oo = /*#__PURE__*/ l(2, ao), so = /*#__PURE__*/ (/* @__PURE__ */ Dt({
	op: "SetInterruptible",
	[rt](e) {
		if (e.interruptible = this[j], e._interruptedCause && e.interruptible) return () => zi(e._interruptedCause);
	}
}))(!0), co = (e) => {
	let t = e.onItem, n = e.step;
	return (e, r, i) => {
		let a = i?.start ?? 0, o = i?.end ?? r.length, s = i?.concurrency ?? 1, c = !1, l, u, d, f = !1, p, m, h = () => {
			let i = !1;
			for (; !p && a < o; a++) {
				let o = r[a], g = m ?? t(e, o, a);
				if (da(g)) {
					if (p = n(e, o, g, a), p) break;
				} else if (s === 1) return z(Ha(g), (t) => (p = n(e, o, t, a), a++, p ?? h() ?? Ki));
				else if (l) {
					m = void 0;
					let t = uo(l, g, !0, !0, "inherit");
					if (t._exit) {
						if (p = n(e, o, t._exit, a), p) break;
						continue;
					}
					u ? u.add(t) : u = /* @__PURE__ */ new Set([t]);
					let r = a;
					if (t.addObserver((a) => {
						if (u.delete(t), p) {
							if (!f && a._tag === "Failure") for (let e of a.cause.reasons) if (e._tag === "Interrupt") continue;
							else p._tag === "Failure" ? p.cause.reasons.push(e) : p = jt(_t([e]));
						} else {
							let t = n(e, o, a, r);
							t && (p = t._tag === "Failure" ? jt(_t(t.cause.reasons.slice())) : t, h());
						}
						if (i) {
							let e = h();
							e && d(e);
						} else c && u.size === 0 && d(p ?? Ki);
					}), u.size < s) continue;
					i = !0, a++;
					return;
				} else return Xi((e) => {
					l = Ai(), m = g, d = e;
					let t = h();
					return t ? e(t) : R(() => (p = ya, f = !0, u ? Ri(u) : Ki));
				});
			}
			if (c = !0, p) {
				if (u && u.size > 0) {
					let e = Ni(l);
					u.forEach((t) => t.interruptUnsafe(l.id, e));
					return;
				}
				if (d || p._tag === "Failure") return p;
			} else if (d) if (u) u.size === 0 && d(Ki);
			else return ya;
		};
		return h();
	};
}, lo = () => co, uo = (e, t, n = !1, r = !1, i = !1) => {
	let a = i === "inherit" ? e.interruptible : !i, o = new ji(e.context, a);
	return n ? o.evaluate(t) : e.currentDispatcher.scheduleTask(() => o.evaluate(t), 0), !r && !o._exit && (e.children().add(o), o.addObserver(() => e._children.delete(o))), o;
}, fo = (e) => (t, n) => {
	let r = new ji(n?.scheduler ? sr(e, Jr, n.scheduler) : e, n?.uninterruptible !== !0);
	if (r.evaluate(t), r._exit) return r;
	if (n?.signal) if (n.signal.aborted) r.interruptUnsafe();
	else {
		let e = () => r.interruptUnsafe();
		n.signal.addEventListener("abort", e, { once: !0 }), r.addObserver(() => n.signal.removeEventListener("abort", e));
	}
	return n?.onFiberStart && n.onFiberStart(r), r;
}, po = /*#__PURE__*/ l(2, (e, t) => {
	if (e._exit) return e;
	if (t.state._tag === "Closed") return e.interruptUnsafe(e.id), e;
	let n = {};
	return Qa(t, n, () => Ii(e)), e.addObserver(() => $a(t, n)), e;
}), mo = /*#__PURE__*/ fo(/*#__PURE__*/ ir()), ho = (e) => {
	let t = fo(e);
	return (e, n) => {
		let r = t(e, n);
		return n?.onExit && r.addObserver(n.onExit), (e) => r.interruptUnsafe(e);
	};
}, go = /*#__PURE__*/ ho(/*#__PURE__*/ ir()), _o = (e) => {
	let t = fo(e);
	return (e, n) => {
		let r = t(e, n);
		return new Promise((e) => {
			r.addObserver((t) => e(t));
		});
	};
}, vo = /*#__PURE__*/ _o(/*#__PURE__*/ ir()), yo = (e) => {
	let t = _o(e);
	return (e, n) => t(e, n).then((e) => {
		if (e._tag === "Failure") throw Ei(e.cause);
		return e.value;
	});
}, bo = /*#__PURE__*/ yo(/*#__PURE__*/ ir()), xo = (e) => {
	let t = fo(e);
	return (e) => {
		if (da(e)) return e;
		let n = new Zr("sync"), r = t(e, { scheduler: n });
		return r.currentDispatcher?.flush(), r._exit ?? Nt(new Ro(r));
	};
}, So = /*#__PURE__*/ xo(/*#__PURE__*/ ir()), Co = (e) => {
	let t = xo(e);
	return (e) => {
		let n = t(e);
		if (n._tag === "Failure") throw Ei(n.cause);
		return n.value;
	};
}, wo = /*#__PURE__*/ Co(/*#__PURE__*/ ir()), To = /*#__PURE__*/ BigInt(0), Eo = {
	_tag: "Span",
	spanId: "noop",
	traceId: "noop",
	sampled: !1,
	status: {
		_tag: "Ended",
		startTime: To,
		endTime: To,
		exit: ya
	},
	attributes: /*#__PURE__*/ new Map(),
	links: [],
	kind: "internal",
	attribute() {},
	event() {},
	end() {},
	addLinks() {}
}, Do = (e) => Object.assign(Object.create(Eo), e), Oo = (e) => e ? ur(e.annotations, ii) ? e._tag === "Span" ? Oo(dn(e.parent)) : cn() : N(e) : cn(), ko = (e, t, n) => {
	let r = !e.getRef(pi) || n?.annotations && ur(n.annotations, ii), i = n?.parent === void 0 ? n?.root ? cn() : Oo(e.currentSpan) : N(n.parent), a;
	if (r) a = Do({
		name: t,
		parent: i,
		annotations: sr(n?.annotations ?? ir(), ii, !0)
	});
	else {
		let r = e.getRef(ci), o = e.getRef(Mo), s = e.getRef(mi), c = e.getRef(hi), l = e.getRef(gi), u = n?.level ?? e.getRef(ai), d = n?.links === void 0 ? l.slice() : [...l, ...n.links];
		a = r.span({
			name: t,
			parent: i,
			annotations: n?.annotations ?? ir(),
			links: d,
			startTime: s ? o.currentTimeNanosUnsafe() : BigInt(0),
			kind: n?.kind ?? "internal",
			root: n?.root ?? ln(i),
			sampled: n?.sampled ?? (un(i) && i.value.sampled === !1 ? !1 : !Vo(e.getRef(oi), u))
		});
		for (let [e, t] of Object.entries(c)) a.attribute(e, t);
		if (n?.attributes !== void 0) for (let [e, t] of Object.entries(n.attributes)) a.attribute(e, t);
	}
	return a;
}, Ao = (e, ...t) => {
	let n = t.length === 1 ? void 0 : t[0], r = t[t.length - 1];
	return Pt((t) => {
		let i = ko(t, e, n), a = t.getRef(Mo);
		return oo(Xe(() => r(i)), (e) => L(() => {
			i.status._tag !== "Ended" && i.end(a.currentTimeNanosUnsafe(), e);
		}));
	});
}, jo = /*#__PURE__*/ Oa(ni), Mo = /*#__PURE__*/ P("effect/Clock", { defaultValue: () => new Po() }), No = 2 ** 31 - 1, Po = class {
	currentTimeMillisUnsafe() {
		return Date.now();
	}
	currentTimeMillis = /*#__PURE__*/ L(() => this.currentTimeMillisUnsafe());
	currentTimeNanosUnsafe() {
		return Io();
	}
	currentTimeNanos = /*#__PURE__*/ L(() => this.currentTimeNanosUnsafe());
	sleep(e) {
		let t = Hr(e);
		return t <= 0 ? Vi : Xi((e) => {
			if (t > No) return;
			let n = setTimeout(() => e(Ki), t);
			return L(() => clearTimeout(n));
		});
	}
}, Fo = /*#__PURE__*/ function() {
	let e = /*#__PURE__*/ BigInt(1e6);
	if (typeof performance > "u" || performance.now === void 0) return () => BigInt(Date.now()) * e;
	if (typeof performance.timeOrigin == "number" && performance.timeOrigin === 0) return () => BigInt(Math.round(performance.now() * 1e6));
	let t = /*#__PURE__*/ BigInt(/*#__PURE__*/ Date.now()) * e - /*#__PURE__*/ BigInt(/*#__PURE__*/ Math.round(/*#__PURE__*/ performance.now() * 1e6));
	return () => t + BigInt(Math.round(performance.now() * 1e6));
}(), Io = /*#__PURE__*/ function() {
	let e = typeof process == "object" && "hrtime" in process && typeof process.hrtime.bigint == "function" ? process.hrtime : void 0;
	if (!e) return Fo;
	let t = /*#__PURE__*/ Fo() - /*#__PURE__*/ e.bigint();
	return () => t + e.bigint();
}();
Lt("TimeoutError"), Lt("IllegalArgumentError"), Lt("ExceededCapacityError");
var Lo = "~effect/Cause/AsyncFiberError", Ro = class extends Lt("AsyncFiberError") {
	[Lo] = Lo;
	constructor(e) {
		super({
			message: "An asynchronous Effect was executed with Effect.runSync",
			fiber: e
		});
	}
}, zo = "~effect/Cause/UnknownError", Bo = class extends Lt("UnknownError") {
	[zo] = zo;
	constructor(e, t) {
		super({
			message: t,
			cause: e
		});
	}
}, Vo = /*#__PURE__*/ sn(/* @__PURE__ */ on(an, (e) => {
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
})), Ho = {
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
Ho.gray, Ho.blue, Ho.green, Ho.yellow, Ho.red, Ho.bgBrightRed, Ho.black;
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Cause.js
var Uo = Si;
Xn()("effect/Cause/StackTrace"), Xn()("effect/Cause/InterruptorStackTrace");
var Wo = Lt, Go = Mt, Ko = ya, qo = Ca, Jo = {
	"~effect/Deferred": {
		_A: u,
		_E: u
	},
	pipe() {
		return o(this, arguments);
	}
}, Yo = () => {
	let e = Object.create(Jo);
	return e.resumes = void 0, e.effect = void 0, e;
}, Xo = (e) => Xi((t) => e.effect ? t(e.effect) : (e.resumes ??= [], e.resumes.push(t), L(() => {
	let n = e.resumes.indexOf(t);
	e.resumes.splice(n, 1);
}))), Zo = /* @__PURE__ */ l(2, (e, t) => L(() => Qo(e, t))), Qo = (e, t) => {
	if (e.effect) return !1;
	if (e.effect = t, e.resumes) {
		for (let n = 0; n < e.resumes.length; n++) e.resumes[n](t);
		e.resumes = void 0;
	}
	return !0;
}, $o = eo, es = ro, ts = Xa, ns = qa, rs = "~effect/Layer", is = "~effect/Layer/MemoMap", as = (e, t) => (e.observers++, sa(Za(t, (t) => e.finalizer(t)), e.effect)), os = {
	[rs]: {
		_ROut: u,
		_E: u,
		_RIn: u
	},
	pipe() {
		return o(this, arguments);
	}
}, ss = (e) => {
	let t = Object.create(os);
	return t.build = e, t;
}, cs = (e) => ss((t, n) => {
	let r = ts(n);
	return oo(e(t, r), (e) => e._tag === "Failure" ? ns(r, e) : Ki);
}), ls = (e) => {
	let t = cs((n, r) => n.getOrElseMemoize(t, r, e));
	return t;
}, us = (e, t, n, r) => {
	let i = $o(), a = Yo(), o = {
		observers: 1,
		effect: Xo(a),
		finalizer: (n) => R(() => (o.observers--, o.observers === 0 ? (e.map.delete(t), ns(i, n)) : Ki))
	};
	return e.map.set(t, o), Za(n, o.finalizer).pipe(z(() => r(e, i)), oo((e) => (o.effect = e, Zo(a, e))));
}, ds = class {
	get [is]() {
		return is;
	}
	parent;
	constructor(e) {
		this.parent = e;
	}
	map = /*#__PURE__*/ new Map();
	get(e, t) {
		let n = this.map.get(e);
		return n ? as(n, t) : this.parent?.get(e, t);
	}
	getOrElseMemoize(e, t, n) {
		return this.get(e, t) || us(this, e, t, n);
	}
}, fs = () => new ds(), ps = class extends Xn()("effect/Layer/CurrentMemoMap") {
	static getOrCreate = /*#__PURE__*/ cr(this, fs);
}, ms = /*#__PURE__*/ l(3, (e, t, n) => Oa(ma(e.build(t, n), sr(ps, t)), ps, t)), hs = function() {
	return arguments.length === 1 ? (e) => gs(arguments[0], e) : gs(arguments[0], arguments[1]);
}, gs = (e, t) => _s(ma(t, (t) => or(e, t))), _s = (e) => ls((t, n) => es(e, n)), vs = "~effect/time/DateTime", ys = "~effect/time/DateTime/TimeZone", bs = {
	[vs]: vs,
	pipe() {
		return o(this, arguments);
	},
	[qe]() {
		return this.toString();
	},
	toJSON() {
		return Ss(this).toJSON();
	}
};
({ ...bs }), { ...bs };
var xs = {
	[ys]: ys,
	[qe]() {
		return this.toString();
	}
};
({ ...xs }), { ...xs };
var Ss = (e) => new Date(e.epochMilliseconds), Cs = qi, ws = I, Ts = Ui, Es = Hi, Ds = R, Os = L, ks = Zi, B = Bi, As = Wi, js = Pt, Ms = z, Ns = pa, Ps = ca, Fs = Ia, Is = Ha, Ls = Fa, Rs = Da, zs = io, Bs = mo, Vs = fo, Hs = ho, Us = go, Ws = bo, Gs = yo, Ks = vo, qs = _o, Js = wo, Ys = Co, Xs = So, Zs = xo, Qs = ta;
Xn()("effect/Effect/Transaction");
var $s = ha, ec = ga, tc = fa, nc = _a, rc = ra;
Xn()("effect/DateTime/CurrentTimeZone"), Wo("EncodingError");
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/schema/annotations.js
function ic(e) {
	return e.checks ? e.checks[e.checks.length - 1].annotations : e.annotations;
}
function ac(e) {
	return (t) => ic(t)?.[e];
}
var oc = /*#__PURE__*/ ac("identifier"), sc = /*#__PURE__*/ _((e) => {
	let t = oc(e);
	return typeof t == "string" ? t : e.getExpected(sc);
});
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/record.js
function cc(e, t, n) {
	return t === "__proto__" ? Object.defineProperty(e, t, {
		value: n,
		writable: !0,
		enumerable: !0,
		configurable: !0
	}) : e[t] = n, e;
}
globalThis.RegExp;
var lc = (e) => e.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&"), uc = "~effect/SchemaIssue/Issue";
function dc(e) {
	return w(e, uc);
}
var fc = class {
	[uc] = uc;
	toString() {
		return Mc(this);
	}
}, pc = class extends fc {
	_tag = "Filter";
	actual;
	filter;
	issue;
	constructor(e, t, n) {
		super(), this.actual = e, this.filter = t, this.issue = n;
	}
}, mc = class extends fc {
	_tag = "Encoding";
	ast;
	actual;
	issue;
	constructor(e, t, n) {
		super(), this.ast = e, this.actual = t, this.issue = n;
	}
}, hc = class extends fc {
	_tag = "Pointer";
	path;
	issue;
	constructor(e, t) {
		super(), this.path = e, this.issue = t;
	}
}, gc = class extends fc {
	_tag = "MissingKey";
	annotations;
	constructor(e) {
		super(), this.annotations = e;
	}
}, _c = class extends fc {
	_tag = "UnexpectedKey";
	ast;
	actual;
	constructor(e, t) {
		super(), this.ast = e, this.actual = t;
	}
}, vc = class extends fc {
	_tag = "Composite";
	ast;
	actual;
	issues;
	constructor(e, t, n) {
		super(), this.ast = e, this.actual = t, this.issues = n;
	}
}, yc = class extends fc {
	_tag = "InvalidType";
	ast;
	actual;
	constructor(e, t) {
		super(), this.ast = e, this.actual = t;
	}
}, bc = class extends fc {
	_tag = "InvalidValue";
	actual;
	annotations;
	constructor(e, t) {
		super(), this.actual = e, this.annotations = t;
	}
}, xc = class extends fc {
	_tag = "AnyOf";
	ast;
	actual;
	issues;
	constructor(e, t, n) {
		super(), this.ast = e, this.actual = t, this.issues = n;
	}
}, Sc = class extends fc {
	_tag = "OneOf";
	ast;
	actual;
	successes;
	constructor(e, t, n) {
		super(), this.ast = e, this.actual = t, this.successes = n;
	}
};
function Cc(e, t) {
	if (dc(t)) return t;
	if (typeof t == "string") return new bc(N(e), { message: t });
	let n = typeof t.issue == "string" ? new bc(N(e), { message: t.issue }) : t.issue;
	return new hc(t.path, n);
}
function wc(e, t) {
	if (t !== void 0) return typeof t == "boolean" ? t ? void 0 : new bc(N(e)) : Cc(e, t);
}
function Tc(e, t, n) {
	return Array.isArray(n) ? Sn(n) ? n.length === 1 ? Cc(e, n[0]) : new vc(t, N(e), kn(n, (t) => Cc(e, t))) : void 0 : wc(e, n);
}
var Ec = (e) => {
	let t = Pc(e);
	if (t !== void 0) return t;
	switch (e._tag) {
		case "InvalidType": return Oc(sc(e.ast), Ic(e.actual));
		case "InvalidValue": return `Invalid data ${Ic(e.actual)}`;
		case "MissingKey": return "Missing key";
		case "UnexpectedKey": return `Unexpected key with value ${A(e.actual)}`;
		case "Forbidden": return "Forbidden operation";
		case "OneOf": return `Expected exactly one member to match the input ${A(e.actual)}`;
	}
}, Dc = (e) => Pc(e.issue) ?? Pc(e);
function Oc(e, t) {
	return `Expected ${e}, got ${t}`;
}
function kc(e, t, n, r) {
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
					message: Oc(Ac(e.filter), A(e.actual))
				}];
				default: return kc(e.issue, t, n, r);
			}
		}
		case "Encoding": return kc(e.issue, t, n, r);
		case "Pointer": return kc(e.issue, [...t, ...e.path], n, r);
		case "Composite": return e.issues.flatMap((e) => kc(e, t, n, r));
		case "AnyOf": {
			let i = Pc(e);
			return e.issues.length === 0 ? i === void 0 ? [{
				path: t,
				message: Oc(sc(e.ast), A(e.actual))
			}] : [{
				path: t,
				message: i
			}] : e.issues.flatMap((e) => kc(e, t, n, r));
		}
		default: return [{
			path: t,
			message: n(e)
		}];
	}
}
function Ac(e) {
	let t = e.annotations?.expected;
	if (typeof t == "string") return t;
	switch (e._tag) {
		case "Filter": return "<filter>";
		case "FilterGroup": return e.checks.map((e) => Ac(e)).join(" & ");
	}
}
function jc() {
	return (e) => kc(e, [], Ec, Dc).map(Nc).join("\n");
}
var Mc = /*#__PURE__*/ jc();
function Nc(e) {
	let t = e.message;
	if (e.path && e.path.length > 0) {
		let n = We(e.path);
		t += `\n  at ${n}`;
	}
	return t;
}
function Pc(e) {
	switch (e._tag) {
		case "InvalidType":
		case "OneOf":
		case "Composite":
		case "AnyOf": return Fc(e.ast.annotations);
		case "InvalidValue":
		case "Forbidden": return Fc(e.annotations);
		case "MissingKey": return Fc(e.annotations, "messageMissingKey");
		case "UnexpectedKey": return Fc(e.ast.annotations, "messageUnexpectedKey");
		case "Filter": return Fc(e.filter.annotations);
		case "Encoding": return Pc(e.issue);
	}
}
function Fc(e, t = "message") {
	let n = e?.[t];
	if (typeof n == "string") return n;
}
function Ic(e) {
	return ln(e) ? "no value provided" : A(e.value);
}
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/SchemaGetter.js
var Lc = class e extends c {
	run;
	constructor(e) {
		super(), this.run = e;
	}
	map(t) {
		return new e((e, n) => this.run(e, n).pipe($s(fn(t))));
	}
	compose(t) {
		return zc(this) ? t : zc(t) ? this : new e((e, n) => this.run(e, n).pipe(tc((e) => t.run(e, n))));
	}
}, Rc = /*#__PURE__*/ new Lc(ws);
function zc(e) {
	return e.run === Rc.run;
}
function Bc() {
	return Rc;
}
function Vc(e) {
	return Hc(fn(e));
}
function Hc(e) {
	return new Lc((t) => ws(e(t)));
}
function Uc(e) {
	return new Lc((t) => {
		let n = pn(t, C);
		return un(n) ? ws(n) : $s(e, N);
	});
}
function Wc() {
	return Vc(globalThis.String);
}
function Gc() {
	return Vc(globalThis.Number);
}
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/SchemaTransformation.js
var Kc = "~effect/SchemaTransformation/Transformation", qc = class e {
	[Kc] = Kc;
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
function Jc(e) {
	return w(e, Kc);
}
var Yc = (e) => Jc(e) ? e : new qc(e.decode, e.encode), Xc = /*#__PURE__*/ new qc(/*#__PURE__*/ Bc(), /*#__PURE__*/ Bc());
function Zc() {
	return Xc;
}
var Qc = /*#__PURE__*/ new qc(/*#__PURE__*/ Gc(), /*#__PURE__*/ Wc());
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/SchemaAST.js
function $c(e) {
	return (t) => t._tag === e;
}
var el = /*#__PURE__*/ $c("Declaration"), tl = /*#__PURE__*/ $c("Never"), nl = /*#__PURE__*/ $c("Literal"), rl = /*#__PURE__*/ $c("UniqueSymbol"), il = /*#__PURE__*/ $c("Arrays"), al = /*#__PURE__*/ $c("Objects"), ol = /*#__PURE__*/ $c("Union"), sl = class {
	to;
	transformation;
	constructor(e, t) {
		this.to = e, this.transformation = t;
	}
}, cl = {}, ll = class {
	isOptional;
	isMutable;
	defaultValue;
	annotations;
	constructor(e, t, n = void 0, r = void 0) {
		this.isOptional = e, this.isMutable = t, this.defaultValue = n, this.annotations = r;
	}
}, ul = "~effect/Schema", dl = class {
	[ul] = ul;
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
}, fl = class e extends dl {
	_tag = "Declaration";
	typeParameters;
	run;
	encodingChecks;
	constructor(e, t, n, r, i, a, o) {
		super(n, r, i, a), this.typeParameters = e, this.run = t, this.encodingChecks = o;
	}
	getParser() {
		let e = this.run(this.typeParameters);
		return (t, n) => ln(t) ? Ts : $s(e(t.value, this, n), N);
	}
	rebuild(t, n, r) {
		let i = su(this.typeParameters, t);
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
}, pl = /*#__PURE__*/ new class extends dl {
	_tag = "Unknown";
	getParser() {
		return Su(this, te);
	}
	getExpected() {
		return "unknown";
	}
}(), ml = class extends dl {
	_tag = "Literal";
	literal;
	constructor(e, t, n, r, i) {
		if (super(t, n, r, i), typeof e == "number" && !globalThis.Number.isFinite(e)) throw Error(`A numeric literal must be finite, got ${A(e)}`);
		this.literal = e;
	}
	getParser() {
		return xu(this, this.literal);
	}
	toCodecJson() {
		return typeof this.literal == "bigint" ? hl(this) : this;
	}
	toCodecStringTree() {
		return typeof this.literal == "string" ? this : hl(this);
	}
	getExpected() {
		return typeof this.literal == "string" ? JSON.stringify(this.literal) : globalThis.String(this.literal);
	}
};
function hl(e) {
	let t = globalThis.String(e.literal);
	return eu(e, [new sl(new ml(t), new qc(Vc(() => e.literal), Vc(() => t)))]);
}
var gl = /*#__PURE__*/ new class extends dl {
	_tag = "String";
	getParser() {
		return Su(this, b);
	}
	getExpected() {
		return "string";
	}
}(), _l = class extends dl {
	_tag = "Number";
	getParser() {
		return Su(this, x);
	}
	toCodecJson() {
		return this.checks && (vl(this.checks, "isFinite") || vl(this.checks, "isInt")) ? this : eu(this, [Gl]);
	}
	toCodecStringTree() {
		return this.checks && (vl(this.checks, "isFinite") || vl(this.checks, "isInt")) ? eu(this, [ku]) : eu(this, [Au]);
	}
	getExpected() {
		return "number";
	}
};
function vl(e, t) {
	return e.some((e) => {
		switch (e._tag) {
			case "Filter": return e.annotations?.meta?._tag === t;
			case "FilterGroup": return vl(e.checks, t);
		}
	});
}
var yl = /*#__PURE__*/ new _l(), bl = class e extends dl {
	_tag = "Arrays";
	isMutable;
	elements;
	rest;
	encodingChecks;
	constructor(e, t, n, r, i, a, o, s) {
		super(r, i, a, o), this.isMutable = e, this.elements = t, this.rest = n, this.encodingChecks = s;
		let c = t.findIndex(du);
		if (c !== -1 && (t.slice(c + 1).some((e) => !du(e)) || n.length > 1)) throw Error("A required element cannot follow an optional element. ts(1257)");
		if (n.length > 1 && n.slice(1).some(du)) throw Error("An optional element cannot follow a rest element. ts(1266)");
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
		return rc(function* (e, n) {
			if (e._tag === "None") return e;
			let r = e.value;
			if (!Array.isArray(r)) return yield* B(new yc(t, e));
			let a = r.length, o = {
				ast: t,
				getParser: c,
				oinput: e,
				len: a,
				tailThreshold: Sl(a, i, s),
				output: new globalThis.Array(a),
				issues: void 0,
				options: n
			}, l = xl(o, r, {
				concurrency: Cl(n?.concurrency)?.concurrency,
				end: t.rest.length === 0 ? i : Math.max(a, i + s)
			});
			if (l && (yield* l), t.rest.length === 0 && a > i) for (let s = i; s <= a - 1; s++) {
				let i = new hc([s], new _c(t, r[s]));
				if (n.errors === "all") o.issues ? o.issues.push(i) : o.issues = [i];
				else return yield* B(new vc(t, e, [i]));
			}
			return o.issues ? yield* B(new vc(t, e, o.issues)) : N(o.output);
		});
	}
	rebuild(t, n, r) {
		let i = su(this.elements, t), a = su(this.rest, t);
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
}, xl = /*#__PURE__*/ lo()({
	onItem(e, t, n) {
		let r = n < e.len ? N(t) : cn();
		return e.getParser(e.tailThreshold, n).parser(r, e.options);
	},
	step(e, t, n, r) {
		if (n._tag === "Failure") return wl(e, e.ast, r, n);
		if (n.value._tag === "Some") e.output[r] = n.value.value;
		else {
			let t = e.getParser(e.tailThreshold, r);
			if (du(t.ast)) return;
			let n = new hc([r], new gc(t.ast.context?.annotations));
			if (e.options.errors === "all") e.issues ? e.issues.push(n) : e.issues = [n];
			else return Go(new vc(e.ast, e.oinput, [n]));
		}
	}
});
function Sl(e, t, n) {
	return Math.max(t, e - n);
}
var Cl = (e) => (e = e === "unbounded" ? Infinity : e ?? 1, e > 1 ? { concurrency: e } : void 0), wl = (e, t, n, r) => {
	let i = Uo(r.cause);
	if (gn(i)) return r;
	let a = new hc([n], i.success);
	if (e.options.errors === "all") e.issues ? e.issues.push(a) : e.issues = [a];
	else return Go(new vc(t, e.oinput, [a]));
}, Tl = "[+-]?\\d*\\.?\\d+(?:[Ee][+-]?\\d+)?", El = /*#__PURE__*/ new globalThis.RegExp(`(?:${Tl}|Infinity|-Infinity|NaN)`);
function Dl(e, t) {
	let n = pu(t);
	switch (n._tag) {
		case "String": return Object.keys(e);
		case "TemplateLiteral": {
			let t = vu(n);
			return Object.keys(e).filter((e) => t.test(e));
		}
		case "Symbol": return Object.getOwnPropertySymbols(e);
		case "Number": return Object.keys(e).filter((e) => El.test(e));
		case "Union": return [...new Set(n.types.flatMap((t) => Dl(e, t)))];
		default: return [];
	}
}
var Ol = class {
	name;
	type;
	constructor(e, t) {
		this.name = e, this.type = t;
	}
}, kl = class {
	parameter;
	type;
	merge;
	constructor(e, t, n) {
		if (this.parameter = e, this.type = t, this.merge = n, du(t) && !gu(t)) throw Error("Cannot use `Schema.optionalKey` with index signatures, use `Schema.optional` instead.");
	}
}, Al = class e extends dl {
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
		if (t.propertySignatures.length === 0 && t.indexSignatures.length === 0) return Su(t, ee);
		let o = a > 0 ? lo()({
			onItem: rc(function* (n, [i, a]) {
				let o = e(wu(a.parameter))(N(i), n.options), s = da(o) ? o : yield* Is(o);
				if (s._tag === "Failure") {
					let e = wl(n, t, i, s);
					e && (yield* e);
					return;
				}
				let c = N(n.input[i]), l = e(a.type)(c, n.options), u = da(l) ? l : yield* Is(l);
				if (u._tag === "Failure") {
					let e = wl(n, t, i, u);
					e && (yield* e);
					return;
				} else if (s.value._tag === "Some" && u.value._tag === "Some") {
					let e = s.value.value;
					if (r.has(i) || r.has(e)) return;
					let t = u.value.value;
					if (a.merge && a.merge.decode && Object.hasOwn(n.out, e)) {
						let [r, i] = a.merge.decode.combine([e, n.out[e]], [e, t]);
						cc(n.out, r, i);
					} else cc(n.out, e, t);
				}
			}),
			step: (e, t, n) => n._tag === "Failure" ? n : void 0
		}) : void 0;
		return rc(function* (e, s) {
			if (e._tag === "None") return e;
			let c = e.value;
			if (!(typeof c == "object" && c && !Array.isArray(c))) return yield* B(new yc(t, e));
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
						let n = new hc([i], new _c(t, c[i]));
						if (d) {
							u.issues ? u.issues.push(n) : u.issues = [n];
							continue;
						} else return yield* B(new vc(t, e, [n]));
					} else cc(l, i, c[i]);
				}
			}
			let h = Cl(s?.concurrency), g = jl(u, i, h);
			if (g && (yield* g), o) {
				let e = On();
				for (let n = 0; n < a; n++) {
					let r = t.indexSignatures[n], i = Dl(c, r.parameter);
					for (let t = 0; t < i.length; t++) {
						let n = i[t];
						e.push([n, r]);
					}
				}
				let n = o(u, e, h);
				n && (yield* n);
			}
			if (u.issues) return yield* B(new vc(t, e, u.issues));
			if (s.propertyOrder === "original") {
				let e = (m ?? Reflect.ownKeys(c)).concat(n), t = {};
				for (let n of e) Object.hasOwn(l, n) && cc(t, n, l[n]);
				return N(t);
			}
			return N(l);
		});
	}
	rebuild(t, n, r, i) {
		let a = su(this.propertySignatures, (e) => {
			let n = t(e.type);
			return n === e.type ? e : new Ol(e.name, n);
		}), o = su(this.indexSignatures, (e) => {
			let r = t(e.parameter), i = t(e.type), a = n ? e.merge?.flip() : e.merge;
			return r === e.parameter && i === e.type && a === e.merge ? e : new kl(r, i, a);
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
}, jl = /*#__PURE__*/ lo()({
	onItem(e, t) {
		let n = Object.hasOwn(e.input, t.name) ? N(e.input[t.name]) : cn();
		return t.parser(n, e.options);
	},
	step(e, t, n) {
		if (n._tag === "Failure") return wl(e, e.ast, t.name, n);
		if (n.value._tag === "Some") cc(e.out, t.name, n.value.value);
		else if (!du(t.type)) {
			let n = new hc([t.name], new gc(t.type.context?.annotations));
			if (e.options.errors === "all") {
				e.issues ? e.issues.push(n) : e.issues = [n];
				return;
			} else return Go(new vc(e.ast, e.oinput, [n]));
		}
	}
});
function Ml(e, t, n) {
	return new Al(Reflect.ownKeys(e).map((t) => new Ol(t, e[t].ast)), [], n, t);
}
function Nl(e) {
	return e.ast;
}
function Pl(e, t = void 0) {
	return new bl(!1, e.map((e) => e.ast), [], void 0, t);
}
function Fl(e, t, n) {
	return new Hl(e.map(Nl), t, void 0, n);
}
function Il(e) {
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
		case "Union": return Array.from(new Set(e.types.flatMap(Il)));
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
function Ll(e) {
	switch (e._tag) {
		default: return [];
		case "Declaration": {
			let t = e.annotations?.["~sentinels"];
			return Array.isArray(t) ? t : [];
		}
		case "Objects": return e.propertySignatures.flatMap((e) => {
			let t = e.type;
			if (!du(t)) {
				if (nl(t)) return [{
					key: e.name,
					literal: t.literal
				}];
				if (rl(t)) return [{
					key: e.name,
					literal: t.symbol
				}];
			}
			return [];
		});
		case "Arrays": return e.elements.flatMap((e, t) => nl(e) && !du(e) ? [{
			key: t,
			literal: e.literal
		}] : []);
		case "Suspend": return Ll(e.thunk());
	}
}
var Rl = /*#__PURE__*/ new WeakMap();
function zl(e) {
	let t = Rl.get(e);
	if (t) return t;
	t = {};
	for (let n of e) {
		let e = pu(n);
		if (tl(e)) continue;
		let r = Il(e), i = Ll(e);
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
	return Rl.set(e, t), t;
}
function Bl(e) {
	return (t) => {
		let n = pu(t);
		return n._tag === "Literal" ? n.literal === e : n._tag === "UniqueSymbol" ? n.symbol === e : !0;
	};
}
function Vl(e, t) {
	let n = zl(t), r = e === null ? "null" : Array.isArray(e) ? "array" : typeof e;
	if (n.bySentinel) {
		let t = n.otherwise?.[r] ?? [];
		if (r === "object" || r === "array") {
			for (let [r, i] of n.bySentinel) if (Object.hasOwn(e, r)) {
				let n = i.get(e[r]);
				if (n) return [...n, ...t].filter(Bl(e));
			}
		}
		return t;
	}
	return (n.byType?.[r] ?? []).filter(Bl(e));
}
var Hl = class e extends dl {
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
			if (n._tag === "None") return ws(n);
			let i = n.value, a = Vl(i, t.types), o = {
				ast: t,
				recur: e,
				oinput: n,
				input: i,
				out: void 0,
				successes: [],
				issues: void 0,
				options: r
			}, s = Ul(o, a, Cl(r?.concurrency));
			return s ? Ms(s, (e) => o.out ? ws(o.out) : B(new xc(t, i, o.issues ?? []))) : o.out ? ws(o.out) : B(new xc(t, i, o.issues ?? []));
		};
	}
	rebuild(t, n, r) {
		let i = su(this.types, t);
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
			let n = pu(t);
			switch (n._tag) {
				case "Arrays": {
					let t = n.elements.filter(nl);
					if (t.length > 0) return `${Kl(n.isMutable)}[ ${t.map((t) => e(t) + ql(t.context?.isOptional)).join(", ")}, ... ]`;
					break;
				}
				case "Objects": {
					let t = n.propertySignatures.filter((e) => nl(e.type));
					if (t.length > 0) return `{ ${t.map((t) => `${Kl(t.type.context?.isMutable)}${Ue(t.name)}${ql(t.type.context?.isOptional)}: ${e(t.type)}`).join(", ")}, ... }`;
					break;
				}
			}
			return e(n);
		});
		return Array.from(new Set(n)).join(" | ");
	}
}, Ul = /*#__PURE__*/ lo()({
	onItem(e, t) {
		return e.recur(t)(e.oinput, e.options);
	},
	step(e, t, n) {
		if (n._tag === "Failure") {
			let t = Uo(n.cause);
			if (gn(t)) return n;
			e.issues ? e.issues.push(t.success) : e.issues = [t.success];
		} else {
			if (e.out && e.ast.mode === "oneOf") return e.successes.push(t), Go(new Sc(e.ast, e.input, e.successes));
			if (e.out = n.value, e.successes.push(t), e.ast.mode === "anyOf") return Ko;
		}
	}
}), Wl = /*#__PURE__*/ new Hl([
	/*#__PURE__*/ new ml("Infinity"),
	/*#__PURE__*/ new ml("-Infinity"),
	/*#__PURE__*/ new ml("NaN")
], "anyOf"), Gl = /*#__PURE__*/ new sl(/*#__PURE__*/ new Hl([yl, Wl], "anyOf"), /*#__PURE__*/ new qc(/*#__PURE__*/ Gc(), /*#__PURE__*/ Vc((e) => globalThis.Number.isFinite(e) ? e : globalThis.String(e))));
function Kl(e) {
	return e ? "" : "readonly ";
}
function ql(e) {
	return e ? "?" : "";
}
function Jl(e) {
	switch (e._tag) {
		case "Declaration":
		case "Arrays":
		case "Objects":
		case "Union": return e.encodingChecks;
		default: return;
	}
}
var Yl = class e extends c {
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
		return new Xl([this, e], t);
	}
}, Xl = class e extends c {
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
function Zl(e, t, n = !1) {
	return new Yl((t, n, r) => Tc(t, n, e(t, n, r)), t, n);
}
function Ql(e, t) {
	let n = e.source;
	return Zl((t) => e.test(t), {
		expected: `a string matching the RegExp ${n}`,
		meta: {
			_tag: "isPattern",
			regExp: e
		},
		arbitrary: { constraint: { patterns: [e.source] } },
		...t
	});
}
function $l(e, t) {
	let n = Object.getOwnPropertyDescriptors(e);
	return t(n), Object.create(Object.getPrototypeOf(e), n);
}
function eu(e, t) {
	return e.encoding === t ? e : $l(e, (e) => {
		e.encoding.value = t;
	});
}
function tu(e, t) {
	return e.context === t ? e : $l(e, (e) => {
		e.context.value = t;
	});
}
function nu(e, t) {
	if (e.checks) {
		let n = e.checks[e.checks.length - 1];
		return ru(e, yn(e.checks.slice(0, -1), n.annotate(t)));
	}
	return $l(e, (e) => {
		e.annotations.value = {
			...e.annotations.value,
			...t
		};
	});
}
function ru(e, t) {
	if (e._tag === "Suspend" && t !== void 0) throw Error("Cannot add checks to Suspend");
	return e.checks === t ? e : $l(e, (e) => {
		e.checks.value = t;
	});
}
function iu(e, t) {
	return ru(e, e.checks ? [...e.checks, ...t] : t);
}
function au(e, t) {
	let n = e, r = n[n.length - 1], i = t(r.to);
	return i === r.to ? e : yn(e.slice(0, e.length - 1), new sl(i, r.transformation));
}
function ou(e, t, n) {
	let r = new sl(e, t);
	return eu(n, n.encoding ? [...n.encoding, r] : [r]);
}
function su(e, t) {
	let n = !1, r = Array(e.length);
	for (let i = 0; i < e.length; i++) {
		let a = e[i], o = t(a);
		o !== a && (n = !0), r[i] = o;
	}
	return n ? r : e;
}
function cu(e, t) {
	return tu(e, e.context ? new ll(e.context.isOptional, e.context.isMutable, e.context.defaultValue, {
		...e.context.annotations,
		...t
	}) : new ll(!1, !1, void 0, t));
}
function lu(e, t) {
	let n = [new sl(pl, new qc(Uc(t), Bc()))];
	return tu(e, e.context ? new ll(e.context.isOptional, e.context.isMutable, n, e.context.annotations) : new ll(!1, !1, n));
}
function uu(e, t, n) {
	return ou(e, n, t);
}
function du(e) {
	return e.context?.isOptional ?? !1;
}
var fu = /*#__PURE__*/ _((e) => {
	if (e.encoding) return fu(eu(e, void 0));
	let t = e, n = t.recur?.(fu) ?? t;
	return Jl(n) ? $l(n, (e) => {
		e.encodingChecks.value = void 0;
	}) : n;
}), pu = /*#__PURE__*/ _((e) => fu(hu(e)));
function mu(e, t) {
	let n = t, r = n.length, i = n[r - 1], a = [new sl(hu(eu(e, void 0)), n[0].transformation.flip())];
	for (let e = 1; e < r; e++) a.unshift(new sl(hu(n[e - 1].to), n[e].transformation.flip()));
	let o = hu(i.to);
	return o.encoding ? eu(o, [...o.encoding, ...a]) : eu(o, a);
}
var hu = /*#__PURE__*/ _((e) => {
	if (e.encoding) return mu(e, e.encoding);
	let t = e;
	return t.flip?.(hu) ?? t.recur?.(hu) ?? t;
});
function gu(e) {
	switch (e._tag) {
		case "Undefined": return !0;
		case "Union": return e.types.some(gu);
		default: return !1;
	}
}
function _u(e, t) {
	return e.encodedParts.map((e) => bu(e, yu(e), t)).join("");
}
var vu = /*#__PURE__*/ _((e) => new globalThis.RegExp(`^${_u(e, !0)}$`));
function yu(e) {
	switch (e._tag) {
		case "Literal": return lc(globalThis.String(e.literal));
		case "String": return Tu;
		case "Number": return Tl;
		case "BigInt": return ju;
		case "TemplateLiteral": return _u(e, !1);
		case "Union": return e.types.map(yu).join("|");
	}
}
function bu(e, t, n) {
	if (ol(e)) {
		if (!n) return `(?:${t})`;
	} else if (!n) return t;
	return `(${t})`;
}
function xu(e, t) {
	let n = Es(t);
	return (r) => r._tag === "None" ? Ts : r.value === t ? n : B(new yc(e, r));
}
function Su(e, t) {
	return (n) => n._tag === "None" ? Ts : t(n.value) ? ws(n) : B(new yc(e, n));
}
function Cu(e) {
	function t(n) {
		return n.encoding ? eu(n, au(n.encoding, t)) : e(n);
	}
	return _(t);
}
var wu = /*#__PURE__*/ Cu((e) => {
	switch (e._tag) {
		default: return e;
		case "Number": return e.toCodecStringTree();
		case "Union": return e.recur(wu);
	}
}), Tu = "[\\s\\S]*?", Eu = /*#__PURE__*/ new globalThis.RegExp(`^${Tl}$`);
function Du(e) {
	return Ql(Eu, {
		expected: "a string representing a finite number",
		meta: {
			_tag: "isStringFinite",
			regExp: Eu
		},
		...e
	});
}
var Ou = /*#__PURE__*/ iu(gl, [/*#__PURE__*/ Du()]), ku = /*#__PURE__*/ new sl(Ou, Qc), Au = /*#__PURE__*/ new sl(/*#__PURE__*/ new Hl([Ou, Wl], "anyOf"), Qc), ju = "-?\\d+";
`${ju}`;
function Mu(e, t, n, r, i) {
	for (let a = 0; a < e.length; a++) {
		let o = e[a];
		if (o._tag === "FilterGroup") Mu(o.checks, t, n, r, i);
		else {
			let e = o.run(t, r, i);
			if (e && (n.push(new pc(t, o, e)), o.aborted || i?.errors !== "all")) return;
		}
	}
}
var Nu = "~effect/Schema/Class", Pu = "~structural", Fu = /*#__PURE__*/ _((e) => {
	switch (e._tag) {
		case "Declaration": {
			let t = e.annotations?.[Nu];
			if (S(t)) {
				let n = t(e.typeParameters), r = Fu(n.to);
				return eu(e, r === n.to ? [n] : [new sl(r, n.transformation)]);
			}
			return e;
		}
		case "Objects":
		case "Arrays": return e.recur((e) => {
			let t = e.context?.defaultValue;
			return t ? eu(Fu(e), t) : Fu(e);
		});
		case "Suspend": return e.recur(Fu);
		default: return e;
	}
});
function Iu(e) {
	let t = Vu(Fu(fu(e.ast)));
	return (e, n) => t(e, n?.disableChecks ? n?.parseOptions ? {
		...n.parseOptions,
		disableChecks: !0
	} : { disableChecks: !0 } : n?.parseOptions);
}
function Lu(e) {
	let t = Iu(e);
	return (e, n) => qo(Xs(t(e, n)));
}
function Ru(e) {
	let t = Iu(e);
	return (e, n) => Js(ec(t(e, n), (e) => Error(e.toString(), { cause: e })));
}
function zu(e, t) {
	let n = Vu(e.ast);
	return t === void 0 ? n : (e, r) => n(e, Bu(t, r));
}
var Bu = (e, t) => t === void 0 ? e : {
	...e,
	...t
};
function Vu(e) {
	let t = Hu(e);
	return (e, n) => tc(t(N(e), n ?? cl), (e) => e._tag === "None" ? B(new bc(e)) : ws(e.value));
}
var Hu = /*#__PURE__*/ _((e) => {
	let t, n = Jl(e), r = e.checks ?? n, i = (r ? r[r.length - 1].annotations : e.annotations)?.parseOptions;
	if (!e.context && !e.encoding && !e.checks && !n) return (n, r) => (t ??= e.getParser(Hu), i && (r = {
		...r,
		...i
	}), t(n, r));
	let a = il(e) || al(e) || el(e) && e.typeParameters.length > 0;
	return (r, o) => {
		i && (o = {
			...o,
			...i
		});
		let s = e.encoding, c;
		if (s) {
			let t = s, n = t.length;
			for (let e = n - 1; e >= 0; e--) {
				let n = t[e], i = n.to, a = Hu(i);
				if (c = c ? tc(c, (e) => a(e, o)) : a(r, o), n.transformation._tag === "Transformation") {
					let e = n.transformation.decode;
					c = tc(c, (t) => e.run(t, o));
				} else c = n.transformation.decode(c, o);
			}
			c = ec(c, (t) => new mc(e, r, t));
		}
		t ??= e.getParser(Hu);
		let l = c ? tc(c, (e) => t(e, o)) : t(r, o);
		if (n && !o?.disableChecks && (l = tc(l, (t) => {
			if (un(r) && un(t)) {
				let t = [];
				if (Mu(n, r.value, t, e, o), xn(t)) return B(new vc(e, r, t));
			}
			return ws(t);
		})), e.checks && !o?.disableChecks) {
			let t = e.checks;
			o?.errors === "all" && a && un(r) && (l = nc(l, (n) => {
				let i = [];
				return Mu(t.filter((e) => e.annotations?.[Pu]), r.value, i, e, o), B(xn(i) ? n._tag === "Composite" && n.ast === e ? new vc(e, n.actual, [...n.issues, ...i]) : new vc(e, r, [n, ...i]) : n);
			})), l = tc(l, (n) => {
				if (un(n)) {
					let r = n.value, i = [];
					if (Mu(t, r, i, e, o), xn(i)) return B(new vc(e, n, i));
				}
				return ws(n);
			});
		}
		return l;
	};
}), Uu = "~effect/Schema/Schema", Wu = {
	[Uu]: Uu,
	pipe() {
		return o(this, arguments);
	},
	annotate(e) {
		return this.rebuild(nu(this.ast, e));
	},
	annotateKey(e) {
		return this.rebuild(cu(this.ast, e));
	},
	check(...e) {
		return this.rebuild(iu(this.ast, e));
	}
};
function Gu(e, t) {
	let n = Object.create(Wu);
	return t && Object.assign(n, t), n.ast = e, n.rebuild = (e) => Gu(e, t), n.makeEffect = g(Iu(n), ec((e) => new qu(e))), n.make = Ru(n), n.makeOption = Lu(n), n;
}
var Ku = "~effect/Schema/SchemaError", qu = class {
	[Ku] = Ku;
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
}, Ju = Uu;
function Yu(e, t) {
	let n = zu(e, t);
	return (e, t) => ec(n(e, t), (e) => new qu(e));
}
var Xu = Gu;
function Zu(e) {
	return w(e, Ju) && e[Ju] === Ju;
}
function Qu(e) {
	let t = Xu(new ml(e), {
		literal: e,
		transform(n) {
			return t.pipe(ad(Qu(n), {
				decode: Vc(() => n),
				encode: Vc(() => e)
			}));
		}
	});
	return t;
}
var $u = /*#__PURE__*/ Xu(gl), ed = /*#__PURE__*/ Xu(yl);
function td(e, t) {
	return Xu(e, {
		fields: t,
		mapFields(e, t) {
			let n = e(this.fields);
			return td(Ml(n, t?.unsafePreserveChecks ? this.ast.checks : void 0), n);
		}
	});
}
function nd(e) {
	return td(Ml(e, void 0), e);
}
function rd(e, t) {
	return Xu(e, {
		elements: t,
		mapElements(e, t) {
			let n = e(this.elements);
			return rd(Pl(n, t?.unsafePreserveChecks ? this.ast.checks : void 0), n);
		}
	});
}
function id(e, t) {
	return Xu(e, {
		members: t,
		mapMembers(e, t) {
			let n = e(this.members);
			return id(Fl(n, this.ast.mode, t?.unsafePreserveChecks ? this.ast.checks : void 0), n);
		}
	});
}
function ad(e, t) {
	return (n) => Xu(uu(n.ast, e.ast, t ? Yc(t) : Zc()), {
		from: n,
		to: e
	});
}
function od(e) {
	return (t) => Xu(lu(t.ast, ec(e, (e) => e.issue)), { schema: t });
}
function sd(e) {
	return Qu(e).pipe(od(ws(e)));
}
function cd(e, t) {
	return nd({
		_tag: sd(e),
		...t
	});
}
globalThis.RegExp, globalThis.URL, globalThis.File, globalThis.FormData, globalThis.URLSearchParams, globalThis.Uint8Array;
var ld = /*#__PURE__*/ globalThis.Symbol.for("immer-draftable");
function ud(e, t, n, r, i) {
	let a = pd(n, t, r), s = fd(t), c = class extends e {
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
		static [Ju] = Ju;
		get [s]() {
			return s;
		}
		static [ld] = !0;
		static identifier = t;
		static fields = n.fields;
		static get ast() {
			return a(this).ast;
		}
		static pipe() {
			return o(this, arguments);
		}
		static rebuild(e) {
			return a(this).rebuild(e);
		}
		static make(e, t) {
			return new this(e, t);
		}
		static makeOption(e, t) {
			return Lu(a(this))(e ?? {}, t);
		}
		static makeEffect(e, t) {
			return a(this).makeEffect(e ?? {}, t);
		}
		static annotate(e) {
			return this.rebuild(nu(this.ast, e));
		}
		static annotateKey(e) {
			return this.rebuild(cu(this.ast, e));
		}
		static check(...e) {
			return this.rebuild(iu(this.ast, e));
		}
		static extend(e) {
			return (t, r) => {
				let a = {
					...n.fields,
					...t
				};
				return ud(this, e, td(Ml(a, n.ast.checks, { identifier: e }), a), r, i);
			};
		}
		static mapFields(e, t) {
			return n.mapFields(e, t);
		}
	};
	return i !== void 0 && Object.assign(c.prototype, i(t)), c;
}
function dd(e) {
	return new qc(Vc((t) => new e(t)), Bc());
}
function fd(e) {
	return `~effect/Schema/Class/${e}`;
}
function pd(e, t, n) {
	let r;
	return (i) => {
		if (r === void 0) {
			let a = dd(i), o = Xu(new fl([e.ast], () => (e, n) => e instanceof i || w(e, fd(t)) ? ws(e) : B(new yc(n, N(e))), {
				identifier: t,
				[Nu]: ([e]) => new sl(e, a),
				toCodec: ([e]) => new sl(e.ast, a),
				toArbitrary: ([e]) => () => ({
					arbitrary: e.arbitrary.map((e) => new i(e)),
					terminal: e.terminal?.map((e) => new i(e))
				}),
				toFormatter: ([e]) => (t) => `${i.identifier}(${e(t)})`,
				"~sentinels": Ll(e.ast),
				...n
			}));
			r = e.pipe(ad(o, a));
		}
		return r;
	};
}
function md(e) {
	return Zu(e);
}
var hd = (e) => (t, n) => ud(It, e, md(t) ? t : nd(t), n, (e) => ({ name: e })), gd = (e) => (t, n, r) => {
	let i = md(n) ? n.mapFields((e) => ({
		_tag: sd(t),
		...e
	}), { unsafePreserveChecks: !0 }) : cd(t, n);
	return hd(e ?? t)(i, r);
};
nd({
	id: $u,
	title: $u,
	body: $u,
	createdAt: ed,
	updatedAt: ed
});
var _d = nd({
	title: $u,
	body: $u
}), vd = nd({
	id: $u,
	title: $u,
	body: $u
}), yd = nd({ id: $u }), V = Symbol.for("drizzle:entityKind");
function H(e, t) {
	if (!e || typeof e != "object") return !1;
	if (e instanceof t) return !0;
	if (!Object.prototype.hasOwnProperty.call(t, V)) throw Error(`Class "${t.name ?? "<unknown>"}" doesn't look like a Drizzle entity. If this is incorrect and the class is provided by Drizzle, please report this as a bug.`);
	let n = Object.getPrototypeOf(e)?.constructor;
	if (n) for (; n;) {
		if (V in n && n[V] === t[V]) return !0;
		n = Object.getPrototypeOf(n);
	}
	return !1;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/query-promise.js
var bd = class {
	static [V] = "QueryPromise";
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
}, xd = Symbol.for("drizzle:OriginalColumn"), Sd = (e) => e;
Sd.isNoop = !0;
var U = class {
	static [V] = "Column";
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
	mapFromDriverValue = Sd;
	mapToDriverValue = Sd;
	postBuild() {
		return this;
	}
	shouldDisableInsert() {
		return this.config.generated !== void 0 && this.config.generated.type !== "byDefault";
	}
	[xd]() {
		return this;
	}
}, Cd = Symbol.for("drizzle:Name"), wd = Symbol.for("drizzle:Schema"), Td = Symbol.for("drizzle:Columns"), Ed = Symbol.for("drizzle:ExtraConfigColumns"), Dd = Symbol.for("drizzle:OriginalName"), Od = Symbol.for("drizzle:BaseName"), kd = Symbol.for("drizzle:IsAlias"), Ad = Symbol.for("drizzle:ExtraConfigBuilder"), jd = Symbol.for("drizzle:IsDrizzleTable"), W = class {
	static [V] = "Table";
	static Symbol = {
		Name: Cd,
		Schema: wd,
		OriginalName: Dd,
		Columns: Td,
		ExtraConfigColumns: Ed,
		BaseName: Od,
		IsAlias: kd,
		ExtraConfigBuilder: Ad
	};
	[Cd];
	[Dd];
	[wd];
	[Td];
	[Ed];
	[Od];
	[kd] = !1;
	[jd] = !0;
	[Ad] = void 0;
	constructor(e, t, n) {
		this[Cd] = this[Dd] = e, this[wd] = t, this[Od] = n;
	}
};
function Md(e) {
	return e[Cd];
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/subquery.js
var G = class {
	static [V] = "Subquery";
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
}, Nd = class extends G {
	static [V] = "WithSubquery";
}, Pd = { startActiveSpan(e, t) {
	return t();
} }, K = Symbol.for("drizzle:ViewBaseConfig");
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/sql/sql.js
function Fd(e) {
	return e != null && typeof e.getSQL == "function";
}
function Id(e) {
	let t = {
		sql: "",
		params: []
	};
	for (let n of e) t.sql += n.sql, t.params.push(...n.params);
	return t;
}
function Ld(e) {
	let t = {
		sql: "",
		params: []
	}, n = [];
	for (let r of e) n.push(r.sql), t.params.push(...r.params);
	return t._sql = Object.assign(n, { raw: n }), t;
}
var q = class {
	static [V] = "StringChunk";
	value;
	constructor(e) {
		this.value = Array.isArray(e) ? e : [e];
	}
	getSQL() {
		return new J([this]);
	}
}, J = class e {
	static [V] = "SQL";
	decoder = Bd;
	shouldInlineParams = !1;
	usedTables = [];
	constructor(e) {
		this.queryChunks = e;
		for (let t of e) if (H(t, W)) {
			let e = t[W.Symbol.Schema];
			this.usedTables.push(e === void 0 ? t[W.Symbol.Name] : e + "." + t[W.Symbol.Name]);
		}
	}
	append(e) {
		return this.queryChunks.push(...e.queryChunks), this;
	}
	toQuery(e) {
		return Pd.startActiveSpan("drizzle.buildSQL", (t) => {
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
			if (H(t, q)) return {
				sql: t.value.join(""),
				params: []
			};
			if (H(t, Rd)) return {
				sql: i(t.value),
				params: []
			};
			if (t === void 0) return {
				sql: "",
				params: []
			};
			if (Array.isArray(t)) {
				let e = [new q("(")];
				for (let [n, r] of t.entries()) e.push(r), n < t.length - 1 && e.push(new q(", "));
				return e.push(new q(")")), this.buildQueryFromSourceParams(e, r);
			}
			if (H(t, e)) return this.buildQueryFromSourceParams(t.queryChunks, {
				...r,
				inlineParams: s || t.shouldInlineParams
			});
			if (H(t, W)) {
				let e = t[W.Symbol.Schema], n = t[W.Symbol.Name];
				return l === "mssql-view-with-schemabinding" ? {
					sql: i(e === void 0 ? "dbo" : e) + "." + i(n),
					params: []
				} : {
					sql: e === void 0 || t[kd] ? i(n) : i(e) + "." + i(n),
					params: []
				};
			}
			if (H(t, U)) {
				let e = t.name;
				if (n.invokeSource === "indexes") return {
					sql: i(e),
					params: []
				};
				let r = l === "mssql-check" ? void 0 : t.table[W.Symbol.Schema];
				return {
					sql: t.isAlias ? i(t.name) : t.table[kd] || r === void 0 ? i(t.table[W.Symbol.Name]) + "." + i(e) : i(r) + "." + i(t.table[W.Symbol.Name]) + "." + i(e),
					params: []
				};
			}
			if (H(t, qd)) {
				let e = t[K].schema, n = t[K].name;
				return {
					sql: e === void 0 || t[K].isAlias ? i(n) : i(e) + "." + i(n),
					params: []
				};
			}
			if (H(t, Hd)) {
				if (H(t.value, e)) return this.buildQueryFromSourceParams([t.value], r);
				let n = o && H(t.encoder, U);
				if (H(t.value, Wd)) {
					let e = a(c.value++, t);
					return t.codec = n ? (e) => o.apply(t.encoder, "normalizeParam", e) : void 0, {
						sql: n ? o.apply(t.encoder, "castParam", e) : e,
						params: [t]
					};
				}
				let i;
				if (t.value === null) i = t.value;
				else {
					if (i = t.encoder.mapToDriverValue.isNoop ? t.value : t.encoder.mapToDriverValue(t.value), H(i, e)) return this.buildQueryFromSourceParams([i], r);
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
			return H(t, Wd) ? {
				sql: a(c.value++, t),
				params: [t]
			} : H(t, e.Aliased) && t.fieldAlias !== void 0 ? {
				sql: (t.origin === void 0 ? "" : i(t.origin) + ".") + i(t.fieldAlias),
				params: []
			} : H(t, G) ? t._.isWith ? {
				sql: i(t._.alias),
				params: []
			} : this.buildQueryFromSourceParams([
				new q("("),
				t._.sql,
				new q(") "),
				new Rd(t._.alias)
			], r) : typeof t == "function" && "enumName" in t ? "schema" in t && t.schema ? {
				sql: i(t.schema) + "." + i(t.enumName),
				params: []
			} : {
				sql: i(t.enumName),
				params: []
			} : Fd(t) ? t.shouldOmitSQLParens?.() ? this.buildQueryFromSourceParams([t.getSQL()], r) : this.buildQueryFromSourceParams([
				new q("("),
				t.getSQL(),
				new q(")")
			], r) : s ? {
				sql: this.mapInlineParam(t, r),
				params: []
			} : {
				sql: a(c.value++, t),
				params: [t]
			};
		});
		return n.tagged ? Ld(u) : Id(u);
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
}, Rd = class {
	static [V] = "Name";
	brand;
	constructor(e) {
		this.value = e;
	}
	getSQL() {
		return new J([this]);
	}
};
function zd(e) {
	return typeof e == "object" && !!e && "mapToDriverValue" in e && typeof e.mapToDriverValue == "function";
}
var Bd = { mapFromDriverValue: (e) => e };
Bd.mapFromDriverValue.isNoop = !0;
var Vd = { mapToDriverValue: (e) => e };
Vd.mapToDriverValue.isNoop = !0, {
	...Bd,
	...Vd
};
var Hd = class {
	static [V] = "Param";
	brand;
	constructor(e, t = Vd, n) {
		this.value = e, this.encoder = t, this.codec = n;
	}
	getSQL() {
		return new J([this]);
	}
};
function Y(e, ...t) {
	let n = [];
	(t.length > 0 || e.length > 0 && e[0] !== "") && n.push(new q(e[0]));
	for (let [r, i] of t.entries()) n.push(i, new q(e[r + 1]));
	return new J(n);
}
(function(e) {
	function t() {
		return new J([]);
	}
	e.empty = t;
	function n(e) {
		return new J(e);
	}
	e.fromList = n;
	function r(e) {
		return new J([new q(e)]);
	}
	e.raw = r;
	function i(e, t) {
		let n = [];
		for (let [r, i] of e.entries()) r > 0 && t !== void 0 && n.push(t), n.push(i);
		return new J(n);
	}
	e.join = i;
	function a(e) {
		return new Rd(e);
	}
	e.identifier = a;
	function o(e) {
		return new Wd(e);
	}
	e.placeholder = o;
	function s(e, t) {
		return new Hd(e, t);
	}
	e.param = s;
	function c(e) {
		let t = Ud(e);
		if (t.length) return Y.raw(t);
	}
	e.comment = c;
})(Y ||= {});
function Ud(e) {
	let t = Ud.encodeInput(e);
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
})(Ud ||= {}), (function(e) {
	class t {
		static [V] = "SQL.Aliased";
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
})(J ||= {});
var Wd = class {
	static [V] = "Placeholder";
	constructor(e) {
		this.name = e;
	}
	getSQL() {
		return new J([this]);
	}
};
function Gd(e, t) {
	return e.map((e) => {
		if (H(e, Wd)) {
			if (!(e.name in t)) throw Error(`No value for placeholder "${e.name}" was provided`);
			return t[e.name];
		}
		if (H(e, Hd) && H(e.value, Wd)) {
			if (!(e.value.name in t)) throw Error(`No value for placeholder "${e.value.name}" was provided`);
			let n = t[e.value.name];
			if (n === null) return n;
			let r = e.encoder.mapToDriverValue.isNoop ? n : e.encoder.mapToDriverValue(n);
			return e.codec ? e.codec(r) : r;
		}
		return e;
	});
}
var Kd = Symbol.for("drizzle:IsDrizzleView"), qd = class {
	static [V] = "View";
	[K];
	[Kd] = !0;
	get [Cd]() {
		return this[K].name;
	}
	get [wd]() {
		return this[K].schema;
	}
	get [kd]() {
		return this[K].isAlias;
	}
	get [Dd]() {
		return this[K].originalName;
	}
	get [Td]() {
		return this[K].selectedFields;
	}
	constructor({ name: e, schema: t, selectedFields: n, query: r }) {
		this[K] = {
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
U.prototype.getSQL = function() {
	return new J([this]);
}, G.prototype.getSQL = function() {
	return new J([this]);
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/errors.js
var Jd = class extends Error {
	static [V] = "DrizzleError";
	constructor({ message: e, cause: t }) {
		super(e), this.name = "DrizzleError", this.cause = t;
	}
}, Yd = class e extends Error {
	static [V] = "DrizzleQueryError";
	constructor(t, n, r) {
		super(`Failed query: ${t}\nparams: ${n}`), this.query = t, this.params = n, this.cause = r, this.name = "DrizzleQueryError", Error.captureStackTrace(this, e), r && (this.cause = r);
	}
}, Xd = class extends Jd {
	static [V] = "TransactionRollbackError";
	constructor() {
		super({ message: "Rollback" }), this.name = "TransactionRollbackError";
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/sql/expressions/conditions.js
function X(e, t) {
	return zd(t) && !Fd(e) && !H(e, Hd) && !H(e, Wd) && !H(e, U) && !H(e, W) && !H(e, qd) ? new Hd(e, t) : e;
}
var Zd = (e, t) => Y`${e} = ${X(t, e)}`, Qd = (e, t) => Y`${e} <> ${X(t, e)}`;
function $d(...e) {
	let t = e.filter((e) => e !== void 0);
	if (t.length !== 0) return t.length === 1 ? new J(t) : new J([
		new q("("),
		Y.join(t.map((e) => Y`(${e})`), new q(" and ")),
		new q(")")
	]);
}
function ef(...e) {
	let t = e.filter((e) => e !== void 0);
	if (t.length !== 0) return t.length === 1 ? new J(t) : new J([
		new q("("),
		Y.join(t.map((e) => Y`(${e})`), new q(" or ")),
		new q(")")
	]);
}
function tf(e) {
	return H(e, J) ? Y`not (${e})` : Y`not ${e}`;
}
var nf = (e, t) => Y`${e} > ${X(t, e)}`, rf = (e, t) => Y`${e} >= ${X(t, e)}`, af = (e, t) => Y`${e} < ${X(t, e)}`, of = (e, t) => Y`${e} <= ${X(t, e)}`;
function sf(e, t) {
	return Array.isArray(t) ? t.length === 0 ? Y`false` : Y`${e} in ${t.map((t) => X(t, e))}` : Y`${e} in ${X(t, e)}`;
}
function cf(e, t) {
	return Array.isArray(t) ? t.length === 0 ? Y`true` : Y`${e} not in ${t.map((t) => X(t, e))}` : Y`${e} not in ${X(t, e)}`;
}
function lf(e) {
	return Y`(${e} is null)`;
}
function uf(e) {
	return Y`(${e} is not null)`;
}
function df(e) {
	return Y`exists ${e}`;
}
function ff(e) {
	return Y`not exists ${e}`;
}
function pf(e, t, n) {
	return Y`${e} between ${X(t, e)} and ${X(n, e)}`;
}
function mf(e, t, n) {
	return Y`${e} not between ${X(t, e)} and ${X(n, e)}`;
}
function hf(e, t) {
	return Y`${e} like ${t}`;
}
function gf(e, t) {
	return Y`${e} not like ${t}`;
}
function _f(e, t) {
	return Y`${e} ilike ${t}`;
}
function vf(e, t) {
	return Y`${e} not ilike ${t}`;
}
function yf(e, t) {
	if (Array.isArray(t)) {
		if (t.length === 0) throw Error("arrayContains requires at least one value");
		let n = X(t, e);
		return Y`${e} @> ${Y`${Array.isArray(n) ? new Hd(n) : n}`}`;
	}
	return Y`${e} @> ${X(t, e)}`;
}
function bf(e, t) {
	if (Array.isArray(t)) {
		if (t.length === 0) throw Error("arrayContained requires at least one value");
		let n = X(t, e);
		return Y`${e} <@ ${Y`${Array.isArray(n) ? new Hd(n) : n}`}`;
	}
	return Y`${e} <@ ${X(t, e)}`;
}
function xf(e, t) {
	if (Array.isArray(t)) {
		if (t.length === 0) throw Error("arrayOverlaps requires at least one value");
		let n = X(t, e);
		return Y`${e} && ${Y`${Array.isArray(n) ? new Hd(n) : n}`}`;
	}
	return Y`${e} && ${X(t, e)}`;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/sql/expressions/select.js
function Sf(e) {
	return Y`${e} asc`;
}
function Cf(e) {
	return Y`${e} desc`;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/alias.js
var wf = class {
	static [V] = "ColumnTableAliasProxyHandler";
	constructor(e, t) {
		this.table = e, this.ignoreColumnAlias = t;
	}
	get(e, t) {
		return t === "table" ? this.table : t === "isAlias" && this.ignoreColumnAlias ? !1 : e[t];
	}
}, Tf = class {
	static [V] = "ViewSelectionAliasProxyHandler";
	constructor(e, t, n) {
		this.view = e, this.selection = t, this.ignoreColumnAlias = n;
	}
	get(e, t) {
		let n = e[t];
		return H(n, U) ? new Proxy(n, new wf(this.view, this.ignoreColumnAlias)) : H(n, G) || H(n, J) || H(n, J.Aliased) || Fd(n) || typeof n != "object" || !n ? n : new Proxy(n, this);
	}
}, Ef = class {
	static [V] = "TableAliasProxyHandler";
	constructor(e, t, n) {
		this.alias = e, this.replaceOriginalName = t, this.ignoreColumnAlias = n;
	}
	get(e, t) {
		if (t === W.Symbol.IsAlias) return !0;
		if (t === W.Symbol.Name || this.replaceOriginalName && t === W.Symbol.OriginalName) return this.alias;
		if (t === K) return {
			...e[K],
			name: this.alias,
			isAlias: !0,
			selectedFields: new Proxy(e[K].selectedFields, new Tf(new Proxy(e, this), e[K].selectedFields, this.ignoreColumnAlias))
		};
		if (t === W.Symbol.Columns) {
			let t = e[W.Symbol.Columns];
			if (!t) return t;
			if (H(e, qd)) return new Proxy(e[W.Symbol.Columns], new Tf(new Proxy(e, this), e[W.Symbol.Columns], this.ignoreColumnAlias));
			let n = {};
			return Object.keys(t).map((r) => {
				n[r] = new Proxy(t[r], new wf(new Proxy(e, this), this.ignoreColumnAlias));
			}), n;
		}
		let n = e[t];
		return H(n, U) ? new Proxy(n, new wf(new Proxy(e, this), this.ignoreColumnAlias)) : n;
	}
}, Df = class {
	static [V] = "ColumnAliasProxyHandler";
	constructor(e) {
		this.alias = e;
	}
	get(e, t) {
		return t === "isAlias" ? !0 : t === "name" ? this.alias : t === "keyAsName" ? !1 : t === xd ? () => e : e[t];
	}
};
function Of(e, t) {
	return new Proxy(e, new Ef(t, !1, !1));
}
function kf(e, t) {
	return new Proxy(e, new Df(t));
}
U.prototype.as = function(e) {
	return kf(this, e);
};
function Af(e) {
	return e[xd]();
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/utils.js
var jf = Object.getPrototypeOf(() => null).constructor;
function Mf(e, t = {}) {
	let n = [], r = [];
	r.push(`const [ ${e.map((e, t) => `c${t}`).join(", ")} ] = rows[i];`);
	let i = {}, a = {}, o = Array.from({ length: e.length });
	for (let r = 0; r < e.length; ++r) {
		let { field: s, path: c, codec: l, arrayDimensions: u } = e[r], d, f, p, m = !1;
		H(s, U) ? (m = !0, d = s, p = `field: decoder${r}`) : H(s, J) ? (d = s.decoder, p = `field: { decoder: decoder${r} }`) : H(s, G) ? (d = s._.sql.decoder, p = `field: { _: { sql: { decoder: decoder${r} } } }`) : (d = s.sql.decoder, p = `field: { sql: { decoder: decoder${r} } }`), f = `decoder${r}.mapFromDriverValue`, d.mapFromDriverValue.isNoop && (f = ""), f ? n.push(`const { ${p}${l ? `, codec: codec${r}` : ""} } = columns[${r}];`) : l && n.push(`const { codec: codec${r} } = columns[${r}];`);
		let h = `c${r}`, g = h;
		if (l && (g = `codec${r}(${g}, ${u})`), f && (g = `${f}(${g})`), o[r] = h === g ? `${h}` : `${h} === null ? ${h} : ${g}`, c.length !== 2 || !m) continue;
		a[c[0]] === void 0 ? a[c[0]] = [`c${r}`] : a[c[0]]?.push(`c${r}`);
		let [_] = c, v = Md(s.table);
		i[_] = t[v] ? !1 : typeof i[_] == "string" ? i[_] === v ? v : !1 : v;
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
function Nf(e, t) {
	let n = `\t"use strict";
	const { columns } = this;
	const { length } = rows;
	const mapped = Array.from({ length });
	${Mf(e, t)}
	return mapped;
	//# sourceURL=drizzle:jit-query-mapper`;
	return Object.assign(new jf("rows", n).bind({ columns: e }), { body: `function jitQueryMapper (rows) {\n${n}\n}` });
}
function Pf(e) {
	if (!e) return !1;
	try {
		let e = new jf("input", "\"use strict\"; return input;")(!0);
		return e !== !0 && (console.warn("Unable to use jit mappers due to incompatibility: corrupted jit function output.\nFalling back to premade mappers.\nError details:"), console.error(`Expected to receive \`true\`, got: ${e}`)), !0;
	} catch (e) {
		return console.warn("Unable to use jit mappers due to incompatibility.\nFalling back to premade mappers.\nError details:"), console.error(e), !1;
	}
}
function Ff(e, t) {
	let n = e.map(({ field: e, codec: n, arrayDimensions: r, path: i }) => {
		let a, o;
		if (H(e, U)) {
			if (o = e, t && i.length === 2) {
				let t = i[0];
				a = (n, r) => {
					t in n ? typeof n[t] == "string" && n[t] !== Md(e.table) && (n[t] = !1) : n[t] = r === null ? Md(e.table) : !1;
				};
			}
		} else o = H(e, J) ? e.decoder : H(e, G) ? e._.sql.decoder : e.sql.decoder;
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
function If(e, t, n) {
	return Object.entries(e).reduce((e, [r, i]) => {
		if (typeof r != "string") return e;
		let a = t ? [...t, r] : [r];
		if (H(i, U)) e.push({
			path: a,
			field: i,
			codec: n?.get(i, "normalize"),
			arrayDimensions: i.dimensions,
			column: i
		});
		else if (H(i, J) || H(i, J.Aliased)) {
			let t = Lf(i);
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
		} else if (H(i, G)) {
			let t, r = Object.values(i._.selectedFields)[0], o;
			H(r, U) ? (t = r, o = r) : H(r, J) ? (t = Lf(r), o = r.decoder) : (t = Lf(r), o = r.sql.decoder), o && (i._.sql.decoder = o), e.push(t ? {
				path: a,
				field: i,
				codec: n?.get(t, "normalize"),
				arrayDimensions: t.dimensions,
				column: t
			} : {
				path: a,
				field: i
			});
		} else H(i, W) ? e.push(...If(i[W.Symbol.Columns], a, n)) : e.push(...If(i, a, n));
		return e;
	}, []);
}
function Lf(e) {
	let t = e.getSQL();
	if (H(t.decoder, U)) return t.decoder;
}
function Rf(e, t) {
	let n = Object.keys(e), r = Object.keys(t);
	if (n.length !== r.length) return !1;
	for (let [e, t] of n.entries()) if (t !== r[e]) return !1;
	return !0;
}
function zf(e, t) {
	let n = Object.entries(t).filter(([, e]) => e !== void 0).map(([t, n]) => H(n, J) || H(n, U) ? [t, n] : [t, new Hd(n, e[W.Symbol.Columns][t])]);
	if (n.length === 0) throw Error("No values to set");
	return Object.fromEntries(n);
}
function Bf(e, t) {
	for (let n of t) for (let t of Object.getOwnPropertyNames(n.prototype)) t !== "constructor" && Object.defineProperty(e.prototype, t, Object.getOwnPropertyDescriptor(n.prototype, t) || Object.create(null));
}
function Vf(e) {
	return e[W.Symbol.Columns];
}
function Hf(e) {
	return H(e, G) ? e._.alias : H(e, qd) ? e[K].name : H(e, J) ? void 0 : e[W.Symbol.IsAlias] ? e[W.Symbol.Name] : e[W.Symbol.BaseName];
}
function Uf(e, t) {
	return {
		name: typeof e == "string" && e.length > 0 ? e : "",
		config: typeof e == "object" ? e : t
	};
}
var Wf = typeof TextDecoder > "u" ? null : new TextDecoder();
function Gf(e) {
	throw Error("Didn't expect to get here");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/relations.js
var Kf = class {
	static [V] = "RelationV2";
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
}, qf = class extends Kf {
	static [V] = "OneV2";
	relationType = "one";
	optional;
	constructor(e, t, n, r) {
		super(t, n), this.alias = r?.alias, this.where = r?.where, r?.from && (this.sourceColumns = (Array.isArray(r.from) ? r.from : [r.from]).map((t) => (this.throughTable ??= t._.through ? e[t._.through._.tableName] : void 0, this.sourceColumnTableNames.push(t._.tableName), t._.column))), r?.to && (this.targetColumns = (Array.isArray(r.to) ? r.to : [r.to]).map((t) => (this.throughTable ??= t._.through ? e[t._.through._.tableName] : void 0, this.targetColumnTableNames.push(t._.tableName), t._.column))), this.throughTable && (this.through = {
			source: (Array.isArray(r?.from) ? r.from : r?.from ? [r.from] : []).map((e) => e._.through),
			target: (Array.isArray(r?.to) ? r.to : r?.to ? [r.to] : []).map((e) => e._.through)
		}), this.optional = r?.optional ?? !0;
	}
}, Jf = {
	and: $d,
	between: pf,
	eq: Zd,
	exists: df,
	gt: nf,
	gte: rf,
	ilike: _f,
	inArray: sf,
	arrayContains: yf,
	arrayContained: bf,
	arrayOverlaps: xf,
	isNull: lf,
	isNotNull: uf,
	like: hf,
	lt: af,
	lte: of,
	ne: Qd,
	not: tf,
	notBetween: mf,
	notExists: ff,
	notLike: gf,
	notIlike: vf,
	notInArray: cf,
	or: ef,
	sql: Y
}, Yf = {
	sql: Y,
	asc: Sf,
	desc: Cf
};
function Xf(e, t, n, r = !1, i = !1, a = !0) {
	let o = t ? 1 : e.length, s = n.map(({ field: e, codec: t, arrayDimensions: n }) => {
		let r;
		return r = H(e, U) ? e : H(e, J) ? e.decoder : H(e, J.Aliased) ? e.sql.decoder : H(e, W) || H(e, qd) ? Bd : e.getSQL().decoder, a && e.mapFromJsonValue ? (t) => e.mapFromJsonValue(t) : r.mapFromDriverValue.isNoop ? t ? (e) => t(e, n) : void 0 : t ? (e) => r.mapFromDriverValue(t(e, n)) : (e) => r.mapFromDriverValue(e);
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
					Xf(o[t.key], !1, t.selection, !1, i);
					continue;
				}
				Xf(o[t.key], !0, t.selection, !1, i);
				continue;
			}
			if (o[t.key] === null) continue;
			let a = s[e];
			a && (o[t.key] = a(o[t.key]));
		}
	}
	return e;
}
function Zf(e, t, n, r = !1, i = !1) {
	let a = t ? 1 : e.length, o = n.map(({ field: e, codec: t, arrayDimensions: n }) => {
		let r;
		return r = H(e, U) ? e : H(e, J) ? e.decoder : H(e, J.Aliased) ? e.sql.decoder : H(e, W) || H(e, qd) ? Bd : e.getSQL().decoder, r.mapFromDriverValue.isNoop ? t ? (e) => t(e, n) : void 0 : t ? (e) => r.mapFromDriverValue(t(e, n)) : (e) => r.mapFromDriverValue(e);
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
				t.isArray ? Xf(s, !1, t.selection, !1, i) : Xf(s, !0, t.selection, !1, i), l[t.key] = s;
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
function Qf({ selection: e, isFirst: t, parseJson: n, parseJsonIfString: r, rootJsonMappers: i, arrayModeRoot: a }) {
	return ((o) => t && !o[0] ? o[0] : a ? Zf(t ? o[0] : o, t, e, n, r) : Xf(t ? o[0] : o, t, e, n, r, i));
}
function $f(e, t, n, r, i, a, o, s, c) {
	let l = [], u = [], d = !1, f = e.map(() => `c${s.n++}`), p = e.map((e, t) => c ? f[t] : `${JSON.stringify(e.key)}: ${f[t]}`);
	l.push(c ? `let [ ${p.join(", ")} ] = ${t};` : `let { ${p.join(", ")} } = ${t};`);
	for (let [t, { field: c, key: p, codec: m, isArray: h, selection: g, arrayDimensions: _ }] of e.entries()) {
		let e = `${n}[${t}]`, v = JSON.stringify(p), y = f[t];
		if (g) {
			r ? (l.push(`if (${y} !== null) ${y} = JSON.parse(${y});`), d = !0) : i && (l.push(`if (typeof ${y} === 'string') ${y} = JSON.parse(${y});`), d = !0);
			let t = `s${s.n++}`, n = o.length;
			if (o.push(`const { selection: ${t} } = ${e};`), h) {
				let e = `j${s.n++}`, r = $f(g, `${y}[${e}]`, t, !1, i, !0, o, s, !1);
				if (r.hasWork) {
					d = !0, l.push(`if (${y} !== null) {`), l.push(`\tfor (let ${e} = 0; ${e} < ${y}.length; ++${e}) {`);
					for (let e of r.bodyStmts) l.push(`\t\t${e}`);
					l.push(`\t\t${y}[${e}] = ${r.literal};`), l.push("	}"), l.push("}");
				} else o.splice(n, 1);
			} else {
				let e = $f(g, y, t, !1, i, !0, o, s, !1);
				if (e.hasWork) {
					d = !0, l.push(`if (${y} !== null) {`);
					for (let t of e.bodyStmts) l.push(`\t${t}`);
					l.push(`\t${y} = ${e.literal};`), l.push("}");
				} else o.splice(n, 1);
			}
			u.push(`${v}: ${y}`);
			continue;
		}
		let b = "", x = "", S = !1;
		if (H(c, U)) {
			if (a && c.mapFromJsonValue) {
				S = !0;
				let e = s.n++;
				x = `field: dec${e}`, b = `dec${e}.mapFromJsonValue`;
			} else if (!c.mapFromDriverValue.isNoop) {
				let e = s.n++;
				x = `field: dec${e}`, b = `dec${e}.mapFromDriverValue`;
			}
		} else if (H(c, J)) {
			if (a && c.decoder.mapFromJsonValue) {
				S = !0;
				let e = s.n++;
				x = `field: { decoder: dec${e} }`, b = `dec${e}.mapFromJsonValue`;
			} else if (!c.decoder.mapFromDriverValue.isNoop) {
				let e = s.n++;
				x = `field: { decoder: dec${e} }`, b = `dec${e}.mapFromDriverValue`;
			}
		} else if (H(c, J.Aliased)) {
			if (a && c.sql.decoder.mapFromJsonValue) {
				S = !0;
				let e = s.n++;
				x = `field: { sql: { decoder: dec${e} } }`, b = `dec${e}.mapFromJsonValue`;
			} else if (!c.sql.decoder.mapFromDriverValue.isNoop) {
				let e = s.n++;
				x = `field: { sql: { decoder: dec${e} } }`, b = `dec${e}.mapFromDriverValue`;
			}
		} else if (!(H(c, W) || H(c, qd))) {
			let t = c.getSQL();
			if (a && t.decoder.mapFromJsonValue) {
				S = !0;
				let t = s.n++;
				o.push(`const dec${t} = ${e}.field.getSQL().decoder;`), b = `dec${t}.mapFromJsonValue`;
			} else if (!t.decoder.mapFromDriverValue.isNoop) {
				let t = s.n++;
				o.push(`const dec${t} = ${e}.field.getSQL().decoder;`), b = `dec${t}.mapFromDriverValue`;
			}
		}
		let C = "";
		if (!S && m && (C = `codec${s.n++}`), x || C) {
			let t = [];
			x && t.push(x), C && t.push(`codec: ${C}`), o.push(`const { ${t.join(", ")} } = ${e};`);
		}
		if (b || C) {
			d = !0;
			let e = y;
			C && (e = `${C}(${e}, ${_})`), b && (e = `${b}(${e})`), u.push(`${v}: ${y} === null ? null : ${e}`);
		} else u.push(`${v}: ${y}`);
	}
	return {
		bodyStmts: l,
		literal: `{ ${u.join(", ")} }`,
		hasWork: d
	};
}
function ep({ selection: e, isFirst: t, parseJson: n, parseJsonIfString: r, rootJsonMappers: i, arrayModeRoot: a }) {
	let o = [], s = $f(e, "row", "selection", n, r, a ? !1 : i, o, { n: 0 }, !!a), c = [];
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
	return Object.assign(new jf("rows", l).bind({ selection: e }), { body: `function jitRqbMapper (rows) {\n${l}\n}` });
}
function tp(e, t) {
	let n = e[Td][t];
	return n ? H(n, U) ? n : H(n, J.Aliased) ? Y`${e}.${Y.identifier(n.fieldAlias)}` : Y`${e}.${Y.identifier(t)}` : Y`${e}.${Y.identifier(t)}`;
}
function np(e, t) {
	if (typeof t != "object" || H(t, Wd)) return Zd(e, t);
	let n = Object.entries(t);
	if (!n.length) return;
	let r = [];
	for (let [t, i] of n) if (i !== void 0) switch (t) {
		case "NOT": {
			let t = np(e, i);
			if (!t) continue;
			r.push(tf(t));
			continue;
		}
		case "OR":
			if (!i.length) continue;
			r.push(ef(...i.map((t) => np(e, t))));
			continue;
		case "AND":
			if (!i.length) continue;
			r.push($d(...i.map((t) => np(e, t))));
			continue;
		case "isNotNull":
		case "isNull":
			if (!i) continue;
			r.push(Jf[t](e));
			continue;
		case "in":
			r.push(Jf.inArray(e, i));
			continue;
		case "notIn":
			r.push(Jf.notInArray(e, i));
			continue;
		default:
			r.push(Jf[t](e, i));
			continue;
	}
	if (r.length) return $d(...r);
}
function rp(e, t, n = {}, r = {}, i = 0) {
	let a = Object.entries(t);
	if (!a.length) return;
	let o = [];
	for (let [t, s] of a) if (s !== void 0) switch (t) {
		case "RAW": {
			let t = typeof s == "function" ? s(e, Jf) : s.getSQL();
			o.push(t);
			continue;
		}
		case "OR":
			if (!s?.length) continue;
			o.push(ef(...s.map((t) => rp(e, t, n, r, i))));
			continue;
		case "AND":
			if (!s?.length) continue;
			o.push($d(...s.map((t) => rp(e, t, n, r, i))));
			continue;
		case "NOT": {
			if (s === void 0) continue;
			let t = rp(e, s, n, r, i);
			if (!t) continue;
			o.push(tf(t));
			continue;
		}
		default: {
			if (e[Td][t]) {
				let n = np(tp(e, t), s);
				n && o.push(n);
				continue;
			}
			let a = n[t];
			if (!a) throw new Jd({ message: `Unknown relational filter field: "${t}"` });
			let c = Of(a.targetTable, `f${i}`), l = a.throughTable ? Of(a.throughTable, `ft${i}`) : void 0, u = r[a.targetTableName], { filter: d, joinCondition: f } = op(a, e, c, l), p = $d(d, typeof s == "boolean" ? void 0 : rp(c, s, u.relations, r, i + 1)), m = l ? Y`(select * from ${sp(c)} inner join ${sp(l)} on ${f}${Y` where ${p}`.if(p)} limit 1)` : Y`(select * from ${sp(c)}${Y` where ${p}`.if(p)} limit 1)`;
			p && o.push((s ? df : ff)(m));
		}
	}
	return $d(...o);
}
function ip(e, t) {
	if (typeof t == "function") {
		let n = t(e, Yf);
		return H(n, J) ? n : Array.isArray(n) ? n.length ? Y.join(n.map((e) => H(e, J) ? e : Sf(e)), Y`, `) : void 0 : H(n, U) ? Sf(n) : void 0;
	}
	let n = Object.entries(t).filter(([e, t]) => t);
	if (n.length) return Y.join(n.map(([t, n]) => (n === "asc" ? Sf : Cf)(tp(e, t))), Y`, `);
}
function ap(e, t, n, r) {
	let i = [], a = [];
	for (let [o, s] of Object.entries(t)) {
		if (!s) continue;
		let t = (typeof s == "function" ? s(e, { sql: Jf.sql }) : s).getSQL(), c = n ? Lf(t) : void 0, l = c && (!r || !c.jsonSelectIdentifier) ? Y`${n.apply(c, r ? "castInJson" : "cast", Y`(${t})`)} as ${Y.identifier(o)}` : Y`(${t}) as ${Y.identifier(o)}`;
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
		sql: i.length ? Y.join(i, Y`, `) : void 0,
		selection: a
	};
}
function op(e, t, n, r) {
	if (e.through) {
		let i = e.sourceColumns.map((n, i) => {
			let a = e.through.source[i];
			return Zd(Y`${t}.${Y.identifier(n.name)}`, Y`${r}.${Y.identifier(H(a._.column, U) ? a._.column.name : a._.key)}`);
		}), a = e.targetColumns.map((t, i) => {
			let a = e.through.target[i];
			return Zd(Y`${r}.${Y.identifier(H(a._.column, U) ? a._.column.name : a._.key)}`, Y`${n}.${Y.identifier(t.name)}`);
		});
		return {
			filter: $d(e.where ? rp(e.isReversed ? t : n, e.where) : void 0, ...i),
			joinCondition: $d(...a)
		};
	}
	return { filter: $d(...e.sourceColumns.map((r, i) => {
		let a = e.targetColumns[i];
		return Zd(Y`${t}.${Y.identifier(r.name)}`, Y`${n}.${Y.identifier(a.name)}`);
	}), e.where ? rp(e.isReversed ? t : n, e.where) : void 0) };
}
function sp(e) {
	return Y`${e[kd] ? Y`${Y`${Y.identifier(e[wd] ?? "")}.`.if(e[wd])}${Y.identifier(e[Dd])} as ${e}` : e}`;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/column-builder.js
var cp = class {
	static [V] = "ColumnBuilder";
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
}, lp = class {
	static [V] = "ConsoleLogWriter";
	write(e) {
		console.log(e);
	}
}, up = class {
	static [V] = "DefaultLogger";
	writer;
	constructor(e) {
		this.writer = e?.writer ?? new lp();
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
}, dp = class {
	static [V] = "NoopLogger";
	logQuery() {}
}, fp = class e extends J {
	static [V] = "SQLiteCountBuilder";
	dialect;
	session;
	static buildCount(e, t, n) {
		let r = Y`select count(*) from ${e}${Y` where ${t}`.if(t)}`;
		return n ? Y`(${r})` : r;
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
}, pp = class extends fp {
	static [V] = "SQLiteAsyncCountBuilder";
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
Bf(pp, [bd]);
var mp = class extends pp {
	static [V] = "SQLiteSyncCountBuilder";
	sync(e) {
		return this.executeRaw(e).sync();
	}
}, hp = class {
	static [V] = "SQLiteRelationalQueryBuilderV2";
	constructor(e, t, n, r, i, a, o, s = gp) {
		this.mode = e, this.schema = t, this.table = n, this.tableConfig = r, this.dialect = i, this.session = a, this.forbidJsonb = o, this.builder = s;
	}
	findMany(e) {
		return new this.builder(this.mode, this.schema, this.table, this.tableConfig, this.dialect, this.session, e ?? !0, "many", this.forbidJsonb);
	}
	findFirst(e) {
		return new this.builder(this.mode, this.schema, this.table, this.tableConfig, this.dialect, this.session, e ?? !0, "first", this.forbidJsonb);
	}
}, gp = class {
	static [V] = "SQLiteRelationalQueryV2";
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
		let e = this.forbidJsonb ? Y`json` : Y`jsonb`;
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
}, _p = class extends gp {
	static [V] = "SQLiteAsyncRelationalQueryV2";
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
}, vp = class extends _p {
	static [V] = "SQLiteSyncRelationalQueryV2";
	sync(e) {
		return this._prepare().execute(e).sync();
	}
};
Bf(_p, [bd]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/selection-proxy.js
var Z = class e {
	static [V] = "SelectionProxyHandler";
	config;
	constructor(e) {
		this.config = { ...e };
	}
	get(t, n) {
		if (n === "_") return {
			...t._,
			selectedFields: new Proxy(t._.selectedFields, this)
		};
		if (n === K) return {
			...t[K],
			selectedFields: new Proxy(t[K].selectedFields, this)
		};
		if (typeof n == "symbol") return t[n];
		let r = (H(t, G) ? t._.selectedFields : H(t, qd) ? t[K].selectedFields : t)[n];
		if (H(r, J.Aliased)) {
			if (this.config.sqlAliasedBehavior === "sql" && !r.isSelectionField) return r.sql;
			let e = r.clone();
			return e.isSelectionField = !0, e.origin = this.config.alias, e;
		}
		if (H(r, J)) {
			if (this.config.sqlBehavior === "sql") return r;
			throw Error(`You tried to reference "${n}" field from a subquery, which is a raw SQL field, but it doesn't have an alias declared. Please add an alias to the field using ".as('alias')" method.`);
		}
		return H(r, U) ? this.config.alias ? new Proxy(r, new wf(new Proxy(r.table, new Ef(this.config.alias, this.config.replaceOriginalName ?? !1, !0)), !0)) : r : typeof r != "object" || !r ? r : new Proxy(r, new e(this.config));
	}
}, yp = class {
	static [V] = "SQLiteForeignKeyBuilder";
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
		return new bp(e, this);
	}
}, bp = class {
	static [V] = "SQLiteForeignKey";
	reference;
	onUpdate;
	onDelete;
	constructor(e, t) {
		this.table = e, this.reference = t.reference, this.onUpdate = t._onUpdate, this.onDelete = t._onDelete;
	}
	getName() {
		let { name: e, columns: t, foreignColumns: n } = this.reference(), r = t.map((e) => e.name), i = n.map((e) => e.name), a = [
			this.table[Cd],
			...r,
			n[0].table[Cd],
			...i
		];
		return e ?? `${a.join("_")}_fk`;
	}
	isNameExplicit() {
		return !!this.reference().name;
	}
}, xp = class extends cp {
	static [V] = "SQLiteColumnBuilder";
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
			let i = new yp(() => {
				let t = n();
				return {
					columns: [e],
					foreignColumns: [t]
				};
			});
			return r.onUpdate && i.onUpdate(r.onUpdate), r.onDelete && i.onDelete(r.onDelete), i.build(t);
		})(n, r));
	}
}, Q = class extends U {
	static [V] = "SQLiteColumn";
	table;
	constructor(e, t) {
		super(e, t), this.table = e;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/sqlite-core/columns/blob.js
function Sp(e) {
	let t = "";
	for (let n = 0; n < e.length; n += 2) {
		let r = e.slice(n, n + 2), i = Number.parseInt(r, 16);
		t += String.fromCodePoint(i);
	}
	return t;
}
var Cp = class extends xp {
	static [V] = "SQLiteBigIntBuilder";
	constructor(e) {
		super(e, "bigint int64", "SQLiteBigInt");
	}
	build(e) {
		return new wp(e, this.config);
	}
}, wp = class extends Q {
	static [V] = "SQLiteBigInt";
	getSQLType() {
		return "blob";
	}
	mapFromDriverValue = (e) => {
		if (typeof e == "string") return BigInt(Sp(e));
		if (typeof Buffer < "u" && Buffer.from) {
			let t = Buffer.isBuffer(e) ? e : e instanceof ArrayBuffer ? Buffer.from(e) : e.buffer ? Buffer.from(e.buffer, e.byteOffset, e.byteLength) : Buffer.from(e);
			return BigInt(t.toString("utf8"));
		}
		return BigInt(Wf.decode(e));
	};
	mapToDriverValue = (e) => Buffer.from(e.toString());
}, Tp = class extends xp {
	static [V] = "SQLiteBlobJsonBuilder";
	constructor(e) {
		super(e, "object json", "SQLiteBlobJson");
	}
	build(e) {
		return new Ep(e, this.config);
	}
}, Ep = class extends Q {
	static [V] = "SQLiteBlobJson";
	getSQLType() {
		return "blob";
	}
	mapFromDriverValue = (e) => {
		if (typeof e == "string") return JSON.parse(Sp(e));
		if (typeof Buffer < "u" && Buffer.from) {
			let t = Buffer.isBuffer(e) ? e : e instanceof ArrayBuffer ? Buffer.from(e) : e.buffer ? Buffer.from(e.buffer, e.byteOffset, e.byteLength) : Buffer.from(e);
			return JSON.parse(t.toString("utf8"));
		}
		return JSON.parse(Wf.decode(e));
	};
	mapToDriverValue = (e) => Buffer.from(JSON.stringify(e));
}, Dp = class extends xp {
	static [V] = "SQLiteBlobBufferBuilder";
	constructor(e) {
		super(e, "object buffer", "SQLiteBlobBuffer");
	}
	build(e) {
		return new Op(e, this.config);
	}
}, Op = class extends Q {
	static [V] = "SQLiteBlobBuffer";
	mapFromDriverValue = (e) => Buffer.isBuffer(e) ? e : typeof e == "string" ? Buffer.from(e, "hex") : Buffer.from(e);
	getSQLType() {
		return "blob";
	}
};
function kp(e, t) {
	let { name: n, config: r } = Uf(e, t);
	return r?.mode === "bigint" ? new Cp(n) : r?.mode === "buffer" ? new Dp(n) : new Tp(n);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/sqlite-core/columns/custom.js
var Ap = class extends xp {
	static [V] = "SQLiteCustomColumnBuilder";
	constructor(e, t, n) {
		super(e, "custom", "SQLiteCustomColumn"), this.config.fieldConfig = t, this.config.customTypeParams = n;
	}
	build(e) {
		return new jp(e, this.config);
	}
}, jp = class extends Q {
	static [V] = "SQLiteCustomColumn";
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
function Mp(e) {
	return (t, n) => {
		let { name: r, config: i } = Uf(t, n);
		return new Ap(r, i, e);
	};
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/sqlite-core/columns/integer.js
var Np = class extends xp {
	static [V] = "SQLiteBaseIntegerBuilder";
	constructor(e, t, n) {
		super(e, t, n), this.config.autoIncrement = !1;
	}
	primaryKey(e) {
		return e?.autoIncrement && (this.config.autoIncrement = !0), this.config.hasDefault = !0, super.primaryKey();
	}
}, Pp = class extends Q {
	static [V] = "SQLiteBaseInteger";
	autoIncrement = this.config.autoIncrement;
	getSQLType() {
		return "integer";
	}
}, Fp = class extends Np {
	static [V] = "SQLiteIntegerBuilder";
	constructor(e) {
		super(e, "number int53", "SQLiteInteger");
	}
	build(e) {
		return new Ip(e, this.config);
	}
}, Ip = class extends Pp {
	static [V] = "SQLiteInteger";
}, Lp = class extends Np {
	static [V] = "SQLiteTimestampBuilder";
	constructor(e, t) {
		super(e, "object date", "SQLiteTimestamp"), this.config.mode = t;
	}
	defaultNow() {
		return this.default(Y`(cast((julianday('now') - 2440587.5)*86400000 as integer))`);
	}
	build(e) {
		return new Rp(e, this.config);
	}
}, Rp = class extends Pp {
	static [V] = "SQLiteTimestamp";
	mode = this.config.mode;
	mapFromDriverValue = (e) => typeof e == "string" ? new Date(e.replaceAll("\"", "")) : this.config.mode === "timestamp" ? /* @__PURE__ */ new Date(e * 1e3) : new Date(e);
	mapToDriverValue = (e) => {
		if (typeof e == "number") return e;
		let t = e.getTime();
		return this.config.mode === "timestamp" ? Math.floor(t / 1e3) : t;
	};
}, zp = class extends Np {
	static [V] = "SQLiteBooleanBuilder";
	constructor(e, t) {
		super(e, "boolean", "SQLiteBoolean"), this.config.mode = t;
	}
	build(e) {
		return new Bp(e, this.config);
	}
}, Bp = class extends Pp {
	static [V] = "SQLiteBoolean";
	mode = this.config.mode;
	mapFromDriverValue = (e) => Number(e) === 1;
	mapToDriverValue = (e) => +!!e;
};
function Vp(e, t) {
	let { name: n, config: r } = Uf(e, t);
	return r?.mode === "timestamp" || r?.mode === "timestamp_ms" ? new Lp(n, r.mode) : r?.mode === "boolean" ? new zp(n, r.mode) : new Fp(n);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/sqlite-core/columns/numeric.js
var Hp = class extends xp {
	static [V] = "SQLiteNumericBuilder";
	constructor(e) {
		super(e, "string numeric", "SQLiteNumeric");
	}
	build(e) {
		return new Up(e, this.config);
	}
}, Up = class extends Q {
	static [V] = "SQLiteNumeric";
	mapFromDriverValue = (e) => typeof e == "string" ? e : String(e);
	getSQLType() {
		return "numeric";
	}
}, Wp = class extends xp {
	static [V] = "SQLiteNumericNumberBuilder";
	constructor(e) {
		super(e, "number", "SQLiteNumericNumber");
	}
	build(e) {
		return new Gp(e, this.config);
	}
}, Gp = class extends Q {
	static [V] = "SQLiteNumericNumber";
	mapFromDriverValue = (e) => typeof e == "number" ? e : Number(e);
	mapToDriverValue = String;
	getSQLType() {
		return "numeric";
	}
}, Kp = class extends xp {
	static [V] = "SQLiteNumericBigIntBuilder";
	constructor(e) {
		super(e, "bigint int64", "SQLiteNumericBigInt");
	}
	build(e) {
		return new qp(e, this.config);
	}
}, qp = class extends Q {
	static [V] = "SQLiteNumericBigInt";
	mapFromDriverValue = BigInt;
	mapToDriverValue = String;
	getSQLType() {
		return "numeric";
	}
};
function Jp(e, t) {
	let { name: n, config: r } = Uf(e, t), i = r?.mode;
	return i === "number" ? new Wp(n) : i === "bigint" ? new Kp(n) : new Hp(n);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/sqlite-core/columns/real.js
var Yp = class extends xp {
	static [V] = "SQLiteRealBuilder";
	constructor(e) {
		super(e, "number double", "SQLiteReal");
	}
	build(e) {
		return new Xp(e, this.config);
	}
}, Xp = class extends Q {
	static [V] = "SQLiteReal";
	getSQLType() {
		return "real";
	}
};
function Zp(e) {
	return new Yp(e ?? "");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/sqlite-core/columns/text.js
var Qp = class extends xp {
	static [V] = "SQLiteTextBuilder";
	constructor(e, t) {
		super(e, t.enum?.length ? "string enum" : "string", "SQLiteText"), this.config.enumValues = t.enum, this.config.length = t.length;
	}
	build(e) {
		return new $p(e, this.config);
	}
}, $p = class extends Q {
	static [V] = "SQLiteText";
	enumValues = this.config.enumValues;
	constructor(e, t) {
		super(e, t);
	}
	getSQLType() {
		return `text${this.config.length ? `(${this.config.length})` : ""}`;
	}
}, em = class extends xp {
	static [V] = "SQLiteTextJsonBuilder";
	constructor(e) {
		super(e, "object json", "SQLiteTextJson");
	}
	build(e) {
		return new tm(e, this.config);
	}
}, tm = class extends Q {
	static [V] = "SQLiteTextJson";
	getSQLType() {
		return "text";
	}
	mapFromDriverValue = (e) => JSON.parse(e);
	mapToDriverValue = (e) => JSON.stringify(e);
};
function nm(e, t = {}) {
	let { name: n, config: r } = Uf(e, t);
	return r.mode === "json" ? new em(n) : new Qp(n, r);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/sqlite-core/columns/all.js
function rm() {
	return {
		blob: kp,
		customType: Mp,
		integer: Vp,
		numeric: Jp,
		real: Zp,
		text: nm
	};
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/casing.js
function im(e) {
	return (e.replace(/['\u2019]/g, "").match(/[\da-z]+|[A-Z]+(?![a-z])|[A-Z][\da-z]+/g) ?? []).map((e) => e.toLowerCase()).join("_");
}
function am(e) {
	return (e.replace(/['\u2019]/g, "").match(/[\da-z]+|[A-Z]+(?![a-z])|[A-Z][\da-z]+/g) ?? []).reduce((e, t, n) => e + (n === 0 ? t.toLowerCase() : `${t[0].toUpperCase()}${t.slice(1)}`), "");
}
function om(e) {
	return e === "snake_case" ? im : e === "camelCase" ? am : (e) => e;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/sqlite-core/table.js
var sm = Symbol.for("drizzle:SQLiteInlineForeignKeys"), cm = class extends W {
	static [V] = "SQLiteTable";
	static Symbol = Object.assign({}, W.Symbol, { InlineForeignKeys: sm });
	[W.Symbol.Columns];
	[sm] = [];
	[W.Symbol.ExtraConfigBuilder] = void 0;
};
function lm(e, t, n, r, i, a = e) {
	let o = om(i), s = new cm(e, r, a), c = typeof t == "function" ? t(rm()) : t, l = Object.fromEntries(Object.entries(c).map(([e, t]) => {
		let n = t;
		n.setName(e, o);
		let r = n.build(s).postBuild();
		return s[sm].push(...n.buildForeignKeys(r, s)), [e, r];
	})), u = Object.assign(s, l);
	return u[W.Symbol.Columns] = l, u[W.Symbol.ExtraConfigColumns] = l, n && (u[cm.Symbol.ExtraConfigBuilder] = n), u;
}
function um(e) {
	return (t, n, r) => lm(t, n, r, void 0, e);
}
var dm = um(void 0);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/sqlite-core/utils.js
function fm(e) {
	return H(e, cm) ? [`${e[W.Symbol.BaseName]}`] : H(e, G) ? e._.usedTables ?? [] : H(e, J) ? e.usedTables ?? [] : [];
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/sqlite-core/query-builders/delete.js
var pm = class {
	static [V] = "SQLiteDelete";
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
			let t = e[0](new Proxy(this.config.table[W.Symbol.Columns], new Z({
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
	returning(e = this.table[cm.Symbol.Columns]) {
		return this.config.returning = If(e), this;
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
}, mm = class extends pm {
	static [V] = "SQLiteAsyncDelete";
	_prepare(e = !1) {
		return this.session.prepareQuery(this.dialect.sqlToQuery(this.getSQL()), "arrays", e, this.config.returning ? "all" : "run", this.config.returning ? this.dialect.mapperGenerators.rows(this.config.returning, void 0) : void 0, {
			type: "delete",
			tables: fm(this.config.table)
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
Bf(mm, [bd]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/sqlite-core/view-base.js
var hm = class extends qd {
	static [V] = "SQLiteViewBase";
}, gm = class {
	static [V] = "TypedQueryBuilder";
	getSelectedFields() {
		return this._.selectedFields;
	}
	withoutSelectionCastCodecs() {
		return this;
	}
}, _m = class {
	static [V] = "SQLiteSelectBuilder";
	fields;
	session;
	dialect;
	withList;
	distinct;
	constructor(e, t = vm) {
		this.builder = t, this.fields = e.fields, this.session = e.session, this.dialect = e.dialect, this.withList = e.withList, this.distinct = e.distinct;
	}
	from(e) {
		let t = !!this.fields, n;
		return n = this.fields ? this.fields : H(e, G) ? Object.fromEntries(Object.keys(e._.selectedFields).map((t) => [t, e[t]])) : H(e, hm) ? e[K].selectedFields : H(e, J) ? {} : Vf(e), new this.builder({
			table: e,
			fields: n,
			isPartialSelect: t,
			session: this.session,
			dialect: this.dialect,
			withList: this.withList ?? [],
			distinct: this.distinct
		});
	}
}, vm = class extends gm {
	static [V] = "SQLiteSelectQueryBuilder";
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
		}, this.tableName = Hf(e), this.joinsNotNullableMap = typeof this.tableName == "string" ? { [this.tableName]: !0 } : {};
		for (let t of fm(e)) this.usedTables.add(t);
	}
	getUsedTables() {
		return [...this.usedTables];
	}
	createJoin(e) {
		return (t, n) => {
			let r = this.tableName, i = Hf(t);
			for (let e of fm(t)) this.usedTables.add(e);
			if (typeof i == "string" && this.config.joins?.some((e) => e.alias === i)) throw Error(`Alias "${i}" is already used in this query`);
			if (!this.isPartialSelect && (Object.keys(this.joinsNotNullableMap).length === 1 && typeof r == "string" && (this.config.fields = { [r]: this.config.fields }), typeof i == "string" && !H(t, J))) {
				let e = H(t, G) ? t._.selectedFields : H(t, qd) ? t[K].selectedFields : t[W.Symbol.Columns];
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
			let r = typeof n == "function" ? n(bm()) : n;
			if (!Rf(this.getSelectedFields(), r.getSelectedFields())) throw Error("Set operator error (union / intersect / except): selected fields are not the same or are in a different order");
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
		return this.config.fieldsFlat = If(this.config.fields), this.dialect.buildSelectQuery(this.config);
	}
	toSQL() {
		return this.dialect.sqlToQuery(this.getSQL());
	}
	as(e) {
		let t = [];
		if (t.push(...fm(this.config.table)), this.config.joins) for (let e of this.config.joins) t.push(...fm(e.table));
		return new Proxy(new G(this.getSQL(), this.config.fields, e, !1, [...new Set(t)]), new Z({
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
function ym(e, t) {
	return (n, r, ...i) => {
		let a = [r, ...i].map((n) => ({
			type: e,
			isAll: t,
			rightSelect: n
		}));
		for (let e of a) if (!Rf(n.getSelectedFields(), e.rightSelect.getSelectedFields())) throw Error("Set operator error (union / intersect / except): selected fields are not the same or are in a different order");
		return n.addSetOperators(a);
	};
}
var bm = () => ({
	union: xm,
	unionAll: Sm,
	intersect: Cm,
	except: wm
}), xm = ym("union", !1), Sm = ym("union", !0), Cm = ym("intersect", !1), wm = ym("except", !1), Tm = class {
	static [V] = "SQLiteDialect";
	mapperGenerators;
	constructor(e) {
		this.mapperGenerators = e?.useJitMappers ? {
			rows: Nf,
			relationalRows: ep
		} : {
			rows: Ff,
			relationalRows: Qf
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
		let t = [Y`with `];
		for (let [n, r] of e.entries()) t.push(Y`${Y.identifier(r._.alias)} as (${r._.sql})`), n < e.length - 1 && t.push(Y`, `);
		return t.push(Y` `), Y.join(t);
	}
	buildDeleteQuery({ table: e, where: t, returning: n, withList: r, limit: i, orderBy: a }) {
		let o = this.buildWithCTE(r), s = n ? Y` returning ${this.buildSelection(n, { isSingleTable: !0 })}` : void 0;
		return Y`${o}delete from ${e}${t ? Y` where ${t}` : void 0}${s}${this.buildOrderBy(a)}${this.buildLimit(i)}`;
	}
	buildUpdateSet(e, t) {
		let n = e[W.Symbol.Columns], r = Object.keys(n).filter((e) => t[e] !== void 0 || n[e]?.onUpdateFn !== void 0), i = r.length;
		return Y.join(r.flatMap((e, r) => {
			let a = n[e], o = a.onUpdateFn?.(), s = t[e] ?? (H(o, J) ? o : Y.param(o, a)), c = Y`${Y.identifier(a.name)} = ${s}`;
			return r < i - 1 ? [c, Y.raw(", ")] : [c];
		}));
	}
	buildUpdateQuery({ table: e, set: t, where: n, returning: r, withList: i, joins: a, from: o, limit: s, orderBy: c }) {
		let l = this.buildWithCTE(i), u = this.buildUpdateSet(e, t), d = o && Y.join([Y.raw(" from "), this.buildFromTable(o)]), f = this.buildJoins(a), p = r ? Y` returning ${this.buildSelection(r, { isSingleTable: !0 })}` : void 0;
		return Y`${l}update ${e} set ${u}${d}${f}${n ? Y` where ${n}` : void 0}${p}${this.buildOrderBy(c)}${this.buildLimit(s)}`;
	}
	buildSelection(e, { isSingleTable: t = !1 } = {}) {
		let n = e.length, r = e.flatMap(({ field: e }, r) => {
			let i = [];
			if (H(e, J.Aliased)) if (e.isSelectionField) !t && e.origin !== void 0 && i.push(Y.identifier(e.origin), Y.raw(".")), i.push(Y.identifier(e.fieldAlias));
			else {
				let n = e.sql;
				if (t) {
					let e = new J(n.queryChunks.map((e) => H(e, U) ? Y.identifier(e.name) : e));
					i.push(n.shouldInlineParams ? e.inlineParams() : e);
				} else i.push(n);
				i.push(Y` as ${Y.identifier(e.fieldAlias)}`);
			}
			else if (H(e, J)) {
				let n = e;
				if (t) {
					let e = new J(n.queryChunks.map((e) => H(e, U) ? Y.identifier(e.name) : e));
					i.push(n.shouldInlineParams ? e.inlineParams() : e);
				} else i.push(n);
			} else H(e, U) ? e.columnType === "SQLiteNumericBigInt" || e.columnType === "SQLiteNumeric" ? t ? i.push(e.isAlias ? Y`cast(${Y.identifier(Af(e).name)} as text) as ${e}` : Y`cast(${Y.identifier(e.name)} as text)`) : i.push(e.isAlias ? Y`cast(${Af(e)} as text) as ${e}` : Y`cast(${e} as text)`) : t ? i.push(e.isAlias ? Y`${Y.identifier(Af(e).name)} as ${e}` : Y.identifier(e.name)) : i.push(e.isAlias ? Y`${Af(e)} as ${e}` : e) : H(e, G) && (e._.isWith ? i.push(e) : i.push(Y`(${e._.sql}) ${Y.identifier(e._.alias)}`));
			return r < n - 1 && i.push(Y`, `), i;
		});
		return Y.join(r);
	}
	buildJoins(e) {
		if (!e || e.length === 0) return;
		let t = [];
		if (e) for (let [n, r] of e.entries()) {
			n === 0 && t.push(Y` `);
			let i = r.table, a = r.on ? Y` on ${r.on}` : void 0;
			if (H(i, cm)) {
				let e = i[cm.Symbol.Name], n = i[cm.Symbol.Schema], o = i[cm.Symbol.OriginalName], s = e === o ? void 0 : r.alias;
				t.push(Y`${Y.raw(r.joinType)} join ${n ? Y`${Y.identifier(n)}.` : void 0}${Y.identifier(o)}${s && Y` ${Y.identifier(s)}`}${a}`);
			} else t.push(Y`${Y.raw(r.joinType)} join ${i}${a}`);
			n < e.length - 1 && t.push(Y` `);
		}
		return Y.join(t);
	}
	buildLimit(e) {
		return typeof e == "object" || typeof e == "number" && e >= 0 ? Y` limit ${e}` : void 0;
	}
	buildOrderBy(e) {
		let t = [];
		if (e) for (let [n, r] of e.entries()) t.push(r), n < e.length - 1 && t.push(Y`, `);
		return t.length > 0 ? Y` order by ${Y.join(t)}` : void 0;
	}
	buildFromTable(e) {
		if (H(e, W) && e[W.Symbol.IsAlias]) return Y`${Y`${Y.identifier(e[W.Symbol.Schema] ?? "")}.`.if(e[W.Symbol.Schema])}${Y.identifier(e[W.Symbol.OriginalName])} ${Y.identifier(e[W.Symbol.Name])}`;
		if (H(e, qd) && e[K].isAlias) {
			let t = Y`${Y.identifier(e[K].originalName)}`;
			return e[K].schema && (t = Y`${Y.identifier(e[K].schema)}.${t}`), Y`${t} ${Y.identifier(e[K].name)}`;
		}
		return e;
	}
	buildSelectQuery({ withList: e, fields: t, fieldsFlat: n, where: r, having: i, table: a, joins: o, orderBy: s, groupBy: c, limit: l, offset: u, distinct: d, setOperators: f }) {
		let p = n ?? If(t);
		for (let e of p) if (H(e.field, U) && Md(e.field.table) !== (H(a, G) ? a._.alias : H(a, hm) ? a[K].name : H(a, J) ? void 0 : Md(a)) && !((e) => o?.some(({ alias: t }) => t === (e[W.Symbol.IsAlias] ? Md(e) : e[W.Symbol.BaseName])))(e.field.table)) {
			let t = Md(e.field.table);
			throw Error(`Your "${e.path.join("->")}" field references a column "${t}"."${e.field.name}", but the table "${t}" is not part of the query! Did you forget to join it?`);
		}
		let m = !o || o.length === 0, h = this.buildWithCTE(e), g = d ? Y` distinct` : void 0, _ = this.buildSelection(p, { isSingleTable: m }), v = this.buildFromTable(a), y = this.buildJoins(o), b = r ? Y` where ${r}` : void 0, x = i ? Y` having ${i}` : void 0, S = [];
		if (c) for (let [e, t] of c.entries()) S.push(t), e < c.length - 1 && S.push(Y`, `);
		let C = Y`${h}select${g} ${_} from ${v}${y}${b}${S.length > 0 ? Y` group by ${Y.join(S)}` : void 0}${x}${this.buildOrderBy(s)}${this.buildLimit(l)}${u ? Y` offset ${u}` : void 0}`;
		return f.length > 0 ? this.buildSetOperations(C, f) : C;
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
		let s = Y`${e.getSQL()} `, c = Y`${r.getSQL()}`, l;
		if (a && a.length > 0) {
			let e = [];
			for (let t of a) if (H(t, Q)) e.push(Y.identifier(t.name));
			else if (H(t, J)) {
				for (let e = 0; e < t.queryChunks.length; e++) {
					let n = t.queryChunks[e];
					H(n, Q) && (t.queryChunks[e] = Y.identifier(n.name));
				}
				e.push(Y`${t}`);
			} else e.push(Y`${t}`);
			l = Y` order by ${Y.join(e, Y`, `)}`;
		}
		let u = typeof i == "object" || typeof i == "number" && i >= 0 ? Y` limit ${i}` : void 0, d = Y.raw(`${t} ${n ? "all " : ""}`), f = o ? Y` offset ${o}` : void 0;
		return Y`${s}${d}${c}${l}${u}${f}`;
	}
	buildInsertQuery({ table: e, values: t, onConflict: n, returning: r, withList: i, select: a }) {
		let o = [], s = e[W.Symbol.Columns], c = Object.entries(s), l = a && !H(t, J) ? Object.keys(t.getSelectedFields()).map((e) => [e, s[e]]) : c.filter(([e, t]) => !t.shouldDisableInsert()), u = l.map(([, e]) => Y.identifier(e.name));
		if (a) {
			let e = t;
			H(e, J) ? o.push(e) : o.push(e.getSQL());
		} else {
			let e = t;
			o.push(Y.raw("values "));
			for (let [t, n] of e.entries()) {
				let r = [];
				for (let [e, t] of l) {
					let i = n[e];
					if (i === void 0 || H(i, Hd) && i.value === void 0) {
						let e;
						if (t.default !== null && t.default !== void 0) e = H(t.default, J) ? t.default : Y.param(t.default, t);
						else if (t.defaultFn !== void 0) {
							let n = t.defaultFn();
							e = H(n, J) ? n : Y.param(n, t);
						} else if (!t.default && t.onUpdateFn !== void 0) {
							let n = t.onUpdateFn();
							e = H(n, J) ? n : Y.param(n, t);
						} else e = Y`null`;
						r.push(e);
					} else r.push(i);
				}
				o.push(r), t < e.length - 1 && o.push(Y`, `);
			}
		}
		let d = this.buildWithCTE(i), f = Y.join(o), p = r ? Y` returning ${this.buildSelection(r, { isSingleTable: !0 })}` : void 0;
		return Y`${d}insert into ${e} ${u} ${f}${n?.length ? Y.join(n) : void 0}${p}`;
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
		throw new Jd({ message: "Views with nested selections are not supported by the relational query builder" });
	}
	buildRqbColumn(e, t, n, r) {
		if (H(t, U)) {
			let i = Y`${e}.${Y.identifier(t.name)}`;
			switch (t.columnType) {
				case "SQLiteBigInt":
				case "SQLiteBlobJson":
				case "SQLiteBlobBuffer": return r ? Y`hex(${i}) as ${Y.identifier(n)}` : Y`${i} as ${Y.identifier(n)}`;
				case "SQLiteNumeric":
				case "SQLiteNumericNumber":
				case "SQLiteNumericBigInt": return Y`cast(${i} as text) as ${Y.identifier(n)}`;
				case "SQLiteCustomColumn": return r ? Y`${t.jsonSelectIdentifier(i, Y)} as ${Y.identifier(n)}` : Y`${i} as ${Y.identifier(n)}`;
				default: return Y`${i} as ${Y.identifier(n)}`;
			}
		}
		return Y`${e}.${H(t, J.Aliased) ? Y.identifier(t.fieldAlias) : Fd(t) ? Y.identifier(n) : this.nestedSelectionerror()} as ${Y.identifier(n)}`;
	}
	unwrapAllColumns = (e, t, n) => Y.join(Object.entries(e[Td]).map(([r, i]) => (t.push({
		key: r,
		field: i
	}), this.buildRqbColumn(e, i, r, n))), Y`, `);
	getSelectedTableColumns = (e, t) => {
		let n = [], r = e[Td], i = Object.entries(t), a;
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
		return i.length ? Y.join(i, Y`, `) : void 0;
	})() : this.unwrapAllColumns(e, t, n);
	buildRelationalQuery({ schema: e, table: t, tableConfig: n, queryConfig: r, relationWhere: i, mode: a, isNested: o, errorPath: s, depth: c, throughJoin: l, jsonb: u }) {
		let d = [], f = a === "first", p = r === !0 ? void 0 : r, m = s ?? "", h = c ?? 0;
		h || (t = Of(t, `d${h}`));
		let g = f ? 1 : p?.limit, _ = p?.offset, v = this.buildColumns(t, d, !!o, p), y = p?.where && i ? $d(rp(t, p.where, n.relations, e), i) : p?.where ? rp(t, p.where, n.relations, e) : i, b = p?.orderBy ? ip(t, p.orderBy) : void 0, x = p?.extras ? ap(t, p.extras) : void 0;
		x && d.push(...x.selection);
		let S = p ? (() => {
			let { with: r } = p;
			if (!r) return;
			let i = Object.entries(r).filter(([e, t]) => t);
			if (i.length) return Y.join(i.map(([r, i]) => {
				let a = n.relations[r], s = H(a, qf), c = Of(a.targetTable, `d${h + 1}`), l = a.throughTable ? Of(a.throughTable, `tr${h}`) : void 0, { filter: f, joinCondition: p } = op(a, t, c, l), g = l ? Y` inner join ${sp(l)} on ${p}` : void 0, _ = this.buildRelationalQuery({
					table: c,
					mode: s ? "first" : "many",
					schema: e,
					queryConfig: i,
					tableConfig: e[a.targetTableName],
					relationWhere: f,
					isNested: !0,
					errorPath: `${m.length ? `${m}.` : ""}${r}`,
					depth: h + 1,
					throughJoin: g,
					jsonb: u
				});
				d.push({
					field: c,
					key: r,
					selection: _.selection,
					isArray: !s,
					isOptional: (a.optional ?? !1) || i !== !0 && !!i.where
				});
				let v = Y.join(_.selection.map((e) => Y`${Y.raw(this.escapeString(e.key))}, ${e.selection ? Y`${u}(${Y.identifier(e.key)})` : Y.identifier(e.key)}`), Y`, `), y = o ? u : Y`json`;
				return s ? Y`(select ${y}_object(${v}) as ${Y.identifier("r")} from (${_.sql}) as ${Y.identifier("t")}) as ${Y.identifier(r)}` : Y`coalesce((select ${y}_group_array(json_object(${v})) as ${Y.identifier("r")} from (${_.sql}) as ${Y.identifier("t")}), ${u}_array()) as ${Y.identifier(r)}`;
			}), Y`, `);
		})() : void 0, C = [
			v,
			x?.sql,
			S
		].filter((e) => e !== void 0);
		if (!C.length) throw new Jd({ message: `No fields selected for table "${n.name}"${m ? ` ("${m}")` : ""}` });
		return {
			sql: Y`select ${Y.join(C, Y`, `)} from ${sp(t)}${l}${Y` where ${y}`.if(y)}${Y` order by ${b}`.if(b)}${Y` limit ${g}`.if(g !== void 0)}${Y` offset ${_}`.if(_ !== void 0)}`,
			selection: d
		};
	}
}, Em = class {
	static [V] = "SQLiteQueryBuilder";
	dialect;
	dialectConfig;
	constructor(e) {
		this.dialect = H(e, Tm) ? e : void 0, this.dialectConfig = H(e, Tm) ? void 0 : e;
	}
	$with = (e, t) => {
		let n = this;
		return { as: (r) => (typeof r == "function" && (r = r(n)), new Proxy(new Nd(r.getSQL(), t ?? ("getSelectedFields" in r ? r.getSelectedFields() ?? {} : {}), e, !0), new Z({
			alias: e,
			sqlAliasedBehavior: "alias",
			sqlBehavior: "error"
		}))) };
	};
	with(...e) {
		let t = this;
		function n(n) {
			return new _m({
				fields: n ?? void 0,
				session: void 0,
				dialect: t.getDialect(),
				withList: e
			});
		}
		function r(n) {
			return new _m({
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
		return new _m({
			fields: e ?? void 0,
			session: void 0,
			dialect: this.getDialect()
		});
	}
	selectDistinct(e) {
		return new _m({
			fields: e ?? void 0,
			session: void 0,
			dialect: this.getDialect(),
			distinct: !0
		});
	}
	getDialect() {
		return this.dialect ||= new Tm(this.dialectConfig), this.dialect;
	}
}, Dm = class {
	static [V] = "SQLiteInsertBuilder";
	constructor(e, t, n, r, i = Om) {
		this.table = e, this.session = t, this.dialect = n, this.withList = r, this.builder = i;
	}
	values(e) {
		if (e = Array.isArray(e) ? e : [e], e.length === 0) throw Error("values() must be called with at least one value");
		let t = e.map((e) => {
			let t = {}, n = this.table[W.Symbol.Columns];
			for (let r of Object.keys(e)) {
				let i = e[r];
				t[r] = H(i, J) ? i : new Hd(i, n[r]);
			}
			return t;
		});
		return new this.builder(this.table, t, this.session, this.dialect, this.withList);
	}
	select(e) {
		let t = typeof e == "function" ? e(new Em()) : e;
		if (!H(t, J)) {
			let e = Object.keys(this.table[W.Symbol.Columns]), n = Object.keys(t._.selectedFields);
			for (let t of n) if (!e.includes(t)) throw Error(`Insert select error: column "${t}" does not exist in table "${this.table[W.Symbol.Name]}"`);
		}
		return new this.builder(this.table, t, this.session, this.dialect, this.withList, !0);
	}
}, Om = class {
	static [V] = "SQLiteInsert";
	config;
	constructor(e, t, n, r, i, a) {
		this.session = n, this.dialect = r, this.config = {
			table: e,
			values: t,
			withList: i,
			select: a
		};
	}
	returning(e = this.config.table[cm.Symbol.Columns]) {
		return this.config.returning = If(e), this;
	}
	onConflictDoNothing(e = {}) {
		if (this.config.onConflict || (this.config.onConflict = []), e.target === void 0) this.config.onConflict.push(Y` on conflict do nothing`);
		else {
			let t = Array.isArray(e.target) ? Y`${e.target}` : Y`${[e.target]}`, n = e.where ? Y` where ${e.where}` : Y``;
			this.config.onConflict.push(Y` on conflict ${t} do nothing${n}`);
		}
		return this;
	}
	onConflictDoUpdate(e) {
		if (e.where && (e.targetWhere || e.setWhere)) throw Error("You cannot use both \"where\" and \"targetWhere\"/\"setWhere\" at the same time - \"where\" is deprecated, use \"targetWhere\" or \"setWhere\" instead.");
		this.config.onConflict || (this.config.onConflict = []);
		let t = e.where ? Y` where ${e.where}` : void 0, n = e.targetWhere ? Y` where ${e.targetWhere}` : void 0, r = e.setWhere ? Y` where ${e.setWhere}` : void 0, i = Array.isArray(e.target) ? Y`${e.target}` : Y`${[e.target]}`, a = this.dialect.buildUpdateSet(this.config.table, zf(this.config.table, e.set));
		return this.config.onConflict.push(Y` on conflict ${i}${n} do update set ${a}${t}${r}`), this;
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
}, km = class extends Om {
	static [V] = "SQLiteAsyncInsert";
	_prepare(e = !1) {
		return this.session.prepareQuery(this.dialect.sqlToQuery(this.getSQL()), "arrays", e, this.config.returning ? "all" : "run", this.config.returning ? this.dialect.mapperGenerators.rows(this.config.returning, void 0) : void 0, {
			type: "insert",
			tables: fm(this.config.table)
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
Bf(km, [bd]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/sqlite-core/query-builders/raw.js
var Am = class {
	static [V] = "SQLiteRaw";
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
}, jm = class extends Am {
	static [V] = "SQLiteAsyncRaw";
	constructor(e, t, n) {
		super(e, t, n);
	}
	execute(e) {
		return this.prepared.execute(e);
	}
};
Bf(jm, [bd]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/sqlite-core/async/select.js
var Mm = class extends vm {
	static [V] = "SQLiteAsyncSelect";
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
Bf(Mm, [bd]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/sqlite-core/query-builders/update.js
var Nm = class {
	static [V] = "SQLiteUpdateBuilder";
	constructor(e, t, n, r, i = Pm) {
		this.table = e, this.session = t, this.dialect = n, this.withList = r, this.builder = i;
	}
	set(e) {
		return new this.builder(this.table, zf(this.table, e), this.session, this.dialect, this.withList);
	}
}, Pm = class {
	static [V] = "SQLiteUpdate";
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
			let r = Hf(t);
			if (typeof r == "string" && this.config.joins.some((e) => e.alias === r)) throw Error(`Alias "${r}" is already used in this query`);
			if (typeof n == "function") {
				let e = this.config.from ? H(t, cm) ? t[W.Symbol.Columns] : H(t, G) ? t._.selectedFields : H(t, hm) ? t[K].selectedFields : void 0 : void 0;
				n = n(new Proxy(this.config.table[W.Symbol.Columns], new Z({
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
			let t = e[0](new Proxy(this.config.table[W.Symbol.Columns], new Z({
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
	returning(e = this.config.table[cm.Symbol.Columns]) {
		return this.config.returning = If(e), this;
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
}, Fm = class extends Pm {
	static [V] = "SQLiteAsyncUpdate";
	_prepare(e = !1) {
		return this.session.prepareQuery(this.dialect.sqlToQuery(this.getSQL()), "arrays", e, this.config.returning ? "all" : "run", this.config.returning ? this.dialect.mapperGenerators.rows(this.config.returning, void 0) : void 0, {
			type: "update",
			tables: fm(this.config.table)
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
Bf(Fm, [bd]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/sqlite-core/async/db.js
var Im = class {
	static [V] = "BaseSQLiteDatabase";
	query;
	constructor(e, t, n, r, i) {
		this.resultKind = e, this.dialect = t, this.session = n, this.forbidJsonb = i, this._ = {
			relations: r,
			session: n,
			resultKind: e
		}, this.query = {};
		for (let [a, o] of Object.entries(r)) this.query[a] = new hp(e, r, r[o.name].table, o, t, n, i, e === "sync" ? vp : _p);
		this.$cache = { invalidate: async (e) => {} };
	}
	$with = (e, t) => {
		let n = this;
		return { as: (r) => (typeof r == "function" && (r = r(new Em(n.dialect))), new Proxy(new Nd(r.getSQL(), t ?? ("getSelectedFields" in r ? r.getSelectedFields() ?? {} : {}), e, !0), new Z({
			alias: e,
			sqlAliasedBehavior: "alias",
			sqlBehavior: "error"
		}))) };
	};
	$count(e, t) {
		return this.resultKind === "async" ? new pp({
			source: e,
			filters: t,
			session: this.session,
			dialect: this.dialect
		}) : new mp({
			source: e,
			filters: t,
			session: this.session,
			dialect: this.dialect
		});
	}
	with(...e) {
		let t = this;
		function n(n) {
			return new _m({
				fields: n ?? void 0,
				session: t.session,
				dialect: t.dialect,
				withList: e
			}, Mm);
		}
		function r(n) {
			return new _m({
				fields: n ?? void 0,
				session: t.session,
				dialect: t.dialect,
				withList: e,
				distinct: !0
			}, Mm);
		}
		function i(n) {
			return new Nm(n, t.session, t.dialect, e, Fm);
		}
		function a(n) {
			return new Dm(n, t.session, t.dialect, e, km);
		}
		function o(n) {
			return new mm(n, t.session, t.dialect, e);
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
		return new _m({
			fields: e ?? void 0,
			session: this.session,
			dialect: this.dialect
		}, Mm);
	}
	selectDistinct(e) {
		return new _m({
			fields: e ?? void 0,
			session: this.session,
			dialect: this.dialect,
			distinct: !0
		}, Mm);
	}
	update(e) {
		return new Nm(e, this.session, this.dialect, void 0, Fm);
	}
	$cache;
	insert(e) {
		return new Dm(e, this.session, this.dialect, void 0, km);
	}
	delete(e) {
		return new mm(e, this.session, this.dialect);
	}
	run(e) {
		let t = typeof e == "string" ? Y.raw(e) : e.getSQL(), n = this.dialect.sqlToQuery(t), r = this.session.prepareQuery(n, "raw", !1, "run");
		return this.resultKind === "async" ? new jm(r, t, n) : this.session.run(t);
	}
	all(e) {
		let t = typeof e == "string" ? Y.raw(e) : e.getSQL(), n = this.dialect.sqlToQuery(t), r = this.session.prepareQuery(n, "objects", !1, "all");
		return this.resultKind === "async" ? new jm(r, t, n) : this.session.objects(t);
	}
	get(e) {
		let t = typeof e == "string" ? Y.raw(e) : e.getSQL(), n = this.dialect.sqlToQuery(t), r = this.session.prepareQuery(n, "objects", !1, "get");
		return this.resultKind === "async" ? new jm(r, t, n) : this.session.object(t);
	}
	values(e) {
		let t = typeof e == "string" ? Y.raw(e) : e.getSQL(), n = this.dialect.sqlToQuery(t), r = this.session.prepareQuery(n, "objects", !1, "values");
		return this.resultKind === "async" ? new jm(r, t, n) : this.session.arrays(t);
	}
	transaction(e, t) {
		return this.session.transaction(e, t);
	}
}, Lm = class {
	static [V] = "Cache";
}, Rm = class extends Lm {
	static [V] = "NoopCache";
	strategy() {
		return "all";
	}
	async get(e) {}
	async put(e, t, n, r) {}
	async onMutate(e) {}
}, zm = async (e, t, n, r) => {
	if (!n) return { type: "skip" };
	let { type: i, tables: a } = n;
	return (i === "insert" || i === "update" || i === "delete") && a.length > 0 ? {
		type: "invalidate",
		tables: a
	} : !r || !r.enabled ? { type: "skip" } : i === "select" ? {
		type: "try",
		key: r.tag ?? await Bm(e, t),
		isTag: r.tag !== void 0,
		autoInvalidate: r.autoInvalidate,
		tables: n.tables,
		config: r.config
	} : { type: "skip" };
};
async function Bm(e, t) {
	let n = `${e}-${JSON.stringify(t, (e, t) => typeof t == "bigint" ? `${t}n` : t)}`, r = new TextEncoder().encode(n), i = await crypto.subtle.digest("SHA-256", r);
	return [...new Uint8Array(i)].map((e) => e.toString(16).padStart(2, "0")).join("");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+1fc2f33786c67f8f/node_modules/drizzle-orm/sqlite-core/session.js
var Vm = class {
	static [V] = "SQLiteBasePreparedQuery";
	mapper;
	executeMethod;
	constructor(e, t, n, r) {
		this.query = t, this.mode = r, this.mapper = n, this.executeMethod = e;
	}
	getQuery() {
		return this.query;
	}
}, Hm = class {
	static [V] = "SQLiteSession";
	constructor(e) {
		this.dialect = e;
	}
}, Um = class extends bd {
	static [V] = "ExecuteResultSync";
	constructor(e) {
		super(), this.resultCb = e;
	}
	async execute() {
		return this.resultCb();
	}
	sync() {
		return this.resultCb();
	}
}, Wm = class extends Vm {
	static [V] = "SQLiteAsyncPreparedQuery";
	fastPath;
	constructor(e, t = "all", n, r, i, a, o, s, c, l) {
		super(t, r, i, a), this.resultKind = e, this.executors = n, this.logger = o, this.cache = s, this.queryMetadata = c, this.cacheConfig = l, s && s.strategy() === "all" && l === void 0 && (this.cacheConfig = {
			enabled: !0,
			autoInvalidate: !0
		}), this.cacheConfig?.enabled || (this.cacheConfig = void 0), this.fastPath = l === void 0 && (s === void 0 || H(s, Rm));
	}
	async queryWithCache(e, t, n, r) {
		let i = this.cache !== void 0 && !H(this.cache, Rm) ? await zm(e, t, this.queryMetadata, this.cacheConfig) : { type: "skip" };
		if (i.type === "skip") return r().catch((n) => {
			throw new Yd(e, t, n);
		});
		let a = this.cache;
		if (i.type === "invalidate") return Promise.all([r(), a.onMutate({ tables: i.tables })]).then((e) => e[0]).catch((n) => {
			throw new Yd(e, t, n);
		});
		if (i.type === "try") {
			let { tables: o, key: s, isTag: c, autoInvalidate: l, config: u } = i, d = `${n}_${s}`, f = await a.get(d, o, c, l);
			if (f === void 0) {
				let n = await r().catch((n) => {
					throw new Yd(e, t, n);
				});
				return await a.put(d, n, l ? o : [], c, u), n;
			}
			return f;
		}
		Gf(i);
	}
	run(e = {}) {
		let { query: t, logger: n, executors: r, fastPath: i, resultKind: a } = this, o = t._sql ? t._sql.join(" ") : t.sql, s = t.params.length === 0 ? t.params : Gd(t.params, e);
		if (n.logQuery(o, s), a === "sync") try {
			return r.run(s);
		} catch (e) {
			throw new Yd(o, s, e);
		}
		return i ? r.run(s).catch((e) => {
			throw new Yd(o, s, e);
		}) : this.queryWithCache(o, s, "run", () => r.run(s));
	}
	all(e = {}) {
		let { query: t, logger: n, executors: r, mapper: i, fastPath: a, resultKind: o } = this, s = t._sql ? t._sql.join(" ") : t.sql, c = t.params.length === 0 ? t.params : Gd(t.params, e);
		if (n.logQuery(s, c), o === "sync") {
			let e;
			try {
				e = r.all(c);
			} catch (e) {
				throw new Yd(s, c, e);
			}
			return i ? i(e) : e;
		}
		let l = a ? r.all(c).catch((e) => {
			throw new Yd(s, c, e);
		}) : this.queryWithCache(s, c, "all", () => r.all(c));
		return i ? l.then((e) => i(e)) : l;
	}
	get(e = {}) {
		let { query: t, logger: n, executors: r, mapper: i, fastPath: a, resultKind: o } = this, s = t._sql ? t._sql.join(" ") : t.sql, c = t.params.length === 0 ? t.params : Gd(t.params, e);
		if (n.logQuery(s, c), o === "sync") {
			let e;
			try {
				e = r.get(c);
			} catch (e) {
				throw new Yd(s, c, e);
			}
			return e ? i ? i([e])[0] : e : void 0;
		}
		let l = a ? r.get(c).catch((e) => {
			throw new Yd(s, c, e);
		}) : this.queryWithCache(s, c, "get", () => r.get(c));
		return i ? l.then((e) => e ? i([e])[0] : void 0) : l.then((e) => e || void 0);
	}
	values(e = {}) {
		let { query: t, logger: n, executors: r, fastPath: i, resultKind: a } = this, o = t._sql ? t._sql.join(" ") : t.sql, s = t.params.length === 0 ? t.params : Gd(t.params, e);
		if (n.logQuery(o, s), a === "sync") try {
			return r.values(s);
		} catch (e) {
			throw new Yd(o, s, e);
		}
		return i ? r.values(s).catch((e) => {
			throw new Yd(o, s, e);
		}) : this.queryWithCache(o, s, "values", () => r.values(s));
	}
	execute(e) {
		return this.resultKind === "async" ? this[this.executeMethod](e) : new Um(() => this[this.executeMethod](e));
	}
}, Gm = class extends Hm {
	static [V] = "SQLiteAsyncSession";
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
}, Km = class extends Im {
	static [V] = "SQLiteAsyncTransaction";
	constructor(e, t, n, r, i = 0, a) {
		super(e, t, n, r, a), this.nestedIndex = i;
	}
	rollback() {
		throw new Xd();
	}
}, qm = class e extends Gm {
	static [V] = "TursoDatabaseSyncSession";
	logger;
	cache;
	constructor(e, t, n, r) {
		super(t, "async"), this.client = e, this.relations = n, this.options = r, this.logger = r.logger ?? new dp(), this.cache = r.cache ?? new Rm();
	}
	prepareQuery(e, t, n, r, i, a, o) {
		let s;
		return new Wm("async", r, n ? {
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
		let r = new e(this.client, this.dialect, this.relations, this.options), i = new Jm("async", this.dialect, r, this.relations);
		return await this.client.transaction(async () => await t(i))();
	}
}, Jm = class e extends Km {
	static [V] = "TursoDatabaseSyncTransaction";
	async transaction(t) {
		let n = `sp${this.nestedIndex}`, r = new e("async", this.dialect, this.session, this._.relations, this.nestedIndex + 1);
		await this.session.run(Y.raw(`savepoint ${n}`));
		try {
			let e = await t(r);
			return await this.session.run(Y.raw(`release savepoint ${n}`)), e;
		} catch (e) {
			throw await this.session.run(Y.raw(`rollback to savepoint ${n}`)), e;
		}
	}
}, Ym = class extends Im {
	static [V] = "TursoDatabaseSyncDatabase";
};
function Xm(e, t = {}) {
	let n = new Tm({ useJitMappers: Pf(t.jit) }), r;
	t.logger === !0 ? r = new up() : t.logger !== !1 && (r = t.logger);
	let i = t.relations ?? {}, a = new Ym("async", n, new qm(e, n, i, {
		logger: r,
		cache: t.cache
	}), i);
	return a.$client = e, a.$cache = t.cache, a.$cache && (a.$cache.invalidate = t.cache?.onMutate), a;
}
function Zm(...t) {
	if (typeof t[0] == "string") return Xm(new e({ path: t[0] }), t[1]);
	let { connection: n, client: r, ...i } = t[0];
	return Xm(r || (typeof n == "string" ? new e({ path: n }) : new e(n)), i);
}
(function(e) {
	function t(e) {
		return Xm({}, e);
	}
	e.mock = t;
})(Zm ||= {});
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/MutableRef.js
var Qm = "~effect/MutableRef", $m = {
	[Qm]: Qm,
	...at,
	toJSON() {
		return {
			_id: "MutableRef",
			current: Je(this.current)
		};
	}
}, eh = (e) => {
	let t = Object.create($m);
	return t.current = e, t;
}, th = /*#__PURE__*/ l(2, (e, t) => (e.current = t, e)), nh = {
	"~effect/Ref": { _A: u },
	...at,
	toJSON() {
		return {
			_id: "Ref",
			ref: this.ref
		};
	}
}, rh = (e) => {
	let t = Object.create(nh);
	return t.ref = eh(e), t;
}, ih = (e) => Os(() => rh(e)), ah = (e) => Os(() => e.ref.current), oh = /*#__PURE__*/ l(2, (e, t) => Os(() => th(e.ref, t))), sh = /*#__PURE__*/ l(2, (e, t) => Os(() => {
	e.ref.current = t(e.ref.current);
})), $ = dm("notes", {
	id: nm("id").primaryKey(),
	title: nm("title").notNull(),
	body: nm("body").notNull(),
	createdAt: Vp("created_at").notNull(),
	updatedAt: Vp("updated_at").notNull(),
	deletedAt: Vp("deleted_at")
}), ch = class extends gd()("PersistenceError", {
	operation: $u,
	message: $u
}) {}, lh = class extends gd()("NoteNotFoundError", { id: $u }) {}, uh = class extends Xn()("@store/persistence/OfflineStore") {}, dh = (e) => e instanceof Error ? e.message : String(e), fh = (e, t) => Cs({
	try: () => Promise.resolve(t()),
	catch: (t) => new ch({
		operation: e,
		message: dh(t)
	})
}), ph = (e) => ks(function* () {
	let t = !!e.syncUrl, n = !1, r = Zm({ connection: t ? {
		path: e.path,
		url: () => n ? e.syncUrl : null,
		...e.authToken ? { authToken: e.authToken } : {},
		clientName: "store-electron"
	} : { path: e.path } });
	yield* fh("connect database", () => r.$client.connect()), yield* fh("initialize database", () => r.run(Y`
        CREATE TABLE IF NOT EXISTS notes (
          id TEXT PRIMARY KEY NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          deleted_at INTEGER
        )
      `));
	let i = yield* ih({
		phase: t ? "idle" : "local-only",
		configured: t,
		lastSyncedAt: null,
		message: t ? "Ready to sync" : "Add Turso credentials to enable cloud sync"
	});
	yield* zs(() => fh("close database", () => r.$client.close()).pipe(Ls));
	let a = fh("list notes", () => r.select({
		id: $.id,
		title: $.title,
		body: $.body,
		createdAt: $.createdAt,
		updatedAt: $.updatedAt
	}).from($).where(lf($.deletedAt)).orderBy(Cf($.updatedAt)).all()), o = Qs("OfflineStore.createNote")(function* (e) {
		let t = Date.now(), n = {
			id: crypto.randomUUID(),
			title: e.title.trim(),
			body: e.body.trim(),
			createdAt: t,
			updatedAt: t
		};
		return yield* fh("create note", () => r.insert($).values(n).run()), n;
	}), s = Qs("OfflineStore.updateNote")(function* (e) {
		let t = yield* fh("find note", () => r.select().from($).where(Zd($.id, e.id)).get());
		if (!t || t.deletedAt !== null) return yield* new lh({ id: e.id });
		let n = {
			id: t.id,
			title: e.title.trim(),
			body: e.body.trim(),
			createdAt: t.createdAt,
			updatedAt: Date.now()
		};
		return yield* fh("update note", () => r.update($).set({
			title: n.title,
			body: n.body,
			updatedAt: n.updatedAt
		}).where(Zd($.id, n.id)).run()), n;
	}), c = Qs("OfflineStore.deleteNote")(function* (e) {
		if (!(yield* fh("find note", () => r.select({ id: $.id }).from($).where(Zd($.id, e)).get()))) return yield* new lh({ id: e });
		yield* fh("delete note", () => r.update($).set({
			deletedAt: Date.now(),
			updatedAt: Date.now()
		}).where(Zd($.id, e)).run());
	}), l = Qs("OfflineStore.sync")(function* () {
		if (!t) return yield* ah(i);
		yield* sh(i, (e) => ({
			...e,
			phase: "syncing",
			message: "Pushing local changes…"
		})), n = !0;
		let e = yield* fh("sync with Turso", async () => {
			await r.$client.push(), await r.$client.pull();
		}).pipe(Fs);
		if (e._tag === "Failure") return yield* sh(i, (t) => ({
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
		return yield* oh(i, a), a;
	});
	return uh.of({
		listNotes: a,
		createNote: o,
		updateNote: s,
		deleteNote: c,
		getSyncStatus: ah(i),
		sync: l()
	});
}), mh = (e) => hs(uh, ph(e)), hh = {
	listNotes: Ms(uh, (e) => e.listNotes),
	createNote: (e) => Ms(uh, (t) => t.createNote(e)),
	updateNote: (e) => Ms(uh, (t) => t.updateNote(e)),
	deleteNote: (e) => Ms(uh, (t) => t.deleteNote(e)),
	getSyncStatus: Ms(uh, (e) => e.getSyncStatus),
	sync: Ms(uh, (e) => e.sync)
}, gh = Pi, _h = po, vh = "~effect/ManagedRuntime", yh = (e, t) => {
	let n = t?.memoMap ?? fs(), r = $o("parallel"), i = ts(r, "sequential"), a = { onFiberStart: _h(r) }, o = (e) => e ? {
		...e,
		onFiberStart: e.onFiberStart ? (t) => {
			a.onFiberStart(t), e.onFiberStart(t);
		} : a.onFiberStart
	} : a, s, c = js((t) => (s ||= Bs(Ps(ms(e, n, i), (e) => Os(() => {
		l.cachedContext = e;
	})), {
		...a,
		scheduler: t.currentScheduler
	}), Ns(gh(s)))), l = {
		[vh]: vh,
		memoMap: n,
		scope: r,
		contextEffect: c,
		cachedContext: void 0,
		context() {
			return l.cachedContext === void 0 ? Ws(l.contextEffect) : Promise.resolve(l.cachedContext);
		},
		dispose() {
			return Ws(l.disposeEffect);
		},
		disposeEffect: Ds(() => (l.contextEffect = As("ManagedRuntime disposed"), l.cachedContext = void 0, ns(l.scope, Ko))),
		runFork(e, t) {
			return l.cachedContext === void 0 ? Bs(bh(l, e), o(t)) : Vs(l.cachedContext)(e, o(t));
		},
		runCallback(e, t) {
			return l.cachedContext === void 0 ? Us(bh(l, e), o(t)) : Hs(l.cachedContext)(e, o(t));
		},
		runSyncExit(e) {
			return l.cachedContext === void 0 ? Xs(bh(l, e)) : Zs(l.cachedContext)(e);
		},
		runSync(e) {
			return l.cachedContext === void 0 ? Js(bh(l, e)) : Ys(l.cachedContext)(e);
		},
		runPromiseExit(e, t) {
			return l.cachedContext === void 0 ? Ks(bh(l, e), o(t)) : qs(l.cachedContext)(e, o(t));
		},
		runPromise(e, t) {
			return l.cachedContext === void 0 ? Ws(bh(l, e), o(t)) : Gs(l.cachedContext)(e, o(t));
		}
	};
	return l;
};
function bh(e, t) {
	return Ms(e.contextEffect, (e) => Rs(t, e));
}
//#endregion
//#region electron/main.ts
var xh = a.dirname(i(import.meta.url));
process.env.APP_ROOT = a.join(xh, "..");
var Sh = process.env.VITE_DEV_SERVER_URL, Ch = a.join(process.env.APP_ROOT, "dist-electron"), wh = a.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = Sh ? a.join(process.env.APP_ROOT, "public") : wh;
var Th, Eh, Dh = (e) => Eh ? Eh.runPromise(e).catch((e) => {
	let t = typeof e == "object" && e && "message" in e ? String(e.message) : String(e);
	throw Error(t);
}) : Promise.reject(/* @__PURE__ */ Error("The local store is not ready"));
function Oh() {
	r.handle("store:notes:list", () => Dh(hh.listNotes)), r.handle("store:notes:create", (e, t) => Dh(Yu(_d)(t).pipe(Ms(hh.createNote)))), r.handle("store:notes:update", (e, t) => Dh(Yu(vd)(t).pipe(Ms(hh.updateNote)))), r.handle("store:notes:delete", (e, t) => Dh(Yu(yd)(t).pipe(Ms(({ id: e }) => hh.deleteNote(e))))), r.handle("store:sync:status", () => Dh(hh.getSyncStatus)), r.handle("store:sync:run", () => Dh(hh.sync));
}
function kh() {
	Th = new t({
		icon: a.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
		frame: !1,
		webPreferences: { preload: a.join(xh, "preload.mjs") }
	}), Th.webContents.on("did-finish-load", () => {
		Th?.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
	}), Th.on("enter-full-screen", () => {
		Th?.webContents.send("window-controls:full-screen-changed", !0);
	}), Th.on("leave-full-screen", () => {
		Th?.webContents.send("window-controls:full-screen-changed", !1);
	}), Sh ? Th.loadURL(Sh) : Th.loadFile(a.join(wh, "index.html"));
}
r.on("window-controls:minimize", (e) => {
	t.fromWebContents(e.sender)?.minimize();
}), r.handle("window-controls:toggle-maximize", (e) => {
	let n = t.fromWebContents(e.sender);
	return n ? (n.isMaximized() ? n.unmaximize() : n.maximize(), n.isMaximized()) : !1;
}), r.handle("window-controls:is-maximized", (e) => t.fromWebContents(e.sender)?.isMaximized() ?? !1), r.handle("window-controls:is-full-screen", (e) => t.fromWebContents(e.sender)?.isFullScreen() ?? !1), r.on("window-controls:close", (e) => {
	t.fromWebContents(e.sender)?.close();
}), n.on("window-all-closed", () => {
	process.platform !== "darwin" && (n.quit(), Th = null);
}), n.on("activate", () => {
	t.getAllWindows().length === 0 && kh();
}), n.on("before-quit", () => {
	Eh && Eh.dispose();
}), n.whenReady().then(() => {
	Eh = yh(mh({
		path: a.join(n.getPath("userData"), "offline-store.db"),
		syncUrl: process.env.TURSO_DATABASE_URL,
		authToken: process.env.TURSO_AUTH_TOKEN
	})), Oh(), kh();
});
//#endregion
export { Ch as MAIN_DIST, wh as RENDERER_DIST, Sh as VITE_DEV_SERVER_URL };
