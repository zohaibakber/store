import crypto$1, { createHash, webcrypto } from "node:crypto";
import { Database } from "@tursodatabase/sync";
import fs, { existsSync, readdirSync } from "node:fs";
import path, { join } from "node:path";
import { BrowserWindow, app, ipcMain, safeStorage } from "electron";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
//#region \0rolldown/runtime.js
var __defProp = Object.defineProperty;
var __exportAll = (all, no_symbols) => {
	let target = {};
	for (var name in all) __defProp(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) __defProp(target, Symbol.toStringTag, { value: "Module" });
	return target;
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/entity.js
var entityKind = Symbol.for("drizzle:entityKind");
function is(value, type) {
	if (!value || typeof value !== "object") return false;
	if (value instanceof type) return true;
	if (!Object.prototype.hasOwnProperty.call(type, entityKind)) throw new Error(`Class "${type.name ?? "<unknown>"}" doesn't look like a Drizzle entity. If this is incorrect and the class is provided by Drizzle, please report this as a bug.`);
	let cls = Object.getPrototypeOf(value)?.constructor;
	if (cls) while (cls) {
		if (entityKind in cls && cls[entityKind] === type[entityKind]) return true;
		cls = Object.getPrototypeOf(cls);
	}
	return false;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/column-common.js
var OriginalColumn = Symbol.for("drizzle:OriginalColumn");
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/column.js
var noop = (v) => v;
noop.isNoop = true;
var Column = class {
	static [entityKind] = "Column";
	/** @internal */
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
	/** @internal */
	config;
	/** @internal */
	table;
	/** @internal */
	onInit() {}
	constructor(table, config) {
		this.config = config;
		this.onInit();
		this.table = table;
		this.name = config.name;
		this.isAlias = false;
		this.keyAsName = config.keyAsName;
		this.notNull = config.notNull;
		this.default = config.default;
		this.defaultFn = config.defaultFn;
		this.onUpdateFn = config.onUpdateFn;
		this.hasDefault = config.hasDefault;
		this.primary = config.primaryKey;
		this.isUnique = config.isUnique;
		this.uniqueName = config.uniqueName;
		this.uniqueType = config.uniqueType;
		this.dataType = config.dataType;
		this.columnType = config.columnType;
		this.generated = config.generated;
		this.generatedIdentity = config.generatedIdentity;
		this.length = config["length"];
		this.isLengthExact = config["isLengthExact"];
	}
	mapFromDriverValue = noop;
	mapToDriverValue = noop;
	/** @internal */
	postBuild() {
		return this;
	}
	/** @internal */
	shouldDisableInsert() {
		return this.config.generated !== void 0 && this.config.generated.type !== "byDefault";
	}
	/** @internal */
	[OriginalColumn]() {
		return this;
	}
};
function getColumnTable(column) {
	return column.table;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/table.utils.js
/** @internal */
var TableName = Symbol.for("drizzle:Name");
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/table.js
/** @internal */
var TableSchema = Symbol.for("drizzle:Schema");
/** @internal */
var TableColumns = Symbol.for("drizzle:Columns");
/** @internal */
var ExtraConfigColumns = Symbol.for("drizzle:ExtraConfigColumns");
/** @internal */
var OriginalName = Symbol.for("drizzle:OriginalName");
/** @internal */
var BaseName = Symbol.for("drizzle:BaseName");
/** @internal */
var IsAlias = Symbol.for("drizzle:IsAlias");
/** @internal */
var ExtraConfigBuilder = Symbol.for("drizzle:ExtraConfigBuilder");
var IsDrizzleTable = Symbol.for("drizzle:IsDrizzleTable");
var Table = class {
	static [entityKind] = "Table";
	/** @internal */
	static Symbol = {
		Name: TableName,
		Schema: TableSchema,
		OriginalName,
		Columns: TableColumns,
		ExtraConfigColumns,
		BaseName,
		IsAlias,
		ExtraConfigBuilder
	};
	/**
	* @internal
	* Can be changed if the table is aliased.
	*/
	[TableName];
	/**
	* @internal
	* Used to store the original name of the table, before any aliasing.
	*/
	[OriginalName];
	/** @internal */
	[TableSchema];
	/** @internal */
	[TableColumns];
	/** @internal */
	[ExtraConfigColumns];
	/**
	*  @internal
	* Used to store the table name before the transformation via the `tableCreator` functions.
	*/
	[BaseName];
	/** @internal */
	[IsAlias] = false;
	/** @internal */
	[IsDrizzleTable] = true;
	/** @internal */
	[ExtraConfigBuilder] = void 0;
	constructor(name, schema, baseName) {
		this[TableName] = this[OriginalName] = name;
		this[TableSchema] = schema;
		this[BaseName] = baseName;
	}
};
function isTable(table) {
	return typeof table === "object" && table !== null && IsDrizzleTable in table;
}
function getTableName(table) {
	return table[TableName];
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/subquery.js
var Subquery = class {
	static [entityKind] = "Subquery";
	constructor(sql, fields, alias, isWith = false, usedTables = []) {
		this._ = {
			brand: "Subquery",
			sql,
			selectedFields: fields,
			alias,
			isWith,
			usedTables
		};
	}
};
var WithSubquery = class extends Subquery {
	static [entityKind] = "WithSubquery";
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/tracing.js
/** @internal */
var tracer = { startActiveSpan(name, fn) {
	return fn();
} };
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/view-common.js
var ViewBaseConfig = Symbol.for("drizzle:ViewBaseConfig");
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sql/sql.js
function isSQLWrapper(value) {
	return value !== null && value !== void 0 && typeof value.getSQL === "function";
}
function mergeQueries(queries) {
	const result = {
		sql: "",
		params: []
	};
	for (const query of queries) {
		result.sql += query.sql;
		result.params.push(...query.params);
	}
	return result;
}
function _mergeQueries(queries) {
	const result = {
		sql: "",
		params: []
	};
	const sqls = [];
	for (const query of queries) {
		sqls.push(query.sql);
		result.params.push(...query.params);
	}
	result._sql = Object.assign(sqls, { raw: sqls });
	return result;
}
var StringChunk = class {
	static [entityKind] = "StringChunk";
	value;
	constructor(value) {
		this.value = Array.isArray(value) ? value : [value];
	}
	getSQL() {
		return new SQL([this]);
	}
};
var SQL = class SQL {
	static [entityKind] = "SQL";
	/** @internal */
	decoder = noopDecoder;
	/** @internal */
	shouldInlineParams = false;
	/** @internal */
	usedTables = [];
	constructor(queryChunks) {
		this.queryChunks = queryChunks;
		for (const chunk of queryChunks) if (is(chunk, Table)) {
			const schemaName = chunk[Table.Symbol.Schema];
			this.usedTables.push(schemaName === void 0 ? chunk[Table.Symbol.Name] : schemaName + "." + chunk[Table.Symbol.Name]);
		}
	}
	append(query) {
		this.queryChunks.push(...query.queryChunks);
		return this;
	}
	toQuery(config) {
		return tracer.startActiveSpan("drizzle.buildSQL", (span) => {
			const query = this.buildQueryFromSourceParams(this.queryChunks, config);
			span?.setAttributes({
				"drizzle.query.text": query.sql,
				"drizzle.query.params": JSON.stringify(query.params)
			});
			return query;
		});
	}
	buildQueryFromSourceParams(chunks, _config) {
		const config = Object.assign({}, _config, {
			inlineParams: _config.inlineParams || this.shouldInlineParams,
			paramStartIndex: _config.paramStartIndex || { value: 0 }
		});
		const { escapeName, escapeParam, codecs, inlineParams, paramStartIndex, invokeSource } = config;
		const mappedChunks = chunks.map((chunk) => {
			if (is(chunk, StringChunk)) return {
				sql: chunk.value.join(""),
				params: []
			};
			if (is(chunk, Name)) return {
				sql: escapeName(chunk.value),
				params: []
			};
			if (chunk === void 0) return {
				sql: "",
				params: []
			};
			if (Array.isArray(chunk)) {
				const result = [new StringChunk("(")];
				for (const [i, p] of chunk.entries()) {
					result.push(p);
					if (i < chunk.length - 1) result.push(new StringChunk(", "));
				}
				result.push(new StringChunk(")"));
				return this.buildQueryFromSourceParams(result, config);
			}
			if (is(chunk, SQL)) return this.buildQueryFromSourceParams(chunk.queryChunks, {
				...config,
				inlineParams: inlineParams || chunk.shouldInlineParams
			});
			if (is(chunk, Table)) {
				const schemaName = chunk[Table.Symbol.Schema];
				const tableName = chunk[Table.Symbol.Name];
				if (invokeSource === "mssql-view-with-schemabinding") return {
					sql: (schemaName === void 0 ? escapeName("dbo") : escapeName(schemaName)) + "." + escapeName(tableName),
					params: []
				};
				return {
					sql: schemaName === void 0 || chunk[IsAlias] ? escapeName(tableName) : escapeName(schemaName) + "." + escapeName(tableName),
					params: []
				};
			}
			if (is(chunk, Column)) {
				const columnName = chunk.name;
				if (_config.invokeSource === "indexes") return {
					sql: escapeName(columnName),
					params: []
				};
				const schemaName = invokeSource === "mssql-check" ? void 0 : chunk.table[Table.Symbol.Schema];
				return {
					sql: chunk.isAlias ? escapeName(chunk.name) : chunk.table[IsAlias] || schemaName === void 0 ? escapeName(chunk.table[Table.Symbol.Name]) + "." + escapeName(columnName) : escapeName(schemaName) + "." + escapeName(chunk.table[Table.Symbol.Name]) + "." + escapeName(columnName),
					params: []
				};
			}
			if (is(chunk, View)) {
				const schemaName = chunk[ViewBaseConfig].schema;
				const viewName = chunk[ViewBaseConfig].name;
				return {
					sql: schemaName === void 0 || chunk[ViewBaseConfig].isAlias ? escapeName(viewName) : escapeName(schemaName) + "." + escapeName(viewName),
					params: []
				};
			}
			if (is(chunk, Param)) {
				if (is(chunk.value, SQL)) return this.buildQueryFromSourceParams([chunk.value], config);
				const useCodecs = codecs && is(chunk.encoder, Column);
				if (is(chunk.value, Placeholder)) {
					const escaped = escapeParam(paramStartIndex.value++, chunk);
					chunk.codec = useCodecs ? (value) => codecs.apply(chunk.encoder, "normalizeParam", value) : void 0;
					return {
						sql: useCodecs ? codecs.apply(chunk.encoder, "castParam", escaped) : escaped,
						params: [chunk]
					};
				}
				let mappedValue;
				if (chunk.value === null) mappedValue = chunk.value;
				else {
					mappedValue = chunk.encoder.mapToDriverValue.isNoop ? chunk.value : chunk.encoder.mapToDriverValue(chunk.value);
					if (is(mappedValue, SQL)) return this.buildQueryFromSourceParams([mappedValue], config);
					if (useCodecs) mappedValue = codecs.apply(chunk.encoder, "normalizeParam", mappedValue);
				}
				if (inlineParams) return {
					sql: this.mapInlineParam(mappedValue, config),
					params: []
				};
				const escaped = escapeParam(paramStartIndex.value++, mappedValue);
				return {
					sql: useCodecs ? codecs.apply(chunk.encoder, "castParam", escaped) : escaped,
					params: [mappedValue]
				};
			}
			if (is(chunk, Placeholder)) return {
				sql: escapeParam(paramStartIndex.value++, chunk),
				params: [chunk]
			};
			if (is(chunk, SQL.Aliased) && chunk.fieldAlias !== void 0) return {
				sql: (chunk.origin !== void 0 ? escapeName(chunk.origin) + "." : "") + escapeName(chunk.fieldAlias),
				params: []
			};
			if (is(chunk, Subquery)) {
				if (chunk._.isWith) return {
					sql: escapeName(chunk._.alias),
					params: []
				};
				return this.buildQueryFromSourceParams([
					new StringChunk("("),
					chunk._.sql,
					new StringChunk(") "),
					new Name(chunk._.alias)
				], config);
			}
			if (typeof chunk === "function" && "enumName" in chunk) {
				if ("schema" in chunk && chunk.schema) return {
					sql: escapeName(chunk.schema) + "." + escapeName(chunk.enumName),
					params: []
				};
				return {
					sql: escapeName(chunk.enumName),
					params: []
				};
			}
			if (isSQLWrapper(chunk)) {
				if (chunk.shouldOmitSQLParens?.()) return this.buildQueryFromSourceParams([chunk.getSQL()], config);
				return this.buildQueryFromSourceParams([
					new StringChunk("("),
					chunk.getSQL(),
					new StringChunk(")")
				], config);
			}
			if (inlineParams) return {
				sql: this.mapInlineParam(chunk, config),
				params: []
			};
			return {
				sql: escapeParam(paramStartIndex.value++, chunk),
				params: [chunk]
			};
		});
		if (_config.tagged) return _mergeQueries(mappedChunks);
		return mergeQueries(mappedChunks);
	}
	mapInlineParam(chunk, { escapeString }) {
		if (chunk === null) return "null";
		if (typeof chunk === "number" || typeof chunk === "boolean" || typeof chunk === "bigint") return chunk.toString();
		if (typeof chunk === "string") return escapeString(chunk);
		if (typeof chunk === "object") {
			const mappedValueAsString = chunk.toString();
			if (mappedValueAsString === "[object Object]") return escapeString(JSON.stringify(chunk));
			return escapeString(mappedValueAsString);
		}
		throw new Error("Unexpected param value: " + chunk);
	}
	getSQL() {
		return this;
	}
	as(alias) {
		if (alias === void 0) return this;
		return new SQL.Aliased(this, alias);
	}
	mapWith(decoder) {
		this.decoder = typeof decoder === "function" ? { mapFromDriverValue: decoder } : decoder;
		return this;
	}
	nullable() {
		return this;
	}
	inlineParams() {
		this.shouldInlineParams = true;
		return this;
	}
	/**
	* This method is used to conditionally include a part of the query.
	*
	* @param condition - Condition to check
	* @returns itself if the condition is `true`, otherwise `undefined`
	*/
	if(condition) {
		return condition ? this : void 0;
	}
};
/**
* Any DB name (table, column, index etc.)
*/
var Name = class {
	static [entityKind] = "Name";
	brand;
	constructor(value) {
		this.value = value;
	}
	getSQL() {
		return new SQL([this]);
	}
};
function isDriverValueEncoder(value) {
	return typeof value === "object" && value !== null && "mapToDriverValue" in value && typeof value.mapToDriverValue === "function";
}
var noopDecoder = { mapFromDriverValue: (value) => value };
noopDecoder.mapFromDriverValue.isNoop = true;
var noopEncoder = { mapToDriverValue: (value) => value };
noopEncoder.mapToDriverValue.isNoop = true;
({
	...noopDecoder,
	...noopEncoder
});
/** Parameter value that is optionally bound to an encoder (for example, a column). */
var Param = class {
	static [entityKind] = "Param";
	brand;
	/**
	* @param value - Parameter value
	* @param encoder - Encoder to convert the value to a driver parameter
	*/
	constructor(value, encoder = noopEncoder, codec) {
		this.value = value;
		this.encoder = encoder;
		this.codec = codec;
	}
	getSQL() {
		return new SQL([this]);
	}
};
function sql(strings, ...params) {
	const queryChunks = [];
	if (params.length > 0 || strings.length > 0 && strings[0] !== "") queryChunks.push(new StringChunk(strings[0]));
	for (const [paramIndex, param] of params.entries()) queryChunks.push(param, new StringChunk(strings[paramIndex + 1]));
	return new SQL(queryChunks);
}
(function(_sql) {
	function empty() {
		return new SQL([]);
	}
	_sql.empty = empty;
	function fromList(list) {
		return new SQL(list);
	}
	_sql.fromList = fromList;
	function raw(str) {
		return new SQL([new StringChunk(str)]);
	}
	_sql.raw = raw;
	function join(chunks, separator) {
		const result = [];
		for (const [i, chunk] of chunks.entries()) {
			if (i > 0 && separator !== void 0) result.push(separator);
			result.push(chunk);
		}
		return new SQL(result);
	}
	_sql.join = join;
	function identifier(value) {
		return new Name(value);
	}
	_sql.identifier = identifier;
	function placeholder(name) {
		return new Placeholder(name);
	}
	_sql.placeholder = placeholder;
	function param(value, encoder) {
		return new Param(value, encoder);
	}
	_sql.param = param;
	function comment(input) {
		const encoded = sqlCommenter(input);
		if (!encoded.length) return void 0;
		return sql.raw(encoded);
	}
	_sql.comment = comment;
})(sql || (sql = {}));
function sqlCommenter(input) {
	const encoded = sqlCommenter.encodeInput(input);
	if (!encoded.length) return "";
	return `/*${encoded}*/`;
}
(function(_sqlCommenter) {
	function merge(input1, input2) {
		let encoded;
		if (typeof input1 === "object" && typeof input2 === "object") encoded = encodeInput({
			...input1,
			...input2
		});
		else if (input1 && input2) encoded = [encodeInput(input1), encodeInput(input2)].filter((i) => i.length).join(",");
		else if (input2) encoded = encodeInput(input2);
		else if (input1) encoded = encodeInput(input1);
		else return "";
		if (!encoded.length) return "";
		return `/*${encoded}*/`;
	}
	_sqlCommenter.merge = merge;
	function encodeInput(input) {
		if (typeof input === "string") {
			if (!input.length) return input;
			return sanitizeStringInput(input);
		}
		const parts = [];
		for (const [key, value] of Object.entries(input)) {
			if (value === null || value === void 0 || value === "") continue;
			const encodedKey = sanitizeObjectElement(key);
			const encodedValue = sanitizeObjectElement(String(value));
			parts.push(`${encodedKey}='${encodedValue}'`);
		}
		if (!parts.length) return "";
		return parts.sort().join(",");
	}
	_sqlCommenter.encodeInput = encodeInput;
	function sanitizeObjectElement(key) {
		return encodeURIComponent(key).replace(/'/g, `\\'`);
	}
	_sqlCommenter.sanitizeObjectElement = sanitizeObjectElement;
	function sanitizeStringInput(input) {
		return input.replace(/\/\*/g, "/ *").replace(/\*\//g, "* /");
	}
	_sqlCommenter.sanitizeStringInput = sanitizeStringInput;
})(sqlCommenter || (sqlCommenter = {}));
(function(_SQL) {
	class Aliased {
		static [entityKind] = "SQL.Aliased";
		/** @internal */
		isSelectionField = false;
		/** @internal */
		origin;
		constructor(sql, fieldAlias) {
			this.sql = sql;
			this.fieldAlias = fieldAlias;
		}
		getSQL() {
			return this.sql;
		}
		/** @internal */
		clone() {
			return new Aliased(this.sql, this.fieldAlias);
		}
	}
	_SQL.Aliased = Aliased;
})(SQL || (SQL = {}));
var Placeholder = class {
	static [entityKind] = "Placeholder";
	constructor(name) {
		this.name = name;
	}
	getSQL() {
		return new SQL([this]);
	}
};
function fillPlaceholders(params, values) {
	return params.map((p) => {
		if (is(p, Placeholder)) {
			if (!(p.name in values)) throw new Error(`No value for placeholder "${p.name}" was provided`);
			return values[p.name];
		}
		if (is(p, Param) && is(p.value, Placeholder)) {
			if (!(p.value.name in values)) throw new Error(`No value for placeholder "${p.value.name}" was provided`);
			const value = values[p.value.name];
			if (value === null) return value;
			const mapped = p.encoder.mapToDriverValue.isNoop ? value : p.encoder.mapToDriverValue(value);
			return p.codec ? p.codec(mapped) : mapped;
		}
		return p;
	});
}
var IsDrizzleView = Symbol.for("drizzle:IsDrizzleView");
var View = class {
	static [entityKind] = "View";
	/** @internal */
	[ViewBaseConfig];
	/** @internal */
	[IsDrizzleView] = true;
	/** @internal */
	get [TableName]() {
		return this[ViewBaseConfig].name;
	}
	/** @internal */
	get [TableSchema]() {
		return this[ViewBaseConfig].schema;
	}
	/** @internal */
	get [IsAlias]() {
		return this[ViewBaseConfig].isAlias;
	}
	/** @internal */
	get [OriginalName]() {
		return this[ViewBaseConfig].originalName;
	}
	/** @internal */
	get [TableColumns]() {
		return this[ViewBaseConfig].selectedFields;
	}
	constructor({ name, schema, selectedFields, query }) {
		this[ViewBaseConfig] = {
			name,
			originalName: name,
			schema,
			selectedFields,
			query,
			isExisting: !query,
			isAlias: false
		};
	}
};
function isView(view) {
	return typeof view === "object" && view !== null && IsDrizzleView in view;
}
Column.prototype.getSQL = function() {
	return new SQL([this]);
};
Subquery.prototype.getSQL = function() {
	return new SQL([this]);
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/utils.js
/** @internal bypass bundle-time filtering */
var FnConstructor = Object.getPrototypeOf(() => null).constructor;
/** @internal */
function makeJitQueryMapperInner(columns, joinsNotNullableMap = {}) {
	const preFn = [];
	const fn = [];
	fn.push(`const [ ${columns.map((_, i) => `c${i}`).join(", ")} ] = rows[i];`);
	const nullifyMap = {};
	const objectIds = {};
	const decodes = Array.from({ length: columns.length });
	for (let idx = 0; idx < columns.length; ++idx) {
		const { field, path, codec, arrayDimensions } = columns[idx];
		let decoder;
		let decoderStr;
		let decoderFieldDestructure;
		let isColumn = false;
		if (is(field, Column)) {
			isColumn = true;
			decoder = field;
			decoderFieldDestructure = `field: decoder${idx}`;
		} else if (is(field, SQL)) {
			decoder = field.decoder;
			decoderFieldDestructure = `field: { decoder: decoder${idx} }`;
		} else if (is(field, Subquery)) {
			decoder = field._.sql.decoder;
			decoderFieldDestructure = `field: { _: { sql: { decoder: decoder${idx} } } }`;
		} else {
			decoder = field.sql.decoder;
			decoderFieldDestructure = `field: { sql: { decoder: decoder${idx} } }`;
		}
		decoderStr = `decoder${idx}.mapFromDriverValue`;
		if (decoder.mapFromDriverValue.isNoop) decoderStr = "";
		if (decoderStr) preFn.push(`const { ${decoderFieldDestructure}${codec ? `, codec: codec${idx}` : ""} } = columns[${idx}];`);
		else if (codec) preFn.push(`const { codec: codec${idx} } = columns[${idx}];`);
		const colStr = `c${idx}`;
		let decodedValue = colStr;
		if (codec) decodedValue = `codec${idx}(${decodedValue}, ${arrayDimensions})`;
		if (decoderStr) decodedValue = `${decoderStr}(${decodedValue})`;
		decodes[idx] = colStr === decodedValue ? `${colStr}` : `${colStr} === null ? ${colStr} : ${decodedValue}`;
		if (path.length !== 2 || !isColumn) continue;
		if (objectIds[path[0]] === void 0) objectIds[path[0]] = [`c${idx}`];
		else objectIds[path[0]]?.push(`c${idx}`);
		const [objectName] = path;
		const tableName = getTableName(field.table);
		nullifyMap[objectName] = joinsNotNullableMap[tableName] ? false : typeof nullifyMap[objectName] === "string" ? nullifyMap[objectName] === tableName ? tableName : false : tableName;
	}
	fn.push(`mapped[i] = {`);
	let currentObjectPath = [];
	for (let idx = 0; idx < columns.length; ++idx) {
		const { path } = columns[idx];
		const jsonPath = path.map((e) => JSON.stringify(e));
		const decodedValue = decodes[idx];
		const objectPath = path.slice(0, -1);
		let commonLen = 0;
		while (commonLen < currentObjectPath.length && commonLen < objectPath.length && currentObjectPath[commonLen] === objectPath[commonLen]) commonLen++;
		for (let d = currentObjectPath.length - 1; d >= commonLen; --d) fn.push(`${"	".repeat(d + 1)}},`);
		for (let d = commonLen; d < objectPath.length; ++d) fn.push(`${"	".repeat(d + 1)}${jsonPath[d]}: ${d === 0 && objectPath.length === 1 && typeof nullifyMap[path[0]] === "string" ? `${objectIds[path[0]]?.map((c) => `${c} === null`).join(" && ")} ? null : {` : "{"}`);
		currentObjectPath = objectPath;
		fn.push(`${"	".repeat(path.length)}${jsonPath[path.length - 1]}: ${decodedValue},`);
	}
	for (let d = currentObjectPath.length - 1; d >= 0; --d) fn.push(`${"	".repeat(d + 1)}},`);
	fn.push(`};`);
	return `${preFn.length ? `${preFn.join("\n	")}\n\t` : ""}for (let i = 0; i < length; ++i) {
		${fn.join("\n		")}
	}`;
}
function makeJitQueryMapper(columns, joinsNotNullableMap) {
	const internals = `\t"use strict";
	const { columns } = this;
	const { length } = rows;
	const mapped = Array.from({ length });
	${makeJitQueryMapperInner(columns, joinsNotNullableMap)}
	return mapped;
	//# sourceURL=drizzle:jit-query-mapper`;
	return Object.assign(new FnConstructor("rows", internals).bind({ columns }), { body: `function jitQueryMapper (rows) {\n${internals}\n}` });
}
/** @internal */
function jitCompatCheck(isEnabled) {
	if (!isEnabled) return false;
	try {
		const res = new FnConstructor("input", "\"use strict\"; return input;")(true);
		if (res !== true) {
			console.warn("Unable to use jit mappers due to incompatibility: corrupted jit function output.\nFalling back to premade mappers.\nError details:");
			console.error(`Expected to receive \`true\`, got: ${res}`);
		}
		return true;
	} catch (e) {
		console.warn("Unable to use jit mappers due to incompatibility.\nFalling back to premade mappers.\nError details:");
		console.error(e);
		return false;
	}
}
function makeDefaultQueryMapper(columns, joinsNotNullableMap) {
	const interpretedData = columns.map(({ field, codec, arrayDimensions, path }) => {
		let processNullifyMap;
		let decoderSrc;
		if (is(field, Column)) {
			decoderSrc = field;
			if (joinsNotNullableMap && path.length === 2) {
				const objectName = path[0];
				processNullifyMap = (nullifyMap, value) => {
					if (!(objectName in nullifyMap)) nullifyMap[objectName] = value === null ? getTableName(field.table) : false;
					else if (typeof nullifyMap[objectName] === "string" && nullifyMap[objectName] !== getTableName(field.table)) nullifyMap[objectName] = false;
				};
			}
		} else if (is(field, SQL)) decoderSrc = field.decoder;
		else if (is(field, Subquery)) decoderSrc = field._.sql.decoder;
		else decoderSrc = field.sql.decoder;
		let decoder;
		if (decoderSrc.mapFromDriverValue.isNoop) decoder = codec ? (v) => codec(v, arrayDimensions) : void 0;
		else decoder = codec ? (v) => decoderSrc.mapFromDriverValue(codec(v, arrayDimensions)) : (v) => decoderSrc.mapFromDriverValue(v);
		return [decoder, processNullifyMap];
	});
	return ((rows) => rows.map((row) => {
		const nullifyMap = {};
		const result = columns.reduce((result, { path }, columnIndex) => {
			let node = result;
			for (const [pathChunkIndex, pathChunk] of path.entries()) if (pathChunkIndex < path.length - 1) {
				if (!(pathChunk in node)) node[pathChunk] = {};
				node = node[pathChunk];
			} else {
				const [decoder, processNullifyMap] = interpretedData[columnIndex];
				const rawValue = row[columnIndex];
				const value = node[pathChunk] = rawValue === null ? null : decoder ? decoder(rawValue) : rawValue;
				processNullifyMap?.(nullifyMap, value);
			}
			return result;
		}, {});
		if (joinsNotNullableMap && Object.keys(nullifyMap).length > 0) {
			for (const [objectName, tableName] of Object.entries(nullifyMap)) if (typeof tableName === "string" && !joinsNotNullableMap[tableName]) result[objectName] = null;
		}
		return result;
	}));
}
/** @internal */
function orderSelectedFields(fields, pathPrefix, codecs) {
	return Object.entries(fields).reduce((result, [name, field]) => {
		if (typeof name !== "string") return result;
		const newPath = pathPrefix ? [...pathPrefix, name] : [name];
		if (is(field, Column)) result.push({
			path: newPath,
			field,
			codec: codecs?.get(field, "normalize"),
			arrayDimensions: field.dimensions,
			column: field
		});
		else if (is(field, SQL) || is(field, SQL.Aliased)) {
			const col = getColumnFromDecoder(field);
			result.push(col ? {
				path: newPath,
				field,
				codec: codecs?.get(col, "normalize"),
				arrayDimensions: col.dimensions,
				column: col
			} : {
				path: newPath,
				field
			});
		} else if (is(field, Subquery)) {
			let column;
			const entry = Object.values(field._.selectedFields)[0];
			let fieldDecoder;
			if (is(entry, Column)) {
				column = entry;
				fieldDecoder = entry;
			} else if (is(entry, SQL)) {
				column = getColumnFromDecoder(entry);
				fieldDecoder = entry.decoder;
			} else {
				column = getColumnFromDecoder(entry);
				fieldDecoder = entry.sql.decoder;
			}
			if (fieldDecoder) field._.sql.decoder = fieldDecoder;
			result.push(column ? {
				path: newPath,
				field,
				codec: codecs?.get(column, "normalize"),
				arrayDimensions: column.dimensions,
				column
			} : {
				path: newPath,
				field
			});
		} else if (is(field, Table)) result.push(...orderSelectedFields(field[Table.Symbol.Columns], newPath, codecs));
		else result.push(...orderSelectedFields(field, newPath, codecs));
		return result;
	}, []);
}
function getColumnFromDecoder(source) {
	const query = source.getSQL();
	if (is(query.decoder, Column)) return query.decoder;
}
function haveSameKeys(left, right) {
	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) return false;
	for (const [index, key] of leftKeys.entries()) if (key !== rightKeys[index]) return false;
	return true;
}
/** @internal */
function mapUpdateSet(table, values) {
	const entries = Object.entries(values).filter(([, value]) => value !== void 0).map(([key, value]) => {
		if (is(value, SQL) || is(value, Column)) return [key, value];
		else return [key, new Param(value, table[Table.Symbol.Columns][key])];
	});
	if (entries.length === 0) throw new Error("No values to set");
	return Object.fromEntries(entries);
}
/** @internal */
function applyMixins(baseClass, extendedClasses) {
	for (const extendedClass of extendedClasses) for (const name of Object.getOwnPropertyNames(extendedClass.prototype)) {
		if (name === "constructor") continue;
		Object.defineProperty(baseClass.prototype, name, Object.getOwnPropertyDescriptor(extendedClass.prototype, name) || Object.create(null));
	}
}
/**
* @deprecated
* Use `getColumns` instead
*/
function getTableColumns(table) {
	return table[Table.Symbol.Columns];
}
function getColumns(table) {
	return is(table, Table) ? table[Table.Symbol.Columns] : is(table, View) ? table[ViewBaseConfig].selectedFields : table._.selectedFields;
}
/** @internal */
function getTableLikeName(table) {
	return is(table, Subquery) ? table._.alias : is(table, View) ? table[ViewBaseConfig].name : is(table, SQL) ? void 0 : table[Table.Symbol.IsAlias] ? table[Table.Symbol.Name] : table[Table.Symbol.BaseName];
}
/** @internal */
function getColumnNameAndConfig(a, b) {
	return {
		name: typeof a === "string" && a.length > 0 ? a : "",
		config: typeof a === "object" ? a : b
	};
}
var textDecoder = typeof TextDecoder === "undefined" ? null : new TextDecoder();
function assertUnreachable(_x) {
	throw new Error("Didn't expect to get here");
}
function isWithEnum(value) {
	return (typeof value === "object" && value !== null || typeof value === "function") && "enumValues" in value && Array.isArray(value.enumValues) && value.enumValues.length > 0;
}
var CONSTANTS = {
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
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/column-builder.js
function extractExtendedColumnType(column) {
	const [type, constraint] = column.dataType.split(" ");
	return {
		type,
		constraint
	};
}
var ColumnBuilder = class {
	static [entityKind] = "ColumnBuilder";
	/** @internal */
	config;
	constructor(name, dataType, columnType) {
		this.config = {
			name,
			keyAsName: name === "",
			notNull: false,
			default: void 0,
			hasDefault: false,
			primaryKey: false,
			isUnique: false,
			uniqueName: void 0,
			uniqueType: void 0,
			dataType,
			columnType,
			generated: void 0
		};
	}
	/**
	* Changes the data type of the column. Commonly used with `json` columns. Also, useful for branded types.
	*
	* @example
	* ```ts
	* const users = pgTable('users', {
	* 	id: integer('id').$type<UserId>().primaryKey(),
	* 	details: json('details').$type<UserDetails>().notNull(),
	* });
	* ```
	*/
	$type() {
		return this;
	}
	/**
	* Adds a `not null` clause to the column definition.
	*
	* Affects the `select` model of the table - columns *without* `not null` will be nullable on select.
	*/
	notNull() {
		this.config.notNull = true;
		return this;
	}
	/**
	* Adds a `default <value>` clause to the column definition.
	*
	* Affects the `insert` model of the table - columns *with* `default` are optional on insert.
	*
	* If you need to set a dynamic default value, use {@link $defaultFn} instead.
	*/
	default(value) {
		this.config.default = value;
		this.config.hasDefault = true;
		return this;
	}
	/**
	* Adds a dynamic default value to the column.
	* The function will be called when the row is inserted, and the returned value will be used as the column value.
	*
	* **Note:** This value does not affect the `drizzle-kit` behavior, it is only used at runtime in `drizzle-orm`.
	*/
	$defaultFn(fn) {
		this.config.defaultFn = fn;
		this.config.hasDefault = true;
		return this;
	}
	/**
	* Alias for {@link $defaultFn}.
	*/
	$default = this.$defaultFn;
	/**
	* Adds a dynamic update value to the column.
	* The function will be called when the row is updated, and the returned value will be used as the column value if none is provided.
	* If no `default` (or `$defaultFn`) value is provided, the function will be called when the row is inserted as well, and the returned value will be used as the column value.
	*
	* **Note:** This value does not affect the `drizzle-kit` behavior, it is only used at runtime in `drizzle-orm`.
	*/
	$onUpdateFn(fn) {
		this.config.onUpdateFn = fn;
		this.config.hasDefault = true;
		return this;
	}
	/**
	* Alias for {@link $onUpdateFn}.
	*/
	$onUpdate = this.$onUpdateFn;
	/**
	* Adds a `primary key` clause to the column definition. This implicitly makes the column `not null`.
	*
	* In SQLite, `integer primary key` implicitly makes the column auto-incrementing.
	*/
	primaryKey() {
		this.config.primaryKey = true;
		this.config.notNull = true;
		return this;
	}
	/** @internal Sets the name of the column to the key within the table definition if a name was not given. */
	setName(name, casingFn) {
		if (this.config.name !== "") return;
		this.config.name = casingFn(name);
	}
};
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Pipeable.js
/**
* The `Pipeable` module defines the shared interface and implementation helpers
* for values that support Effect-style method chaining with `.pipe(...)`.
*
* A `Pipeable` value can pass itself through a sequence of unary functions from
* left to right, so code can be written as `value.pipe(f, g, h)` instead of
* deeply nesting calls. This is the method form used by many Effect data types
* to compose transformations, validations, and effectful operations while
* keeping the original value as the starting point of the pipeline.
*
* @since 2.0.0
*/
/**
* Applies a `pipe` method's variadic arguments to an initial value from left
* to right.
*
* **When to use**
*
* Use to implement a custom `.pipe(...)` method from JavaScript's `arguments`
* object.
*
* **Details**
*
* This helper is intended for implementing `Pipeable.pipe` methods that
* receive JavaScript's `arguments` object. With no functions it returns the
* original value; otherwise it feeds each result into the next function.
*
* **Example** (Implementing a pipe method)
*
* ```ts
* import { Pipeable } from "effect"
*
* class NumberBox {
*   constructor(readonly value: number) {}
*
*   pipe(..._fns: ReadonlyArray<(value: number) => number>): number {
*     return Pipeable.pipeArguments(this.value, arguments) as number
*   }
* }
*
* const result = new NumberBox(5).pipe(
*   (n) => n + 2,
*   (n) => n * 3
* )
* console.log(result) // 21
* ```
*
* @category combinators
* @since 2.0.0
*/
var pipeArguments = (self, args) => {
	switch (args.length) {
		case 0: return self;
		case 1: return args[0](self);
		case 2: return args[1](args[0](self));
		case 3: return args[2](args[1](args[0](self)));
		case 4: return args[3](args[2](args[1](args[0](self))));
		case 5: return args[4](args[3](args[2](args[1](args[0](self)))));
		case 6: return args[5](args[4](args[3](args[2](args[1](args[0](self))))));
		case 7: return args[6](args[5](args[4](args[3](args[2](args[1](args[0](self)))))));
		case 8: return args[7](args[6](args[5](args[4](args[3](args[2](args[1](args[0](self))))))));
		case 9: return args[8](args[7](args[6](args[5](args[4](args[3](args[2](args[1](args[0](self)))))))));
		default: {
			let ret = self;
			for (let i = 0, len = args.length; i < len; i++) ret = args[i](ret);
			return ret;
		}
	}
};
/**
* Reusable prototype that implements `Pipeable.pipe`.
*
* **When to use**
*
* Use when classes or object prototypes can reuse this value when they need the
* standard pipe implementation backed by `pipeArguments`.
*
* @category prototypes
* @since 3.15.0
*/
var Prototype$1 = { pipe() {
	return pipeArguments(this, arguments);
} };
/**
* Provides a base constructor whose instances implement the standard `Pipeable.pipe`
* method.
*
* **When to use**
*
* Use when you need to define a class that supports Effect-style method
* chaining through `.pipe(...)`.
*
* @category constructors
* @since 3.15.0
*/
var Class$1 = /*#__PURE__*/ function() {
	function PipeableBase() {}
	PipeableBase.prototype = Prototype$1;
	return PipeableBase;
}();
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Function.js
/**
* Creates a function that can be called in data-first style or data-last
* (`pipe`-friendly) style.
*
* **When to use**
*
* Use to expose one implementation through both direct and `pipe`-friendly
* call styles.
*
* **Details**
*
* Pass either the arity of the uncurried function or a predicate that decides
* whether the current call is data-first. Arity is the common case. Use a
* predicate when optional arguments make arity ambiguous.
*
* **Example** (Using arity to determine data-first or data-last style)
*
* ```ts
* import { Function, pipe } from "effect"
*
* const sum = Function.dual<
*   (that: number) => (self: number) => number,
*   (self: number, that: number) => number
* >(2, (self, that) => self + that)
*
* console.log(sum(2, 3)) // 5
* console.log(pipe(2, sum(3))) // 5
* ```
*
* **Example** (Using call signatures to define the overloads)
*
* ```ts
* import { Function, pipe } from "effect"
*
* const sum: {
*   (that: number): (self: number) => number
*   (self: number, that: number): number
* } = Function.dual(2, (self: number, that: number): number => self + that)
*
* console.log(sum(2, 3)) // 5
* console.log(pipe(2, sum(3))) // 5
* ```
*
* **Example** (Using a predicate to determine data-first or data-last style)
*
* ```ts
* import { Function, pipe } from "effect"
*
* const sum = Function.dual<
*   (that: number) => (self: number) => number,
*   (self: number, that: number) => number
* >(
*   (args) => args.length === 2,
*   (self, that) => self + that
* )
*
* console.log(sum(2, 3)) // 5
* console.log(pipe(2, sum(3))) // 5
* ```
*
* @category combinators
* @since 2.0.0
*/
var dual = function(arity, body) {
	if (typeof arity === "function") return function() {
		return arity(arguments) ? body.apply(this, arguments) : (self) => body(self, ...arguments);
	};
	switch (arity) {
		case 0:
		case 1: throw new RangeError(`Invalid arity ${arity}`);
		case 2: return function(a, b) {
			if (arguments.length >= 2) return body(a, b);
			return function(self) {
				return body(self, a);
			};
		};
		case 3: return function(a, b, c) {
			if (arguments.length >= 3) return body(a, b, c);
			return function(self) {
				return body(self, a, b);
			};
		};
		default: return function() {
			if (arguments.length >= arity) return body.apply(this, arguments);
			const args = arguments;
			return function(self) {
				return body(self, ...args);
			};
		};
	}
};
/**
* Returns its input argument unchanged.
*
* **When to use**
*
* Use to return a value unchanged where a function is required.
*
* **Example** (Returning the same value)
*
* ```ts
* import { identity } from "effect"
* import * as assert from "node:assert"
*
* assert.deepStrictEqual(identity(5), 5)
* ```
*
* @category combinators
* @since 2.0.0
*/
var identity = (a) => a;
/**
* Creates a zero-argument function that always returns the provided value.
*
* **When to use**
*
* Use when you need a thunk or callback that returns the same value on every
* invocation.
*
* **Example** (Creating a constant thunk)
*
* ```ts
* import { Function } from "effect"
* import * as assert from "node:assert"
*
* const constNull = Function.constant(null)
*
* assert.deepStrictEqual(constNull(), null)
* assert.deepStrictEqual(constNull(), null)
* ```
*
* @category constructors
* @since 2.0.0
*/
var constant = (value) => () => value;
/**
* Returns `true` when called.
*
* **When to use**
*
* Use when you need a thunk that returns `true` on every invocation.
*
* **Example** (Returning true from a thunk)
*
* ```ts
* import { Function } from "effect"
* import * as assert from "node:assert"
*
* assert.deepStrictEqual(Function.constTrue(), true)
* ```
*
* @category constants
* @since 2.0.0
*/
var constTrue = /*#__PURE__*/ constant(true);
/**
* Returns `false` when called.
*
* **When to use**
*
* Use when you need a thunk that returns `false` on every invocation.
*
* **Example** (Returning false from a thunk)
*
* ```ts
* import { Function } from "effect"
* import * as assert from "node:assert"
*
* assert.deepStrictEqual(Function.constFalse(), false)
* ```
*
* @category constants
* @since 2.0.0
*/
var constFalse = /*#__PURE__*/ constant(false);
/**
* Returns `undefined` when called.
*
* **When to use**
*
* Use when you need a thunk that returns `undefined` on every invocation.
*
* **Example** (Returning undefined from a thunk)
*
* ```ts
* import { Function } from "effect"
* import * as assert from "node:assert"
*
* assert.deepStrictEqual(Function.constUndefined(), undefined)
* ```
*
* @category constants
* @since 2.0.0
*/
var constUndefined = /*#__PURE__*/ constant(void 0);
/**
* Returns no meaningful value when called.
*
* **When to use**
*
* Use when you need a thunk that is called only for its effect and has no
* meaningful return value.
*
* **Example** (Returning void from a thunk)
*
* ```ts
* import { Function } from "effect"
* import * as assert from "node:assert"
*
* assert.deepStrictEqual(Function.constVoid(), undefined)
* ```
*
* @category constants
* @since 2.0.0
*/
var constVoid = constUndefined;
function flow(ab, bc, cd, de, ef, fg, gh, hi, ij) {
	switch (arguments.length) {
		case 1: return ab;
		case 2: return function() {
			return bc(ab.apply(this, arguments));
		};
		case 3: return function() {
			return cd(bc(ab.apply(this, arguments)));
		};
		case 4: return function() {
			return de(cd(bc(ab.apply(this, arguments))));
		};
		case 5: return function() {
			return ef(de(cd(bc(ab.apply(this, arguments)))));
		};
		case 6: return function() {
			return fg(ef(de(cd(bc(ab.apply(this, arguments))))));
		};
		case 7: return function() {
			return gh(fg(ef(de(cd(bc(ab.apply(this, arguments)))))));
		};
		case 8: return function() {
			return hi(gh(fg(ef(de(cd(bc(ab.apply(this, arguments))))))));
		};
		case 9: return function() {
			return ij(hi(gh(fg(ef(de(cd(bc(ab.apply(this, arguments)))))))));
		};
	}
}
/**
* Creates a memoized function whose input is an object, caching results by
* object identity.
*
* **When to use**
*
* Use to reuse the result of a synchronous computation whose output is stable
* for a given object reference.
*
* **Details**
*
* Each memoized wrapper owns a private `WeakMap` keyed by object identity.
* Cached `undefined` results are still returned because the cache is checked
* with `WeakMap.has`.
*
* **Gotchas**
*
* Structurally equal objects do not share cache entries. If the same object is
* mutated after its first call, later calls still return the cached result for
* that reference.
*
* @category caching
* @since 4.0.0
*/
function memoize(f) {
	const cache = /* @__PURE__ */ new WeakMap();
	return (a) => {
		if (cache.has(a)) return cache.get(a);
		const result = f(a);
		cache.set(a, result);
		return result;
	};
}
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/equal.js
/** @internal */
var getAllObjectKeys = (obj) => {
	const keys = new Set(Reflect.ownKeys(obj));
	if (obj.constructor === Object) return keys;
	if (obj instanceof Error) keys.delete("stack");
	const proto = Object.getPrototypeOf(obj);
	let current = proto;
	while (current !== null && current !== Object.prototype) {
		const ownKeys = Reflect.ownKeys(current);
		for (let i = 0; i < ownKeys.length; i++) keys.add(ownKeys[i]);
		current = Object.getPrototypeOf(current);
	}
	if (keys.has("constructor") && typeof obj.constructor === "function" && proto === obj.constructor.prototype) keys.delete("constructor");
	return keys;
};
/** @internal */
var byReferenceInstances = /*#__PURE__*/ new WeakSet();
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Predicate.js
/**
* Defines runtime checks for values.
*
* A `Predicate<A>` returns `true` or `false` for an `A`. A
* `Refinement<A, B>` is a predicate that also narrows the TypeScript type when
* it succeeds. This module includes guards for common JavaScript values,
* property and tag checks, tuple and struct checks, boolean combinators, and
* helpers for composing predicates and refinements.
*
* @since 2.0.0
*/
/**
* Checks whether a value is a `string`.
*
* **When to use**
*
* Use when you need a `Predicate` guard to narrow an `unknown` value to a
* string.
*
* **Details**
*
* Uses `typeof input === "string"`.
*
* **Example** (Guard string)
*
* ```ts
* import { Predicate } from "effect"
*
* const data: unknown = "hi"
*
* if (Predicate.isString(data)) {
*   console.log(data.toUpperCase())
* }
* ```
*
* @see {@link isNumber}
* @see {@link isBoolean}
* @see {@link Refinement}
* @category guards
* @since 2.0.0
*/
function isString(input) {
	return typeof input === "string";
}
/**
* Checks whether a value is a `number`.
*
* **When to use**
*
* Use when you need a `Predicate` guard to narrow an `unknown` value to a
* number.
*
* **Details**
*
* Uses `typeof input === "number"` and does not exclude `NaN` or `Infinity`.
*
* **Example** (Guard number)
*
* ```ts
* import { Predicate } from "effect"
*
* const data: unknown = 42
*
* if (Predicate.isNumber(data)) {
*   console.log(data + 1)
* }
* ```
*
* @see {@link isBigInt}
* @see {@link isString}
* @category guards
* @since 2.0.0
*/
function isNumber(input) {
	return typeof input === "number";
}
/**
* Checks whether a value is a `boolean`.
*
* **When to use**
*
* Use when you need a `Predicate` guard to narrow an `unknown` value to a
* boolean.
*
* **Details**
*
* Uses `typeof input === "boolean"`.
*
* **Example** (Guard boolean)
*
* ```ts
* import { Predicate } from "effect"
*
* const data: unknown = true
*
* if (Predicate.isBoolean(data)) {
*   console.log(data ? "yes" : "no")
* }
* ```
*
* @see {@link isString}
* @see {@link isNumber}
* @category guards
* @since 2.0.0
*/
function isBoolean(input) {
	return typeof input === "boolean";
}
/**
* Checks whether a value is a `bigint`.
*
* **When to use**
*
* Use when you need a `Predicate` guard to narrow an `unknown` value to a
* bigint.
*
* **Details**
*
* Uses `typeof input === "bigint"`.
*
* **Example** (Guard bigint)
*
* ```ts
* import { Predicate } from "effect"
*
* const data: unknown = 1n
*
* if (Predicate.isBigInt(data)) {
*   console.log(data + 2n)
* }
* ```
*
* @see {@link isNumber}
* @category guards
* @since 2.0.0
*/
function isBigInt(input) {
	return typeof input === "bigint";
}
/**
* Checks whether a value is a `symbol`.
*
* **When to use**
*
* Use when you need a `Predicate` guard to narrow an `unknown` value to a
* symbol.
*
* **Details**
*
* Uses `typeof input === "symbol"`.
*
* **Example** (Guard symbol)
*
* ```ts
* import { Predicate } from "effect"
*
* const data: unknown = Symbol.for("id")
*
* if (Predicate.isSymbol(data)) {
*   console.log(data.description)
* }
* ```
*
* @see {@link isPropertyKey}
* @category guards
* @since 2.0.0
*/
function isSymbol(input) {
	return typeof input === "symbol";
}
/**
* Checks whether a value is a valid `PropertyKey` (string, number, or symbol).
*
* **When to use**
*
* Use when you need a `Predicate` guard for unknown property keys before
* indexing.
*
* **Details**
*
* Uses `isString`, `isNumber`, and `isSymbol`.
*
* **Example** (Guard property key)
*
* ```ts
* import { Predicate } from "effect"
*
* const key: unknown = "name"
* const obj: Record<PropertyKey, unknown> = { name: "Ada" }
*
* if (Predicate.isPropertyKey(key) && key in obj) {
*   console.log(obj[key])
* }
* ```
*
* @see {@link isString}
* @see {@link isNumber}
* @see {@link isSymbol}
* @category guards
* @since 4.0.0
*/
function isPropertyKey(u) {
	return isString(u) || isNumber(u) || isSymbol(u);
}
/**
* Checks whether a value is a `function`.
*
* **When to use**
*
* Use when you need a `Predicate` guard to narrow an `unknown` value to a
* callable function.
*
* **Details**
*
* Uses `typeof input === "function"`.
*
* **Example** (Guard function)
*
* ```ts
* import { Predicate } from "effect"
*
* const data: unknown = () => 1
*
* if (Predicate.isFunction(data)) {
*   console.log(data())
* }
* ```
*
* @see {@link isObjectKeyword}
* @category guards
* @since 2.0.0
*/
function isFunction(input) {
	return typeof input === "function";
}
/**
* Checks whether a value is not `undefined`.
*
* **When to use**
*
* Use when you need a `Predicate` refinement that filters out `undefined`
* while preserving other falsy values.
*
* **Details**
*
* Returns a refinement that excludes `undefined`.
*
* **Example** (Filter undefined)
*
* ```ts
* import { Predicate } from "effect"
*
* const values = [1, undefined, 2]
* const defined = values.filter(Predicate.isNotUndefined)
*
* console.log(defined)
* ```
*
* @see {@link isUndefined}
* @see {@link isNotNullish}
* @category guards
* @since 2.0.0
*/
function isNotUndefined(input) {
	return input !== void 0;
}
/**
* Checks whether a value is not `null` and not `undefined`.
*
* **When to use**
*
* Use when you need a `Predicate` refinement that filters out nullish values
* but keeps other falsy ones.
*
* **Details**
*
* Uses `input != null`.
*
* **Example** (Filter non-nullish)
*
* ```ts
* import { Predicate } from "effect"
*
* const values = [0, null, "", undefined]
* const present = values.filter(Predicate.isNotNullish)
*
* console.log(present)
* ```
*
* @see {@link isNullish}
* @see {@link isNotNull}
* @see {@link isNotUndefined}
* @category guards
* @since 4.0.0
*/
function isNotNullish(input) {
	return input != null;
}
/**
* Type guard that always returns `true`.
*
* **When to use**
*
* Use when you need a `Predicate` that always accepts, e.g. as a placeholder.
*
* **Example** (Always matches)
*
* ```ts
* import { Predicate } from "effect"
*
* console.log(Predicate.isUnknown(123))
* ```
*
* @see {@link isNever}
* @category guards
* @since 2.0.0
*/
function isUnknown(_) {
	return true;
}
/**
* Checks whether a value is an `object` in the JavaScript sense (objects, arrays, functions).
*
* **When to use**
*
* Use when you need a `Predicate` guard that accepts arrays and functions as
* well as objects.
*
* **Details**
*
* Returns `true` for arrays and functions, and `false` for `null`.
*
* **Example** (Object keyword)
*
* ```ts
* import { Predicate } from "effect"
*
* console.log(Predicate.isObjectKeyword(() => 1))
* console.log(Predicate.isObjectKeyword(null))
* ```
*
* @see {@link isObject}
* @see {@link isObjectOrArray}
* @category guards
* @since 4.0.0
*/
function isObjectKeyword(input) {
	return typeof input === "object" && input !== null || isFunction(input);
}
/**
* Checks whether a value has a given property key.
*
* **When to use**
*
* Use when you need a `Predicate` guard for property access on `unknown`
* values with a simple structural object check.
*
* **Details**
*
* Uses the `in` operator and `isObjectKeyword`. This does not check property
* value types.
*
* **Example** (Guard property)
*
* ```ts
* import { Predicate } from "effect"
*
* const hasName = Predicate.hasProperty("name")
* const data: unknown = { name: "Ada" }
*
* if (hasName(data)) {
*   console.log(data.name)
* }
* ```
*
* @see {@link isTagged}
* @see {@link isObjectKeyword}
* @category guards
* @since 2.0.0
*/
var hasProperty = /*#__PURE__*/ dual(2, (self, property) => isObjectKeyword(self) && property in self);
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Hash.js
/**
* Computes Effect hash values and defines the interface for objects that want
* to provide their own hash implementation. Hashes are small numeric
* fingerprints used by Effect data structures to bucket values quickly; they
* are not cryptographic digests and they are not proof that two values are
* equal. The module also includes helpers for primitive, structure, array, and
* reference-based hashes, plus functions for combining and optimizing numeric
* hash values.
*
* @since 2.0.0
*/
/**
* Defines the unique identifier used to identify objects that implement the Hash interface.
*
* **When to use**
*
* Use as the computed property key for the method that supplies a custom hash
* value on a `Hash` implementor.
*
* @see {@link Hash} for the interface implemented with this symbol
* @see {@link isHash} for checking whether a value implements `Hash`
* @see {@link hash} for computing hash values
*
* @category symbols
* @since 2.0.0
*/
var symbol$1 = "~effect/interfaces/Hash";
/**
* Computes a hash value for any given value.
*
* **When to use**
*
* Use to compute an Effect hash for primitives, collections, and hashable
* objects.
*
* **Details**
*
* This function can hash primitives (numbers, strings, booleans, etc.) as well as
* objects, arrays, and other complex data structures. It automatically handles
* different types and provides a consistent hash value for equivalent inputs.
*
* **Gotchas**
*
* Objects being hashed must be treated as immutable after their first hash
* computation. Hash results are cached, so mutating an object after hashing will
* lead to stale cached values and broken hash-based operations. For mutable
* objects, implement a custom `Hash` interface that hashes the object reference
* rather than its content.
*
* **Example** (Hashing different values)
*
* ```ts
* import { Hash } from "effect"
*
* // Hash primitive values
* console.log(Hash.hash(42)) // numeric hash
* console.log(Hash.hash("hello")) // string hash
* console.log(Hash.hash(true)) // boolean hash
*
* // Hash objects and arrays
* console.log(Hash.hash({ name: "John", age: 30 }))
* console.log(Hash.hash([1, 2, 3]))
* console.log(Hash.hash({ id: "user-1", roles: ["admin", "editor"] }))
* ```
*
* @category hashing
* @since 2.0.0
*/
var hash = (self) => {
	switch (typeof self) {
		case "number": return number$1(self);
		case "bigint": return string$1(self.toString(10));
		case "boolean": return string$1(String(self));
		case "symbol": return string$1(String(self));
		case "string": return string$1(self);
		case "undefined": return string$1("undefined");
		case "function":
		case "object": if (self === null) return string$1("null");
		else if (self instanceof Date) return string$1(self.toISOString());
		else if (self instanceof RegExp) return string$1(self.toString());
		else {
			if (byReferenceInstances.has(self)) return random(self);
			if (hashCache.has(self)) return hashCache.get(self);
			const h = withVisitedTracking$1(self, () => {
				if (isHash(self)) return self[symbol$1]();
				else if (typeof self === "function") return random(self);
				else if (Array.isArray(self) || ArrayBuffer.isView(self)) return array(self);
				else if (self instanceof Map) return hashMap(self);
				else if (self instanceof Set) return hashSet(self);
				return structure(self);
			});
			hashCache.set(self, h);
			return h;
		}
		default: throw new Error(`BUG: unhandled typeof ${typeof self} - please report an issue at https://github.com/Effect-TS/effect/issues`);
	}
};
/**
* Generates a random hash value for an object and caches it.
*
* **When to use**
*
* Use to hash an object by reference identity instead of structural content.
*
* **Details**
*
* This function creates a random hash value for objects that don't have their own
* hash implementation. The hash value is cached using a WeakMap, so the same object
* will always return the same hash value during its lifetime.
*
* **Example** (Hashing objects by reference)
*
* ```ts
* import { Hash } from "effect"
*
* const obj1 = { a: 1 }
* const obj2 = { a: 1 }
*
* // Same object always returns the same hash
* console.log(Hash.random(obj1) === Hash.random(obj1)) // true
*
* // Different objects get different hashes
* console.log(Hash.random(obj1) === Hash.random(obj2)) // false
* ```
*
* @category hashing
* @since 2.0.0
*/
var random = (self) => {
	if (!randomHashCache.has(self)) randomHashCache.set(self, number$1(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)));
	return randomHashCache.get(self);
};
/**
* Combines two hash values into a single hash value.
*
* **When to use**
*
* Use to build a hash for a composite value by folding together hash values for
* its parts.
*
* **Details**
*
* Supports both direct and pipeable usage. The implementation combines two
* hash values with `(self * 53) ^ b`.
*
* **Example** (Combining hash values)
*
* ```ts
* import { Hash, pipe } from "effect"
*
* // Can also be used with pipe
*
* const hash1 = Hash.hash("hello")
* const hash2 = Hash.hash("world")
*
* // Combine two hash values
* const combined = Hash.combine(hash2)(hash1)
* console.log(combined)
* const result = pipe(hash1, Hash.combine(hash2))
* ```
*
* @see {@link hash} for computing hash values from arbitrary inputs
* @see {@link structureKeys} for hashing selected object fields without manual combination
*
* @category hashing
* @since 2.0.0
*/
var combine = /*#__PURE__*/ dual(2, (self, b) => self * 53 ^ b);
/**
* Applies bit manipulation techniques to optimize a hash value.
*
* **When to use**
*
* Use to improve the bit distribution of a raw numeric hash value.
*
* **Details**
*
* This function takes a hash value and applies bitwise operations to improve
* the distribution of hash values, reducing the likelihood of collisions.
*
* **Example** (Optimizing a hash value)
*
* ```ts
* import { Hash } from "effect"
*
* const rawHash = 1234567890
* const optimizedHash = Hash.optimize(rawHash)
* console.log(optimizedHash) // optimized hash value
*
* // Often used internally by other hash functions
* const stringHash = Hash.optimize(Hash.string("hello"))
* ```
*
* @category hashing
* @since 2.0.0
*/
var optimize = (n) => n & 3221225471 | n >>> 1 & 1073741824;
/**
* Checks whether a value implements the Hash interface.
*
* **When to use**
*
* Use to detect whether an unknown value provides a custom hash implementation.
*
* **Details**
*
* This function determines whether a given value has the Hash symbol property,
* indicating that it can provide its own hash value implementation.
*
* **Example** (Checking for Hash support)
*
* ```ts
* import { Hash } from "effect"
*
* class MyHashable implements Hash.Hash {
*   [Hash.symbol]() {
*     return 42
*   }
* }
*
* const obj = new MyHashable()
* console.log(Hash.isHash(obj)) // true
* console.log(Hash.isHash({})) // false
* console.log(Hash.isHash("string")) // false
* ```
*
* @category guards
* @since 2.0.0
*/
var isHash = (u) => hasProperty(u, symbol$1);
/**
* Computes a hash value for a number.
*
* **When to use**
*
* Use to hash a JavaScript number with Effect's numeric hash semantics.
*
* **Details**
*
* This function creates a hash value for numeric inputs, handling special cases
* like NaN, Infinity, and -Infinity with distinct hash values. It uses bitwise operations to ensure good distribution
* of hash values across different numeric inputs.
*
* **Example** (Hashing numbers)
*
* ```ts
* import { Hash } from "effect"
*
* console.log(Hash.number(42)) // hash of 42
* console.log(Hash.number(3.14)) // hash of 3.14
* console.log(Hash.number(NaN)) // hash of "NaN"
* console.log(Hash.number(Infinity)) // 0 (special case)
*
* // Same numbers produce the same hash
* console.log(Hash.number(100) === Hash.number(100)) // true
* ```
*
* @category hashing
* @since 2.0.0
*/
var number$1 = (n) => {
	if (n !== n) return string$1("NaN");
	if (n === Infinity) return string$1("Infinity");
	if (n === -Infinity) return string$1("-Infinity");
	let h = n | 0;
	if (h !== n) h ^= n * 4294967295;
	while (n > 4294967295) h ^= n /= 4294967295;
	return optimize(h);
};
/**
* Computes a hash value for a string using the djb2 algorithm.
*
* **When to use**
*
* Use when you need a string field to contribute to a custom structural hash
* implementation.
*
* **Details**
*
* This function implements a variation of the djb2 hash algorithm, which is
* known for its good distribution properties and speed. It processes each
* character of the string to produce a consistent hash value.
*
* **Example** (Hashing strings)
*
* ```ts
* import { Hash } from "effect"
*
* console.log(Hash.string("hello")) // hash of "hello"
* console.log(Hash.string("world")) // hash of "world"
* console.log(Hash.string("")) // hash of empty string
*
* // Same strings produce the same hash
* console.log(Hash.string("test") === Hash.string("test")) // true
* ```
*
* @category hashing
* @since 2.0.0
*/
var string$1 = (str) => {
	let h = 5381, i = str.length;
	while (i) h = h * 33 ^ str.charCodeAt(--i);
	return optimize(h);
};
/**
* Computes a hash value for an object using only the specified keys.
*
* **When to use**
*
* Use to hash an object by a selected set of property keys.
*
* **Details**
*
* This function allows you to hash an object by considering only specific keys,
* which is useful when you want to create a hash based on a subset of an object's
* properties.
*
* **Example** (Hashing selected object keys)
*
* ```ts
* import { Hash } from "effect"
*
* const person = { name: "John", age: 30, city: "New York" }
*
* // Hash only specific keys
* const hash1 = Hash.structureKeys(person, ["name", "age"])
* const hash2 = Hash.structureKeys(person, ["name", "city"])
*
* console.log(hash1) // hash based on name and age
* console.log(hash2) // hash based on name and city
*
* // Same keys produce the same hash
* const person2 = { name: "John", age: 30, city: "Boston" }
* const hash3 = Hash.structureKeys(person2, ["name", "age"])
* console.log(hash1 === hash3) // true
* ```
*
* @category hashing
* @since 2.0.0
*/
var structureKeys = (o, keys) => {
	let h = 12289;
	for (const key of keys) h ^= combine(hash(key), hash(o[key]));
	return optimize(h);
};
/**
* Computes a structural hash for an object using Effect's object key collection.
*
* **When to use**
*
* Use to hash an object from all structural keys collected by Effect.
*
* **Details**
*
* The hash is based on the object's structural keys and their values, including
* symbol keys and relevant prototype keys for non-plain objects.
*
* **Example** (Hashing object structures)
*
* ```ts
* import { Hash } from "effect"
*
* const obj1 = { name: "John", age: 30 }
* const obj2 = { name: "Jane", age: 25 }
* const obj3 = { name: "John", age: 30 }
*
* console.log(Hash.structure(obj1)) // hash of obj1
* console.log(Hash.structure(obj2)) // different hash
* console.log(Hash.structure(obj3)) // same as obj1
*
* // Objects with same properties produce same hash
* console.log(Hash.structure(obj1) === Hash.structure(obj3)) // true
* ```
*
* @category hashing
* @since 2.0.0
*/
var structure = (o) => structureKeys(o, getAllObjectKeys(o));
var iterableWith = (seed, f) => (iter) => {
	let h = seed;
	for (const element of iter) h ^= f(element);
	return optimize(h);
};
/**
* Computes a hash value for an iterable by hashing all of its elements.
*
* **When to use**
*
* Use to hash the values yielded by an iterable with Effect hash semantics.
*
* **Details**
*
* The implementation folds element hashes from the seed `6151` with XOR and
* then optimizes the final hash.
*
* **Gotchas**
*
* A hash is not an equality proof. Because this implementation uses XOR,
* reordered inputs can produce the same hash.
*
* **Example** (Hashing arrays)
*
* ```ts
* import { Hash } from "effect"
*
* const arr1 = [1, 2, 3]
* const arr2 = [1, 2, 3]
* const arr3 = [3, 2, 1]
*
* console.log(Hash.array(arr1)) // hash of [1, 2, 3]
* console.log(Hash.array(arr2)) // same hash as arr1
* console.log(Hash.array(arr3)) // may match reordered inputs
*
* console.log(Hash.array(arr1) === Hash.array(arr2)) // true
* console.log(Hash.array(arr1) === Hash.array(arr3)) // true
* ```
*
* @see {@link hash} for the general-purpose hash dispatcher
*
* @category hashing
* @since 2.0.0
*/
var array = /*#__PURE__*/ iterableWith(6151, hash);
var hashMap = /*#__PURE__*/ iterableWith(/*#__PURE__*/ string$1("Map"), ([k, v]) => combine(hash(k), hash(v)));
var hashSet = /*#__PURE__*/ iterableWith(/*#__PURE__*/ string$1("Set"), hash);
var randomHashCache = /*#__PURE__*/ new WeakMap();
var hashCache = /*#__PURE__*/ new WeakMap();
var visitedObjects = /*#__PURE__*/ new WeakSet();
function withVisitedTracking$1(obj, fn) {
	if (visitedObjects.has(obj)) return string$1("[Circular]");
	visitedObjects.add(obj);
	const result = fn();
	visitedObjects.delete(obj);
	return result;
}
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Equal.js
/**
* Defines the unique string identifier for the `Equal` interface.
*
* **When to use**
*
* Use when you implement custom equality and need the computed property key for
* the equality method.
*
* **Details**
*
* This is a pure constant with no allocation or side effects.
*
* **Example** (Implementing Equal on a Class)
*
* ```ts
* import { Equal, Hash } from "effect"
*
* class UserId implements Equal.Equal {
*   constructor(readonly id: string) {}
*
*   [Equal.symbol](that: Equal.Equal): boolean {
*     return that instanceof UserId && this.id === that.id
*   }
*
*   [Hash.symbol](): number {
*     return Hash.string(this.id)
*   }
* }
* ```
*
* @see {@link Equal} — the interface that uses this symbol
* @see {@link isEqual} — type guard for `Equal` implementors
* @category symbols
* @since 2.0.0
*/
var symbol = "~effect/interfaces/Equal";
function equals$2() {
	if (arguments.length === 1) return (self) => compareBoth(self, arguments[0]);
	return compareBoth(arguments[0], arguments[1]);
}
function compareBoth(self, that) {
	if (self === that) return true;
	if (self == null || that == null) return false;
	const selfType = typeof self;
	if (selfType !== typeof that) return false;
	if (selfType === "number" && self !== self && that !== that) return true;
	if (selfType !== "object" && selfType !== "function") return false;
	if (byReferenceInstances.has(self) || byReferenceInstances.has(that)) return false;
	return withCache(self, that, compareObjects);
}
/** Helper to run comparison with proper visited tracking */
function withVisitedTracking(self, that, fn) {
	const hasLeft = visitedLeft.has(self);
	const hasRight = visitedRight.has(that);
	if (hasLeft && hasRight) return true;
	if (hasLeft || hasRight) return false;
	visitedLeft.add(self);
	visitedRight.add(that);
	const result = fn();
	visitedLeft.delete(self);
	visitedRight.delete(that);
	return result;
}
var visitedLeft = /*#__PURE__*/ new WeakSet();
var visitedRight = /*#__PURE__*/ new WeakSet();
/** Helper to perform cached object comparison */
function compareObjects(self, that) {
	if (hash(self) !== hash(that)) return false;
	else if (self instanceof Date) {
		if (!(that instanceof Date)) return false;
		return self.toISOString() === that.toISOString();
	} else if (self instanceof RegExp) {
		if (!(that instanceof RegExp)) return false;
		return self.toString() === that.toString();
	}
	const selfIsEqual = isEqual(self);
	const thatIsEqual = isEqual(that);
	if (selfIsEqual !== thatIsEqual) return false;
	const bothEquals = selfIsEqual && thatIsEqual;
	if (typeof self === "function" && !bothEquals) return false;
	return withVisitedTracking(self, that, () => {
		if (bothEquals) return self[symbol](that);
		else if (Array.isArray(self)) {
			if (!Array.isArray(that) || self.length !== that.length) return false;
			return compareArrays(self, that);
		} else if (ArrayBuffer.isView(self)) {
			if (!ArrayBuffer.isView(that) || self.byteLength !== that.byteLength) return false;
			return compareTypedArrays(self, that);
		} else if (self instanceof Map) {
			if (!(that instanceof Map) || self.size !== that.size) return false;
			return compareMaps(self, that);
		} else if (self instanceof Set) {
			if (!(that instanceof Set) || self.size !== that.size) return false;
			return compareSets(self, that);
		}
		return compareRecords(self, that);
	});
}
function withCache(self, that, f) {
	let selfMap = equalityCache.get(self);
	if (!selfMap) {
		selfMap = /* @__PURE__ */ new WeakMap();
		equalityCache.set(self, selfMap);
	} else if (selfMap.has(that)) return selfMap.get(that);
	const result = f(self, that);
	selfMap.set(that, result);
	let thatMap = equalityCache.get(that);
	if (!thatMap) {
		thatMap = /* @__PURE__ */ new WeakMap();
		equalityCache.set(that, thatMap);
	}
	thatMap.set(self, result);
	return result;
}
var equalityCache = /*#__PURE__*/ new WeakMap();
function compareArrays(self, that) {
	for (let i = 0; i < self.length; i++) if (!compareBoth(self[i], that[i])) return false;
	return true;
}
function compareTypedArrays(self, that) {
	if (self.length !== that.length) return false;
	for (let i = 0; i < self.length; i++) if (self[i] !== that[i]) return false;
	return true;
}
function compareRecords(self, that) {
	const selfKeys = getAllObjectKeys(self);
	const thatKeys = getAllObjectKeys(that);
	if (selfKeys.size !== thatKeys.size) return false;
	for (const key of selfKeys) if (!thatKeys.has(key) || !compareBoth(self[key], that[key])) return false;
	return true;
}
/** @internal */
function makeCompareMap(keyEquivalence, valueEquivalence) {
	return function compareMaps(self, that) {
		for (const [selfKey, selfValue] of self) {
			let found = false;
			for (const [thatKey, thatValue] of that) if (keyEquivalence(selfKey, thatKey) && valueEquivalence(selfValue, thatValue)) {
				found = true;
				break;
			}
			if (!found) return false;
		}
		return true;
	};
}
var compareMaps = /*#__PURE__*/ makeCompareMap(compareBoth, compareBoth);
/** @internal */
function makeCompareSet(equivalence) {
	return function compareSets(self, that) {
		for (const selfValue of self) {
			let found = false;
			for (const thatValue of that) if (equivalence(selfValue, thatValue)) {
				found = true;
				break;
			}
			if (!found) return false;
		}
		return true;
	};
}
var compareSets = /*#__PURE__*/ makeCompareSet(compareBoth);
/**
* Checks whether a value implements the {@link Equal} interface.
*
* **When to use**
*
* Use when you need generic utility code to distinguish `Equal` implementors
* from plain values before calling `[Equal.symbol]` directly.
*
* **Details**
*
* - Pure function, no side effects.
* - Returns `true` if and only if `u` has a property keyed by
*   {@link symbol}.
* - Acts as a TypeScript type guard, narrowing the input to {@link Equal}.
*
* **Example** (Type Guard)
*
* ```ts
* import { Equal, Hash } from "effect"
*
* class Token implements Equal.Equal {
*   constructor(readonly value: string) {}
*   [Equal.symbol](that: Equal.Equal): boolean {
*     return that instanceof Token && this.value === that.value
*   }
*   [Hash.symbol](): number {
*     return Hash.string(this.value)
*   }
* }
*
* console.log(Equal.isEqual(new Token("abc"))) // true
* console.log(Equal.isEqual({ x: 1 }))         // false
* console.log(Equal.isEqual(42))                // false
* ```
*
* @see {@link Equal} — the interface being checked
* @see {@link symbol} — the property key that signals `Equal` support
* @category guards
* @since 2.0.0
*/
var isEqual = (u) => hasProperty(u, symbol);
/**
* Wraps {@link equals} as an `Equivalence<A>`.
*
* **When to use**
*
* Use when you want to pass `Equal.equals` to APIs that require an
* `Equivalence`.
*
* **Details**
*
* - Returns a function `(a: A, b: A) => boolean` that delegates to
*   {@link equals}.
* - Pure; allocates a thin wrapper on each call.
*
* **Example** (Deduplicating with Equal Semantics)
*
* ```ts
* import { Array, Equal } from "effect"
*
* const eq = Equal.asEquivalence<number>()
* const result = Array.dedupeWith([1, 2, 2, 3, 1], eq)
* console.log(result) // [1, 2, 3]
* ```
*
* @see {@link equals} — the underlying comparison function
* @category instances
* @since 4.0.0
*/
var asEquivalence = () => equals$2;
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Equivalence.js
/**
* Creates a custom equivalence relation with an optimized reference equality check.
*
* **When to use**
*
* Use when you need an equality rule that the built-in instances and input
* mapping helpers cannot express, and you can provide a law-abiding comparison.
*
* **Details**
*
* The returned equivalence first checks reference equality (`===`) for
* performance. If the values are not the same reference, it falls back to the
* provided equivalence function, which must satisfy reflexive, symmetric, and
* transitive properties.
*
* **Example** (Case-insensitive string equivalence)
*
* ```ts
* import { Equivalence } from "effect"
*
* const caseInsensitive = Equivalence.make<string>((a, b) =>
*   a.toLowerCase() === b.toLowerCase()
* )
*
* console.log(caseInsensitive("Hello", "HELLO")) // true
* console.log(caseInsensitive("foo", "bar")) // false
*
* // Same reference optimization
* const str = "test"
* console.log(caseInsensitive(str, str)) // true (fast path)
* ```
*
* **Example** (Numeric tolerance equivalence)
*
* ```ts
* import { Equivalence } from "effect"
*
* const tolerance = Equivalence.make<number>((a, b) => Math.abs(a - b) < 0.0001)
*
* console.log(tolerance(1.0, 1.001)) // false
* console.log(tolerance(1.0, 1.00001)) // true
* ```
*
* @see {@link strictEqual}
* @see {@link mapInput}
* @category constructors
* @since 2.0.0
*/
var make$16 = (isEquivalent) => (self, that) => self === that || isEquivalent(self, that);
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/array.js
/**
* @since 2.0.0
*/
/** @internal */
var isArrayNonEmpty$1 = (self) => self.length > 0;
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Redactable.js
/**
* Defines the symbol used to identify objects that implement the {@link Redactable}
* protocol.
*
* **When to use**
*
* Use as the property key when implementing the `Redactable` protocol.
*
* **Details**
*
* Add a method under this key to make an object redactable. The method receives
* the current `Context` and must return the replacement value. The symbol is
* registered globally via `Symbol.for("~effect/Redactable")`, so it is
* identical across multiple copies of the library at runtime.
*
* **Example** (Masking an API key)
*
* ```ts
* import { Context, Redactable } from "effect"
*
* class ApiKey {
*   constructor(readonly raw: string) {}
*
*   [Redactable.symbolRedactable](_ctx: Context.Context<never>) {
*     return this.raw.slice(0, 4) + "..."
*   }
* }
* ```
*
* @see {@link Redactable} for the interface this symbol belongs to
* @see {@link isRedactable} to check whether a value has this symbol
* @category symbols
* @since 3.10.0
*/
var symbolRedactable = /*#__PURE__*/ Symbol.for("~effect/Redactable");
/**
* Type guard that checks whether a value implements the {@link Redactable}
* interface.
*
* **When to use**
*
* Use to narrow an unknown value before calling redaction-specific helpers.
*
* @see {@link Redactable} for the interface being checked
* @see {@link redact} to apply redaction if the value is redactable
* @category guards
* @since 3.10.0
*/
var isRedactable = (u) => hasProperty(u, symbolRedactable);
/**
* Returns a redacted value if it implements {@link Redactable}, otherwise returns it
* unchanged.
*
* **When to use**
*
* Use as the general-purpose entry point for redaction when the input may
* or may not implement the redaction protocol.
*
* **Details**
*
* This function calls {@link isRedactable} and, when it returns `true`,
* delegates to {@link getRedacted}.
*
* **Gotchas**
*
* Redaction is not recursive. Nested redactable values inside the returned
* object are not automatically redacted.
*
* @see {@link isRedactable} to check before redacting
* @see {@link getRedacted} for the lower-level variant for known redactables
* @category destructors
* @since 3.10.0
*/
function redact(u) {
	if (isRedactable(u)) return getRedacted(u);
	return u;
}
/**
* Returns the result of calling `[symbolRedactable]` on a value that is
* already known to be {@link Redactable}.
*
* **When to use**
*
* Use when you need to read the redacted representation from a value already
* verified as `Redactable`.
*
* **Details**
*
* This function reads the current fiber's `Context` from the global fiber
* reference and passes it to the redaction method.
*
* **Gotchas**
*
* If no fiber is active, an empty `Context` is passed to the redaction method.
*
* @see {@link redact} for the higher-level variant that handles non-redactable values
* @see {@link isRedactable} for the type guard to verify before calling this
* @category destructors
* @since 4.0.0
*/
function getRedacted(redactable) {
	return redactable[symbolRedactable](globalThis["~effect/Fiber/currentFiber"]?.context ?? emptyContext$1);
}
/** @internal */
var currentFiberTypeId = "~effect/Fiber/currentFiber";
var emptyContext$1 = {
	"~effect/Context": {},
	mapUnsafe: /*#__PURE__*/ new Map(),
	pipe() {
		return pipeArguments(this, arguments);
	}
};
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Formatter.js
/**
* Formats JavaScript values into readable strings.
*
* `format` is intended for logs, diagnostics, and error messages. It handles
* primitives, objects, arrays, dates, regular expressions, maps, sets, class
* instances, errors, circular references, and redactable values. `formatJson`
* wraps JSON formatting with redaction and circular-reference handling, and the
* module also includes helpers for property keys, paths, and dates.
*
* @since 4.0.0
*/
/**
* Converts any JavaScript value into a human-readable string.
*
* **When to use**
*
* Use when you need to format arbitrary JavaScript values for debugging,
* logging, or error messages.
*
* **Details**
*
* - Output is **not** valid JSON; use {@link formatJson} when you need
*   parseable JSON.
* - Handles `BigInt`, `Symbol`, `Set`, `Map`, `Date`, `RegExp`, and class
*   instances that `JSON.stringify` cannot represent.
* - Circular references are shown as `"[Circular]"` instead of throwing.
* - Primitives: stringified naturally (`null`, `undefined`, `123`, `true`).
*   Strings are JSON-quoted.
* - Objects with a custom `toString` (not `Object.prototype.toString`):
*   `toString()` is called unless `ignoreToString` is `true`.
* - Errors with a `cause`: formatted as `"<message> (cause: <cause>)"`.
* - Iterables (`Set`, `Map`, etc.): formatted as
*   `ClassName([...elements])`.
* - Class instances: wrapped as `ClassName({...})`.
* - `Redactable` values are automatically redacted.
* - Arrays/objects with 0–1 entries are inline; larger ones are
*   pretty-printed when `space` is set.
* - `space` — indentation unit (number of spaces, or a string like
*   `"\t"`). Defaults to `0` (compact).
* - `ignoreToString` — skip calling `toString()`. Defaults to `false`.
*
* **Example** (Compact output)
*
* ```ts
* import { Formatter } from "effect"
*
* console.log(Formatter.format({ a: 1, b: [2, 3] }))
* // {"a":1,"b":[2,3]}
* ```
*
* **Example** (Pretty-printed output)
*
* ```ts
* import { Formatter } from "effect"
*
* console.log(Formatter.format({ a: 1, b: [2, 3] }, { space: 2 }))
* // {
* //   "a": 1,
* //   "b": [
* //     2,
* //     3
* //   ]
* // }
* ```
*
* **Example** (Circular reference handling)
*
* ```ts
* import { Formatter } from "effect"
*
* const obj: any = { name: "loop" }
* obj.self = obj
* console.log(Formatter.format(obj))
* // {"name":"loop","self":[Circular]}
* ```
*
* @see {@link formatJson}
* @see {@link Formatter}
* @category formatting
* @since 2.0.0
*/
function format$1(input, options) {
	const space = options?.space ?? 0;
	const seen = /* @__PURE__ */ new WeakSet();
	const gap = !space ? "" : typeof space === "number" ? " ".repeat(space) : space;
	const ind = (d) => gap.repeat(d);
	const wrap = (v, body) => {
		const ctor = v?.constructor;
		return ctor && ctor !== Object.prototype.constructor && ctor.name ? `${ctor.name}(${body})` : body;
	};
	const ownKeys = (o) => {
		try {
			return Reflect.ownKeys(o);
		} catch {
			return ["[ownKeys threw]"];
		}
	};
	function recur(v, d = 0) {
		if (Array.isArray(v)) {
			if (seen.has(v)) return CIRCULAR;
			seen.add(v);
			if (!gap || v.length <= 1) return `[${v.map((x) => recur(x, d)).join(",")}]`;
			const inner = v.map((x) => recur(x, d + 1)).join(",\n" + ind(d + 1));
			return `[\n${ind(d + 1)}${inner}\n${ind(d)}]`;
		}
		if (v instanceof Date) return formatDate(v);
		if (!options?.ignoreToString && hasProperty(v, "toString") && typeof v["toString"] === "function" && v["toString"] !== Object.prototype.toString && v["toString"] !== Array.prototype.toString) {
			const s = safeToString(v);
			if (v instanceof Error && v.cause) return `${s} (cause: ${recur(v.cause, d)})`;
			return s;
		}
		if (typeof v === "string") return JSON.stringify(v);
		if (typeof v === "number" || v == null || typeof v === "boolean" || typeof v === "symbol") return String(v);
		if (typeof v === "bigint") return String(v) + "n";
		if (typeof v === "object" || typeof v === "function") {
			if (seen.has(v)) return CIRCULAR;
			seen.add(v);
			if (symbolRedactable in v) return format$1(getRedacted(v));
			if (Symbol.iterator in v) return `${v.constructor.name}(${recur(Array.from(v), d)})`;
			const keys = ownKeys(v);
			if (!gap || keys.length <= 1) {
				const body = `{${keys.map((k) => `${formatPropertyKey(k)}:${recur(v[k], d)}`).join(",")}}`;
				return wrap(v, body);
			}
			const body = `{\n${keys.map((k) => `${ind(d + 1)}${formatPropertyKey(k)}: ${recur(v[k], d + 1)}`).join(",\n")}\n${ind(d)}}`;
			return wrap(v, body);
		}
		return String(v);
	}
	return recur(input, 0);
}
var CIRCULAR = "[Circular]";
/**
* @internal
*/
function formatPropertyKey(name) {
	return typeof name === "string" ? JSON.stringify(name) : String(name);
}
/**
* Formats an array of property keys as a bracket-notation path string.
*
* @internal
*/
function formatPath(path) {
	return path.map((key) => `[${formatPropertyKey(key)}]`).join("");
}
/**
* Formats a `Date` as an ISO 8601 string, returning `"Invalid Date"` for
* invalid dates instead of throwing.
*
* @internal
*/
function formatDate(date) {
	try {
		return date.toISOString();
	} catch {
		return "Invalid Date";
	}
}
function safeToString(input) {
	try {
		const s = input.toString();
		return typeof s === "string" ? s : String(s);
	} catch {
		return "[toString threw]";
	}
}
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Inspectable.js
/**
* Defines the symbol used by Node.js for custom object inspection.
*
* **When to use**
*
* Use to implement Node.js custom inspection for a value.
*
* **Details**
*
* This symbol is recognized by Node.js's `util.inspect()` function and the REPL
* for custom object representation. When an object has a method with this symbol,
* it will be called to determine how the object should be displayed.
*
* **Example** (Defining custom Node inspection)
*
* ```ts
* import { Inspectable } from "effect"
*
* class CustomObject {
*   constructor(private value: string) {}
*
*   [Inspectable.NodeInspectSymbol]() {
*     return `CustomObject(${this.value})`
*   }
* }
*
* const obj = new CustomObject("hello")
* console.log(obj) // Displays: CustomObject(hello)
* ```
*
* @category symbols
* @since 2.0.0
*/
var NodeInspectSymbol = /*#__PURE__*/ Symbol.for("nodejs.util.inspect.custom");
/**
* Converts a value to a JSON-serializable representation safely.
*
* **When to use**
*
* Use when you need a safe, JSON-serializable representation of a value
* without risking unhandled errors.
*
* **Details**
*
* This function attempts to extract JSON data from objects that implement the
* `toJSON` method, recursively processes arrays, and handles errors gracefully.
* For objects that don't have a `toJSON` method, it applies redaction to
* protect sensitive information.
*
* @see {@link toStringUnknown} for converting unknown values to strings
*
* @category converting
* @since 4.0.0
*/
var toJson = (input) => {
	try {
		if (hasProperty(input, "toJSON") && isFunction(input["toJSON"]) && input["toJSON"].length === 0) return input.toJSON();
		else if (Array.isArray(input)) return input.map(toJson);
	} catch {
		return "[toJSON threw]";
	}
	return redact(input);
};
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Utils.js
/**
* Yields its wrapped value exactly once through an `IterableIterator`.
*
* **When to use**
*
* Use to implement `[Symbol.iterator]()` on Effect-like types so they can be
* `yield*`-ed inside generator functions, such as `Effect.gen` and
* `Option.gen`.
*
* **Details**
*
* The first call to `next()` returns `{ value: self, done: false }`. Every
* subsequent call returns `{ value: a, done: true }` where `a` is the argument
* passed to `next()`. `[Symbol.iterator]()` returns a **new** `SingleShotGen`
* wrapping the same value, so the outer type can be iterated multiple times.
*
* **Example** (Yielding a wrapped value in a generator)
*
* ```ts
* import { Utils } from "effect"
*
* const gen = new Utils.SingleShotGen<string, number>("hello")
*
* // First call yields the wrapped value
* console.log(gen.next(0))
* // { value: "hello", done: false }
*
* // Second call signals completion with the provided value
* console.log(gen.next(42))
* // { value: 42, done: true }
* ```
*
* @see {@link Gen} for the type-level signature that relies on `SingleShotGen`
* @category constructors
* @since 2.0.0
*/
var SingleShotGen = class SingleShotGen {
	called = false;
	self;
	constructor(self) {
		this.self = self;
	}
	/**
	* Yields the stored value once, then completes with the value sent back in.
	*
	* **When to use**
	*
	* Use to advance a `SingleShotGen` through its single yield and completion
	* step.
	*
	* @since 2.0.0
	*/
	next(a) {
		return this.called ? {
			value: a,
			done: true
		} : (this.called = true, {
			value: this.self,
			done: false
		});
	}
	/**
	* Creates a fresh single-shot iterator over the stored value.
	*
	* **When to use**
	*
	* Use to iterate the wrapped value again without reusing the consumed
	* iterator state.
	*
	* @since 2.0.0
	*/
	[Symbol.iterator]() {
		return new SingleShotGen(this.self);
	}
};
var pickInternalCall = () => {
	const InternalTypeId = "~effect/Utils/internal";
	const standard = { [InternalTypeId]: (body) => {
		return body();
	} };
	const forced = { [InternalTypeId]: (body) => {
		try {
			return body();
		} finally {}
	} };
	return standard[InternalTypeId](() => (/* @__PURE__ */ new Error()).stack)?.includes(InternalTypeId) === true ? standard[InternalTypeId] : forced[InternalTypeId];
};
/** @internal */
var internalCall = /*#__PURE__*/ pickInternalCall();
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/core.js
/** @internal */
var EffectTypeId = `~effect/Effect`;
/** @internal */
var ExitTypeId = `~effect/Exit`;
var effectVariance = {
	_A: identity,
	_E: identity,
	_R: identity
};
/** @internal */
var identifier = `${EffectTypeId}/identifier`;
/** @internal */
var args = `${EffectTypeId}/args`;
/** @internal */
var evaluate = `${EffectTypeId}/evaluate`;
/** @internal */
var contA = `${EffectTypeId}/successCont`;
/** @internal */
var contE = `${EffectTypeId}/failureCont`;
/** @internal */
var contAll = `${EffectTypeId}/ensureCont`;
/** @internal */
var Yield = /*#__PURE__*/ Symbol.for("effect/Effect/Yield");
/** @internal */
var PipeInspectableProto = {
	pipe() {
		return pipeArguments(this, arguments);
	},
	toJSON() {
		return { ...this };
	},
	toString() {
		return format$1(this.toJSON(), {
			ignoreToString: true,
			space: 2
		});
	},
	[NodeInspectSymbol]() {
		return this.toJSON();
	}
};
/** @internal */
var EffectProto = {
	[EffectTypeId]: effectVariance,
	...PipeInspectableProto,
	[Symbol.iterator]() {
		return new SingleShotGen(this);
	},
	toJSON() {
		return {
			_id: "Effect",
			op: this[identifier],
			...args in this ? { args: this[args] } : void 0
		};
	}
};
/** @internal */
var isEffect = (u) => hasProperty(u, EffectTypeId);
/** @internal */
var isExit = (u) => hasProperty(u, ExitTypeId);
/** @internal */
var CauseTypeId = "~effect/Cause";
/** @internal */
var CauseReasonTypeId = "~effect/Cause/Reason";
/** @internal */
var isCause = (self) => hasProperty(self, CauseTypeId);
/** @internal */
var CauseImpl = class {
	[CauseTypeId];
	reasons;
	constructor(failures) {
		this[CauseTypeId] = CauseTypeId;
		this.reasons = failures;
	}
	pipe() {
		return pipeArguments(this, arguments);
	}
	toJSON() {
		return {
			_id: "Cause",
			failures: this.reasons.map((f) => f.toJSON())
		};
	}
	toString() {
		return `Cause(${format$1(this.reasons)})`;
	}
	[NodeInspectSymbol]() {
		return this.toJSON();
	}
	[symbol](that) {
		return isCause(that) && this.reasons.length === that.reasons.length && this.reasons.every((e, i) => equals$2(e, that.reasons[i]));
	}
	[symbol$1]() {
		return array(this.reasons);
	}
};
var annotationsMap = /*#__PURE__*/ new WeakMap();
/** @internal */
var ReasonBase = class {
	[CauseReasonTypeId];
	annotations;
	_tag;
	constructor(_tag, annotations, originalError) {
		this[CauseReasonTypeId] = CauseReasonTypeId;
		this._tag = _tag;
		if (annotations !== constEmptyAnnotations && typeof originalError === "object" && originalError !== null && annotations.size > 0) {
			const prevAnnotations = annotationsMap.get(originalError);
			if (prevAnnotations) annotations = new Map([...prevAnnotations, ...annotations]);
			annotationsMap.set(originalError, annotations);
		}
		this.annotations = annotations;
	}
	annotate(annotations, options) {
		if (annotations.mapUnsafe.size === 0) return this;
		const newAnnotations = new Map(this.annotations);
		annotations.mapUnsafe.forEach((value, key) => {
			if (options?.overwrite !== true && newAnnotations.has(key)) return;
			newAnnotations.set(key, value);
		});
		const self = Object.assign(Object.create(Object.getPrototypeOf(this)), this);
		self.annotations = newAnnotations;
		return self;
	}
	pipe() {
		return pipeArguments(this, arguments);
	}
	toString() {
		return format$1(this);
	}
	[NodeInspectSymbol]() {
		return this.toString();
	}
};
/** @internal */
var constEmptyAnnotations = /*#__PURE__*/ new Map();
/** @internal */
var Fail = class extends ReasonBase {
	error;
	constructor(error, annotations = constEmptyAnnotations) {
		super("Fail", annotations, error);
		this.error = error;
	}
	toString() {
		return `Fail(${format$1(this.error)})`;
	}
	toJSON() {
		return {
			_tag: "Fail",
			error: this.error
		};
	}
	[symbol](that) {
		return isFailReason(that) && equals$2(this.error, that.error) && equals$2(this.annotations, that.annotations);
	}
	[symbol$1]() {
		return combine(string$1(this._tag))(combine(hash(this.error))(hash(this.annotations)));
	}
};
/** @internal */
var causeFromReasons = (reasons) => new CauseImpl(reasons);
/** @internal */
var causeFail = (error) => new CauseImpl([new Fail(error)]);
/** @internal */
var Die = class extends ReasonBase {
	defect;
	constructor(defect, annotations = constEmptyAnnotations) {
		super("Die", annotations, defect);
		this.defect = defect;
	}
	toString() {
		return `Die(${format$1(this.defect)})`;
	}
	toJSON() {
		return {
			_tag: "Die",
			defect: this.defect
		};
	}
	[symbol](that) {
		return isDieReason(that) && equals$2(this.defect, that.defect) && equals$2(this.annotations, that.annotations);
	}
	[symbol$1]() {
		return combine(string$1(this._tag))(combine(hash(this.defect))(hash(this.annotations)));
	}
};
/** @internal */
var causeDie = (defect) => new CauseImpl([new Die(defect)]);
/** @internal */
var causeAnnotate = /*#__PURE__*/ dual((args) => isCause(args[0]), (self, annotations, options) => {
	if (annotations.mapUnsafe.size === 0) return self;
	return new CauseImpl(self.reasons.map((f) => f.annotate(annotations, options)));
});
/** @internal */
var isFailReason = (self) => self._tag === "Fail";
/** @internal */
var isDieReason = (self) => self._tag === "Die";
/** @internal */
var isInterruptReason = (self) => self._tag === "Interrupt";
function defaultEvaluate(_fiber) {
	return exitDie(`Effect.evaluate: Not implemented`);
}
/** @internal */
var makePrimitiveProto = (options) => ({
	...EffectProto,
	[identifier]: options.op,
	[evaluate]: options[evaluate] ?? defaultEvaluate,
	[contA]: options[contA],
	[contE]: options[contE],
	[contAll]: options[contAll]
});
/** @internal */
var makePrimitive = (options) => {
	const Proto = makePrimitiveProto(options);
	return function() {
		const self = Object.create(Proto);
		self[args] = options.single === false ? arguments : arguments[0];
		return self;
	};
};
/** @internal */
var makeExit = (options) => {
	const Proto = {
		...makePrimitiveProto(options),
		[ExitTypeId]: ExitTypeId,
		_tag: options.op,
		get [options.prop]() {
			return this[args];
		},
		toString() {
			return `${options.op}(${format$1(this[args])})`;
		},
		toJSON() {
			return {
				_id: "Exit",
				_tag: options.op,
				[options.prop]: this[args]
			};
		},
		[symbol](that) {
			return isExit(that) && that._tag === this._tag && equals$2(this[args], that[args]);
		},
		[symbol$1]() {
			return combine(string$1(options.op), hash(this[args]));
		}
	};
	return function(value) {
		const self = Object.create(Proto);
		self[args] = value;
		return self;
	};
};
/** @internal */
var exitSucceed = /*#__PURE__*/ makeExit({
	op: "Success",
	prop: "value",
	[evaluate](fiber) {
		const cont = fiber.getCont(contA);
		return cont ? cont[contA](this[args], fiber, this) : fiber.yieldWith(this);
	}
});
/** @internal */
var StackTraceKey = { key: "effect/Cause/StackTrace" };
/** @internal */
var exitFailCause = /*#__PURE__*/ makeExit({
	op: "Failure",
	prop: "cause",
	[evaluate](fiber) {
		let cause = this[args];
		let annotated = false;
		if (fiber.currentStackFrame) {
			cause = causeAnnotate(cause, { mapUnsafe: /* @__PURE__ */ new Map([[StackTraceKey.key, fiber.currentStackFrame]]) });
			annotated = true;
		}
		let cont = fiber.getCont(contE);
		while (fiber.interruptible && fiber._interruptedCause && cont) cont = fiber.getCont(contE);
		return cont ? cont[contE](cause, fiber, annotated ? void 0 : this) : fiber.yieldWith(annotated ? this : exitFailCause(cause));
	}
});
/** @internal */
var exitFail = (e) => exitFailCause(causeFail(e));
/** @internal */
var exitDie = (defect) => exitFailCause(causeDie(defect));
/** @internal */
var withFiber$1 = /*#__PURE__*/ makePrimitive({
	op: "WithFiber",
	[evaluate](fiber) {
		return this[args](fiber);
	}
});
/** @internal */
var YieldableError = /*#__PURE__*/ function() {
	class YieldableError extends globalThis.Error {}
	const proto = /*#__PURE__*/ makePrimitiveProto({
		op: "YieldableError",
		[evaluate]() {
			return exitFail(this);
		}
	});
	delete proto.toString;
	Object.assign(YieldableError.prototype, proto);
	return YieldableError;
}();
/** @internal */
var Error$1 = /*#__PURE__*/ function() {
	const plainArgsSymbol = /*#__PURE__*/ Symbol.for("effect/Data/Error/plainArgs");
	return class Base extends YieldableError {
		constructor(args) {
			super(args?.message, args?.cause ? { cause: args.cause } : void 0);
			if (args) {
				Object.assign(this, args);
				Object.defineProperty(this, plainArgsSymbol, {
					value: args,
					enumerable: false
				});
			}
		}
		toJSON() {
			return {
				...this[plainArgsSymbol],
				...this
			};
		}
	};
}();
/** @internal */
var TaggedError$1 = (tag) => {
	class Base extends Error$1 {
		_tag = tag;
	}
	Base.prototype.name = tag;
	return Base;
};
TaggedError$1("NoSuchElementError");
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/option.js
/**
* @since 2.0.0
*/
var TypeId$14 = "~effect/data/Option";
var CommonProto$1 = {
	[TypeId$14]: { _A: (_) => _ },
	...PipeInspectableProto,
	[Symbol.iterator]() {
		return new SingleShotGen(this);
	}
};
var SomeProto = /*#__PURE__*/ Object.defineProperty(/*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(CommonProto$1), {
	_tag: "Some",
	_op: "Some",
	[symbol](that) {
		return isOption(that) && isSome$1(that) && equals$2(this.value, that.value);
	},
	[symbol$1]() {
		return combine(hash(this._tag))(hash(this.value));
	},
	toString() {
		return `some(${format$1(this.value)})`;
	},
	toJSON() {
		return {
			_id: "Option",
			_tag: this._tag,
			value: toJson(this.value)
		};
	}
}), "valueOrUndefined", { get() {
	return this.value;
} });
var NoneHash = /*#__PURE__*/ hash("None");
var NoneProto = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(CommonProto$1), {
	_tag: "None",
	_op: "None",
	valueOrUndefined: void 0,
	[symbol](that) {
		return isOption(that) && isNone$1(that);
	},
	[symbol$1]() {
		return NoneHash;
	},
	toString() {
		return `none()`;
	},
	toJSON() {
		return {
			_id: "Option",
			_tag: this._tag
		};
	}
});
/** @internal */
var isOption = (input) => hasProperty(input, TypeId$14);
/** @internal */
var isNone$1 = (fa) => fa._tag === "None";
/** @internal */
var isSome$1 = (fa) => fa._tag === "Some";
/** @internal */
var none$1 = /*#__PURE__*/ Object.create(NoneProto);
/** @internal */
var some$1 = (value) => {
	const a = Object.create(SomeProto);
	a.value = value;
	return a;
};
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/result.js
var TypeId$13 = "~effect/data/Result";
var CommonProto = {
	[TypeId$13]: {
		/* v8 ignore next 2 */
		_A: (_) => _,
		_E: (_) => _
	},
	...PipeInspectableProto,
	[Symbol.iterator]() {
		return new SingleShotGen(this);
	}
};
var SuccessProto = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(CommonProto), {
	_tag: "Success",
	_op: "Success",
	[symbol](that) {
		return isResult(that) && isSuccess(that) && equals$2(this.success, that.success);
	},
	[symbol$1]() {
		return combine(hash(this._tag))(hash(this.success));
	},
	toString() {
		return `success(${format$1(this.success)})`;
	},
	toJSON() {
		return {
			_id: "Result",
			_tag: this._tag,
			value: toJson(this.success)
		};
	}
});
var FailureProto = /*#__PURE__*/ Object.assign(/*#__PURE__*/ Object.create(CommonProto), {
	_tag: "Failure",
	_op: "Failure",
	[symbol](that) {
		return isResult(that) && isFailure$1(that) && equals$2(this.failure, that.failure);
	},
	[symbol$1]() {
		return combine(hash(this._tag))(hash(this.failure));
	},
	toString() {
		return `failure(${format$1(this.failure)})`;
	},
	toJSON() {
		return {
			_id: "Result",
			_tag: this._tag,
			failure: toJson(this.failure)
		};
	}
});
/** @internal */
var isResult = (input) => hasProperty(input, TypeId$13);
/** @internal */
var isFailure$1 = (result) => result._tag === "Failure";
/** @internal */
var isSuccess = (result) => result._tag === "Success";
/** @internal */
var fail$4 = (failure) => {
	const a = Object.create(FailureProto);
	a.failure = failure;
	return a;
};
/** @internal */
var succeed$3 = (success) => {
	const a = Object.create(SuccessProto);
	a.success = success;
	return a;
};
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Order.js
/**
* Defines comparison functions for ordered values.
*
* An `Order<A>` compares two `A` values and returns whether the first is less
* than, equal to, or greater than the second. Orders are used for sorting,
* choosing minimum or maximum values, checking ranges, and building ordered data
* structures. This module includes built-in orders, constructors for custom
* orders, tools for reversing and combining comparisons, tuple and struct
* helpers, comparison predicates, clamping, and reducer support.
*
* @since 2.0.0
*/
/**
* Creates a new `Order` instance from a comparison function.
*
* **When to use**
*
* Use when you need a sorting rule not covered by the built-in orders or input
* mapping helpers, and you can provide a total comparison.
*
* **Details**
*
* Uses reference equality (`===`) as a shortcut: if `self === that`, it returns
* `0` without calling the comparison function. The comparison function should
* return `-1`, `0`, or `1`, and the returned order satisfies total ordering
* laws when the comparison function does.
*
* **Example** (Creating an Order)
*
* ```ts
* import { Order } from "effect"
*
* const byAge = Order.make<{ name: string; age: number }>((self, that) => {
*   if (self.age < that.age) return -1
*   if (self.age > that.age) return 1
*   return 0
* })
*
* console.log(byAge({ name: "Alice", age: 30 }, { name: "Bob", age: 25 })) // 1
* console.log(byAge({ name: "Alice", age: 25 }, { name: "Bob", age: 30 })) // -1
* ```
*
* @see {@link mapInput} to transform an order by mapping the input type
* @see {@link combine} to combine multiple orders
* @category constructors
* @since 2.0.0
*/
function make$15(compare) {
	return (self, that) => self === that ? 0 : compare(self, that);
}
/**
* Order instance for numbers that compares them numerically.
*
* **When to use**
*
* Use when you need numeric ordering for numbers.
*
* **Details**
*
* `0` is considered equal to `-0`. All `NaN` values are considered equal to
* each other, and any `NaN` is considered less than any non-`NaN` number. All
* other values use standard numeric comparison.
*
* **Example** (Number Ordering)
*
* ```ts
* import { Order } from "effect"
*
* console.log(Order.Number(1, 1)) // 0
* console.log(Order.Number(1, 2)) // -1
* console.log(Order.Number(2, 1)) // 1
*
* console.log(Order.Number(0, -0)) // 0
* console.log(Order.Number(NaN, 1)) // -1
* ```
*
* @see {@link mapInput} to compare objects by a number property
* @see {@link BigInt} for bigint comparisons
* @category instances
* @since 4.0.0
*/
var Number$4 = /*#__PURE__*/ make$15((self, that) => {
	if (globalThis.Number.isNaN(self) && globalThis.Number.isNaN(that)) return 0;
	if (globalThis.Number.isNaN(self)) return -1;
	if (globalThis.Number.isNaN(that)) return 1;
	return self < that ? -1 : 1;
});
/**
* Order instance for bigints that compares them numerically.
*
* **When to use**
*
* Use when you need numeric ordering for `bigint` values.
*
* **Details**
*
* Uses standard numeric comparison for bigint values and handles arbitrarily
* large integers.
*
* **Example** (BigInt Ordering)
*
* ```ts
* import { Order } from "effect"
*
* console.log(Order.BigInt(1n, 2n)) // -1
* console.log(Order.BigInt(2n, 1n)) // 1
* console.log(Order.BigInt(1n, 1n)) // 0
* ```
*
* @see {@link Number} for regular number comparisons
* @see {@link mapInput} to compare objects by a bigint property
* @category instances
* @since 4.0.0
*/
var BigInt$4 = /*#__PURE__*/ make$15((self, that) => self < that ? -1 : 1);
/**
* Transforms an `Order` on type `A` into an `Order` on type `B` by providing a function that
* maps values of type `B` to values of type `A`.
*
* **When to use**
*
* Use when you need to adapt an `Order` to compare a larger value by one
* derived property.
*
* **Details**
*
* Applies the mapping function to both values before comparison. The mapping
* function should be pure and not have side effects so the ordering properties
* of the original order are preserved.
*
* **Example** (Mapping Input)
*
* ```ts
* import { Order } from "effect"
*
* const byLength = Order.mapInput(Order.Number, (s: string) => s.length)
*
* console.log(byLength("a", "bb")) // -1
* console.log(byLength("bb", "a")) // 1
* console.log(byLength("aa", "bb")) // 0
* ```
*
* @see {@link combine} to combine mapped orders for multi-criteria comparison
* @see {@link Struct} to create orders for structs with multiple fields
* @category mapping
* @since 2.0.0
*/
var mapInput = /*#__PURE__*/ dual(2, (self, f) => make$15((b1, b2) => self(f(b1), f(b2))));
/**
* Order instance for `Date` objects that compares them chronologically by their timestamp.
*
* **When to use**
*
* Use when you need chronological ordering for JavaScript date values.
*
* **Details**
*
* Compares dates by their underlying timestamp in milliseconds since the epoch.
* Earlier dates are less than later dates. Invalid dates are compared through
* their `getTime()` result.
*
* **Example** (Date Ordering)
*
* ```ts
* import { Order } from "effect"
*
* const date1 = new Date("2023-01-01")
* const date2 = new Date("2023-01-02")
*
* console.log(Order.Date(date1, date2)) // -1
* console.log(Order.Date(date2, date1)) // 1
* console.log(Order.Date(date1, date1)) // 0
* ```
*
* @see {@link mapInput} to compare objects by a date property
* @category instances
* @since 2.0.0
*/
var Date$3 = /*#__PURE__*/ mapInput(Number$4, (date) => date.getTime());
/**
* Checks whether one value is strictly greater than another according to the given order.
*
* **When to use**
*
* Use when you need a boolean greater-than predicate using an `Order`.
*
* **Details**
*
* Returns `true` if the order returns `1`, meaning the first value is greater
* than the second. Equal or lesser values return `false`.
*
* **Example** (Greater Than)
*
* ```ts
* import { Order } from "effect"
*
* const isGreaterThanNumber = Order.isGreaterThan(Order.Number)
*
* console.log(isGreaterThanNumber(2, 1)) // true
* console.log(isGreaterThanNumber(1, 2)) // false
* console.log(isGreaterThanNumber(1, 1)) // false
* ```
*
* @see {@link isGreaterThanOrEqualTo} for non-strict greater than or equal
* @see {@link isLessThan} for strict less than
* @category predicates
* @since 4.0.0
*/
var isGreaterThan$1 = (O) => dual(2, (self, that) => O(self, that) === 1);
/**
* Checks whether one value is less than or equal to another according to the given order.
*
* **When to use**
*
* Use when you need a boolean less-than-or-equal predicate using an `Order`.
*
* **Details**
*
* Returns `true` if the order returns `-1` or `0`, and returns `false` only if
* the order returns `1`.
*
* **Example** (Less Than Or Equal)
*
* ```ts
* import { Order } from "effect"
*
* const isLessThanOrEqualToNumber = Order.isLessThanOrEqualTo(Order.Number)
*
* console.log(isLessThanOrEqualToNumber(1, 2)) // true
* console.log(isLessThanOrEqualToNumber(1, 1)) // true
* console.log(isLessThanOrEqualToNumber(2, 1)) // false
* ```
*
* @see {@link isLessThan} for strict less than
* @see {@link isGreaterThan} for strict greater than
* @category predicates
* @since 4.0.0
*/
var isLessThanOrEqualTo$1 = (O) => dual(2, (self, that) => O(self, that) !== 1);
/**
* Checks whether one value is greater than or equal to another according to the given order.
*
* **When to use**
*
* Use when you need a boolean greater-than-or-equal predicate using an
* `Order`.
*
* **Details**
*
* Returns `true` if the order returns `1` or `0`, and returns `false` only if
* the order returns `-1`.
*
* **Example** (Greater Than Or Equal)
*
* ```ts
* import { Order } from "effect"
*
* const isGreaterThanOrEqualToNumber = Order.isGreaterThanOrEqualTo(Order.Number)
*
* console.log(isGreaterThanOrEqualToNumber(2, 1)) // true
* console.log(isGreaterThanOrEqualToNumber(1, 1)) // true
* console.log(isGreaterThanOrEqualToNumber(1, 2)) // false
* ```
*
* @see {@link isGreaterThan} for strict greater than
* @see {@link isLessThanOrEqualTo} for less than or equal
* @category predicates
* @since 4.0.0
*/
var isGreaterThanOrEqualTo$1 = (O) => dual(2, (self, that) => O(self, that) !== -1);
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Option.js
/**
* Creates an `Option` representing the absence of a value.
*
* **When to use**
*
* Use to represent a missing or uninitialized value, such as returning "no
* result" from a function.
*
* **Details**
*
* - Returns `Option<never>`, which is a subtype of `Option<A>` for any `A`
* - Always returns the same singleton instance
*
* **Example** (Creating an empty Option)
*
* ```ts
* import { Option } from "effect"
*
* //      ┌─── Option<never>
* //      ▼
* const noValue = Option.none()
*
* console.log(noValue)
* // Output: { _id: 'Option', _tag: 'None' }
* ```
*
* @see {@link some} for the opposite operation.
*
* @category constructors
* @since 2.0.0
*/
var none = () => none$1;
/**
* Wraps the given value into an `Option` to represent its presence.
*
* **When to use**
*
* Use to wrap a known present value as `Option`
* - Returning a successful result from a partial function
*
* **Details**
*
* - Always returns `Some<A>`
* - Does not filter `null` or `undefined`; use {@link fromNullishOr} for that
*
* **Example** (Wrapping a value)
*
* ```ts
* import { Option } from "effect"
*
* //      ┌─── Option<number>
* //      ▼
* const value = Option.some(1)
*
* console.log(value)
* // Output: { _id: 'Option', _tag: 'Some', value: 1 }
* ```
*
* @see {@link none} for the opposite operation.
*
* @category constructors
* @since 2.0.0
*/
var some = some$1;
/**
* Checks whether an `Option` is `None` (absent).
*
* **When to use**
*
* Use when you need to branch on an absent `Option` before accessing `.value`.
*
* **Details**
*
* - Acts as a type guard, narrowing to `None<A>`
*
* **Example** (Checking for None)
*
* ```ts
* import { Option } from "effect"
*
* console.log(Option.isNone(Option.some(1)))
* // Output: false
*
* console.log(Option.isNone(Option.none()))
* // Output: true
* ```
*
* @see {@link isSome} for the opposite check.
*
* @category guards
* @since 2.0.0
*/
var isNone = isNone$1;
/**
* Checks whether an `Option` contains a value (`Some`).
*
* **When to use**
*
* Use when you need to branch on a present `Option` before accessing `.value`.
*
* **Details**
*
* - Acts as a type guard, narrowing to `Some<A>`
*
* **Example** (Checking for Some)
*
* ```ts
* import { Option } from "effect"
*
* console.log(Option.isSome(Option.some(1)))
* // Output: true
*
* console.log(Option.isSome(Option.none()))
* // Output: false
* ```
*
* @see {@link isNone} for the opposite check.
*
* @category guards
* @since 2.0.0
*/
var isSome = isSome$1;
/**
* Extracts the value from a `Some`, or returns `undefined` for `None`.
*
* **When to use**
*
* Use when you need to pass absent `Option` values to APIs that expect
* `undefined`.
*
* **Details**
*
* - `Some` → the inner value
* - `None` → `undefined`
*
* **Example** (Unwrapping to undefined)
*
* ```ts
* import { Option } from "effect"
*
* console.log(Option.getOrUndefined(Option.some(1)))
* // Output: 1
*
* console.log(Option.getOrUndefined(Option.none()))
* // Output: undefined
* ```
*
* @see {@link getOrNull} to return `null` instead
* @see {@link getOrElse} for a custom fallback
*
* @category getters
* @since 2.0.0
*/
var getOrUndefined = /*#__PURE__*/ (/* @__PURE__ */ dual(2, (self, onNone) => isNone(self) ? onNone() : self.value))(constUndefined);
/**
* Transforms the value inside a `Some` using the provided function, leaving
* `None` unchanged.
*
* **When to use**
*
* Use to apply a pure transformation to an `Option`'s present value, especially
* when chaining transformations in a pipeline.
*
* **Details**
*
* - `Some` → applies `f` and wraps the result in a new `Some`
* - `None` → returns `None` unchanged
*
* **Example** (Mapping over an Option)
*
* ```ts
* import { Option } from "effect"
*
* console.log(Option.map(Option.some(2), (n) => n * 2))
* // Output: { _id: 'Option', _tag: 'Some', value: 4 }
*
* console.log(Option.map(Option.none(), (n: number) => n * 2))
* // Output: { _id: 'Option', _tag: 'None' }
* ```
*
* @see {@link flatMap} when `f` returns an `Option`
* @see {@link as} to replace the value with a constant
*
* @category mapping
* @since 2.0.0
*/
var map$3 = /*#__PURE__*/ dual(2, (self, f) => isNone(self) ? none() : some(f(self.value)));
/**
* Filters an `Option` using a predicate. Returns `None` if the predicate is
* not satisfied or the input is `None`.
*
* **When to use**
*
* Use when you need to discard an `Option`'s present value when it does not
* meet a condition, while narrowing the type via a refinement predicate.
*
* **Details**
*
* - `None` → `None`
* - `Some` where `predicate(value)` is `true` → `Some(value)`
* - `Some` where `predicate(value)` is `false` → `None`
* - Supports refinements for type narrowing
*
* **Example** (Filtering with a predicate)
*
* ```ts
* import { Option } from "effect"
*
* const removeEmpty = (input: Option.Option<string>) =>
*   Option.filter(input, (value) => value !== "")
*
* console.log(removeEmpty(Option.some("hello")))
* // Output: { _id: 'Option', _tag: 'Some', value: 'hello' }
*
* console.log(removeEmpty(Option.some("")))
* // Output: { _id: 'Option', _tag: 'None' }
*
* console.log(removeEmpty(Option.none()))
* // Output: { _id: 'Option', _tag: 'None' }
* ```
*
* @see {@link filterMap} to transform and filter simultaneously
* @see {@link exists} to test without filtering
*
* @category filtering
* @since 2.0.0
*/
var filter = /*#__PURE__*/ dual(2, (self, predicate) => isNone(self) ? none() : predicate(self.value) ? some(self.value) : none());
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Result.js
/**
* Creates a `Result` holding a `Success` value.
*
* **Details**
*
* - Use when you have a value and want to lift it into the `Result` type
* - The error type `E` defaults to `never`
*
* **Example** (Wrapping a value)
*
* ```ts
* import { Result } from "effect"
*
* const result = Result.succeed(42)
*
* console.log(Result.isSuccess(result))
* // Output: true
* ```
*
* @see {@link fail} to create a Failure
* @see {@link void_ void} for a pre-built `Success<void>`
*
* @category constructors
* @since 4.0.0
*/
var succeed$2 = succeed$3;
/**
* Creates a `Result` holding a `Failure` value.
*
* **When to use**
*
* Use to represent a failed `Result` with a typed failure value.
*
* **Details**
*
* - The success type `A` defaults to `never`
*
* **Example** (Creating a failure)
*
* ```ts
* import { Result } from "effect"
*
* const result = Result.fail("Something went wrong")
*
* console.log(Result.isFailure(result))
* // Output: true
* ```
*
* @see {@link succeed} to create a Success
* @see {@link mapError} to transform the error
*
* @category constructors
* @since 4.0.0
*/
var fail$3 = fail$4;
/**
* Checks whether a `Result` is a `Failure`.
*
* **When to use**
*
* Use to narrow a known `Result` to the `Failure` variant.
*
* **Details**
*
* - Acts as a TypeScript type guard, narrowing to `Failure<A, E>`
* - After narrowing, you can access `.failure` to read the error value
*
* **Example** (Narrowing to Failure)
*
* ```ts
* import { Result } from "effect"
*
* const result = Result.fail("oops")
*
* if (Result.isFailure(result)) {
*   console.log(result.failure)
*   // Output: "oops"
* }
* ```
*
* @see {@link isSuccess} for the opposite check
* @see {@link isResult} to check if a value is any Result
*
* @category guards
* @since 4.0.0
*/
var isFailure = isFailure$1;
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Array.js
/**
* Works with JavaScript arrays, readonly arrays, and non-empty arrays.
*
* The helpers cover common collection work such as creating arrays, reading
* elements, transforming values, sorting, grouping, splitting, combining, and
* reducing many values to one result. Helpers that change contents return new
* arrays and preserve non-empty array types when the result is guaranteed to
* contain values.
*
* @since 2.0.0
*/
/**
* Exposes the global array constructor.
*
* **When to use**
*
* Use to access native JavaScript array constructor methods such as `isArray`
* or `from` from the Effect module namespace.
*
* **Example** (Using the Array constructor)
*
* ```ts
* import { Array } from "effect"
*
* const arr = new Array.Array(3)
* console.log(arr) // [undefined, undefined, undefined]
* ```
*
* @category constructors
* @since 4.0.0
*/
var Array$1 = globalThis.Array;
/**
* Converts an `Iterable` to an `Array`.
*
* **When to use**
*
* Use to convert any `Iterable` (Set, Generator, etc.) into an array.
*
* **Details**
*
* If the input is already an array, this returns it by reference without
* copying. Otherwise, it creates a new array from the iterable. Use `copy` if
* you need a fresh array even when the input is already an array.
*
* **Example** (Converting a Set to an array)
*
* ```ts
* import { Array } from "effect"
*
* const result = Array.fromIterable(new Set([1, 2, 3]))
* console.log(result) // [1, 2, 3]
* ```
*
* @see {@link ensure} — wrap a single value or return an existing array
* @see {@link copy} — create a shallow copy of an array
*
* @category constructors
* @since 2.0.0
*/
var fromIterable = (collection) => Array$1.isArray(collection) ? collection : Array$1.from(collection);
/**
* Adds a single element to the end of an iterable, returning a `NonEmptyArray`.
*
* **When to use**
*
* Use when you need to guarantee a non-empty result after adding a required
* trailing value.
*
* **Example** (Appending an element)
*
* ```ts
* import { Array } from "effect"
*
* const result = Array.append([1, 2, 3], 4)
* console.log(result) // [1, 2, 3, 4]
* ```
*
* @see {@link prepend} — add to the front
* @see {@link appendAll} — append multiple elements
*
* @category combining
* @since 2.0.0
*/
var append = /*#__PURE__*/ dual(2, (self, last) => [...self, last]);
/**
* Concatenates two iterables into a single array.
*
* **When to use**
*
* Use to combine two iterable inputs into a new array with the second input's
* elements after the first.
*
* **Details**
*
* If either input is non-empty, the result is a `NonEmptyArray`.
*
* **Example** (Concatenating arrays)
*
* ```ts
* import { Array } from "effect"
*
* const result = Array.appendAll([1, 2], [3, 4])
* console.log(result) // [1, 2, 3, 4]
* ```
*
* @see {@link append} — add a single element to the end
* @see {@link prependAll} — add elements to the front
*
* @category combining
* @since 2.0.0
*/
var appendAll = /*#__PURE__*/ dual(2, (self, that) => fromIterable(self).concat(fromIterable(that)));
Array$1.isArray;
/**
* Checks whether a mutable `Array` is non-empty, narrowing the type to
* `NonEmptyArray`.
*
* **When to use**
*
* Use when you need the narrowed value to remain a mutable `Array` after proving
* it has at least one element.
*
* **Example** (Checking for a non-empty array)
*
* ```ts
* import { Array } from "effect"
*
* console.log(Array.isArrayNonEmpty([])) // false
* console.log(Array.isArrayNonEmpty([1, 2, 3])) // true
* ```
*
* @see {@link isReadonlyArrayNonEmpty} — readonly variant
* @see {@link isArrayEmpty} — opposite check
*
* @category guards
* @since 4.0.0
*/
var isArrayNonEmpty = isArrayNonEmpty$1;
/**
* Checks whether a `ReadonlyArray` is non-empty, narrowing the type to
* `NonEmptyReadonlyArray`.
*
* **When to use**
*
* Use when you need to prove a readonly array has at least one element without
* requiring mutable array methods afterward.
*
* **Example** (Checking for a non-empty readonly array)
*
* ```ts
* import { Array } from "effect"
*
* console.log(Array.isReadonlyArrayNonEmpty([])) // false
* console.log(Array.isReadonlyArrayNonEmpty([1, 2, 3])) // true
* ```
*
* @see {@link isArrayNonEmpty} — mutable variant
* @see {@link isReadonlyArrayEmpty} — opposite check
*
* @category guards
* @since 4.0.0
*/
var isReadonlyArrayNonEmpty = isArrayNonEmpty$1;
/** @internal */
function isOutOfBounds(i, as) {
	return i < 0 || i >= as.length;
}
/**
* Returns the first element of a `NonEmptyReadonlyArray` directly (no `Option`
* wrapper).
*
* **When to use**
*
* Use to get the first element without `Option` wrapping when the array is known
* to be non-empty.
*
* **Example** (Getting the head of a non-empty array)
*
* ```ts
* import { Array } from "effect"
*
* console.log(Array.headNonEmpty([1, 2, 3, 4])) // 1
* ```
*
* @see {@link head} — safe version for possibly-empty arrays
*
* @category getters
* @since 2.0.0
*/
var headNonEmpty = /*#__PURE__*/ (/* @__PURE__ */ dual(2, (self, index) => {
	const i = Math.floor(index);
	if (isOutOfBounds(i, self)) throw new Error(`Index out of bounds: ${i}`);
	return self[i];
}))(0);
/**
* Returns all elements except the first of a `NonEmptyReadonlyArray`.
*
* **When to use**
*
* Use to get all elements after the first when the array is known to be non-empty.
*
* **Example** (Getting the tail of a non-empty array)
*
* ```ts
* import { Array } from "effect"
*
* console.log(Array.tailNonEmpty([1, 2, 3, 4])) // [2, 3, 4]
* ```
*
* @see {@link tail} — safe version for possibly-empty arrays
* @see {@link initNonEmpty} — all elements except the last
*
* @category getters
* @since 2.0.0
*/
var tailNonEmpty = (self) => self.slice(1);
/**
* Computes the union of two arrays using a custom equivalence, removing
* duplicates.
*
* **When to use**
*
* Use when you need the union of two arrays but duplicate detection must use a
* custom equivalence instead of the default `Equal.equivalence()`.
*
* **Example** (Union with custom equality)
*
* ```ts
* import { Array } from "effect"
*
* console.log(Array.unionWith([1, 2], [2, 3], (a, b) => a === b)) // [1, 2, 3]
* ```
*
* @see {@link union} for the `Equal.equivalence()` variant
* @see {@link intersectionWith} for keeping elements present in both arrays
* @see {@link differenceWith} for keeping elements present only in the first array
*
* @category elements
* @since 2.0.0
*/
var unionWith = /*#__PURE__*/ dual(3, (self, that, isEquivalent) => {
	const a = fromIterable(self);
	const b = fromIterable(that);
	if (isReadonlyArrayNonEmpty(a)) {
		if (isReadonlyArrayNonEmpty(b)) return dedupeWith(isEquivalent)(appendAll(a, b));
		return a;
	}
	return b;
});
/**
* Computes the union of two arrays, removing duplicates using
* `Equal.equivalence()`.
*
* **Example** (Array union)
*
* ```ts
* import { Array } from "effect"
*
* console.log(Array.union([1, 2], [2, 3])) // [1, 2, 3]
* ```
*
* @see {@link unionWith} — use custom equality
* @see {@link intersection} — elements in both arrays
* @see {@link difference} — elements only in the first array
*
* @category elements
* @since 2.0.0
*/
var union$2 = /*#__PURE__*/ dual(2, (self, that) => unionWith(self, that, asEquivalence()));
/**
* Creates an empty array.
*
* **When to use**
*
* Use to create a typed empty array without allocating placeholder elements.
*
* **Example** (Creating an empty array)
*
* ```ts
* import { Array } from "effect"
*
* const result = Array.empty<number>()
* console.log(result) // []
* ```
*
* @see {@link of} — create a single-element array
* @see {@link make} — create from multiple values
*
* @category constructors
* @since 2.0.0
*/
var empty$1 = () => [];
/**
* Transforms each element using a function, returning a new array.
*
* **When to use**
*
* Use to transform each element independently while preserving the array shape.
*
* **Details**
*
* The function receives `(element, index)`. The return type preserves
* `NonEmptyArray`.
*
* **Example** (Doubling values)
*
* ```ts
* import { Array } from "effect"
*
* console.log(Array.map([1, 2, 3], (x) => x * 2)) // [2, 4, 6]
* ```
*
* @see {@link flatMap} — map and flatten
*
* @category mapping
* @since 2.0.0
*/
var map$2 = /*#__PURE__*/ dual(2, (self, f) => self.map(f));
/**
* Removes duplicates using a custom equivalence, preserving the order of the
* first occurrence.
*
* **When to use**
*
* Use to remove all duplicate elements with a custom equivalence when default
* equality is not appropriate.
*
* **Example** (Deduplicating with custom equality)
*
* ```ts
* import { Array } from "effect"
*
* console.log(Array.dedupeWith([1, 2, 2, 3, 3, 3], (a, b) => a === b)) // [1, 2, 3]
* ```
*
* @see {@link dedupe} — uses default equality
* @see {@link dedupeAdjacentWith} — only dedupes consecutive elements
*
* @category elements
* @since 2.0.0
*/
var dedupeWith = /*#__PURE__*/ dual(2, (self, isEquivalent) => {
	const input = fromIterable(self);
	if (isReadonlyArrayNonEmpty(input)) {
		const out = [headNonEmpty(input)];
		const rest = tailNonEmpty(input);
		for (const r of rest) if (out.every((a) => !isEquivalent(r, a))) out.push(r);
		return out;
	}
	return [];
});
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/BigDecimal.js
/**
* Decimal numbers and arithmetic for cases where JavaScript `number` rounding
* is not precise enough. A `BigDecimal` stores digits as a `bigint` plus a
* decimal scale, which lets the module parse, compare, add, subtract, multiply,
* divide, round, and format decimal values such as money, quantities, and
* measurements.
*
* @since 2.0.0
*/
var TypeId$12 = "~effect/BigDecimal";
var BigDecimalProto = {
	[TypeId$12]: TypeId$12,
	[symbol$1]() {
		const normalized = normalize(this);
		return combine(hash(normalized.value), number$1(normalized.scale));
	},
	[symbol](that) {
		return isBigDecimal(that) && equals$1(this, that);
	},
	toString() {
		return `BigDecimal(${format(this)})`;
	},
	toJSON() {
		return {
			_id: "BigDecimal",
			value: String(this.value),
			scale: this.scale
		};
	},
	[NodeInspectSymbol]() {
		return this.toJSON();
	},
	pipe() {
		return pipeArguments(this, arguments);
	}
};
/**
* Checks whether a given value is a `BigDecimal`.
*
* **When to use**
*
* Use to validate unknown input and narrow it to `BigDecimal`.
*
* **Example** (Checking BigDecimal values)
*
* ```ts
* import { BigDecimal } from "effect"
*
* const decimal = BigDecimal.fromNumber(123.45)
* console.log(BigDecimal.isBigDecimal(decimal)) // true
* console.log(BigDecimal.isBigDecimal(123.45)) // false
* console.log(BigDecimal.isBigDecimal("123.45")) // false
* ```
*
* @category guards
* @since 2.0.0
*/
var isBigDecimal = (u) => hasProperty(u, TypeId$12);
/**
* Creates a `BigDecimal` from a `bigint` value and a scale.
*
* **When to use**
*
* Use to construct a decimal directly from its unscaled integer value and
* decimal scale.
*
* **Example** (Creating decimals from bigint and scale)
*
* ```ts
* import { BigDecimal } from "effect"
*
* // Create 123.45 (12345 with scale 2)
* const decimal = BigDecimal.make(12345n, 2)
* console.log(BigDecimal.format(decimal)) // "123.45"
*
* // Create 42 (42 with scale 0)
* const integer = BigDecimal.make(42n, 0)
* console.log(BigDecimal.format(integer)) // "42"
* ```
*
* @see {@link fromBigInt} for constructing an integer decimal from a `bigint`
*
* @category constructors
* @since 2.0.0
*/
var make$14 = (value, scale) => {
	const o = Object.create(BigDecimalProto);
	o.value = value;
	o.scale = scale;
	return o;
};
/**
* Internal function used to create pre-normalized `BigDecimal`s.
*
* @internal
*/
var makeNormalizedUnsafe = (value, scale) => {
	if (value !== bigint0$2 && value % bigint10 === bigint0$2) throw new RangeError("Value must be normalized");
	const o = make$14(value, scale);
	o.normalized = o;
	return o;
};
var bigint0$2 = /*#__PURE__*/ BigInt(0);
var bigint10 = /*#__PURE__*/ BigInt(10);
var zero$1 = /*#__PURE__*/ makeNormalizedUnsafe(bigint0$2, 0);
/**
* Normalizes a given `BigDecimal` by removing trailing zeros.
*
* **When to use**
*
* Use to canonicalize decimals that have equivalent values but different
* internal scales.
*
* **Example** (Normalizing trailing zeros)
*
* ```ts
* import { BigDecimal } from "effect"
* import * as assert from "node:assert"
*
* assert.deepStrictEqual(
*   BigDecimal.normalize(BigDecimal.fromStringUnsafe("123.00000")),
*   BigDecimal.normalize(BigDecimal.make(123n, 0))
* )
* assert.deepStrictEqual(
*   BigDecimal.normalize(BigDecimal.fromStringUnsafe("12300000")),
*   BigDecimal.normalize(BigDecimal.make(123n, -5))
* )
* ```
*
* @see {@link format} for rendering normalized decimals as strings
*
* @category scaling
* @since 2.0.0
*/
var normalize = (self) => {
	if (self.normalized === void 0) if (self.value === bigint0$2) self.normalized = zero$1;
	else {
		const digits = `${self.value}`;
		let trail = 0;
		for (let i = digits.length - 1; i >= 0; i--) if (digits[i] === "0") trail++;
		else break;
		if (trail === 0) self.normalized = self;
		self.normalized = makeNormalizedUnsafe(BigInt(digits.substring(0, digits.length - trail)), self.scale - trail);
	}
	return self.normalized;
};
/**
* Changes a `BigDecimal` to the specified scale.
*
* **When to use**
*
* Use to change how many decimal places are represented by a `BigDecimal`.
*
* **Details**
*
* Increasing the scale appends decimal zeros. Decreasing the scale discards
* digits beyond the target scale by `bigint` division, which truncates toward
* zero.
*
* **Example** (Scaling decimal precision)
*
* ```ts
* import { BigDecimal } from "effect"
*
* const decimal = BigDecimal.fromNumberUnsafe(123.45)
*
* // Increase scale (add more precision)
* const scaled = BigDecimal.scale(decimal, 4)
* console.log(BigDecimal.format(scaled)) // "123.4500"
*
* // Decrease scale (reduce precision, rounds down)
* const reduced = BigDecimal.scale(decimal, 1)
* console.log(BigDecimal.format(reduced)) // "123.4"
* ```
*
* @see {@link round} for changing scale with configurable rounding
*
* @category scaling
* @since 2.0.0
*/
var scale = /*#__PURE__*/ dual(2, (self, scale) => {
	if (scale > self.scale) return make$14(self.value * bigint10 ** BigInt(scale - self.scale), scale);
	if (scale < self.scale) return make$14(self.value / bigint10 ** BigInt(self.scale - scale), scale);
	return self;
});
/**
* Determines the absolute value of a given `BigDecimal`.
*
* **When to use**
*
* Use to remove the sign from a `BigDecimal` while preserving its magnitude.
*
* **Example** (Calculating absolute values)
*
* ```ts
* import { BigDecimal } from "effect"
* import * as assert from "node:assert"
*
* assert.deepStrictEqual(BigDecimal.abs(BigDecimal.fromStringUnsafe("-5")), BigDecimal.fromStringUnsafe("5"))
* assert.deepStrictEqual(BigDecimal.abs(BigDecimal.fromStringUnsafe("0")), BigDecimal.fromStringUnsafe("0"))
* assert.deepStrictEqual(BigDecimal.abs(BigDecimal.fromStringUnsafe("5")), BigDecimal.fromStringUnsafe("5"))
* ```
*
* @category math
* @since 2.0.0
*/
var abs = (n) => n.value < bigint0$2 ? make$14(-n.value, n.scale) : n;
/**
* Provides an `Equivalence` instance for `BigDecimal` that determines equality between BigDecimal values.
*
* **When to use**
*
* Use when comparing decimal values through APIs that accept an equivalence
* relation.
*
* **Example** (Checking decimal equivalence)
*
* ```ts
* import { BigDecimal } from "effect"
*
* const a = BigDecimal.fromStringUnsafe("1.50")
* const b = BigDecimal.fromStringUnsafe("1.5")
* const c = BigDecimal.fromStringUnsafe("2.0")
*
* console.log(BigDecimal.Equivalence(a, b)) // true (1.50 === 1.5)
* console.log(BigDecimal.Equivalence(a, c)) // false (1.50 !== 2.0)
* ```
*
* @category instances
* @since 2.0.0
*/
var Equivalence$3 = /*#__PURE__*/ make$16((self, that) => {
	if (self.scale > that.scale) return scale(that, self.scale).value === self.value;
	if (self.scale < that.scale) return scale(self, that.scale).value === that.value;
	return self.value === that.value;
});
/**
* Checks whether two `BigDecimal`s are equal.
*
* **When to use**
*
* Use to compare two `BigDecimal` values for numeric equality.
*
* **Example** (Checking decimal equality)
*
* ```ts
* import { BigDecimal } from "effect"
*
* const a = BigDecimal.fromStringUnsafe("1.5")
* const b = BigDecimal.fromStringUnsafe("1.50")
* const c = BigDecimal.fromStringUnsafe("2.0")
*
* console.log(BigDecimal.equals(a, b)) // true
* console.log(BigDecimal.equals(a, c)) // false
* ```
*
* @see {@link Equivalence} for passing decimal equality to APIs that require an `Equivalence`
*
* @category predicates
* @since 2.0.0
*/
var equals$1 = /*#__PURE__*/ dual(2, (self, that) => Equivalence$3(self, that));
/**
* Formats a `BigDecimal` as a string.
*
* **When to use**
*
* Use to render a `BigDecimal` as plain decimal text when possible.
*
* **Details**
*
* The value is normalized before formatting. Scientific notation is used when
* the absolute value of the normalized scale is at least `16`; otherwise plain
* decimal notation is used.
*
* **Example** (Formatting decimals)
*
* ```ts
* import { BigDecimal } from "effect"
* import * as assert from "node:assert"
*
* assert.deepStrictEqual(BigDecimal.format(BigDecimal.fromStringUnsafe("-5")), "-5")
* assert.deepStrictEqual(BigDecimal.format(BigDecimal.fromStringUnsafe("123.456")), "123.456")
* assert.deepStrictEqual(BigDecimal.format(BigDecimal.fromStringUnsafe("-0.00000123")), "-0.00000123")
* ```
*
* @see {@link toExponential} for always rendering scientific notation
*
* @category converting
* @since 2.0.0
*/
var format = (n) => {
	const normalized = normalize(n);
	if (Math.abs(normalized.scale) >= 16) return toExponential(normalized);
	const negative = normalized.value < bigint0$2;
	const absolute = negative ? `${normalized.value}`.substring(1) : `${normalized.value}`;
	let before;
	let after;
	if (normalized.scale >= absolute.length) {
		before = "0";
		after = "0".repeat(normalized.scale - absolute.length) + absolute;
	} else {
		const location = absolute.length - normalized.scale;
		if (location > absolute.length) {
			const zeros = location - absolute.length;
			before = `${absolute}${"0".repeat(zeros)}`;
			after = "";
		} else {
			after = absolute.slice(location);
			before = absolute.slice(0, location);
		}
	}
	const complete = after === "" ? before : `${before}.${after}`;
	return negative ? `-${complete}` : complete;
};
/**
* Formats a given `BigDecimal` as a `string` in scientific notation.
*
* **When to use**
*
* Use to render a `BigDecimal` in scientific notation.
*
* **Example** (Formatting decimals exponentially)
*
* ```ts
* import { BigDecimal } from "effect"
* import * as assert from "node:assert"
*
* assert.deepStrictEqual(BigDecimal.toExponential(BigDecimal.make(123456n, -5)), "1.23456e+10")
* ```
*
* @see {@link format} for plain decimal formatting when possible
*
* @category converting
* @since 3.11.0
*/
var toExponential = (n) => {
	if (isZero(n)) return "0e+0";
	const normalized = normalize(n);
	const digits = `${abs(normalized).value}`;
	const head = digits.slice(0, 1);
	const tail = digits.slice(1);
	let output = `${isNegative(normalized) ? "-" : ""}${head}`;
	if (tail !== "") output += `.${tail}`;
	const exp = tail.length - normalized.scale;
	return `${output}e${exp >= 0 ? "+" : ""}${exp}`;
};
/**
* Checks whether a given `BigDecimal` is `0`.
*
* **When to use**
*
* Use to test whether a `BigDecimal` is exactly zero.
*
* **Example** (Checking zero decimals)
*
* ```ts
* import { BigDecimal } from "effect"
* import * as assert from "node:assert"
*
* assert.deepStrictEqual(BigDecimal.isZero(BigDecimal.fromStringUnsafe("0")), true)
* assert.deepStrictEqual(BigDecimal.isZero(BigDecimal.fromStringUnsafe("1")), false)
* ```
*
* @category predicates
* @since 2.0.0
*/
var isZero = (n) => n.value === bigint0$2;
/**
* Checks whether a given `BigDecimal` is negative.
*
* **When to use**
*
* Use to test whether a `BigDecimal` is less than zero.
*
* **Example** (Checking negative decimals)
*
* ```ts
* import { BigDecimal } from "effect"
* import * as assert from "node:assert"
*
* assert.deepStrictEqual(BigDecimal.isNegative(BigDecimal.fromStringUnsafe("-1")), true)
* assert.deepStrictEqual(BigDecimal.isNegative(BigDecimal.fromStringUnsafe("0")), false)
* assert.deepStrictEqual(BigDecimal.isNegative(BigDecimal.fromStringUnsafe("1")), false)
* ```
*
* @category predicates
* @since 2.0.0
*/
var isNegative = (n) => n.value < bigint0$2;
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Effectable.js
/**
* Create a low-level `Effect` prototype.
*
* **When to use**
*
* Use when you need to create a custom Effect-like value without extending a
* class, by providing a label and an evaluate function that receives the
* current fiber.
*
* **Details**
*
* When the effect is evaluated, it calls `evaluate` with the current fiber.
*
* @see {@link Class} for a class-based approach to defining custom Effect values
*
* @category prototypes
* @since 4.0.0
*/
var Prototype = (options) => makePrimitiveProto({
	op: options.label,
	[evaluate]: options.evaluate
});
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Context.js
/**
* Runtime type identifier attached to `Context` service keys and used by
* `isKey` to recognize them.
*
* @category type IDs
* @since 4.0.0
*/
var ServiceTypeId = "~effect/Context/Service";
/**
* Creates a `Context` service key.
*
* **When to use**
*
* Use when you need to define a context service key for a dependency that must
* be provided by the surrounding context.
*
* **Details**
*
* Call `Context.Service("Key")` for a function-style key, or use the two-stage
* form `Context.Service<Self, Shape>()("Key")` for class-style service
* declarations. The returned key can be yielded as an Effect and passed to
* `Context.make`, `Context.add`, and the Context getter functions.
*
* **Gotchas**
*
* The string key is the runtime identity of the service. Reusing the same key
* string for unrelated services makes them occupy the same slot in a
* `Context`.
*
* **Example** (Creating service keys)
*
* ```ts
* import { Context } from "effect"
*
* // Create a simple service
* const Database = Context.Service<{
*   query: (sql: string) => string
* }>("Database")
*
* // Create a service class
* class Config extends Context.Service<Config, {
*   port: number
* }>()("Config") {}
*
* // Use the services to create contexts
* const db = Context.make(Database, {
*   query: (sql) => `Result: ${sql}`
* })
* const config = Context.make(Config, { port: 8080 })
* ```
*
* @see {@link Reference} for service keys with default values
*
* @category constructors
* @since 4.0.0
*/
var Service = function() {
	const prevLimit = Error.stackTraceLimit;
	Error.stackTraceLimit = 2;
	const err = /* @__PURE__ */ new Error();
	Error.stackTraceLimit = prevLimit;
	function KeyClass() {}
	const self = KeyClass;
	Object.setPrototypeOf(self, ServiceProto);
	Object.defineProperty(self, "stack", { get() {
		return err.stack;
	} });
	if (arguments.length > 0) {
		self.key = arguments[0];
		if (arguments[1]?.defaultValue) {
			self[ReferenceTypeId] = ReferenceTypeId;
			self.defaultValue = arguments[1].defaultValue;
		}
		return self;
	}
	return function(key, options) {
		self.key = key;
		if (options?.make) self.make = options.make;
		return self;
	};
};
var ServiceProto = {
	[ServiceTypeId]: ServiceTypeId,
	.../*#__PURE__*/ Prototype({
		label: "Service",
		evaluate(fiber) {
			return exitSucceed(get$1(fiber.context, this));
		}
	}),
	toJSON() {
		return {
			_id: "Service",
			key: this.key,
			stack: this.stack
		};
	},
	of(self) {
		return self;
	},
	context(self) {
		return make$13(this, self);
	},
	use(f) {
		return withFiber$1((fiber) => f(get$1(fiber.context, this)));
	},
	useSync(f) {
		return withFiber$1((fiber) => exitSucceed(f(get$1(fiber.context, this))));
	}
};
var ReferenceTypeId = "~effect/Context/Reference";
var TypeId$11 = "~effect/Context";
/**
* Creates a `Context` from an existing service map.
*
* **When to use**
*
* Use when constructing a low-level `Context` from a trusted map whose lifecycle
* you control.
*
* **Gotchas**
*
* This is unsafe because later mutation of the provided map can affect the
* created `Context`. Prefer `empty`, `make`, `add`, or `merge` for normal
* Context construction.
*
* **Example** (Creating a context from a map)
*
* ```ts
* import { Context } from "effect"
*
* // Create a context from a Map (unsafe)
* const map = new Map([
*   ["Logger", { log: (msg: string) => console.log(msg) }]
* ])
*
* const context = Context.makeUnsafe(map)
* ```
*
* @category constructors
* @since 4.0.0
*/
var makeUnsafe$4 = (mapUnsafe) => {
	const self = Object.create(Proto$1);
	self.mapUnsafe = mapUnsafe;
	self.mutable = false;
	return self;
};
var Proto$1 = {
	...PipeInspectableProto,
	[TypeId$11]: { _Services: (_) => _ },
	toJSON() {
		return {
			_id: "Context",
			services: Array.from(this.mapUnsafe).map(([key, value]) => ({
				key,
				value
			}))
		};
	},
	[symbol](that) {
		if (!isContext(that) || this.mapUnsafe.size !== that.mapUnsafe.size) return false;
		for (const k of this.mapUnsafe.keys()) if (!that.mapUnsafe.has(k) || !equals$2(this.mapUnsafe.get(k), that.mapUnsafe.get(k))) return false;
		return true;
	},
	[symbol$1]() {
		return number$1(this.mapUnsafe.size);
	}
};
/**
* Checks whether the provided argument is a `Context`.
*
* **When to use**
*
* Use to narrow an unknown value before passing it to APIs that require a
* `Context`.
*
* **Details**
*
* This checks the runtime `Context` marker and does not inspect which services
* the context contains.
*
* **Gotchas**
*
* This guard only proves that the value is a `Context`; it does not prove that
* any specific service is present.
*
* **Example** (Checking for contexts)
*
* ```ts
* import { Context } from "effect"
* import * as assert from "node:assert"
*
* assert.strictEqual(Context.isContext(Context.empty()), true)
* ```
*
* @see {@link isKey} for checking service keys
* @see {@link isReference} for checking references with defaults
*
* @category guards
* @since 2.0.0
*/
var isContext = (u) => hasProperty(u, TypeId$11);
/**
* Checks whether the provided argument is a `Reference`.
*
* **Example** (Checking for references)
*
* ```ts
* import { Context } from "effect"
* import * as assert from "node:assert"
*
* const LoggerRef = Context.Reference("Logger", {
*   defaultValue: () => ({ log: (msg: string) => console.log(msg) })
* })
*
* assert.strictEqual(Context.isReference(LoggerRef), true)
* assert.strictEqual(Context.isReference(Context.Service("Key")), false)
* ```
*
* @category guards
* @since 3.11.0
*/
var isReference = (u) => hasProperty(u, ReferenceTypeId);
/**
* Returns an empty `Context`.
*
* **Example** (Creating an empty context)
*
* ```ts
* import { Context } from "effect"
* import * as assert from "node:assert"
*
* assert.strictEqual(Context.isContext(Context.empty()), true)
* ```
*
* @category constructors
* @since 2.0.0
*/
var empty = () => emptyContext;
var emptyContext = /*#__PURE__*/ makeUnsafe$4(/*#__PURE__*/ new Map());
/**
* Creates a new `Context` with a single service associated to the key.
*
* **Example** (Creating a context with one service)
*
* ```ts
* import { Context } from "effect"
* import * as assert from "node:assert"
*
* const Port = Context.Service<{ PORT: number }>("Port")
*
* const context = Context.make(Port, { PORT: 8080 })
*
* assert.deepStrictEqual(Context.get(context, Port), { PORT: 8080 })
* ```
*
* @category constructors
* @since 2.0.0
*/
var make$13 = (key, service) => makeUnsafe$4(/* @__PURE__ */ new Map([[key.key, service]]));
/**
* Adds a service to a given `Context`.
*
* **When to use**
*
* Use when you need to store a known service value in a `Context`.
*
* **Details**
*
* If the context already contains the same service key, the new service
* replaces the previous one.
*
* **Example** (Adding a service to a context)
*
* ```ts
* import { Context, pipe } from "effect"
* import * as assert from "node:assert"
*
* const Port = Context.Service<{ PORT: number }>("Port")
* const Timeout = Context.Service<{ TIMEOUT: number }>("Timeout")
*
* const someContext = Context.make(Port, { PORT: 8080 })
*
* const context = pipe(
*   someContext,
*   Context.add(Timeout, { TIMEOUT: 5000 })
* )
*
* assert.deepStrictEqual(Context.get(context, Port), { PORT: 8080 })
* assert.deepStrictEqual(Context.get(context, Timeout), { TIMEOUT: 5000 })
* ```
*
* @see {@link addOrOmit} for adding or removing a service from an `Option`
*
* @category adders
* @since 2.0.0
*/
var add = /*#__PURE__*/ dual(3, (self, key, service) => withMapUnsafe(self, (map) => {
	map.set(key.key, service);
}));
/**
* Gets the service for a key, or evaluates the fallback when a non-reference
* key is absent.
*
* **When to use**
*
* Use when you need a fallback for a missing `Context.Service` key while still
* resolving `Context.Reference` defaults.
*
* **Details**
*
* If the key is a `Context.Reference` and no override is stored in the
* context, its cached default value is returned instead of the fallback.
*
* **Gotchas**
*
* The fallback is not evaluated for missing `Context.Reference` keys because
* references resolve to their default value.
*
* **Example** (Falling back for missing services)
*
* ```ts
* import { Context } from "effect"
*
* const Logger = Context.Service<{ log: (msg: string) => void }>("Logger")
* const Database = Context.Service<{ query: (sql: string) => string }>(
*   "Database"
* )
*
* const context = Context.make(Logger, {
*   log: (msg: string) => console.log(msg)
* })
*
* const logger = Context.getOrElse(context, Logger, () => ({ log: () => {} }))
* const database = Context.getOrElse(
*   context,
*   Database,
*   () => ({ query: () => "fallback" })
* )
*
* console.log(logger === Context.get(context, Logger)) // true
* console.log(database.query("SELECT 1")) // "fallback"
* ```
*
* @see {@link getOption} for returning `Option.none` when a non-reference key is missing
*
* @category getters
* @since 3.7.0
*/
var getOrElse = /*#__PURE__*/ dual(3, (self, key, orElse) => {
	if (self.mapUnsafe.has(key.key)) return self.mapUnsafe.get(key.key);
	return isReference(key) ? getDefaultValue(key) : orElse();
});
/**
* Gets the service for a key, throwing if an absent non-reference key cannot be
* resolved.
*
* **When to use**
*
* Use when you need to read a service from a context whose type does not prove
* the service is present.
*
* **Details**
*
* If the key is a `Context.Reference` and no override is stored in the
* context, its cached default value is returned. For absent non-reference keys,
* this function throws a runtime error.
*
* **Example** (Getting services unsafely)
*
* ```ts
* import { Context } from "effect"
* import * as assert from "node:assert"
*
* const Port = Context.Service<{ PORT: number }>("Port")
* const Timeout = Context.Service<{ TIMEOUT: number }>("Timeout")
*
* const context = Context.make(Port, { PORT: 8080 })
*
* assert.deepStrictEqual(Context.getUnsafe(context, Port), { PORT: 8080 })
* assert.throws(() => Context.getUnsafe(context, Timeout))
* ```
*
* @see {@link get} for type-checked service access
* @see {@link getOption} for optional service access
*
* @category unsafe
* @since 4.0.0
*/
var getUnsafe = /*#__PURE__*/ dual(2, (self, service) => {
	if (!self.mapUnsafe.has(service.key)) {
		if (ReferenceTypeId in service) return getDefaultValue(service);
		throw serviceNotFoundError(service);
	}
	return self.mapUnsafe.get(service.key);
});
/**
* Gets a service from the context that corresponds to the given key.
*
* **When to use**
*
* Use when you need type-checked access to a service already included in the
* context type.
*
* **Example** (Getting a service from a context)
*
* ```ts
* import { Context, pipe } from "effect"
* import * as assert from "node:assert"
*
* const Port = Context.Service<{ PORT: number }>("Port")
* const Timeout = Context.Service<{ TIMEOUT: number }>("Timeout")
*
* const context = pipe(
*   Context.make(Port, { PORT: 8080 }),
*   Context.add(Timeout, { TIMEOUT: 5000 })
* )
*
* assert.deepStrictEqual(Context.get(context, Timeout), { TIMEOUT: 5000 })
* ```
*
* @see {@link getOption} for optional service access
* @see {@link getOrElse} for fallback values
*
* @category getters
* @since 2.0.0
*/
var get$1 = getUnsafe;
/**
* Gets the value for a `Context.Reference`, returning its cached default when
* the context does not contain an override.
*
* **When to use**
*
* Use when you need a `Context.Reference` value resolved from either a stored
* override or the reference's default value.
*
* **Details**
*
* Stored overrides take precedence. If no override is present, the reference's
* default value is computed lazily and cached on the reference itself.
*
* **Gotchas**
*
* Mutable default values can be shared across contexts unless an override is
* provided, because the default is cached on the `Context.Reference`.
*
* **Example** (Getting reference defaults unsafely)
*
* ```ts
* import { Context } from "effect"
*
* const LoggerRef = Context.Reference("Logger", {
*   defaultValue: () => ({ log: (msg: string) => console.log(msg) })
* })
*
* const context = Context.empty()
* const logger = Context.getReferenceUnsafe(context, LoggerRef)
*
* console.log(typeof logger.log) // "function"
* ```
*
* @see {@link getUnsafe} for unsafe access with any service key
* @see {@link get} for type-checked reference-aware access
* @see {@link getOption} for optional access to non-reference keys
*
* @category unsafe
* @since 4.0.0
*/
var getReferenceUnsafe = (self, service) => {
	if (!self.mapUnsafe.has(service.key)) return getDefaultValue(service);
	return self.mapUnsafe.get(service.key);
};
var defaultValueCacheKey = "~effect/Context/defaultValue";
var getDefaultValue = (ref) => {
	if (defaultValueCacheKey in ref) return ref[defaultValueCacheKey];
	return ref[defaultValueCacheKey] = ref.defaultValue();
};
var serviceNotFoundError = (service) => {
	const error = /* @__PURE__ */ new Error(`Service not found${service.key ? `: ${String(service.key)}` : ""}`);
	if (service.stack) {
		const lines = service.stack.split("\n");
		if (lines.length > 2) {
			const afterAt = lines[2].match(/at (.*)/);
			if (afterAt) error.message = error.message + ` (defined at ${afterAt[1]})`;
		}
	}
	if (error.stack) {
		const lines = error.stack.split("\n");
		lines.splice(1, 3);
		error.stack = lines.join("\n");
	}
	return error;
};
/**
* Merges two `Context`s into one.
*
* **When to use**
*
* Use when you need to combine two contexts.
*
* **Details**
*
* When both contexts contain the same service key, the service from `that`
* overrides the service from `self`.
*
* **Example** (Merging two contexts)
*
* ```ts
* import { Context } from "effect"
* import * as assert from "node:assert"
*
* const Port = Context.Service<{ PORT: number }>("Port")
* const Timeout = Context.Service<{ TIMEOUT: number }>("Timeout")
*
* const firstContext = Context.make(Port, { PORT: 8080 })
* const secondContext = Context.make(Timeout, { TIMEOUT: 5000 })
*
* const context = Context.merge(firstContext, secondContext)
*
* assert.deepStrictEqual(Context.get(context, Port), { PORT: 8080 })
* assert.deepStrictEqual(Context.get(context, Timeout), { TIMEOUT: 5000 })
* ```
*
* @see {@link mergeAll} for merging more than two contexts at once
*
* @category combining
* @since 2.0.0
*/
var merge = /*#__PURE__*/ dual(2, (self, that) => {
	if (self.mapUnsafe.size === 0) return that;
	if (that.mapUnsafe.size === 0) return self;
	return withMapUnsafe(self, (map) => {
		that.mapUnsafe.forEach((value, key) => map.set(key, value));
	});
});
var withMapUnsafe = (self, f) => {
	if (self.mutable) {
		f(self.mapUnsafe);
		return self;
	}
	const map = new Map(self.mapUnsafe);
	f(map);
	return makeUnsafe$4(map);
};
/**
* Creates a context key with a default value.
*
* **When to use**
*
* Use when you need to define a context key with a lazily computed default
* value.
*
* **Details**
*
* `Context.Reference` allows you to create a key that can hold a value. You
* can provide a default value for the service, which will automatically be used
* when the context is accessed, or override it with a custom implementation
* when needed. The default value is computed lazily and cached on the
* reference.
*
* **Example** (Creating references with default values)
*
* ```ts
* import { Context } from "effect"
*
* // Create a reference with a default value
* const LoggerRef = Context.Reference("Logger", {
*   defaultValue: () => ({ log: (msg: string) => console.log(msg) })
* })
*
* // The reference provides the default value when accessed from an empty context
* const context = Context.empty()
* const logger = Context.get(context, LoggerRef)
*
* // You can also override the default value
* const customContext = Context.make(LoggerRef, {
*   log: (msg: string) => `Custom: ${msg}`
* })
* const customLogger = Context.get(customContext, LoggerRef)
* ```
*
* @see {@link Service} for required services without default values
*
* @category references
* @since 3.11.0
*/
var Reference = Service;
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Duration.js
var TypeId$10 = "~effect/time/Duration";
var bigint0$1 = /*#__PURE__*/ BigInt(0);
var bigint1 = /*#__PURE__*/ BigInt(1);
var bigint1e3 = /*#__PURE__*/ BigInt(1e3);
var roundTiesAwayFromZero = (input) => BigInt(input < 0 ? Math.ceil(input - .5) : Math.floor(input + .5));
var roundMillisToNanos = (millis) => roundTiesAwayFromZero(millis * 1e6);
var parseNanos = (input, scale) => input.includes(".") ? roundTiesAwayFromZero(Number(input) * Number(scale)) : BigInt(input) * scale;
var DURATION_REGEXP = /^(-?\d+(?:\.\d+)?)\s+(nanos?|micros?|millis?|seconds?|minutes?|hours?|days?|weeks?)$/;
/**
* Decodes a `Duration.Input` into a `Duration`.
*
* **When to use**
*
* Use when the input has already been validated or comes from a trusted source
* and throwing is acceptable for invalid duration syntax.
*
* **Gotchas**
*
* If the input is not a valid `Duration.Input`, it throws an error.
*
* **Example** (Decoding duration inputs)
*
* ```ts
* import { Duration } from "effect"
*
* const duration1 = Duration.fromInputUnsafe(1000) // 1000 milliseconds
* const duration2 = Duration.fromInputUnsafe("5 seconds")
* const duration3 = Duration.fromInputUnsafe("Infinity")
* const duration4 = Duration.fromInputUnsafe([2, 500_000_000]) // 2 seconds and 500ms
* ```
*
* @category constructors
* @since 4.0.0
*/
var fromInputUnsafe = (input) => {
	switch (typeof input) {
		case "number": return millis(input);
		case "bigint": return nanos(input);
		case "string": {
			if (input === "Infinity") return infinity;
			if (input === "-Infinity") return negativeInfinity;
			const match = DURATION_REGEXP.exec(input);
			if (!match) break;
			const [_, valueStr, unit] = match;
			if (unit === "nano" || unit === "nanos") return nanos(parseNanos(valueStr, bigint1));
			if (unit === "micro" || unit === "micros") return nanos(parseNanos(valueStr, bigint1e3));
			const value = Number(valueStr);
			switch (unit) {
				case "milli":
				case "millis": return millis(value);
				case "second":
				case "seconds": return seconds(value);
				case "minute":
				case "minutes": return minutes(value);
				case "hour":
				case "hours": return hours(value);
				case "day":
				case "days": return days(value);
				case "week":
				case "weeks": return weeks(value);
			}
			break;
		}
		case "object": {
			if (input === null) break;
			if (TypeId$10 in input) return input;
			if (Array.isArray(input)) {
				if (input.length !== 2 || !input.every(isNumber)) return invalid(input);
				if (Number.isNaN(input[0]) || Number.isNaN(input[1])) return zero;
				if (input[0] === -Infinity || input[1] === -Infinity) return negativeInfinity;
				if (input[0] === Infinity || input[1] === Infinity) return infinity;
				return make$12(roundTiesAwayFromZero(input[0] * 1e9 + input[1]));
			}
			const obj = input;
			let millis = 0;
			if (obj.weeks) millis += obj.weeks * 6048e5;
			if (obj.days) millis += obj.days * 864e5;
			if (obj.hours) millis += obj.hours * 36e5;
			if (obj.minutes) millis += obj.minutes * 6e4;
			if (obj.seconds) millis += obj.seconds * 1e3;
			if (obj.milliseconds) millis += obj.milliseconds;
			if (!obj.microseconds && !obj.nanoseconds) return make$12(millis);
			return make$12(roundTiesAwayFromZero(millis * 1e6 + (obj.microseconds ?? 0) * 1e3 + (obj.nanoseconds ?? 0)));
		}
	}
	return invalid(input);
};
var invalid = (input) => {
	throw new Error(`Invalid Input: ${input}`);
};
var zeroDurationValue = {
	_tag: "Millis",
	millis: 0
};
var infinityDurationValue = { _tag: "Infinity" };
var negativeInfinityDurationValue = { _tag: "NegativeInfinity" };
var DurationProto = {
	[TypeId$10]: TypeId$10,
	[symbol$1]() {
		return structure(this.value);
	},
	[symbol](that) {
		return isDuration(that) && equals(this, that);
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
	[NodeInspectSymbol]() {
		return this.toJSON();
	},
	pipe() {
		return pipeArguments(this, arguments);
	}
};
var make$12 = (input) => {
	const duration = Object.create(DurationProto);
	if (typeof input === "number") if (isNaN(input) || input === 0 || Object.is(input, -0)) duration.value = zeroDurationValue;
	else if (!Number.isFinite(input)) duration.value = input > 0 ? infinityDurationValue : negativeInfinityDurationValue;
	else if (!Number.isInteger(input)) duration.value = {
		_tag: "Nanos",
		nanos: roundMillisToNanos(input)
	};
	else duration.value = {
		_tag: "Millis",
		millis: input
	};
	else if (input === bigint0$1) duration.value = zeroDurationValue;
	else duration.value = {
		_tag: "Nanos",
		nanos: input
	};
	return duration;
};
/**
* Checks whether a value is a Duration.
*
* **Example** (Checking for durations)
*
* ```ts
* import { Duration } from "effect"
*
* console.log(Duration.isDuration(Duration.seconds(1))) // true
* console.log(Duration.isDuration(1000)) // false
* ```
*
* @category guards
* @since 2.0.0
*/
var isDuration = (u) => hasProperty(u, TypeId$10);
/**
* A Duration representing zero time.
*
* **Example** (Using the zero duration)
*
* ```ts
* import { Duration } from "effect"
*
* console.log(Duration.toMillis(Duration.zero)) // 0
* ```
*
* @category constructors
* @since 2.0.0
*/
var zero = /*#__PURE__*/ make$12(0);
/**
* A Duration representing infinite time.
*
* **Example** (Using infinite duration)
*
* ```ts
* import { Duration } from "effect"
*
* console.log(Duration.toMillis(Duration.infinity)) // Infinity
* ```
*
* @category constructors
* @since 2.0.0
*/
var infinity = /*#__PURE__*/ make$12(Infinity);
/**
* A Duration representing negative infinite time.
*
* **Example** (Using negative infinite duration)
*
* ```ts
* import { Duration } from "effect"
*
* console.log(Duration.toMillis(Duration.negativeInfinity)) // -Infinity
* ```
*
* @category constructors
* @since 4.0.0
*/
var negativeInfinity = /*#__PURE__*/ make$12(-Infinity);
/**
* Creates a Duration from nanoseconds.
*
* **Example** (Creating durations from nanoseconds)
*
* ```ts
* import { Duration } from "effect"
*
* const duration = Duration.nanos(BigInt(500_000_000))
* console.log(Duration.toMillis(duration)) // 500
* ```
*
* @category constructors
* @since 2.0.0
*/
var nanos = (nanos) => make$12(nanos);
/**
* Creates a Duration from milliseconds.
*
* **Example** (Creating durations from milliseconds)
*
* ```ts
* import { Duration } from "effect"
*
* const duration = Duration.millis(1000)
* console.log(Duration.toMillis(duration)) // 1000
* ```
*
* @category constructors
* @since 2.0.0
*/
var millis = (millis) => make$12(millis);
/**
* Creates a Duration from seconds.
*
* **Example** (Creating durations from seconds)
*
* ```ts
* import { Duration } from "effect"
*
* const duration = Duration.seconds(30)
* console.log(Duration.toMillis(duration)) // 30000
* ```
*
* @category constructors
* @since 2.0.0
*/
var seconds = (seconds) => make$12(seconds * 1e3);
/**
* Creates a Duration from minutes.
*
* **Example** (Creating durations from minutes)
*
* ```ts
* import { Duration } from "effect"
*
* const duration = Duration.minutes(5)
* console.log(Duration.toMillis(duration)) // 300000
* ```
*
* @category constructors
* @since 2.0.0
*/
var minutes = (minutes) => make$12(minutes * 6e4);
/**
* Creates a Duration from hours.
*
* **Example** (Creating durations from hours)
*
* ```ts
* import { Duration } from "effect"
*
* const duration = Duration.hours(2)
* console.log(Duration.toMillis(duration)) // 7200000
* ```
*
* @category constructors
* @since 2.0.0
*/
var hours = (hours) => make$12(hours * 36e5);
/**
* Creates a Duration from days.
*
* **Example** (Creating durations from days)
*
* ```ts
* import { Duration } from "effect"
*
* const duration = Duration.days(1)
* console.log(Duration.toMillis(duration)) // 86400000
* ```
*
* @category constructors
* @since 2.0.0
*/
var days = (days) => make$12(days * 864e5);
/**
* Creates a Duration from weeks.
*
* **Example** (Creating durations from weeks)
*
* ```ts
* import { Duration } from "effect"
*
* const duration = Duration.weeks(1)
* console.log(Duration.toMillis(duration)) // 604800000
* ```
*
* @category constructors
* @since 2.0.0
*/
var weeks = (weeks) => make$12(weeks * 6048e5);
/**
* Converts a Duration to milliseconds.
*
* **Example** (Converting durations to milliseconds)
*
* ```ts
* import { Duration } from "effect"
*
* console.log(Duration.toMillis(Duration.seconds(5))) // 5000
* console.log(Duration.toMillis(Duration.minutes(2))) // 120000
* ```
*
* @category getters
* @since 2.0.0
*/
var toMillis = (self) => match$1(fromInputUnsafe(self), {
	onMillis: identity,
	onNanos: (nanos) => Number(nanos) / 1e6,
	onInfinity: () => Infinity,
	onNegativeInfinity: () => -Infinity
});
/**
* Gets the duration in nanoseconds as a bigint.
*
* **When to use**
*
* Use when the duration is known to be finite and you need the nanosecond value
* as a `bigint`.
*
* **Details**
*
* Millisecond-backed fractional durations are rounded to the nearest
* nanosecond, with ties away from zero.
*
* **Gotchas**
*
* If the duration is infinite, it throws an error.
*
* **Example** (Reading nanoseconds unsafely)
*
* ```ts
* import { Duration } from "effect"
*
* const duration = Duration.seconds(2)
* const nanos = Duration.toNanosUnsafe(duration)
* console.log(nanos) // 2000000000n
*
* // Duration.toNanosUnsafe(Duration.infinity)
* // throws Error: "Cannot convert infinite duration to nanos"
* ```
*
* @category getters
* @since 4.0.0
*/
var toNanosUnsafe = (input) => {
	const self = fromInputUnsafe(input);
	switch (self.value._tag) {
		case "Infinity":
		case "NegativeInfinity": throw new Error("Cannot convert infinite duration to nanos");
		case "Nanos": return self.value.nanos;
		case "Millis": return roundMillisToNanos(self.value.millis);
	}
};
/**
* Pattern matches on the representation of a `Duration`.
*
* **Details**
*
* Provide handlers for millisecond-backed values, nanosecond-backed values,
* and positive infinity. Use `onNegativeInfinity` to handle negative infinity
* separately; otherwise negative infinity is handled by `onInfinity`.
*
* **Example** (Pattern matching on duration representations)
*
* ```ts
* import { Duration } from "effect"
*
* const result = Duration.match(Duration.seconds(5), {
*   onMillis: (millis) => `${millis} milliseconds`,
*   onNanos: (nanos) => `${nanos} nanoseconds`,
*   onInfinity: () => "infinite"
* })
* console.log(result) // "5000 milliseconds"
* ```
*
* @category pattern matching
* @since 2.0.0
*/
var match$1 = /*#__PURE__*/ dual(2, (self, options) => {
	switch (self.value._tag) {
		case "Millis": return options.onMillis(self.value.millis);
		case "Nanos": return options.onNanos(self.value.nanos);
		case "Infinity": return options.onInfinity();
		case "NegativeInfinity": return (options.onNegativeInfinity ?? options.onInfinity)();
	}
});
/**
* Pattern matches on two `Duration`s, providing handlers that receive both values.
*
* **Example** (Pattern matching on duration pairs)
*
* ```ts
* import { Duration } from "effect"
*
* const sum = Duration.matchPair(Duration.seconds(3), Duration.seconds(2), {
*   onMillis: (a, b) => a + b,
*   onNanos: (a, b) => Number(a + b),
*   onInfinity: () => Infinity
* })
* console.log(sum) // 5000
* ```
*
* @category pattern matching
* @since 4.0.0
*/
var matchPair = /*#__PURE__*/ dual(3, (self, that, options) => {
	if (self.value._tag === "Infinity" || self.value._tag === "NegativeInfinity" || that.value._tag === "Infinity" || that.value._tag === "NegativeInfinity") return options.onInfinity(self, that);
	if (self.value._tag === "Millis") return that.value._tag === "Millis" ? options.onMillis(self.value.millis, that.value.millis) : options.onNanos(toNanosUnsafe(self), that.value.nanos);
	else return options.onNanos(self.value.nanos, toNanosUnsafe(that));
});
/**
* Provides an `Equivalence` instance for comparing `Duration` values.
*
* **Example** (Comparing durations for equivalence)
*
* ```ts
* import { Duration } from "effect"
*
* const isEqual = Duration.Equivalence(Duration.seconds(5), Duration.millis(5000))
* console.log(isEqual) // true
* ```
*
* @category instances
* @since 2.0.0
*/
var Equivalence$2 = (self, that) => matchPair(self, that, {
	onMillis: (self, that) => self === that,
	onNanos: (self, that) => self === that,
	onInfinity: (self, that) => self.value._tag === that.value._tag
});
/**
* Checks whether two Durations are equal.
*
* **Example** (Checking duration equality)
*
* ```ts
* import { Duration } from "effect"
*
* const isEqual = Duration.equals(Duration.seconds(5), Duration.millis(5000))
* console.log(isEqual) // true
* ```
*
* @category predicates
* @since 2.0.0
*/
var equals = /*#__PURE__*/ dual(2, (self, that) => Equivalence$2(self, that));
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Scheduler.js
/**
* Controls how runnable Effect fiber tasks are dispatched.
*
* A scheduler decides how tasks are queued, when queued tasks run, and when a
* fiber should pause so other work can continue. This module includes the
* scheduler service reference, the default `MixedScheduler`, dispatcher types
* for queued tasks, and references for tuning or disabling automatic scheduler
* yields.
*
* @since 2.0.0
*/
/**
* Context reference for the scheduler used by the Effect runtime.
*
* **When to use**
*
* Use when you need to replace scheduling behavior globally in tests or runtime
* setup, such as forcing deterministic task dispatch.
*
* **Details**
*
* The default value creates a `MixedScheduler`. Provide this service to
* customize execution mode, task dispatching, or yield behavior.
*
* @category references
* @since 2.0.0
*/
var Scheduler = /*#__PURE__*/ Reference("effect/Scheduler", { defaultValue: () => new MixedScheduler() });
var setImmediate = "setImmediate" in globalThis ? (f) => {
	const timer = globalThis.setImmediate(f);
	return () => globalThis.clearImmediate(timer);
} : (f) => {
	const timer = setTimeout(f, 0);
	return () => clearTimeout(timer);
};
var PriorityBuckets = class {
	buckets = [];
	scheduleTask(task, priority) {
		const buckets = this.buckets;
		const len = buckets.length;
		let bucket;
		let index = 0;
		for (; index < len; index++) {
			if (buckets[index][0] > priority) break;
			bucket = buckets[index];
		}
		if (bucket && bucket[0] === priority) bucket[1].push(task);
		else if (index === len) buckets.push([priority, [task]]);
		else buckets.splice(index, 0, [priority, [task]]);
	}
	drain() {
		const buckets = this.buckets;
		this.buckets = [];
		return buckets;
	}
};
/**
* Provides a scheduler implementation that batches queued tasks and dispatches them by
* priority.
*
* **When to use**
*
* Use when you need the default runtime scheduler directly, including a
* scheduler that batches queued work by priority and preserves FIFO order within
* each priority.
*
* **Details**
*
* `MixedScheduler` supports synchronous and asynchronous execution modes, uses
* operation counts to decide when fibers should yield, and is the default
* scheduler implementation.
*
* @category schedulers
* @since 2.0.0
*/
var MixedScheduler = class {
	executionMode;
	setImmediate;
	constructor(executionMode = "async", setImmediateFn = setImmediate) {
		this.executionMode = executionMode;
		this.setImmediate = setImmediateFn;
	}
	/**
	* Returns whether the fiber has reached its operation budget and should yield.
	*
	* **When to use**
	*
	* Use to decide whether a fiber should yield after consuming its current
	* operation budget.
	*
	* @since 2.0.0
	*/
	shouldYield(fiber) {
		return fiber.currentOpCount >= fiber.maxOpsBeforeYield;
	}
	/**
	* Creates a dispatcher that schedules work through this scheduler.
	*
	* **When to use**
	*
	* Use when you need a standalone dispatcher from a scheduler instance, for
	* example in tests that enqueue tasks and then flush them deterministically.
	*
	* @since 4.0.0
	*/
	makeDispatcher() {
		return new MixedSchedulerDispatcher(this.setImmediate);
	}
};
var MixedSchedulerDispatcher = class {
	tasks = /*#__PURE__*/ new PriorityBuckets();
	running = void 0;
	setImmediate;
	constructor(setImmediateFn = setImmediate) {
		this.setImmediate = setImmediateFn;
	}
	/**
	* @since 2.0.0
	*/
	scheduleTask(task, priority) {
		this.tasks.scheduleTask(task, priority);
		if (this.running === void 0) this.running = this.setImmediate(this.afterScheduled);
	}
	/**
	* @since 2.0.0
	*/
	afterScheduled = () => {
		this.running = void 0;
		this.runTasks();
	};
	/**
	* @since 2.0.0
	*/
	runTasks() {
		const buckets = this.tasks.drain();
		for (let i = 0; i < buckets.length; i++) {
			const toRun = buckets[i][1];
			for (let j = 0; j < toRun.length; j++) toRun[j]();
		}
	}
	/**
	* @since 2.0.0
	*/
	flush() {
		while (this.tasks.buckets.length > 0) {
			if (this.running !== void 0) {
				this.running();
				this.running = void 0;
			}
			this.runTasks();
		}
	}
};
/**
* Context reference that controls the maximum number of operations a fiber
* can perform before yielding control back to the scheduler.
*
* **When to use**
*
* Use to tune scheduler fairness for CPU-bound fibers by changing the scheduler
* operation budget that triggers a yield.
*
* **Details**
*
* The default value is `2048` operations, which balances performance and
* fairness by helping prevent long-running fibers from monopolizing the
* execution thread.
*
* @see {@link PreventSchedulerYield} for bypassing scheduler yield checks entirely rather than tuning the operation budget
*
* @category references
* @since 4.0.0
*/
var MaxOpsBeforeYield = /*#__PURE__*/ Reference("effect/Scheduler/MaxOpsBeforeYield", { defaultValue: () => 2048 });
/**
* Context reference that controls whether the runtime should bypass scheduler
* yield checks. When set to `true`, the fiber run loop won't call
* `Scheduler.shouldYield`.
*
* **When to use**
*
* Use to bypass scheduler yield checks for controlled runtime workloads where
* cooperative yielding should be disabled.
*
* **Gotchas**
*
* Setting this reference to `true` can let long-running fibers monopolize the
* JavaScript thread.
*
* @see {@link MaxOpsBeforeYield} for tuning yield frequency without disabling yield checks
* @see {@link Scheduler} for providing custom scheduler yield behavior
*
* @category references
* @since 4.0.0
*/
var PreventSchedulerYield = /*#__PURE__*/ Reference("effect/Scheduler/PreventSchedulerYield", { defaultValue: () => false });
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Tracer.js
/**
* Defines the low-level tracing model used by Effect.
*
* A span records the lifetime of an operation, including its name, parent,
* attributes, links, annotations, sampling decision, kind, and completion
* status. The module also defines the tracer service, parent-span context,
* external span support, trace propagation settings, and the default in-memory
* span implementation.
*
* @since 2.0.0
*/
/**
* Defines the string key for the parent-span context service.
*
* **When to use**
*
* Use when you need the raw context key for parent span lookup in lower-level
* tracing code.
*
* **Example** (Reading the parent span key)
*
* ```ts
* import { Tracer } from "effect"
*
* // The key used to identify parent spans in the context
* console.log(Tracer.ParentSpanKey) // "effect/Tracer/ParentSpan"
* ```
*
* @category constants
* @since 4.0.0
*/
var ParentSpanKey = "effect/Tracer/ParentSpan";
/**
* Context service containing the `Span` or `ExternalSpan` to use as the parent
* of newly-created child spans.
*
* **Example** (Accessing the parent span)
*
* ```ts
* import { Effect, Tracer } from "effect"
*
* // Access the parent span from the context
* const program = Effect.gen(function*() {
*   const parentSpan = yield* Effect.service(Tracer.ParentSpan)
*   console.log(`Parent span: ${parentSpan.spanId}`)
* })
* ```
*
* @category services
* @since 2.0.0
*/
var ParentSpan = class extends Service()(ParentSpanKey) {};
/**
* Creates a `Tracer` value from a tracer implementation object.
*
* **When to use**
*
* Use to create a custom tracing backend value that Effect can use when
* creating spans.
*
* **Details**
*
* `make` returns the supplied implementation object unchanged. The object must
* satisfy the `Tracer` contract, including a `span` method that returns a
* `Span`.
*
* @see {@link Span} for the span values returned by tracer implementations
*
* @category constructors
* @since 2.0.0
*/
var make$11 = (options) => options;
/**
* Context reference for disabling trace propagation.
*
* **When to use**
*
* Use to prevent spans in a scope from propagating tracing context.
*
* **Details**
*
* When enabled on fiber or span annotations, new spans are created as
* non-propagating no-op spans and disabled spans are skipped when deriving a
* parent span.
*
* **Example** (Disabling span propagation)
*
* ```ts
* import { Effect, Tracer } from "effect"
*
* // Disable span propagation for a specific effect
* const program = Effect.gen(function*() {
*   yield* Effect.log("This will not propagate parent span")
* }).pipe(
*   Effect.provideService(Tracer.DisablePropagation, true)
* )
* ```
*
* @category references
* @since 3.12.0
*/
var DisablePropagation = /*#__PURE__*/ Reference("effect/Tracer/DisablePropagation", { defaultValue: constFalse });
/**
* Context reference for controlling the current trace level for dynamic filtering.
*
* **When to use**
*
* Use to set the default trace level for spans in a scope when span options do
* not provide `level`.
*
* **Details**
*
* The default value is `"Info"`. Span creation uses `options.level ??
* CurrentTraceLevel` before applying `MinimumTraceLevel`.
*
* @see {@link MinimumTraceLevel} for the threshold that decides whether spans at that level are sampled
*
* @category references
* @since 4.0.0
*/
var CurrentTraceLevel = /*#__PURE__*/ Reference("effect/Tracer/CurrentTraceLevel", { defaultValue: () => "Info" });
/**
* Context reference for setting the minimum trace level threshold. Spans and their
* descendants below this level will have their sampling decision forced to
* false, preventing them from being exported.
*
* **When to use**
*
* Use to set the trace-level threshold that controls whether spans are sampled
* by default.
*
* **Details**
*
* The default value is `"All"`. Span creation compares the span level from
* `options.level ?? CurrentTraceLevel` against this threshold.
*
* **Gotchas**
*
* Explicit `options.sampled` bypasses threshold computation.
*
* @see {@link CurrentTraceLevel} for the default span level used when options do not specify one
*
* @category references
* @since 4.0.0
*/
var MinimumTraceLevel = /*#__PURE__*/ Reference("effect/Tracer/MinimumTraceLevel", { defaultValue: () => "All" });
/**
* Defines the string key for the active tracer context reference.
*
* **When to use**
*
* Use when you need the raw context key for active tracer lookup in lower-level
* tracing code.
*
* @category references
* @since 4.0.0
*/
var TracerKey = "effect/Tracer";
/**
* Context reference for the active tracer service. By default it uses the
* native tracer, which creates `NativeSpan` instances.
*
* **Example** (Accessing the current tracer)
*
* ```ts
* import { Effect, Tracer } from "effect"
*
* // Access the current tracer from the context
* const program = Effect.gen(function*() {
*   const tracer = yield* Effect.service(Tracer.Tracer)
*   console.log("Using current tracer")
* })
*
* // Or use the built-in tracer effect
* const tracerEffect = Effect.gen(function*() {
*   const tracer = yield* Effect.tracer
*   console.log("Current tracer obtained")
* })
* ```
*
* @category references
* @since 2.0.0
*/
var Tracer = /*#__PURE__*/ Reference(TracerKey, { defaultValue: () => make$11({ span: (options) => new NativeSpan(options) }) });
/**
* Default in-memory `Span` implementation used by the native tracer. It
* generates span and trace identifiers, stores attributes, events, and links,
* and records `Started` or `Ended` status.
*
* **Details**
*
* The constructor initializes the span with `Started` status, inherits the
* parent trace id or generates a new one, and always generates a new span id.
* Attributes, events, links, and status are then mutated through `Span` methods.
*
* @see {@link Span} for the interface implemented by native spans
*
* @category native tracer
* @since 4.0.0
*/
var NativeSpan = class {
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
	constructor(options) {
		this.name = options.name;
		this.parent = options.parent;
		this.annotations = options.annotations;
		this.links = options.links;
		this.startTime = options.startTime;
		this.kind = options.kind;
		this.sampled = options.sampled;
		this.status = {
			_tag: "Started",
			startTime: options.startTime
		};
		this.attributes = /* @__PURE__ */ new Map();
		this.traceId = getOrUndefined(options.parent)?.traceId ?? randomHexString(32);
		this.spanId = randomHexString(16);
	}
	end(endTime, exit) {
		this.status = {
			_tag: "Ended",
			endTime,
			exit,
			startTime: this.status.startTime
		};
	}
	attribute(key, value) {
		this.attributes.set(key, value);
	}
	event(name, startTime, attributes) {
		this.events.push([
			name,
			startTime,
			attributes ?? {}
		]);
	}
	addLinks(links) {
		this.links.push(...links);
	}
};
var randomHexString = /*#__PURE__*/ function() {
	const characters = "abcdef0123456789";
	const charactersLength = 16;
	return function(length) {
		let result = "";
		for (let i = 0; i < length; i++) result += characters.charAt(Math.floor(Math.random() * charactersLength));
		return result;
	};
}();
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/metric.js
/** @internal */
var FiberRuntimeMetricsKey = "effect/observability/Metric/FiberRuntimeMetricsKey";
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/references.js
/** @internal */
var CurrentStackFrame = /*#__PURE__*/ Reference("effect/References/CurrentStackFrame", { defaultValue: constUndefined });
/** @internal */
var TracerEnabled = /*#__PURE__*/ Reference("effect/References/TracerEnabled", { defaultValue: constTrue });
/** @internal */
var TracerTimingEnabled = /*#__PURE__*/ Reference("effect/References/TracerTimingEnabled", { defaultValue: constTrue });
/** @internal */
var TracerSpanAnnotations = /*#__PURE__*/ Reference("effect/References/TracerSpanAnnotations", { defaultValue: () => ({}) });
/** @internal */
var TracerSpanLinks = /*#__PURE__*/ Reference("effect/References/TracerSpanLinks", { defaultValue: () => [] });
/** @internal */
var CurrentLogLevel = /*#__PURE__*/ Reference("effect/References/CurrentLogLevel", { defaultValue: () => "Info" });
/** @internal */
var MinimumLogLevel = /*#__PURE__*/ Reference("effect/References/MinimumLogLevel", { defaultValue: () => "Info" });
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/tracer.js
/** @internal */
var makeStackCleaner = (line) => (stack) => {
	let cache;
	return () => {
		if (cache !== void 0) return cache;
		const trace = stack();
		if (!trace) return void 0;
		const lines = trace.split("\n");
		if (lines[line] !== void 0) {
			cache = lines[line].trim();
			return cache;
		}
	};
};
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/effect.js
/** @internal */
var Interrupt = class extends ReasonBase {
	fiberId;
	constructor(fiberId, annotations = constEmptyAnnotations) {
		super("Interrupt", annotations, "Interrupted");
		this.fiberId = fiberId;
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
	[symbol](that) {
		return isInterruptReason(that) && this.fiberId === that.fiberId && this.annotations === that.annotations;
	}
	[symbol$1]() {
		return combine(string$1(`${this._tag}:${this.fiberId}`))(random(this.annotations));
	}
};
/** @internal */
var causeInterrupt = (fiberId) => new CauseImpl([new Interrupt(fiberId)]);
/** @internal */
var findError$1 = (self) => {
	for (let i = 0; i < self.reasons.length; i++) {
		const reason = self.reasons[i];
		if (reason._tag === "Fail") return succeed$2(reason.error);
	}
	return fail$3(self);
};
/** @internal */
var hasInterrupts = (self) => self.reasons.some(isInterruptReason);
/** @internal */
var causeCombine = /*#__PURE__*/ dual(2, (self, that) => {
	if (self.reasons.length === 0) return that;
	else if (that.reasons.length === 0) return self;
	const newCause = new CauseImpl(union$2(self.reasons, that.reasons));
	return equals$2(self, newCause) ? self : newCause;
});
/** @internal */
var causePartition = (self) => {
	const obj = {
		Fail: [],
		Die: [],
		Interrupt: []
	};
	for (let i = 0; i < self.reasons.length; i++) obj[self.reasons[i]._tag].push(self.reasons[i]);
	return obj;
};
/** @internal */
var causeSquash = (self) => {
	const partitioned = causePartition(self);
	if (partitioned.Fail.length > 0) return partitioned.Fail[0].error;
	else if (partitioned.Die.length > 0) return partitioned.Die[0].defect;
	else if (partitioned.Interrupt.length > 0) return new globalThis.Error("All fibers interrupted without error");
	return new globalThis.Error("Empty cause");
};
/** @internal */
var FiberTypeId = `~effect/Fiber/dev`;
var fiberVariance = {
	_A: identity,
	_E: identity
};
var fiberIdStore = { id: 0 };
/** @internal */
var getCurrentFiber = () => globalThis[currentFiberTypeId];
/** @internal */
var FiberImpl = class {
	constructor(context, interruptible = true) {
		this[FiberTypeId] = fiberVariance;
		this.setContext(context);
		this.id = ++fiberIdStore.id;
		this.currentOpCount = 0;
		this.currentLoopCount = 0;
		this.interruptible = interruptible;
		this._stack = [];
		this._observers = [];
		this._exit = void 0;
		this._children = void 0;
		this._interruptedCause = void 0;
		this._yielded = void 0;
		this.runtimeMetrics?.recordFiberStart(this.context);
	}
	[FiberTypeId];
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
	getRef(ref) {
		return getReferenceUnsafe(this.context, ref);
	}
	addObserver(cb) {
		if (this._exit) {
			cb(this._exit);
			return constVoid;
		}
		this._observers.push(cb);
		return () => {
			const index = this._observers.indexOf(cb);
			if (index >= 0) this._observers.splice(index, 1);
		};
	}
	interruptUnsafe(fiberId, annotations) {
		if (this._exit) return;
		let cause = causeInterrupt(fiberId);
		if (this.currentStackFrame) cause = causeAnnotate(cause, make$13(StackTraceKey, this.currentStackFrame));
		if (annotations) cause = causeAnnotate(cause, annotations);
		this._interruptedCause = this._interruptedCause ? causeCombine(this._interruptedCause, cause) : cause;
		if (this.interruptible) this.evaluate(failCause(this._interruptedCause));
	}
	pollUnsafe() {
		return this._exit;
	}
	evaluate(effect) {
		if (this._exit) return;
		else if (this._yielded !== void 0) {
			const yielded = this._yielded;
			this._yielded = void 0;
			yielded();
		}
		const exit = this.runLoop(effect);
		if (exit === Yield) return;
		const interruptChildren = fiberMiddleware.interruptChildren && fiberMiddleware.interruptChildren(this);
		if (interruptChildren !== void 0) return this.evaluate(flatMap$1(interruptChildren, () => exit));
		this._exit = exit;
		this.runtimeMetrics?.recordFiberEnd(this.context, this._exit);
		for (let i = 0; i < this._observers.length; i++) this._observers[i](exit);
		this._observers.length = 0;
	}
	runLoop(effect) {
		const prevFiber = globalThis[currentFiberTypeId];
		globalThis[currentFiberTypeId] = this;
		let yielding = false;
		let current = effect;
		this.currentOpCount = 0;
		const currentLoop = ++this.currentLoopCount;
		try {
			while (true) {
				this.currentOpCount++;
				if (!yielding && !this.currentPreventYield && this.currentScheduler.shouldYield(this)) {
					yielding = true;
					const prev = current;
					current = flatMap$1(yieldNow, () => prev);
				}
				current = this.currentTracerContext ? this.currentTracerContext(current, this) : current[evaluate](this);
				if (currentLoop !== this.currentLoopCount) return Yield;
				else if (current === Yield) {
					const yielded = this._yielded;
					if (ExitTypeId in yielded) {
						this._yielded = void 0;
						return yielded;
					}
					return Yield;
				}
			}
		} catch (error) {
			if (!hasProperty(current, evaluate)) return exitDie(`Fiber.runLoop: Not a valid effect: ${String(current)}`);
			return this.runLoop(exitDie(error));
		} finally {
			globalThis[currentFiberTypeId] = prevFiber;
		}
	}
	getCont(symbol) {
		while (true) {
			const op = this._stack.pop();
			if (!op) return void 0;
			const cont = op[contAll] && op[contAll](this);
			if (cont) {
				cont[symbol] = cont;
				return cont;
			}
			if (op[symbol]) return op;
		}
	}
	yieldWith(value) {
		this._yielded = value;
		return Yield;
	}
	children() {
		return this._children ??= /* @__PURE__ */ new Set();
	}
	pipe() {
		return pipeArguments(this, arguments);
	}
	setContext(context) {
		this.context = context;
		const scheduler = this.getRef(Scheduler);
		if (scheduler !== this.currentScheduler) {
			this.currentScheduler = scheduler;
			this._dispatcher = void 0;
		}
		this.currentSpan = context.mapUnsafe.get(ParentSpanKey);
		this.currentLogLevel = this.getRef(CurrentLogLevel);
		this.minimumLogLevel = this.getRef(MinimumLogLevel);
		this.currentStackFrame = context.mapUnsafe.get(CurrentStackFrame.key);
		this.maxOpsBeforeYield = this.getRef(MaxOpsBeforeYield);
		this.currentPreventYield = this.getRef(PreventSchedulerYield);
		this.runtimeMetrics = context.mapUnsafe.get(FiberRuntimeMetricsKey);
		const currentTracer = context.mapUnsafe.get(TracerKey);
		this.currentTracerContext = currentTracer ? currentTracer["context"] : void 0;
	}
	get currentSpanLocal() {
		return this.currentSpan?._tag === "Span" ? this.currentSpan : void 0;
	}
};
var fiberMiddleware = { interruptChildren: void 0 };
var fiberStackAnnotations = (fiber) => {
	if (!fiber.currentStackFrame) return void 0;
	const annotations = /* @__PURE__ */ new Map();
	annotations.set(StackTraceKey.key, fiber.currentStackFrame);
	return makeUnsafe$4(annotations);
};
/** @internal */
var fiberAwait = (self) => {
	const impl = self;
	if (impl._exit) return succeed$1(impl._exit);
	return callback((resume) => {
		if (impl._exit) return resume(succeed$1(impl._exit));
		return sync$1(self.addObserver((exit) => resume(succeed$1(exit))));
	});
};
/** @internal */
var fiberAwaitAll = (self) => callback((resume) => {
	const iter = self[Symbol.iterator]();
	const exits = [];
	let cancel = void 0;
	function loop() {
		let result = iter.next();
		while (!result.done) {
			if (result.value._exit) {
				exits.push(result.value._exit);
				result = iter.next();
				continue;
			}
			cancel = result.value.addObserver((exit) => {
				exits.push(exit);
				loop();
			});
			return;
		}
		resume(succeed$1(exits));
	}
	loop();
	return sync$1(() => cancel?.());
});
/** @internal */
var fiberInterrupt = (self) => withFiber$1((fiber) => fiberInterruptAs(self, fiber.id));
/** @internal */
var fiberInterruptAs = /*#__PURE__*/ dual((args) => hasProperty(args[0], FiberTypeId), (self, fiberId, annotations) => withFiber$1((parent) => {
	let ann = fiberStackAnnotations(parent);
	ann = ann && annotations ? merge(ann, annotations) : ann ?? annotations;
	self.interruptUnsafe(fiberId, ann);
	return asVoid(fiberAwait(self));
}));
/** @internal */
var fiberInterruptAll = (fibers) => withFiber$1((parent) => {
	const annotations = fiberStackAnnotations(parent);
	for (const fiber of fibers) fiber.interruptUnsafe(parent.id, annotations);
	return asVoid(fiberAwaitAll(fibers));
});
/** @internal */
var succeed$1 = exitSucceed;
/** @internal */
var failCause = exitFailCause;
/** @internal */
var fail$2 = exitFail;
/** @internal */
var sync$1 = /*#__PURE__*/ makePrimitive({
	op: "Sync",
	[evaluate](fiber) {
		const value = this[args]();
		const cont = fiber.getCont(contA);
		return cont ? cont[contA](value, fiber) : fiber.yieldWith(exitSucceed(value));
	}
});
/** @internal */
var suspend$1 = /*#__PURE__*/ makePrimitive({
	op: "Suspend",
	[evaluate](_fiber) {
		return this[args]();
	}
});
/** @internal */
var yieldNow = /*#__PURE__*/ (/* @__PURE__ */ makePrimitive({
	op: "Yield",
	[evaluate](fiber) {
		let resumed = false;
		fiber.currentDispatcher.scheduleTask(() => {
			if (resumed) return;
			fiber.evaluate(exitVoid);
		}, this[args] ?? 0);
		return fiber.yieldWith(() => {
			resumed = true;
		});
	}
}))(0);
/** @internal */
var succeedSome$1 = (a) => succeed$1(some(a));
/** @internal */
var succeedNone$1 = /*#__PURE__*/ succeed$1(/*#__PURE__*/ none());
/** @internal */
var die$1 = (defect) => exitDie(defect);
/** @internal */
var failSync = (error) => suspend$1(() => fail$2(internalCall(error)));
/** @internal */
var void_$1 = /*#__PURE__*/ succeed$1(void 0);
/** @internal */
var tryPromise$1 = (options) => {
	const f = typeof options === "function" ? options : options.try;
	const catcher = typeof options === "function" ? (cause) => new UnknownError(cause, "An error occurred in Effect.tryPromise") : options.catch;
	return callbackOptions(function(resume, signal) {
		try {
			internalCall(() => f(signal)).then((a) => resume(succeed$1(a)), (e) => resume(fail$2(internalCall(() => catcher(e)))));
		} catch (err) {
			resume(fail$2(internalCall(() => catcher(err))));
		}
	}, eval.length !== 0);
};
var callbackOptions = /*#__PURE__*/ makePrimitive({
	op: "Async",
	single: false,
	[evaluate](fiber) {
		const register = internalCall(() => this[args][0].bind(fiber.currentScheduler));
		let resumed = false;
		let yielded = false;
		const controller = this[args][1] ? new AbortController() : void 0;
		const onCancel = register((effect) => {
			if (resumed) return;
			resumed = true;
			if (yielded) fiber.evaluate(effect);
			else yielded = effect;
		}, controller?.signal);
		if (yielded !== false) return yielded;
		yielded = true;
		fiber._yielded = () => {
			resumed = true;
		};
		if (controller === void 0 && onCancel === void 0) return Yield;
		fiber._stack.push(asyncFinalizer(() => {
			resumed = true;
			controller?.abort();
			return onCancel ?? exitVoid;
		}));
		return Yield;
	}
});
var asyncFinalizer = /*#__PURE__*/ makePrimitive({
	op: "AsyncFinalizer",
	[contAll](fiber) {
		if (fiber.interruptible) {
			fiber.interruptible = false;
			fiber._stack.push(setInterruptibleTrue);
		}
	},
	[contE](cause, _fiber) {
		return hasInterrupts(cause) ? flatMap$1(this[args](), () => failCause(cause)) : failCause(cause);
	}
});
/** @internal */
var callback = (register) => callbackOptions(register, register.length >= 2);
/** @internal */
var gen$1 = (...args) => suspend$1(() => fromIteratorUnsafe(args.length === 1 ? args[0]() : args[1].call(args[0].self)));
/** @internal */
var fnUntraced = (body, ...pipeables) => {
	const fn = pipeables.length === 0 ? function() {
		return suspend$1(() => fromIteratorUnsafe(body.apply(this, arguments)));
	} : function() {
		let effect = suspend$1(() => fromIteratorUnsafe(body.apply(this, arguments)));
		for (let i = 0; i < pipeables.length; i++) effect = pipeables[i](effect, ...arguments);
		return effect;
	};
	return defineFunctionLength(body.length, fn);
};
var defineFunctionLength = (length, fn) => Object.defineProperty(fn, "length", {
	value: length,
	configurable: true
});
var fnStackCleaner = /*#__PURE__*/ makeStackCleaner(2);
/** @internal */
var fn$1 = function() {
	const nameFirst = typeof arguments[0] === "string";
	const name = nameFirst ? arguments[0] : "Effect.fn";
	const spanOptions = nameFirst ? arguments[1] : void 0;
	const prevLimit = globalThis.Error.stackTraceLimit;
	globalThis.Error.stackTraceLimit = 2;
	const defError = new globalThis.Error();
	globalThis.Error.stackTraceLimit = prevLimit;
	if (nameFirst) return (body, ...pipeables) => makeFn(name, body, defError, pipeables, nameFirst, spanOptions);
	return makeFn(name, arguments[0], defError, Array.prototype.slice.call(arguments, 1), nameFirst, spanOptions);
};
var makeFn = (name, bodyOrOptions, defError, pipeables, addSpan, spanOptions) => {
	const body = typeof bodyOrOptions === "function" ? bodyOrOptions : pipeables.pop().bind(bodyOrOptions.self);
	return defineFunctionLength(body.length, function(...args) {
		let result = suspend$1(() => {
			const iter = body.apply(this, arguments);
			return isEffect(iter) ? iter : fromIteratorUnsafe(iter);
		});
		for (let i = 0; i < pipeables.length; i++) result = pipeables[i](result, ...args);
		if (!isEffect(result)) return result;
		const prevLimit = globalThis.Error.stackTraceLimit;
		globalThis.Error.stackTraceLimit = 2;
		const callError = new globalThis.Error();
		globalThis.Error.stackTraceLimit = prevLimit;
		return updateService(addSpan ? useSpan(name, spanOptions, (span) => provideParentSpan(result, span)) : result, CurrentStackFrame, (prev) => ({
			name,
			stack: fnStackCleaner(() => callError.stack),
			parent: {
				name: `${name} (definition)`,
				stack: fnStackCleaner(() => defError.stack),
				parent: prev
			}
		}));
	});
};
/** @internal */
var fnUntracedEager$1 = (body, ...pipeables) => defineFunctionLength(body.length, pipeables.length === 0 ? function() {
	return fromIteratorEagerUnsafe(() => body.apply(this, arguments));
} : function() {
	let effect = fromIteratorEagerUnsafe(() => body.apply(this, arguments));
	for (const pipeable of pipeables) effect = pipeable(effect);
	return effect;
});
var fromIteratorEagerUnsafe = (evaluate) => {
	try {
		const iterator = evaluate();
		let value = void 0;
		while (true) {
			const state = iterator.next(value);
			if (state.done) return succeed$1(state.value);
			const primitive = state.value;
			if (primitive && primitive._tag === "Success") {
				value = primitive.value;
				continue;
			} else if (primitive && primitive._tag === "Failure") return state.value;
			else {
				let isFirstExecution = true;
				return suspend$1(() => {
					if (isFirstExecution) {
						isFirstExecution = false;
						return flatMap$1(state.value, (value) => fromIteratorUnsafe(iterator, value));
					} else return suspend$1(() => fromIteratorUnsafe(evaluate()));
				});
			}
		}
	} catch (error) {
		return die$1(error);
	}
};
var fromIteratorUnsafe = /*#__PURE__*/ makePrimitive({
	op: "Iterator",
	single: false,
	[contA](value, fiber) {
		const iter = this[args][0];
		while (true) {
			const state = iter.next(value);
			if (state.done) return succeed$1(state.value);
			if (!effectIsExit(state.value)) {
				fiber._stack.push(this);
				return state.value;
			} else if (state.value._tag === "Failure") return state.value;
			value = state.value.value;
		}
	},
	[evaluate](fiber) {
		return this[contA](this[args][1], fiber);
	}
});
/** @internal */
var as = /*#__PURE__*/ dual(2, (self, value) => {
	const b = succeed$1(value);
	return flatMap$1(self, (_) => b);
});
/** @internal */
var andThen = /*#__PURE__*/ dual(2, (self, f) => flatMap$1(self, (a) => isEffect(f) ? f : internalCall(() => f(a))));
/** @internal */
var tap$1 = /*#__PURE__*/ dual(2, (self, f) => flatMap$1(self, (a) => as(isEffect(f) ? f : internalCall(() => f(a)), a)));
/** @internal */
var asVoid = (self) => flatMap$1(self, (_) => exitVoid);
/** @internal */
var flatMap$1 = /*#__PURE__*/ dual(2, (self, f) => {
	const onSuccess = Object.create(OnSuccessProto);
	onSuccess[args] = self;
	onSuccess[contA] = f.length !== 1 ? (a) => f(a) : f;
	return onSuccess;
});
var OnSuccessProto = /*#__PURE__*/ makePrimitiveProto({
	op: "OnSuccess",
	[evaluate](fiber) {
		fiber._stack.push(this);
		return this[args];
	}
});
/** @internal */
var effectIsExit = (effect) => ExitTypeId in effect;
/** @internal */
var flatMapEager$1 = /*#__PURE__*/ dual(2, (self, f) => {
	if (effectIsExit(self)) return self._tag === "Success" ? f(self.value) : self;
	return flatMap$1(self, f);
});
/** @internal */
var flatten$1 = (self) => flatMap$1(self, identity);
/** @internal */
var map$1 = /*#__PURE__*/ dual(2, (self, f) => flatMap$1(self, (a) => succeed$1(internalCall(() => f(a)))));
/** @internal */
var mapEager$1 = /*#__PURE__*/ dual(2, (self, f) => effectIsExit(self) ? exitMap(self, f) : map$1(self, f));
/** @internal */
var mapErrorEager$1 = /*#__PURE__*/ dual(2, (self, f) => effectIsExit(self) ? exitMapError(self, f) : mapError(self, f));
/** @internal */
var catchEager$1 = /*#__PURE__*/ dual(2, (self, f) => {
	if (effectIsExit(self)) {
		if (self._tag === "Success") return self;
		const error = findError$1(self.cause);
		if (isFailure(error)) return self;
		return f(error.success);
	}
	return catch_(self, f);
});
/** @internal */
var exitIsSuccess = (self) => self._tag === "Success";
/** @internal */
var exitVoid = /*#__PURE__*/ exitSucceed(void 0);
/** @internal */
var exitMap = /*#__PURE__*/ dual(2, (self, f) => self._tag === "Success" ? exitSucceed(f(self.value)) : self);
/** @internal */
var exitMapError = /*#__PURE__*/ dual(2, (self, f) => {
	if (self._tag === "Success") return self;
	const error = findError$1(self.cause);
	if (isFailure(error)) return self;
	return exitFail(f(error.success));
});
/** @internal */
var exitAsVoidAll = (exits) => {
	const failures = [];
	for (const exit of exits) if (exit._tag === "Failure") failures.push(...exit.cause.reasons);
	return failures.length === 0 ? exitVoid : exitFailCause(causeFromReasons(failures));
};
/** @internal */
var exitGetSuccess = (self) => exitIsSuccess(self) ? some(self.value) : none();
/** @internal */
var updateContext = /*#__PURE__*/ dual(2, (self, f) => withFiber$1((fiber) => {
	const prevContext = fiber.context;
	const nextContext = f(prevContext);
	if (prevContext === nextContext) return self;
	fiber.setContext(nextContext);
	return onExitPrimitive(self, () => {
		fiber.setContext(prevContext);
	});
}));
/** @internal */
var updateService = /*#__PURE__*/ dual(3, (self, service, f) => updateContext(self, (s) => {
	const prev = getUnsafe(s, service);
	const next = f(prev);
	if (prev === next) return s;
	return add(s, service, next);
}));
/** @internal */
var contextWith = (f) => withFiber$1((fiber) => f(fiber.context));
/** @internal */
var provideContext$1 = /*#__PURE__*/ dual(2, (self, context) => {
	if (effectIsExit(self)) return self;
	return updateContext(self, merge(context));
});
/** @internal */
var provideService = function() {
	if (arguments.length === 1) return dual(2, (self, impl) => provideServiceImpl(self, arguments[0], impl));
	return dual(3, (self, service, impl) => provideServiceImpl(self, service, impl)).apply(this, arguments);
};
var provideServiceImpl = (self, service, implementation) => updateContext(self, (s) => {
	if (s.mapUnsafe.get(service.key) === implementation) return s;
	return add(s, service, implementation);
});
/** @internal */
var catchCause = /*#__PURE__*/ dual(2, (self, f) => {
	const onFailure = Object.create(OnFailureProto);
	onFailure[args] = self;
	onFailure[contE] = f.length !== 1 ? (cause) => f(cause) : f;
	return onFailure;
});
var OnFailureProto = /*#__PURE__*/ makePrimitiveProto({
	op: "OnFailure",
	[evaluate](fiber) {
		fiber._stack.push(this);
		return this[args];
	}
});
/** @internal */
var catchCauseFilter = /*#__PURE__*/ dual(3, (self, filter, f) => catchCause(self, (cause) => {
	const eb = filter(cause);
	return isFailure(eb) ? failCause(eb.failure) : internalCall(() => f(eb.success, cause));
}));
/** @internal */
var catch_ = /*#__PURE__*/ dual(2, (self, f) => catchCauseFilter(self, findError$1, (e) => f(e)));
/** @internal */
var mapError = /*#__PURE__*/ dual(2, (self, f) => catch_(self, (error) => failSync(() => f(error))));
/** @internal */
var orDie$1 = (self) => catch_(self, die$1);
/** @internal */
var result$1 = (self) => matchEager(self, {
	onFailure: fail$3,
	onSuccess: succeed$2
});
/** @internal */
var matchCauseEffect = /*#__PURE__*/ dual(2, (self, options) => {
	const primitive = Object.create(OnSuccessAndFailureProto);
	primitive[args] = self;
	primitive[contA] = options.onSuccess.length !== 1 ? (a) => options.onSuccess(a) : options.onSuccess;
	primitive[contE] = options.onFailure.length !== 1 ? (cause) => options.onFailure(cause) : options.onFailure;
	return primitive;
});
var OnSuccessAndFailureProto = /*#__PURE__*/ makePrimitiveProto({
	op: "OnSuccessAndFailure",
	[evaluate](fiber) {
		fiber._stack.push(this);
		return this[args];
	}
});
/** @internal */
var matchEffect = /*#__PURE__*/ dual(2, (self, options) => matchCauseEffect(self, {
	onFailure: (cause) => {
		const fail = cause.reasons.find(isFailReason);
		return fail ? internalCall(() => options.onFailure(fail.error)) : failCause(cause);
	},
	onSuccess: options.onSuccess
}));
/** @internal */
var match = /*#__PURE__*/ dual(2, (self, options) => matchEffect(self, {
	onFailure: (error) => sync$1(() => options.onFailure(error)),
	onSuccess: (value) => sync$1(() => options.onSuccess(value))
}));
/** @internal */
var matchEager = /*#__PURE__*/ dual(2, (self, options) => {
	if (effectIsExit(self)) {
		if (self._tag === "Success") return exitSucceed(options.onSuccess(self.value));
		const error = findError$1(self.cause);
		if (isFailure(error)) return self;
		return exitSucceed(options.onFailure(error.success));
	}
	return match(self, options);
});
/** @internal */
var exit$1 = (self) => effectIsExit(self) ? exitSucceed(self) : exitPrimitive(self);
var exitPrimitive = /*#__PURE__*/ makePrimitive({
	op: "Exit",
	[evaluate](fiber) {
		fiber._stack.push(this);
		return this[args];
	},
	[contA](value, _, exit) {
		return succeed$1(exit ?? exitSucceed(value));
	},
	[contE](cause, _, exit) {
		return succeed$1(exit ?? exitFailCause(cause));
	}
});
/** @internal */
var ScopeTypeId = "~effect/Scope";
/** @internal */
var ScopeCloseableTypeId = "~effect/Scope/Closeable";
/** @internal */
var scopeTag = /*#__PURE__*/ Service("effect/Scope");
/** @internal */
var scopeClose = (self, exit_) => suspend$1(() => scopeCloseUnsafe(self, exit_) ?? void_$1);
/** @internal */
var scopeCloseUnsafe = (self, exit_) => {
	if (self.state._tag === "Closed") return;
	const closed = {
		_tag: "Closed",
		exit: exit_
	};
	if (self.state._tag === "Empty") {
		self.state = closed;
		return;
	}
	const { finalizers } = self.state;
	self.state = closed;
	if (finalizers.size === 0) return;
	else if (finalizers.size === 1) return finalizers.values().next().value(exit_);
	return scopeCloseFinalizers(self, finalizers, exit_);
};
var scopeCloseFinalizers = /*#__PURE__*/ fnUntraced(function* (self, finalizers, exit_) {
	let exits = [];
	const fibers = [];
	const arr = Array.from(finalizers.values());
	const parent = getCurrentFiber();
	for (let i = arr.length - 1; i >= 0; i--) {
		const finalizer = arr[i];
		if (self.strategy === "sequential") exits.push(yield* exit$1(finalizer(exit_)));
		else fibers.push(forkUnsafe$1(parent, finalizer(exit_), true, true, "inherit"));
	}
	if (fibers.length > 0) exits = yield* fiberAwaitAll(fibers);
	return yield* exitAsVoidAll(exits);
});
/** @internal */
var scopeForkUnsafe = (scope, finalizerStrategy) => {
	const newScope = scopeMakeUnsafe(finalizerStrategy);
	if (scope.state._tag === "Closed") {
		newScope.state = scope.state;
		return newScope;
	}
	const key = {};
	scopeAddFinalizerUnsafe(scope, key, (exit) => scopeClose(newScope, exit));
	scopeAddFinalizerUnsafe(newScope, key, (_) => sync$1(() => scopeRemoveFinalizerUnsafe(scope, key)));
	return newScope;
};
/** @internal */
var scopeAddFinalizerExit = (scope, finalizer) => {
	return suspend$1(() => {
		if (scope.state._tag === "Closed") return finalizer(scope.state.exit);
		scopeAddFinalizerUnsafe(scope, {}, finalizer);
		return void_$1;
	});
};
/** @internal */
var scopeAddFinalizerUnsafe = (scope, key, finalizer) => {
	if (scope.state._tag === "Empty") scope.state = {
		_tag: "Open",
		finalizers: /* @__PURE__ */ new Map([[key, finalizer]])
	};
	else if (scope.state._tag === "Open") scope.state.finalizers.set(key, finalizer);
};
/** @internal */
var scopeRemoveFinalizerUnsafe = (scope, key) => {
	if (scope.state._tag === "Open") scope.state.finalizers.delete(key);
};
/** @internal */
var scopeMakeUnsafe = (finalizerStrategy = "sequential") => ({
	[ScopeCloseableTypeId]: ScopeCloseableTypeId,
	[ScopeTypeId]: ScopeTypeId,
	strategy: finalizerStrategy,
	state: constScopeEmpty
});
var constScopeEmpty = { _tag: "Empty" };
/** @internal */
var scope = scopeTag;
/** @internal */
var provideScope = /*#__PURE__*/ provideService(scopeTag);
/** @internal */
var addFinalizer$1 = (finalizer) => flatMap$1(scope, (scope) => contextWith((context) => scopeAddFinalizerExit(scope, (exit) => provideContext$1(finalizer(exit), context))));
/** @internal */
var onExitPrimitive = /*#__PURE__*/ makePrimitive({
	op: "OnExit",
	single: false,
	[evaluate](fiber) {
		fiber._stack.push(this);
		return this[args][0];
	},
	[contAll](fiber) {
		if (fiber.interruptible && this[args][2] !== true) {
			fiber._stack.push(setInterruptibleTrue);
			fiber.interruptible = false;
		}
	},
	[contA](value, _, exit) {
		exit ??= exitSucceed(value);
		const eff = this[args][1](exit);
		return eff ? flatMap$1(eff, (_) => exit) : exit;
	},
	[contE](cause, _, exit) {
		exit ??= exitFailCause(cause);
		const eff = this[args][1](exit);
		return eff ? flatMap$1(eff, (_) => exit) : exit;
	}
});
/** @internal */
var onExit = /*#__PURE__*/ dual(2, onExitPrimitive);
var setInterruptibleTrue = /*#__PURE__*/ (/* @__PURE__ */ makePrimitive({
	op: "SetInterruptible",
	[contAll](fiber) {
		fiber.interruptible = this[args];
		if (fiber._interruptedCause && fiber.interruptible) return () => failCause(fiber._interruptedCause);
	}
}))(true);
var iterateEagerImpl = (options) => {
	const onItem = options.onItem;
	const step = options.step;
	return (state, items, opts) => {
		let index = opts?.start ?? 0;
		const end = opts?.end ?? items.length;
		const concurrency = opts?.concurrency ?? 1;
		let done = false;
		let parentFiber;
		let fibers;
		let resume;
		let interrupted = false;
		let terminal;
		let effect;
		const go = () => {
			let paused = false;
			for (; !terminal && index < end; index++) {
				const item = items[index];
				const eff = effect ?? onItem(state, item, index);
				if (effectIsExit(eff)) {
					terminal = step(state, item, eff, index);
					if (terminal) break;
				} else if (concurrency === 1) return flatMap$1(exit$1(eff), (exit) => {
					terminal = step(state, item, exit, index);
					index++;
					return terminal ?? go() ?? void_$1;
				});
				else if (!parentFiber) return callback((cb) => {
					parentFiber = getCurrentFiber();
					effect = eff;
					resume = cb;
					const result = go();
					if (result) return cb(result);
					return suspend$1(() => {
						terminal = exitVoid;
						interrupted = true;
						return fibers ? fiberInterruptAll(fibers) : void_$1;
					});
				});
				else {
					effect = void 0;
					const fiber = forkUnsafe$1(parentFiber, eff, true, true, "inherit");
					if (fiber._exit) {
						terminal = step(state, item, fiber._exit, index);
						if (terminal) break;
						continue;
					}
					if (fibers) fibers.add(fiber);
					else fibers = /* @__PURE__ */ new Set([fiber]);
					const currentIndex = index;
					fiber.addObserver((exit) => {
						fibers.delete(fiber);
						if (terminal) {
							if (!interrupted && exit._tag === "Failure") for (const reason of exit.cause.reasons) if (reason._tag === "Interrupt") continue;
							else if (terminal._tag === "Failure") terminal.cause.reasons.push(reason);
							else terminal = exitFailCause(causeFromReasons([reason]));
						} else {
							const result = step(state, item, exit, currentIndex);
							if (result) {
								terminal = result._tag === "Failure" ? exitFailCause(causeFromReasons(result.cause.reasons.slice())) : result;
								go();
							}
						}
						if (paused) {
							const eff = go();
							if (eff) resume(eff);
						} else if (done && fibers.size === 0) resume(terminal ?? void_$1);
					});
					if (fibers.size < concurrency) continue;
					paused = true;
					index++;
					return;
				}
			}
			done = true;
			if (terminal) {
				if (fibers && fibers.size > 0) {
					const annotations = fiberStackAnnotations(parentFiber);
					fibers.forEach((f) => f.interruptUnsafe(parentFiber.id, annotations));
					return;
				}
				if (resume || terminal._tag === "Failure") return terminal;
			} else if (resume) {
				if (!fibers) return exitVoid;
				else if (fibers.size === 0) resume(void_$1);
			}
		};
		return go();
	};
};
/** @internal */
var iterateEager = () => iterateEagerImpl;
/** @internal */
var forkUnsafe$1 = (parent, effect, immediate = false, daemon = false, uninterruptible = false) => {
	const interruptible = uninterruptible === "inherit" ? parent.interruptible : !uninterruptible;
	const child = new FiberImpl(parent.context, interruptible);
	if (immediate) child.evaluate(effect);
	else parent.currentDispatcher.scheduleTask(() => child.evaluate(effect), 0);
	if (!daemon && !child._exit) {
		parent.children().add(child);
		child.addObserver(() => parent._children.delete(child));
	}
	return child;
};
/** @internal */
var runForkWith$1 = (context) => (effect, options) => {
	const fiber = new FiberImpl(options?.scheduler ? add(context, Scheduler, options.scheduler) : context, options?.uninterruptible !== true);
	fiber.evaluate(effect);
	if (fiber._exit) return fiber;
	if (options?.signal) if (options.signal.aborted) fiber.interruptUnsafe();
	else {
		const abort = () => fiber.interruptUnsafe();
		options.signal.addEventListener("abort", abort, { once: true });
		fiber.addObserver(() => options.signal.removeEventListener("abort", abort));
	}
	if (options?.onFiberStart) options.onFiberStart(fiber);
	return fiber;
};
/** @internal */
var fiberRunIn = /*#__PURE__*/ dual(2, (self, scope) => {
	if (self._exit) return self;
	else if (scope.state._tag === "Closed") {
		self.interruptUnsafe(self.id);
		return self;
	}
	const key = {};
	scopeAddFinalizerUnsafe(scope, key, () => fiberInterrupt(self));
	self.addObserver(() => scopeRemoveFinalizerUnsafe(scope, key));
	return self;
});
/** @internal */
var runFork$1 = /*#__PURE__*/ runForkWith$1(/*#__PURE__*/ empty());
/** @internal */
var runCallbackWith$1 = (context) => {
	const runFork = runForkWith$1(context);
	return (effect, options) => {
		const fiber = runFork(effect, options);
		if (options?.onExit) fiber.addObserver(options.onExit);
		return (interruptor) => {
			return fiber.interruptUnsafe(interruptor);
		};
	};
};
/** @internal */
var runCallback$1 = /*#__PURE__*/ runCallbackWith$1(/*#__PURE__*/ empty());
/** @internal */
var runPromiseExitWith$1 = (context) => {
	const runFork = runForkWith$1(context);
	return (effect, options) => {
		const fiber = runFork(effect, options);
		return new Promise((resolve) => {
			fiber.addObserver((exit) => resolve(exit));
		});
	};
};
/** @internal */
var runPromiseExit$1 = /*#__PURE__*/ runPromiseExitWith$1(/*#__PURE__*/ empty());
/** @internal */
var runPromiseWith$1 = (context) => {
	const runPromiseExit = runPromiseExitWith$1(context);
	return (effect, options) => runPromiseExit(effect, options).then((exit) => {
		if (exit._tag === "Failure") throw causeSquash(exit.cause);
		return exit.value;
	});
};
/** @internal */
var runPromise$1 = /*#__PURE__*/ runPromiseWith$1(/*#__PURE__*/ empty());
/** @internal */
var runSyncExitWith$1 = (context) => {
	const runFork = runForkWith$1(context);
	return (effect) => {
		if (effectIsExit(effect)) return effect;
		const scheduler = new MixedScheduler("sync");
		const fiber = runFork(effect, { scheduler });
		fiber.currentDispatcher?.flush();
		return fiber._exit ?? exitDie(new AsyncFiberError(fiber));
	};
};
/** @internal */
var runSyncExit$1 = /*#__PURE__*/ runSyncExitWith$1(/*#__PURE__*/ empty());
/** @internal */
var runSyncWith$1 = (context) => {
	const runSyncExit = runSyncExitWith$1(context);
	return (effect) => {
		const exit = runSyncExit(effect);
		if (exit._tag === "Failure") throw causeSquash(exit.cause);
		return exit.value;
	};
};
/** @internal */
var runSync$1 = /*#__PURE__*/ runSyncWith$1(/*#__PURE__*/ empty());
var bigint0 = /*#__PURE__*/ BigInt(0);
var NoopSpanProto = {
	_tag: "Span",
	spanId: "noop",
	traceId: "noop",
	sampled: false,
	status: {
		_tag: "Ended",
		startTime: bigint0,
		endTime: bigint0,
		exit: exitVoid
	},
	attributes: /*#__PURE__*/ new Map(),
	links: [],
	kind: "internal",
	attribute() {},
	event() {},
	end() {},
	addLinks() {}
};
/** @internal */
var noopSpan = (options) => Object.assign(Object.create(NoopSpanProto), options);
var filterDisablePropagation = (span) => {
	if (!span) return none();
	return get$1(span.annotations, DisablePropagation) ? span._tag === "Span" ? filterDisablePropagation(getOrUndefined(span.parent)) : none() : some(span);
};
/** @internal */
var makeSpanUnsafe = (fiber, name, options) => {
	const disablePropagation = !fiber.getRef(TracerEnabled) || options?.annotations && get$1(options.annotations, DisablePropagation);
	const parent = options?.parent !== void 0 ? some(options.parent) : options?.root ? none() : filterDisablePropagation(fiber.currentSpan);
	let span;
	if (disablePropagation) span = noopSpan({
		name,
		parent,
		annotations: add(options?.annotations ?? empty(), DisablePropagation, true)
	});
	else {
		const tracer = fiber.getRef(Tracer);
		const clock = fiber.getRef(ClockRef);
		const timingEnabled = fiber.getRef(TracerTimingEnabled);
		const annotationsFromEnv = fiber.getRef(TracerSpanAnnotations);
		const linksFromEnv = fiber.getRef(TracerSpanLinks);
		const level = options?.level ?? fiber.getRef(CurrentTraceLevel);
		const links = options?.links !== void 0 ? [...linksFromEnv, ...options.links] : linksFromEnv.slice();
		span = tracer.span({
			name,
			parent,
			annotations: options?.annotations ?? empty(),
			links,
			startTime: timingEnabled ? clock.currentTimeNanosUnsafe() : BigInt(0),
			kind: options?.kind ?? "internal",
			root: options?.root ?? isNone(parent),
			sampled: options?.sampled ?? (isSome(parent) && parent.value.sampled === false ? false : !isLogLevelGreaterThan(fiber.getRef(MinimumTraceLevel), level))
		});
		for (const [key, value] of Object.entries(annotationsFromEnv)) span.attribute(key, value);
		if (options?.attributes !== void 0) for (const [key, value] of Object.entries(options.attributes)) span.attribute(key, value);
	}
	return span;
};
/** @internal */
var useSpan = (name, ...args) => {
	const options = args.length === 1 ? void 0 : args[0];
	const evaluate = args[args.length - 1];
	return withFiber$1((fiber) => {
		const span = makeSpanUnsafe(fiber, name, options);
		const clock = fiber.getRef(ClockRef);
		return onExit(internalCall(() => evaluate(span)), (exit) => sync$1(() => {
			if (span.status._tag === "Ended") return;
			span.end(clock.currentTimeNanosUnsafe(), exit);
		}));
	});
};
var provideParentSpan = /*#__PURE__*/ provideService(ParentSpan);
/** @internal */
var ClockRef = /*#__PURE__*/ Reference("effect/Clock", { defaultValue: () => new ClockImpl() });
var MAX_TIMER_MILLIS = 2 ** 31 - 1;
var ClockImpl = class {
	currentTimeMillisUnsafe() {
		return Date.now();
	}
	currentTimeMillis = /*#__PURE__*/ sync$1(() => this.currentTimeMillisUnsafe());
	currentTimeNanosUnsafe() {
		return processOrPerformanceNow();
	}
	currentTimeNanos = /*#__PURE__*/ sync$1(() => this.currentTimeNanosUnsafe());
	sleep(duration) {
		const millis = toMillis(duration);
		if (millis <= 0) return yieldNow;
		return callback((resume) => {
			if (millis > MAX_TIMER_MILLIS) return;
			const handle = setTimeout(() => resume(void_$1), millis);
			return sync$1(() => clearTimeout(handle));
		});
	}
};
var performanceNowNanos = /*#__PURE__*/ function() {
	const bigint1e6 = /*#__PURE__*/ BigInt(1e6);
	if (typeof performance === "undefined" || typeof performance.now === "undefined") return () => BigInt(Date.now()) * bigint1e6;
	else if (typeof performance.timeOrigin === "number" && performance.timeOrigin === 0) return () => BigInt(Math.round(performance.now() * 1e6));
	const origin = /*#__PURE__*/ BigInt(/*#__PURE__*/ Date.now()) * bigint1e6 - /*#__PURE__*/ BigInt(/*#__PURE__*/ Math.round(/*#__PURE__*/ performance.now() * 1e6));
	return () => origin + BigInt(Math.round(performance.now() * 1e6));
}();
var processOrPerformanceNow = /*#__PURE__*/ function() {
	const processHrtime = typeof process === "object" && "hrtime" in process && typeof process.hrtime.bigint === "function" ? process.hrtime : void 0;
	if (!processHrtime) return performanceNowNanos;
	const origin = /*#__PURE__*/ performanceNowNanos() - /*#__PURE__*/ processHrtime.bigint();
	return () => origin + processHrtime.bigint();
}();
TaggedError$1("TimeoutError");
TaggedError$1("IllegalArgumentError");
TaggedError$1("ExceededCapacityError");
/** @internal */
var AsyncFiberErrorTypeId = "~effect/Cause/AsyncFiberError";
/** @internal */
var AsyncFiberError = class extends TaggedError$1("AsyncFiberError") {
	[AsyncFiberErrorTypeId] = AsyncFiberErrorTypeId;
	constructor(fiber) {
		super({
			message: "An asynchronous Effect was executed with Effect.runSync",
			fiber
		});
	}
};
/** @internal */
var UnknownErrorTypeId = "~effect/Cause/UnknownError";
/** @internal */
var UnknownError = class extends TaggedError$1("UnknownError") {
	[UnknownErrorTypeId] = UnknownErrorTypeId;
	constructor(cause, message) {
		super({
			message,
			cause
		});
	}
};
/** @internal */
var logLevelToOrder = (level) => {
	switch (level) {
		case "All": return Number.MIN_SAFE_INTEGER;
		case "Fatal": return 5e4;
		case "Error": return 4e4;
		case "Warn": return 3e4;
		case "Info": return 2e4;
		case "Debug": return 1e4;
		case "Trace": return 0;
		case "None": return Number.MAX_SAFE_INTEGER;
	}
};
/** @internal */
var isLogLevelGreaterThan = /*#__PURE__*/ isGreaterThan$1(/* @__PURE__ */ mapInput(Number$4, logLevelToOrder));
var colors = {
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
colors.gray, colors.blue, colors.green, colors.yellow, colors.red, colors.bgBrightRed, colors.black;
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Cause.js
/**
* Records the full reason an `Effect` failed.
*
* A `Cause<E>` can contain typed failures, unexpected defects, interruptions,
* and annotations. Keeping those details together lets code inspect or format
* failures without first collapsing them to a single error value. This module
* includes the `Cause` and `Reason` data types, helpers for building and
* checking causes, and small error types used by several Effect APIs.
*
* @since 2.0.0
*/
/**
* Returns a `Result` whose success value is the first typed error value `E`
* from a `Fail` reason in the cause. If the cause has no `Fail` reason,
* the failure value is the original cause narrowed to `Cause<never>`, because
* it contains no typed error reasons.
*
* **When to use**
*
* Use when you need the first typed error value from a `Cause` as a `Result`
* that preserves the original cause when no match is found.
*
* **Example** (extracting the first error value)
*
* ```ts
* import { Cause, Result } from "effect"
*
* const result = Cause.findError(Cause.fail("error"))
* if (!Result.isFailure(result)) {
*   console.log(result.success) // "error"
* }
* ```
*
* @see {@link findFail} — extract the full `Fail` reason
* @see {@link findErrorOption} — `Option`-based variant
*
* @category filtering
* @since 4.0.0
*/
var findError = findError$1;
Service()("effect/Cause/StackTrace");
Service()("effect/Cause/InterruptorStackTrace");
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Exit.js
/**
* Creates a failed Exit from a typed error value.
*
* **When to use**
*
* Use when you need to represent an expected typed failure as an `Exit`.
*
* **Details**
*
* The error is wrapped in a `Cause.Fail` internally.
*
* Returns a `Failure<never, E>`.
*
* **Example** (Creating a failed Exit)
*
* ```ts
* import { Exit } from "effect"
*
* const exit = Exit.fail("Something went wrong")
* console.log(Exit.isFailure(exit)) // true
* ```
*
* @see {@link succeed} to create a successful Exit
* @see {@link die} to create a Failure from an unexpected defect
* @see {@link failCause} to create a Failure from a full Cause
*
* @category constructors
* @since 2.0.0
*/
var fail$1 = exitFail;
var void_ = exitVoid;
/**
* Returns the success value of an Exit as an Option.
*
* **When to use**
*
* Use when you need the success value from an `Exit` as an `Option` instead of
* pattern matching.
*
* **Details**
*
* Returns `Option.some(value)` for a Success and `Option.none()` for a Failure.
*
* **Example** (Getting the success value)
*
* ```ts
* import { Exit } from "effect"
*
* console.log(Exit.getSuccess(Exit.succeed(42))) // { _tag: "Some", value: 42 }
* console.log(Exit.getSuccess(Exit.fail("err"))) // { _tag: "None" }
* ```
*
* @see {@link getCause} to extract the Cause of a failure
* @see {@link filterValue} for filter-pipeline usage
*
* @category accessors
* @since 4.0.0
*/
var getSuccess = exitGetSuccess;
var DeferredProto = {
	["~effect/Deferred"]: {
		_A: identity,
		_E: identity
	},
	pipe() {
		return pipeArguments(this, arguments);
	}
};
/**
* Creates an empty `Deferred` synchronously outside the `Effect` runtime.
*
* **When to use**
*
* Use to allocate a `Deferred` synchronously when direct allocation outside
* `Effect` is required.
*
* **Example** (Creating a Deferred unsafely)
*
* ```ts
* import { Deferred } from "effect"
*
* const deferred = Deferred.makeUnsafe<number>()
* console.log(deferred)
* ```
*
* @category unsafe
* @since 4.0.0
*/
var makeUnsafe$3 = () => {
	const self = Object.create(DeferredProto);
	self.resumes = void 0;
	self.effect = void 0;
	return self;
};
var _await = (self) => callback((resume) => {
	if (self.effect) return resume(self.effect);
	self.resumes ??= [];
	self.resumes.push(resume);
	return sync$1(() => {
		const index = self.resumes.indexOf(resume);
		self.resumes.splice(index, 1);
	});
});
/**
* Completes the `Deferred` with the specified `Exit` value, which will be
* propagated to all fibers waiting on the value of the `Deferred`.
*
* **When to use**
*
* Use to complete a `Deferred` from an already computed `Exit`.
*
* **Details**
*
* The returned effect succeeds with `true` when this call completed the
* `Deferred`, or `false` if it was already completed.
*
* **Example** (Completing a Deferred with an Exit)
*
* ```ts
* import { Deferred, Effect, Exit } from "effect"
*
* const program = Effect.gen(function*() {
*   const deferred = yield* Deferred.make<number>()
*   yield* Deferred.done(deferred, Exit.succeed(42))
*
*   const value = yield* Deferred.await(deferred)
*   console.log(value) // 42
* })
* ```
*
* @see {@link complete} for completing from an effect and memoizing its result
* @see {@link completeWith} for storing an effect directly
* @see {@link succeed} for completing with a success value
* @see {@link failCause} for completing with a failure cause
*
* @category completion
* @since 2.0.0
*/
var done = /* @__PURE__ */ dual(2, (self, effect) => sync$1(() => doneUnsafe(self, effect)));
/**
* Attempts to complete the `Deferred` synchronously with the specified
* completion effect.
*
* **When to use**
*
* Use to complete a `Deferred` synchronously in low-level code that already has
* the completion effect.
*
* **Details**
*
* This mutates the `Deferred` directly and should be reserved for low-level
* code; prefer the effectful completion APIs when possible. Returns `true` if
* this call completed the `Deferred`, or `false` if it was already completed.
*
* **Example** (Completing a Deferred unsafely)
*
* ```ts
* import { Deferred, Effect } from "effect"
*
* const deferred = Deferred.makeUnsafe<number>()
* const success = Deferred.doneUnsafe(deferred, Effect.succeed(42))
* console.log(success) // true
* ```
*
* @category unsafe
* @since 4.0.0
*/
var doneUnsafe = (self, effect) => {
	if (self.effect) return false;
	self.effect = effect;
	if (self.resumes) {
		for (let i = 0; i < self.resumes.length; i++) self.resumes[i](effect);
		self.resumes = void 0;
	}
	return true;
};
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Scope.js
/**
* Controls how long resources stay open.
*
* A scope is a lifetime boundary. Code can register cleanup effects on it, and
* closing the scope runs those cleanups with the `Exit` value that ended the
* work. Most application code uses higher-level APIs such as `Effect.scoped`
* and `Layer`, while this module is useful when code needs to create, provide,
* fork, close, or inspect scopes directly.
*
* @since 2.0.0
*/
/**
* Creates a new `Scope` synchronously without wrapping it in an `Effect`.
* This is useful when you need a scope immediately but should be used with caution
* as it doesn't provide the same safety guarantees as the `Effect`-wrapped version.
*
* **When to use**
*
* Use when a scope must be allocated synchronously and the caller will close it
* manually.
*
* **Example** (Creating a scope synchronously)
*
* ```ts
* import { Console, Effect, Exit, Scope } from "effect"
*
* // Create a scope immediately
* const scope = Scope.makeUnsafe("sequential")
*
* // Use it in an Effect program
* const program = Effect.gen(function*() {
*   yield* Scope.addFinalizer(scope, Console.log("Cleanup"))
*   yield* Scope.close(scope, Exit.void)
* })
* ```
*
* @category constructors
* @since 4.0.0
*/
var makeUnsafe$2 = scopeMakeUnsafe;
/**
* Provides a concrete `Scope` to an effect.
*
* **When to use**
*
* Use to run an effect that requires `Scope` with a scope managed by the
* caller.
*
* **Details**
*
* Providing the scope removes the `Scope` requirement from the effect context.
*
* **Example** (Providing a scope)
*
* ```ts
* import { Console, Effect, Scope } from "effect"
*
* // An effect that requires a Scope
* const program = Effect.gen(function*() {
*   const scope = yield* Scope.Scope
*   yield* Scope.addFinalizer(scope, Console.log("Cleanup"))
*   yield* Console.log("Working...")
* })
*
* // Provide a scope to the program
* const withScope = Effect.gen(function*() {
*   const scope = yield* Scope.make()
*   yield* Scope.provide(scope)(program)
* })
* ```
*
* @category combinators
* @since 4.0.0
*/
var provide$1 = provideScope;
/**
* Creates a closeable child scope synchronously and registers it with a parent scope.
*
* **When to use**
*
* Use when a child scope must be created synchronously and the caller controls
* both parent and child scope lifetimes.
*
* **Details**
*
* Closing the parent closes the child with the same exit value, and closing the
* child detaches it from the parent. The optional finalizer strategy configures
* the child scope and defaults to `"sequential"` when omitted.
*
* **Example** (Creating a child scope synchronously)
*
* ```ts
* import { Console, Effect, Exit, Scope } from "effect"
*
* const program = Effect.gen(function*() {
*   const parentScope = Scope.makeUnsafe("sequential")
*   const childScope = Scope.forkUnsafe(parentScope, "parallel")
*
*   // Add finalizers to both scopes
*   yield* Scope.addFinalizer(parentScope, Console.log("Parent cleanup"))
*   yield* Scope.addFinalizer(childScope, Console.log("Child cleanup"))
*
*   // Close child first, then parent
*   yield* Scope.close(childScope, Exit.void)
*   yield* Scope.close(parentScope, Exit.void)
* })
* ```
*
* @category combinators
* @since 4.0.0
*/
var forkUnsafe = scopeForkUnsafe;
/**
* Closes a scope and runs its registered finalizers.
*
* **When to use**
*
* Use to close a scope manually with a specific exit value.
*
* **Details**
*
* Finalizers run in the scope's configured order and receive the supplied
* `Exit`.
*
* **Example** (Running scope finalizers)
*
* ```ts
* import { Console, Effect, Exit, Scope } from "effect"
*
* const resourceManagement = Effect.gen(function*() {
*   const scope = yield* Scope.make("sequential")
*
*   // Add multiple finalizers
*   yield* Scope.addFinalizer(scope, Console.log("Close database connection"))
*   yield* Scope.addFinalizer(scope, Console.log("Close file handle"))
*   yield* Scope.addFinalizer(scope, Console.log("Release memory"))
*
*   // Do some work...
*   yield* Console.log("Performing operations...")
*
*   // Close scope - finalizers run in reverse order of registration
*   yield* Scope.close(scope, Exit.succeed("Success!"))
*   // Output: "Release memory", "Close file handle", "Close database connection"
* })
* ```
*
* @category combinators
* @since 2.0.0
*/
var close = scopeClose;
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Layer.js
var TypeId$8 = "~effect/Layer";
var MemoMapTypeId = "~effect/Layer/MemoMap";
var memoMapReuse = (entry, scope) => {
	entry.observers++;
	return andThen(scopeAddFinalizerExit(scope, (exit) => entry.finalizer(exit)), entry.effect);
};
var LayerProto = {
	[TypeId$8]: {
		_ROut: identity,
		_E: identity,
		_RIn: identity
	},
	pipe() {
		return pipeArguments(this, arguments);
	}
};
var fromBuildUnsafe = (build) => {
	const self = Object.create(LayerProto);
	self.build = build;
	return self;
};
/**
* Constructs a `Layer` from a function that uses a `MemoMap` and `Scope` to
* build the layer.
*
* **Details**
*
* The function receives a `MemoMap` for memoization and a `Scope` for resource management.
* A child scope is created, and if the build fails, the child scope is closed.
*
* **Example** (Constructing a layer from a build function)
*
* ```ts
* import { Context, Effect, Layer } from "effect"
*
* class Database extends Context.Service<Database, {
*   readonly query: (sql: string) => Effect.Effect<string>
* }>()("Database") {}
*
* const databaseLayer = Layer.fromBuild(() =>
*   Effect.sync(() =>
*     Context.make(Database, {
*       query: (sql: string) => Effect.succeed("result")
*     })
*   )
* )
* ```
*
* @category constructors
* @since 4.0.0
*/
var fromBuild = (build) => fromBuildUnsafe((memoMap, scope) => {
	const layerScope = forkUnsafe(scope);
	return onExit(build(memoMap, layerScope), (exit) => exit._tag === "Failure" ? close(layerScope, exit) : void_$1);
});
/**
* Constructs a `Layer` from a function that uses a `MemoMap` and `Scope` to
* build the layer, with automatic memoization.
*
* **Details**
*
* This is similar to `fromBuild` but provides automatic memoization of the layer construction.
* The layer will be memoized based on the provided `MemoMap`.
*
* **Example** (Memoizing layer construction)
*
* ```ts
* import { Context, Effect, Layer } from "effect"
*
* class Database extends Context.Service<Database, {
*   readonly query: (sql: string) => Effect.Effect<string>
* }>()("Database") {}
*
* const databaseLayer = Layer.fromBuildMemo(() =>
*   Effect.sync(() =>
*     Context.make(Database, {
*       query: (sql: string) => Effect.succeed("result")
*     })
*   )
* )
* ```
*
* @category constructors
* @since 4.0.0
*/
var fromBuildMemo = (build) => {
	const self = fromBuild((memoMap, scope) => memoMap.getOrElseMemoize(self, scope, build));
	return self;
};
var memoMapBuild = (memoMap, layer, scope, build) => {
	const layerScope = makeUnsafe$2();
	const deferred = makeUnsafe$3();
	const entry = {
		observers: 1,
		effect: _await(deferred),
		finalizer: (exit) => suspend$1(() => {
			entry.observers--;
			if (entry.observers === 0) {
				memoMap.map.delete(layer);
				return close(layerScope, exit);
			}
			return void_$1;
		})
	};
	memoMap.map.set(layer, entry);
	return scopeAddFinalizerExit(scope, entry.finalizer).pipe(flatMap$1(() => build(memoMap, layerScope)), onExit((exit) => {
		entry.effect = exit;
		return done(deferred, exit);
	}));
};
var MemoMapImpl = class {
	get [MemoMapTypeId]() {
		return MemoMapTypeId;
	}
	parent;
	constructor(parent) {
		this.parent = parent;
	}
	map = /*#__PURE__*/ new Map();
	get(layer, scope) {
		const local = this.map.get(layer);
		if (local) return memoMapReuse(local, scope);
		return this.parent?.get(layer, scope);
	}
	getOrElseMemoize(layer, scope, build) {
		const existing = this.get(layer, scope);
		if (existing) return existing;
		return memoMapBuild(this, layer, scope, build);
	}
};
/**
* Constructs a `MemoMap` synchronously so it can be used to build additional layers.
*
* **Example** (Creating a memo map unsafely)
*
* ```ts
* import { Context, Effect, Layer } from "effect"
*
* class Database extends Context.Service<Database, {
*   readonly query: (sql: string) => Effect.Effect<string>
* }>()("Database") {}
*
* // Create a memo map for manual layer building
* const program = Effect.gen(function*() {
*   const memoMap = Layer.makeMemoMapUnsafe()
*   const scope = yield* Effect.scope
*
*   const dbLayer = Layer.succeed(Database, {
*     query: Effect.fn("Database.query")((sql: string) => Effect.succeed("result"))
*   })
*   const context = yield* Layer.buildWithMemoMap(dbLayer, memoMap, scope)
*
*   return Context.get(context, Database)
* })
* ```
*
* @category memo map
* @since 4.0.0
*/
var makeMemoMapUnsafe = () => new MemoMapImpl();
/**
* Context service for the current `MemoMap` used in layer construction.
*
* **When to use**
*
* Use when building custom layer operations that need to access the current
* memoization map from the fiber context.
*
* **Details**
*
* This service wraps a `MemoMap` as a `Context.Service`, making it available
* for dependency injection during layer construction.
*
* @see {@link MemoMap} the memoization map type wrapped by this service
*
* @category models
* @since 3.13.0
*/
var CurrentMemoMap = class extends Service()("effect/Layer/CurrentMemoMap") {
	static getOrCreate = /*#__PURE__*/ getOrElse(this, makeMemoMapUnsafe);
};
/**
* Builds a layer into an `Effect` value, using the specified `MemoMap` to memoize
* the layer construction.
*
* **Example** (Building layers with an explicit memo map)
*
* ```ts
* import { Context, Effect, Layer } from "effect"
*
* class Database extends Context.Service<Database, {
*   readonly query: (sql: string) => Effect.Effect<string>
* }>()("Database") {}
*
* class Logger extends Context.Service<Logger, {
*   readonly log: (msg: string) => Effect.Effect<void>
* }>()("Logger") {}
*
* // Build layers with explicit memoization control
* const program = Effect.gen(function*() {
*   const memoMap = yield* Layer.makeMemoMap
*   const scope = yield* Effect.scope
*
*   // Build database layer with memoization
*   const dbLayer = Layer.succeed(Database, {
*     query: Effect.fn("Database.query")((sql: string) => Effect.succeed("result"))
*   })
*   const dbContext = yield* Layer.buildWithMemoMap(dbLayer, memoMap, scope)
*
*   // Build logger layer with same memoization (reuses memo if same layer)
*   const loggerLayer = Layer.succeed(Logger, {
*     log: Effect.fn("Logger.log")((msg: string) => Effect.sync(() => console.log(msg)))
*   })
*   const loggerContext = yield* Layer.buildWithMemoMap(
*     loggerLayer,
*     memoMap,
*     scope
*   )
*
*   return {
*     database: Context.get(dbContext, Database),
*     logger: Context.get(loggerContext, Logger)
*   }
* })
* ```
*
* @category memo map
* @since 2.0.0
*/
var buildWithMemoMap = /*#__PURE__*/ dual(3, (self, memoMap, scope) => provideService(map$1(self.build(memoMap, scope), add(CurrentMemoMap, memoMap)), CurrentMemoMap, memoMap));
/**
* Constructs a layer from an effect that produces a single service.
*
* **When to use**
*
* Use when you need to construct a `Layer`-provided service with an `Effect`,
* dependencies, or scoped resource acquisition.
*
* **Details**
*
* This allows you to create a `Layer` from an `Effect` that produces a service.
* The `Effect` is executed in the scope of the layer, allowing for proper
* resource management.
*
* **Example** (Creating a layer from an effect)
*
* ```ts
* import { Context, Effect, Layer } from "effect"
*
* class Database extends Context.Service<Database, {
*   readonly query: (sql: string) => Effect.Effect<string>
* }>()("Database") {}
*
* const layer = Layer.effect(Database,
*   Effect.sync(() => ({
*     query: (sql: string) => Effect.succeed(`Query: ${sql}`)
*   }))
* )
* ```
*
* @see {@link effectContext} for effectfully providing multiple services
* @see {@link effectDiscard} for running construction work without providing services
*
* @category constructors
* @since 2.0.0
*/
var effect = function() {
	if (arguments.length === 1) return (effect) => effectImpl(arguments[0], effect);
	return effectImpl(arguments[0], arguments[1]);
};
var effectImpl = (service, effect) => effectContext(map$1(effect, (value) => make$13(service, value)));
/**
* Constructs a layer from an effect that produces all services in a `Context`.
*
* **When to use**
*
* Use when you need a `Layer` that effectfully constructs a `Context` with
* multiple services.
*
* **Details**
*
* This allows you to create a `Layer` from an effectful computation that
* returns multiple services. The `Effect` is executed in the scope of the
* layer.
*
* **Example** (Creating a layer from an effectful context)
*
* ```ts
* import { Context, Effect, Layer } from "effect"
*
* class Database extends Context.Service<
*   Database,
*   { readonly query: (sql: string) => Effect.Effect<string> }
* >()("Database") {}
*
* const layer = Layer.effectContext(
*   Effect.succeed(Context.make(Database, {
*     query: (sql: string) => Effect.succeed(`Query: ${sql}`)
*   }))
* )
* ```
*
* @see {@link effect} for effectfully providing a single service
*
* @category constructors
* @since 2.0.0
*/
var effectContext = (effect) => fromBuildMemo((_, scope) => provide$1(effect, scope));
/**
* Creates a tagged error class with a `_tag` discriminator.
*
* **When to use**
*
* Use when you need domain errors with discriminated-union handling.
*
* **Details**
*
* Like {@link Error}, but instances also carry a `readonly _tag` property,
* enabling `Effect.catchTag` and `Effect.catchTags` for tag-based recovery.
* The `_tag` is excluded from the constructor argument. Yielding an instance
* inside `Effect.gen` fails the effect with this error.
*
* **Example** (Tag-based error recovery)
*
* ```ts
* import { Data, Effect } from "effect"
*
* class NotFound extends Data.TaggedError("NotFound")<{
*   readonly resource: string
* }> {}
*
* class Forbidden extends Data.TaggedError("Forbidden")<{
*   readonly reason: string
* }> {}
*
* const program = Effect.gen(function*() {
*   return yield* new NotFound({ resource: "/users/42" })
* })
*
* const recovered = program.pipe(
*   Effect.catchTag("NotFound", (e) =>
*     Effect.succeed(`missing: ${e.resource}`))
* )
* ```
*
* @see {@link Error} — without a `_tag`
* @see {@link TaggedClass} — tagged class that is not an error
*
* @category constructors
* @since 2.0.0
*/
var TaggedError = TaggedError$1;
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/dateTime.js
/** @internal */
var TypeId$7 = "~effect/time/DateTime";
/** @internal */
var TimeZoneTypeId = "~effect/time/DateTime/TimeZone";
var Proto = {
	[TypeId$7]: TypeId$7,
	pipe() {
		return pipeArguments(this, arguments);
	},
	[NodeInspectSymbol]() {
		return this.toString();
	},
	toJSON() {
		return toDateUtc$1(this).toJSON();
	}
};
({ ...Proto });
({ ...Proto });
var ProtoTimeZone = {
	[TimeZoneTypeId]: TimeZoneTypeId,
	[NodeInspectSymbol]() {
		return this.toString();
	}
};
({ ...ProtoTimeZone });
({ ...ProtoTimeZone });
/** @internal */
var toDateUtc$1 = (self) => new Date(self.epochMilliseconds);
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Effect.js
/**
* Creates an `Effect` that represents an asynchronous computation that might
* fail.
*
* **When to use**
*
* Use when you need to perform asynchronous operations that might fail, such
* as fetching data from an API, and want thrown exceptions or rejected promises
* captured as Effect errors.
*
* **Details**
*
* Error Handling:
*
* There are two ways to handle errors with `tryPromise`:
*
* 1. If you don't provide a `catch` function, the error is caught and the
*    effect fails with an `UnknownError`.
* 2. If you provide a `catch` function, the error is caught and the `catch`
*    function maps it to an error of type `E`.
*
* Interruptions:
*
* An optional `AbortSignal` can be provided to allow for interruption of the
* wrapped `Promise` API.
*
* **Example** (Wrapping a fetch request that may fail)
*
* ```ts
* import { Effect } from "effect"
*
* const getTodo = (id: number) =>
*   // Will catch any errors and propagate them as UnknownError
*   Effect.tryPromise(() =>
*     fetch(`https://jsonplaceholder.typicode.com/todos/${id}`)
*   )
*
* //      ┌─── Effect<Response, UnknownError, never>
* //      ▼
* const program = getTodo(1)
* ```
*
* **Example** (Mapping Promise rejections to a tagged error)
*
* ```ts
* import { Data, Effect } from "effect"
*
* class TodoFetchError extends Data.TaggedError("TodoFetchError")<{ readonly cause: unknown }> {}
*
* const getTodo = (id: number) =>
*   Effect.tryPromise({
*     try: () => fetch(`https://jsonplaceholder.typicode.com/todos/${id}`),
*     // remap the error
*     catch: (cause) => new TodoFetchError({ cause })
*   })
*
* //      ┌─── Effect<Response, TodoFetchError, never>
* //      ▼
* const program = getTodo(1)
* ```
*
* @see {@link promise} if the effectful computation is asynchronous and does not throw errors.
* @category constructors
* @since 2.0.0
*/
var tryPromise = tryPromise$1;
/**
* Creates an `Effect` that always succeeds with a given value.
*
* **When to use**
*
* Use when an effect should complete successfully with a specific value without any errors
* or external dependencies.
*
* **Example** (Creating a successful effect)
*
* ```ts
* import { Effect } from "effect"
*
* // Creating an effect that represents a successful scenario
* //
* //      ┌─── Effect<number, never, never>
* //      ▼
* const success = Effect.succeed(42)
* ```
*
* @see {@link fail} to create an effect that represents a failure.
* @category constructors
* @since 2.0.0
*/
var succeed = succeed$1;
/**
* Returns an effect which succeeds with `None`.
*
* **Example** (Succeeding with Option.none)
*
* ```ts
* import { Effect } from "effect"
*
* const program = Effect.succeedNone
*
* Effect.runPromise(program).then(console.log)
* // Output: { _id: 'Option', _tag: 'None' }
* ```
*
* @category constructors
* @since 2.0.0
*/
var succeedNone = succeedNone$1;
/**
* Returns an effect which succeeds with the value wrapped in a `Some`.
*
* **Example** (Succeeding with Option.some)
*
* ```ts
* import { Effect } from "effect"
*
* const program = Effect.succeedSome(42)
*
* Effect.runPromise(program).then(console.log)
* // Output: { _id: 'Option', _tag: 'Some', value: 42 }
* ```
*
* @category constructors
* @since 2.0.0
*/
var succeedSome = succeedSome$1;
/**
* Creates an `Effect` lazily, delaying construction until it is needed.
*
* **When to use**
*
* Use when you need to defer the evaluation of an effect until it is required.
*
* **Details**
*
* `suspend` takes a thunk that represents an effect and delays creating it
* until the suspended effect is evaluated. This is useful for optimizing
* expensive computations, managing circular dependencies such as recursive
* functions, and helping TypeScript unify return types when branches construct
* different effects. Any side effects or scoped captures inside the thunk are
* re-executed on each invocation.
*
* **Example** (Lazily evaluating side effects)
*
* ```ts
* import { Effect } from "effect"
*
* let i = 0
*
* const bad = Effect.succeed(i++)
*
* const good = Effect.suspend(() => Effect.succeed(i++))
*
* console.log(Effect.runSync(bad)) // Output: 0
* console.log(Effect.runSync(bad)) // Output: 0
*
* console.log(Effect.runSync(good)) // Output: 1
* console.log(Effect.runSync(good)) // Output: 2
* ```
*
* **Example** (Suspending recursive Fibonacci evaluation)
*
* ```ts
* import { Effect } from "effect"
*
* const blowsUp = (n: number): Effect.Effect<number> =>
*   n < 2
*     ? Effect.succeed(1)
*     : Effect.zipWith(blowsUp(n - 1), blowsUp(n - 2), (a, b) => a + b)
*
* // console.log(Effect.runSync(blowsUp(32)))
* // crash: JavaScript heap out of memory
*
* const allGood = (n: number): Effect.Effect<number> =>
*   n < 2
*     ? Effect.succeed(1)
*     : Effect.zipWith(
*         Effect.suspend(() => allGood(n - 1)),
*         Effect.suspend(() => allGood(n - 2)),
*         (a, b) => a + b
*       )
*
* console.log(Effect.runSync(allGood(32)))
* // Output: 3524578
* ```
*
* **Example** (Helping TypeScript infer recursive effect types)
*
* ```ts
* import { Effect } from "effect"
*
* //   Without suspend, TypeScript may struggle with type inference.
* //   Inferred type:
* //     (a: number, b: number) =>
* //       Effect<never, Error, never> | Effect<number, never, never>
* const withoutSuspend = (a: number, b: number) =>
*   b === 0
*     ? Effect.fail(new Error("Cannot divide by zero"))
*     : Effect.succeed(a / b)
*
* //   Using suspend to unify return types.
* //   Inferred type:
* //     (a: number, b: number) => Effect<number, Error, never>
* const withSuspend = (a: number, b: number) =>
*   Effect.suspend(() =>
*     b === 0
*       ? Effect.fail(new Error("Cannot divide by zero"))
*       : Effect.succeed(a / b)
*   )
* ```
*
* @category constructors
* @since 2.0.0
*/
var suspend = suspend$1;
/**
* Creates an `Effect` that represents a synchronous side-effectful computation.
*
* **When to use**
*
* Use when you need to wrap a synchronous side-effectful operation that is not
* expected to throw.
*
* **Details**
*
* The provided function is evaluated lazily when the effect runs.
*
* **Gotchas**
*
* The function must not throw. If it throws, the thrown value is treated as a
* defect, not as a typed failure. Use `try` when throwing is expected.
*
* **Example** (Capturing synchronous logging in an Effect)
*
* ```ts
* import { Effect } from "effect"
*
* const log = (message: string) =>
*   Effect.sync(() => {
*     console.log(message) // side effect
*   })
*
* //      ┌─── Effect<void, never, never>
* //      ▼
* const program = log("Hello, World!")
* ```
*
* @see {@link try_ | try} for a version that can handle failures.
* @category constructors
* @since 2.0.0
*/
var sync = sync$1;
/**
* Provides a way to write effectful code using generator functions, simplifying
* control flow and error handling.
*
* **When to use**
*
* Use when you want to write effectful code that looks and behaves like
* synchronous code, while still handling asynchronous tasks, errors, and complex
* control flow such as loops and conditions.
*
* Generator functions work similarly to `async/await` but keep errors,
* requirements, and interruption in the Effect type. You can `yield*` values
* from effects and return the final result at the end.
*
* **Example** (Sequencing effects with generators)
*
* ```ts
* import { Data, Effect } from "effect"
*
* class DiscountRateError extends Data.TaggedError("DiscountRateError")<{}> {}
*
* const addServiceCharge = (amount: number) => amount + 1
*
* const applyDiscount = (
*   total: number,
*   discountRate: number
* ): Effect.Effect<number, DiscountRateError> =>
*   discountRate === 0
*     ? Effect.fail(new DiscountRateError())
*     : Effect.succeed(total - (total * discountRate) / 100)
*
* const fetchTransactionAmount = Effect.promise(() => Promise.resolve(100))
*
* const fetchDiscountRate = Effect.promise(() => Promise.resolve(5))
*
* export const program = Effect.gen(function*() {
*   const transactionAmount = yield* fetchTransactionAmount
*   const discountRate = yield* fetchDiscountRate
*   const discountedAmount = yield* applyDiscount(
*     transactionAmount,
*     discountRate
*   )
*   const finalAmount = addServiceCharge(discountedAmount)
*   return `Final amount to charge: ${finalAmount}`
* })
* ```
*
* @category constructors
* @since 2.0.0
*/
var gen = gen$1;
/**
* Creates an `Effect` that represents a recoverable error.
*
* **When to use**
*
* Use to explicitly signal a recoverable error in an `Effect`.
*
* **Details**
*
* The error keeps propagating unless it is handled. You can handle tagged
* errors with functions like {@link catchTag} or {@link catchTags}.
*
* **Example** (Creating a failed effect)
*
* ```ts
* import { Data, Effect } from "effect"
*
* class OperationFailedError extends Data.TaggedError("OperationFailedError")<{}> {}
*
* //      ┌─── Effect<never, OperationFailedError, never>
* //      ▼
* const failure = Effect.fail(
*   new OperationFailedError()
* )
* ```
*
* @see {@link succeed} to create an effect that represents a successful value.
* @category constructors
* @since 2.0.0
*/
var fail = fail$2;
/**
* Creates an effect that terminates a fiber with a specified error.
*
* **When to use**
*
* Use when you need an `Effect` to report an unrecoverable defect instead of a
* typed error.
*
* **Details**
*
* The `die` function is used to signal a defect, which represents a critical
* and unexpected error in the code. When invoked, it produces an effect that
* does not handle the error and instead terminates the fiber.
*
* The error channel of the resulting effect is of type `never`, indicating that
* it cannot recover from this failure.
*
* **Example** (Failing when division by zero)
*
* ```ts
* import { Effect } from "effect"
*
* const divide = (a: number, b: number) =>
*   b === 0
*     ? Effect.die(new Error("Cannot divide by zero"))
*     : Effect.succeed(a / b)
*
* //      ┌─── Effect<number, never, never>
* //      ▼
* const program = divide(1, 0)
*
* Effect.runPromise(program).catch(console.error)
* // Output:
* // (FiberFailure) Error: Cannot divide by zero
* //   ...stack trace...
* ```
*
* @category constructors
* @since 2.0.0
*/
var die = die$1;
/**
* Provides access to the current fiber within an effect computation.
*
* **Example** (Reading the current fiber)
*
* ```ts
* import { Effect } from "effect"
*
* const program = Effect.withFiber((fiber) =>
*   Effect.succeed(`Fiber ID: ${fiber.id}`)
* )
*
* Effect.runPromise(program).then(console.log)
* // Output: Fiber ID: 1
* ```
*
* @category constructors
* @since 4.0.0
*/
var withFiber = withFiber$1;
/**
* Chains effects to produce new `Effect` instances, useful for combining
* operations that depend on previous results.
*
* **When to use**
*
* Use when you need to chain multiple effects, ensuring that each
* step produces a new `Effect` while flattening any nested effects that may
* occur.
*
* **Details**
*
* `flatMap` lets you sequence effects so that the result of one effect can be
* used in the next step. It is similar to `flatMap` used with arrays but works
* specifically with `Effect` instances, allowing you to avoid deeply nested
* effect structures.
*
* Since effects are immutable, `flatMap` always returns a new effect instead of
* changing the original one.
*
* **Example** (Syntax)
*
* ```ts
* import { Effect, pipe } from "effect"
*
* const myEffect = Effect.succeed(1)
* const transformation = (n: number) => Effect.succeed(n + 1)
*
* const flatMappedWithPipe = pipe(myEffect, Effect.flatMap(transformation))
* const flatMappedWithDataFirst = Effect.flatMap(myEffect, transformation)
* const flatMappedWithMethod = myEffect.pipe(Effect.flatMap(transformation))
* ```
*
* **Example** (Sequencing dependent effects)
*
* ```ts
* import { Data, Effect, pipe } from "effect"
*
* class DiscountRateError extends Data.TaggedError("DiscountRateError")<{}> {}
*
* // Function to apply a discount safely to a transaction amount
* const applyDiscount = (
*   total: number,
*   discountRate: number
* ): Effect.Effect<number, DiscountRateError> =>
*   discountRate === 0
*     ? Effect.fail(new DiscountRateError())
*     : Effect.succeed(total - (total * discountRate) / 100)
*
* // Simulated asynchronous task to fetch a transaction amount from database
* const fetchTransactionAmount = Effect.promise(() => Promise.resolve(100))
*
* // Chaining the fetch and discount application using `flatMap`
* const finalAmount = pipe(
*   fetchTransactionAmount,
*   Effect.flatMap((amount) => applyDiscount(amount, 5))
* )
*
* Effect.runPromise(finalAmount).then(console.log)
* // Output: 95
* ```
*
* @see {@link tap} for a version that ignores the result of the effect.
* @category sequencing
* @since 2.0.0
*/
var flatMap = flatMap$1;
/**
* Flattens an `Effect` that produces another `Effect` into a single effect.
*
* **Example** (Flattening nested effects)
*
* ```ts
* import { Console, Effect } from "effect"
*
* const nested = Effect.succeed(Effect.succeed("hello"))
*
* const program = Effect.gen(function*() {
*   const value = yield* Effect.flatten(nested)
*   yield* Console.log(value)
*   // Output: hello
* })
* ```
*
* @category sequencing
* @since 2.0.0
*/
var flatten = flatten$1;
/**
* Runs a side effect with the result of an effect without changing the original
* value.
*
* **When to use**
*
* Use when you need to run an effectful observation, such as logging or
* tracking, while passing the original success value to the next step.
*
* **Details**
*
* `tap` works similarly to `flatMap`, but it ignores the result of the function
* passed to it. The value from the previous effect remains available for the
* next part of the chain. Note that if the side effect fails, the entire chain
* will fail too.
*
* **Example** (Logging a step in a pipeline)
*
* ```ts
* import { Console, Data, Effect, pipe } from "effect"
*
* class DiscountRateError extends Data.TaggedError("DiscountRateError")<{}> {}
*
* // Function to apply a discount safely to a transaction amount
* const applyDiscount = (
*   total: number,
*   discountRate: number
* ): Effect.Effect<number, DiscountRateError> =>
*   discountRate === 0
*     ? Effect.fail(new DiscountRateError())
*     : Effect.succeed(total - (total * discountRate) / 100)
*
* // Simulated asynchronous task to fetch a transaction amount from database
* const fetchTransactionAmount = Effect.promise(() => Promise.resolve(100))
*
* const finalAmount = pipe(
*   fetchTransactionAmount,
*   // Log the fetched transaction amount
*   Effect.tap((amount) => Console.log(`Apply a discount to: ${amount}`)),
*   // `amount` is still available!
*   Effect.flatMap((amount) => applyDiscount(amount, 5))
* )
*
* Effect.runPromise(finalAmount).then(console.log)
* // Output:
* // Apply a discount to: 100
* // 95
* ```
*
* @category sequencing
* @since 2.0.0
*/
var tap = tap$1;
/**
* Converts both success and failure of an `Effect` into a `Result` type.
*
* **When to use**
*
* Use when you want an `Effect`'s typed failures to be handled as `Result`
* data while preserving the original error value.
*
* **Details**
*
* This function converts an effect that may fail into an effect that always
* succeeds, wrapping the outcome in a `Result` type. The result will be
* `Result.Failure` if the effect fails, containing the recoverable error, or
* `Result.Success` if it succeeds, containing the result.
*
* Using this function, you can handle recoverable errors explicitly without
* causing the effect to fail. This is particularly useful in scenarios where
* you want to chain effects and manage both success and failure in the same
* logical flow.
*
* The resulting effect cannot fail directly because all recoverable failures
* are represented inside the `Result` type.
*
* **Gotchas**
*
* `result` only captures typed, recoverable failures. Defects and
* interruptions are not captured inside the `Result` and still fail the
* effect.
*
* **Example** (Capturing success or failure as Result)
*
* ```ts
* import { Effect } from "effect"
*
* const success = Effect.succeed(42)
* const failure = Effect.fail("Something went wrong")
*
* const program1 = Effect.result(success)
* const program2 = Effect.result(failure)
*
* Effect.runPromise(program1).then(console.log)
* // { _id: 'Result', _tag: 'Success', value: 42 }
*
* Effect.runPromise(program2).then(console.log)
* // { _id: 'Result', _tag: 'Failure', error: 'Something went wrong' }
* ```
*
* @see {@link option} for a version that uses `Option` instead.
* @see {@link exit} for a version that encapsulates both recoverable errors and defects in an `Exit`.
*
* @category outcome encapsulation
* @since 4.0.0
*/
var result = result$1;
/**
* Transforms an effect to encapsulate both failure and success using the `Exit`
* data type.
*
* **When to use**
*
* Use when you need to inspect the full outcome, including typed failures, defects,
* and interruptions.
*
* **Details**
*
* `exit` wraps an effect's success or failure inside an `Exit` type, allowing
* you to handle both cases explicitly.
*
* The resulting effect cannot fail because the failure is encapsulated within
* the `Exit.Failure` type. The error type is set to `never`, indicating that
* the effect is structured to never fail directly.
*
* **Example** (Capturing completion as Exit)
*
* ```ts
* import { Effect } from "effect"
*
* const success = Effect.succeed(42)
* const failure = Effect.fail("Something went wrong")
*
* const program1 = Effect.exit(success)
* const program2 = Effect.exit(failure)
*
* Effect.runPromise(program1).then(console.log)
* // { _id: 'Exit', _tag: 'Success', value: 42 }
*
* Effect.runPromise(program2).then(console.log)
* // { _id: 'Exit', _tag: 'Failure', cause: { _id: 'Cause', _tag: 'Fail', failure: 'Something went wrong' } }
* ```
*
* @see {@link option} for a version that uses `Option` instead.
* @see {@link result} for a version that uses `Result` instead.
*
* @category outcome encapsulation
* @since 2.0.0
*/
var exit = exit$1;
/**
* Transforms the value inside an effect by applying a function to it.
*
* **When to use**
*
* Use to transform an effect's success value with a function that returns a
* plain value, producing a new effect without changing the original effect's
* typed error or context requirements.
*
* **Details**
*
* `map` takes a function and applies it to the value contained within an
* effect, creating a new effect with the transformed value.
*
* It's important to note that effects are immutable, meaning that the original
* effect is not modified. Instead, a new effect is returned with the updated
* value.
*
* **Example** (Syntax)
*
* ```ts
* import { Effect, pipe } from "effect"
*
* const myEffect = Effect.succeed(1)
* const transformation = (n: number) => n + 1
*
* const mappedWithPipe = pipe(myEffect, Effect.map(transformation))
* const mappedWithDataFirst = Effect.map(myEffect, transformation)
* const mappedWithMethod = myEffect.pipe(Effect.map(transformation))
* ```
*
* **Example** (Adding a service charge)
*
* ```ts
* import { Effect, pipe } from "effect"
*
* const addServiceCharge = (amount: number) => amount + 1
*
* const fetchTransactionAmount = Effect.promise(() => Promise.resolve(100))
*
* const finalAmount = pipe(
*   fetchTransactionAmount,
*   Effect.map(addServiceCharge)
* )
*
* Effect.runPromise(finalAmount).then(console.log)
* // Output: 101
* ```
*
* @see {@link mapError} for a version that operates on the error channel.
* @see {@link mapBoth} for a version that operates on both channels.
* @see {@link flatMap} or {@link andThen} for a version that can return a new effect.
* @category mapping
* @since 2.0.0
*/
var map = map$1;
/**
* Converts typed failures from the error channel into defects, removing the
* error type from the returned effect.
*
* **When to use**
*
* Use when you need to turn an `Effect` typed failure that represents an
* unrecoverable bug or invalid state into a defect.
*
* **Example** (Converting typed failures into defects)
*
* ```ts
* import { Data, Effect } from "effect"
*
* class DivideByZeroError extends Data.TaggedError("DivideByZeroError")<{}> {}
*
* const divide = (a: number, b: number) =>
*   b === 0
*     ? Effect.fail(new DivideByZeroError())
*     : Effect.succeed(a / b)
*
* //      ┌─── Effect<number, never, never>
* //      ▼
* const program = Effect.orDie(divide(1, 0))
*
* Effect.runPromise(program).catch(console.error)
* // Output:
* // (FiberFailure) DivideByZeroError
* //   ...stack trace...
* ```
*
* @category converting failures to defects
* @since 2.0.0
*/
var orDie = orDie$1;
/**
* Provides a context to an effect, fulfilling its service requirements.
*
* **Details**
*
* This function provides multiple services at once by supplying a context
* that contains all the required services. It removes the provided services
* from the effect's requirements, making them available to the effect.
*
* **Example** (Providing a complete context)
*
* ```ts
* import { Context, Effect } from "effect"
*
* // Define service keys
* const Logger = Context.Service<{
*   log: (msg: string) => void
* }>("Logger")
* const Database = Context.Service<{
*   query: (sql: string) => string
* }>("Database")
*
* // Create a context with multiple services
* const context = Context.make(Logger, { log: console.log })
*   .pipe(Context.add(Database, { query: () => "result" }))
*
* // An effect that requires both services
* const program = Effect.gen(function*() {
*   const logger = yield* Effect.service(Logger)
*   const db = yield* Effect.service(Database)
*   logger.log("Querying database")
*   return db.query("SELECT * FROM users")
* })
*
* const provided = Effect.provideContext(program, context)
* ```
*
* @category environment
* @since 4.0.0
*/
var provideContext = provideContext$1;
/**
* Adds a finalizer to the current scope.
*
* **When to use**
*
* Use to register low-level cleanup in the current scope.
*
* **Details**
*
* The finalizer runs when the surrounding scope is closed and receives the
* `Exit` value used to close the scope.
*
* **Example** (Registering scope finalizers)
*
* ```ts
* import { Console, Effect, Exit } from "effect"
*
* const program = Effect.scoped(
*   Effect.gen(function*() {
*     // Add a finalizer that runs when the scope closes
*     yield* Effect.addFinalizer((exit) =>
*       Console.log(
*         Exit.isSuccess(exit)
*           ? "Cleanup: Operation completed successfully"
*           : "Cleanup: Operation failed, cleaning up resources"
*       )
*     )
*
*     yield* Console.log("Performing main operation...")
*
*     // This could succeed or fail
*     return "operation result"
*   })
* )
*
* Effect.runPromise(program).then(console.log)
* // Output:
* // Performing main operation...
* // Cleanup: Operation completed successfully
* // operation result
* ```
*
* @see {@link acquireRelease} for resource acquisition with a release finalizer
* @see {@link ensuring} for attaching a finalizer to one effect
*
* @category resource management
* @since 2.0.0
*/
var addFinalizer = addFinalizer$1;
/**
* Runs an effect in the background, returning a fiber that can
* be observed or interrupted.
*
* **When to use**
*
* Use when you need to start an effect in the background and receive a fiber.
*
* **Example** (Running an effect in the background)
*
* ```ts
* import { Console, Effect, Fiber, Schedule } from "effect"
*
* //      ┌─── Effect<number, never, never>
* //      ▼
* const program = Effect.repeat(
*   Console.log("running..."),
*   Schedule.spaced("200 millis")
* )
*
* //      ┌─── RuntimeFiber<number, never>
* //      ▼
* const fiber = Effect.runFork(program)
*
* setTimeout(() => {
*   Effect.runFork(Fiber.interrupt(fiber))
* }, 500)
* ```
*
* @category running
* @since 2.0.0
*/
var runFork = runFork$1;
/**
* Runs an effect in the background with the provided services.
*
* **When to use**
*
* Use when an effect still requires services, you already have a `Context`, and
* you want a background fiber.
*
* **Example** (Running with services in the background)
*
* ```ts
* import { Context, Effect } from "effect"
*
* interface Logger {
*   log: (message: string) => void
* }
*
* const Logger = Context.Service<Logger>("Logger")
*
* const services = Context.make(Logger, {
*   log: (message) => console.log(message)
* })
*
* const program = Effect.gen(function*() {
*   const logger = yield* Logger
*   logger.log("Hello from service!")
*   return "done"
* })
*
* const fiber = Effect.runForkWith(services)(program)
* ```
*
* @category running
* @since 4.0.0
*/
var runForkWith = runForkWith$1;
/**
* Forks an effect with the provided services, registers `onExit` as a fiber observer, and returns an interruptor.
*
* **When to use**
*
* Use when embedding an effect into callback-style code with explicit services
* and a synchronous interruptor.
*
* **Details**
*
* The returned interruptor calls `fiber.interruptUnsafe`, optionally with an interruptor id.
*
* **Example** (Running with services and a callback)
*
* ```ts
* import { Console, Context, Effect, Exit } from "effect"
*
* interface Logger {
*   log: (message: string) => Effect.Effect<void>
* }
*
* const Logger = Context.Service<Logger>("Logger")
*
* const services = Context.make(Logger, {
*   log: (message) => Console.log(message)
* })
*
* const program = Effect.gen(function*() {
*   const logger = yield* Logger
*   yield* logger.log("Started")
*   return "done"
* })
*
* const interrupt = Effect.runCallbackWith(services)(program, {
*   onExit: (exit) => {
*     if (Exit.isFailure(exit)) {
*       // handle failure or interruption
*     }
*   }
* })
*
* // Use the interruptor if you need to cancel the fiber later.
* interrupt()
* ```
*
* @category running
* @since 4.0.0
*/
var runCallbackWith = runCallbackWith$1;
/**
* Runs an effect asynchronously, registering `onExit` as a fiber observer and
* returning an interruptor.
*
* **Details**
*
* The interruptor calls `fiber.interruptUnsafe` with the optional interruptor
* id.
*
* **Example** (Running with a callback)
*
* ```ts
* import { Console, Effect, Exit } from "effect"
*
* const program = Effect.gen(function*() {
*   yield* Console.log("working")
*   return "done"
* })
*
* const interrupt = Effect.runCallback(program, {
*   onExit: (exit) => {
*     Effect.runSync(
*       Exit.match(exit, {
*         onFailure: () => Console.log("failed"),
*         onSuccess: (value) => Console.log(`success: ${value}`)
*       })
*     )
*   }
* })
*
* // Output:
* // working
* // success: done
*
* // interrupt() to cancel the fiber if needed
* ```
*
* @category running
* @since 2.0.0
*/
var runCallback = runCallback$1;
/**
* Executes an effect and returns the result as a `Promise`.
*
* **When to use**
*
* Use when you need to execute an effect and work with the
* result using `Promise` syntax, typically for compatibility with other
* promise-based code.
*
* If the effect succeeds, the promise will resolve with the result. If the
* effect fails, the promise will reject with an error.
*
* **Example** (Running a successful effect as a Promise)
*
* ```ts
* import { Effect } from "effect"
*
* Effect.runPromise(Effect.succeed(1)).then(console.log)
* // Output: 1
* ```
*
* **Example** (Running effects as promises)
*
* ```ts
* //Example: Handling a Failing Effect as a Rejected Promise
* import { Effect } from "effect"
*
* Effect.runPromise(Effect.fail("my error")).catch(console.error)
* // Output:
* // (FiberFailure) Error: my error
* ```
*
* @see {@link runPromiseExit} for a version that returns an `Exit` type instead of rejecting.
* @category running
* @since 2.0.0
*/
var runPromise = runPromise$1;
/**
* Executes an effect as a Promise with the provided services.
*
* **When to use**
*
* Use when you already have a `Context` and need Promise interop that rejects on
* effect failure.
*
* **Example** (Running with services as a promise)
*
* ```ts
* import { Context, Effect } from "effect"
*
* interface Config {
*   apiUrl: string
* }
*
* const Config = Context.Service<Config>("Config")
*
* const context = Context.make(Config, {
*   apiUrl: "https://api.example.com"
* })
*
* const program = Effect.gen(function*() {
*   const config = yield* Config
*   return `Connecting to ${config.apiUrl}`
* })
*
* Effect.runPromiseWith(context)(program).then(console.log)
* ```
*
* @category running
* @since 4.0.0
*/
var runPromiseWith = runPromiseWith$1;
/**
* Runs an effect and returns a `Promise` that resolves to an `Exit`, which
* represents the outcome (success or failure) of the effect.
*
* **When to use**
*
* Use when you need to determine if an effect succeeded
* or failed, including any defects, and you want to work with a `Promise`.
*
* **Details**
*
* The `Exit` type represents the result of the effect. Successful effects are
* wrapped in `Success`, and failed effects are wrapped in `Failure` with a
* `Cause`.
*
* **Example** (Observing promise results as Exit)
*
* ```ts
* import { Effect } from "effect"
*
* // Execute a successful effect and get the Exit result as a Promise
* Effect.runPromiseExit(Effect.succeed(1)).then(console.log)
* // Output:
* // {
* //   _id: "Exit",
* //   _tag: "Success",
* //   value: 1
* // }
*
* // Execute a failing effect and get the Exit result as a Promise
* Effect.runPromiseExit(Effect.fail("my error")).then(console.log)
* // Output:
* // {
* //   _id: "Exit",
* //   _tag: "Failure",
* //   cause: {
* //     _id: "Cause",
* //     _tag: "Fail",
* //     failure: "my error"
* //   }
* // }
* ```
*
* @see {@link runPromise} for a version that rejects on failure.
*
* @category running
* @since 2.0.0
*/
var runPromiseExit = runPromiseExit$1;
/**
* Runs an effect and returns a Promise of Exit with provided services.
*
* **When to use**
*
* Use when you already have a `Context` and need Promise interop that preserves
* success and failure as an `Exit`.
*
* **Example** (Running with services as an Exit promise)
*
* ```ts
* import { Context, Effect, Exit } from "effect"
*
* interface Database {
*   query: (sql: string) => string
* }
*
* const Database = Context.Service<Database>("Database")
*
* const services = Context.make(Database, {
*   query: (sql) => `Result for: ${sql}`
* })
*
* const program = Effect.gen(function*() {
*   const db = yield* Database
*   return db.query("SELECT * FROM users")
* })
*
* Effect.runPromiseExitWith(services)(program).then((exit) => {
*   if (Exit.isSuccess(exit)) {
*     console.log("Success:", exit.value)
*   }
* })
* ```
*
* @category running
* @since 4.0.0
*/
var runPromiseExitWith = runPromiseExitWith$1;
/**
* Executes an effect synchronously and returns its success value.
*
* **When to use**
*
* Use when you need to execute an effect that is guaranteed to complete
* synchronously.
*
* **Details**
*
* If the effect fails, dies, is interrupted, or performs asynchronous work,
* `runSync` throws a `FiberFailure` instead of returning a value. Use
* `runSyncExit` when you want the failure captured as an `Exit`.
*
* **Example** (Running a synchronous effect)
*
* ```ts
* import { Effect } from "effect"
*
* const program = Effect.sync(() => {
*   console.log("Hello, World!")
*   return 1
* })
*
* const result = Effect.runSync(program)
* // Output: Hello, World!
*
* console.log(result)
* // Output: 1
* ```
*
* **Example** (Throwing for failed or async effects)
*
* ```ts
* import { Effect } from "effect"
*
* try {
*   // Attempt to run an effect that fails
*   Effect.runSync(Effect.fail("my error"))
* } catch (e) {
*   console.error(e)
* }
* // Output:
* // (FiberFailure) Error: my error
*
* try {
*   // Attempt to run an effect that involves async work
*   Effect.runSync(Effect.promise(() => Promise.resolve(1)))
* } catch (e) {
*   console.error(e)
* }
* // Output:
* // (FiberFailure) AsyncFiberException: Fiber #0 cannot be resolved synchronously. This is caused by using runSync on an effect that performs async work
* ```
*
* @see {@link runSyncExit} for a version that returns an `Exit` type instead of
* throwing an error.
* @category running
* @since 2.0.0
*/
var runSync = runSync$1;
/**
* Executes an effect synchronously with provided services.
*
* **When to use**
*
* Use when you already have a `Context`, the effect is known to complete
* synchronously, and failures should throw.
*
* **Example** (Running synchronously with services)
*
* ```ts
* import { Context, Effect } from "effect"
*
* interface MathService {
*   add: (a: number, b: number) => number
* }
*
* const MathService = Context.Service<MathService>("MathService")
*
* const context = Context.make(MathService, {
*   add: (a, b) => a + b
* })
*
* const program = Effect.gen(function*() {
*   const math = yield* MathService
*   return math.add(2, 3)
* })
*
* const result = Effect.runSyncWith(context)(program)
* console.log(result) // 5
* ```
*
* @category running
* @since 4.0.0
*/
var runSyncWith = runSyncWith$1;
/**
* Runs an effect synchronously and captures the outcome safely as an `Exit` type, which
* represents the outcome (success or failure) of the effect.
*
* **When to use**
*
* Use to find out whether an effect succeeded or failed,
* including any defects, without dealing with asynchronous operations.
*
* **Details**
*
* The `Exit` type represents the result of the effect. Successful effects are
* wrapped in `Success`, and failed effects are wrapped in `Failure` with a
* `Cause`.
*
* If the effect contains asynchronous operations, `runSyncExit` will
* return an `Failure` with a `Die` cause, indicating that the effect cannot be
* resolved synchronously.
*
* **Example** (Observing synchronous results as Exit)
*
* ```ts
* import { Effect } from "effect"
*
* console.log(Effect.runSyncExit(Effect.succeed(1)))
* // Output:
* // {
* //   _id: "Exit",
* //   _tag: "Success",
* //   value: 1
* // }
*
* console.log(Effect.runSyncExit(Effect.fail("my error")))
* // Output:
* // {
* //   _id: "Exit",
* //   _tag: "Failure",
* //   cause: {
* //     _id: "Cause",
* //     _tag: "Fail",
* //     failure: "my error"
* //   }
* // }
* ```
*
* **Example** (Capturing async work as a Die cause)
*
* ```ts
* import { Effect } from "effect"
*
* console.log(Effect.runSyncExit(Effect.promise(() => Promise.resolve(1))))
* // Output:
* // {
* //   _id: 'Exit',
* //   _tag: 'Failure',
* //   cause: {
* //     _id: 'Cause',
* //     _tag: 'Die',
* //     defect: [Fiber #0 cannot be resolved synchronously. This is caused by using runSync on an effect that performs async work] {
* //       fiber: [FiberRuntime],
* //       _tag: 'AsyncFiberException',
* //       name: 'AsyncFiberException'
* //     }
* //   }
* // }
* ```
*
* @see {@link runSync} for a version that throws on failure.
*
* @category running
* @since 2.0.0
*/
var runSyncExit = runSyncExit$1;
/**
* Runs an effect synchronously with provided services, returning an Exit result safely.
*
* **When to use**
*
* Use when you already have a `Context` and need a synchronous `Exit` instead of
* throwing on failure.
*
* **Example** (Running synchronously with services as Exit)
*
* ```ts
* import { Context, Effect, Exit } from "effect"
*
* // Define a logger service
* const Logger = Context.Service<{
*   log: (msg: string) => void
* }>("Logger")
*
* const program = Effect.gen(function*() {
*   const logger = yield* Effect.service(Logger)
*   logger.log("Computing result...")
*   return 42
* })
*
* // Prepare context
* const context = Context.make(Logger, {
*   log: (msg) => console.log(`[LOG] ${msg}`)
* })
*
* const exit = Effect.runSyncExitWith(context)(program)
*
* if (Exit.isSuccess(exit)) {
*   console.log(`Success: ${exit.value}`)
* } else {
*   console.log(`Failure: ${exit.cause}`)
* }
* // Output:
* // [LOG] Computing result...
* // Success: 42
* ```
*
* @category running
* @since 4.0.0
*/
var runSyncExitWith = runSyncExitWith$1;
/**
* Creates a reusable traced function from an Effect body.
*
* **When to use**
*
* Use when you are defining a reusable Effect function whose implementation
* would otherwise be a normal function returning {@link gen}, and you want
* tracing spans or stack-frame capture.
*
* **Details**
*
* Compared to a plain function that returns {@link gen}, `Effect.fn` reuses the
* generator body instead of allocating a fresh generator closure around the
* arguments on every call. Call `Effect.fn(body, ...)` for a generic
* stack-frame boundary without creating a span. Call
* `Effect.fn("operationName", options?)(body, ...)` when that boundary should
* have a readable operation name and the returned `Effect` should create a
* tracing span when run. {@link SpanOptionsNoTrace} configures span metadata
* such as attributes, links, parent or root selection, kind, sampling, and log
* level. Additional arguments after the generator body act like `pipe`
* transforms: each transform receives the previous result and the original
* function arguments. When those transforms return an `Effect`, the returned
* effect includes stack-frame metadata and, for the named form, a tracing span.
* Generator bodies may declare a `this` parameter; pass `{ self }` before the
* body to bind `this` when the function is created.
*
* **Example** (Defining traced effect functions)
*
* ```ts
* import { Effect } from "effect"
*
* const f = Effect.fn("calculateLength")(function*(value: string) {
*   return yield* Effect.succeed(value.length)
* })
*
* //      ┌─── Effect.Effect<number>
* //      ▼
* const program = f("hello")
* ```
*
* **Example** (Transforming the returned Effect)
*
* ```ts
* import { Effect } from "effect"
*
* const f = Effect.fn("formatLength")(
*   function*(value: string) {
*     return yield* Effect.succeed(value.length)
*   },
*   (effect, value) =>
*     effect.pipe(Effect.map((length) => `${value}: ${length}`))
* )
*
* //      ┌─── Effect.Effect<string>
* //      ▼
* const program = f("hello")
* ```
*
* **Example** (Binding this)
*
* ```ts
* import { Effect } from "effect"
*
* class Counter {
*   count = 0
*
*   increment = Effect.fn("Counter.increment")(
*     { self: this },
*     function*(this: Counter, by: number) {
*       this.count += by
*       return yield* Effect.succeed(this.count)
*     }
*   )
* }
*
* const counter = new Counter()
*
* //      ┌─── Effect.Effect<number>
* //      ▼
* const program = counter.increment(1)
* ```
*
* **Example** (Annotating a traced non-parametric function)
*
* ```ts
* import { Effect } from "effect"
*
* const f = Effect.fn("calculateLength")(function*(
*   value: string
* ): Effect.fn.Return<number> {
*   return yield* Effect.succeed(value.length)
* })
*
* //      ┌─── Effect.Effect<number>
* //      ▼
* const program = f("hello")
* ```
*
* **Example** (Annotating a traced parametric function)
*
* ```ts
* import { Effect } from "effect"
*
* const f = Effect.fn("succeed")(function*<A>(
*   value: A
* ): Effect.fn.Return<A> {
*   return yield* Effect.succeed(value)
* })
*
* //      ┌─── Effect.Effect<string>
* //      ▼
* const program = f("hello")
* ```
*
* @category functions
* @since 3.11.0
*/
var fn = fn$1;
Service()("effect/Effect/Transaction");
/**
* Applies `map` eagerly when an effect is already resolved.
*
* **When to use**
*
* Use when an already-resolved effect should apply a success transformation
* immediately while pending effects still use regular mapping.
*
* **Details**
*
* Success effects apply the mapping function immediately. Failure effects pass
* through unchanged, and pending effects fall back to regular `map` behavior.
*
* **Example** (Mapping already completed effects)
*
* ```ts
* import { Effect } from "effect"
*
* // For resolved effects, the mapping is applied immediately
* const resolved = Effect.succeed(5)
* const mapped = Effect.mapEager(resolved, (n) => n * 2) // Applied eagerly
*
* // For pending effects, behaves like regular map
* const pending = Effect.delay(Effect.succeed(5), "100 millis")
* const mappedPending = Effect.mapEager(pending, (n) => n * 2) // Uses regular map
* ```
*
* @category eager
* @since 4.0.0
*/
var mapEager = mapEager$1;
/**
* Applies `mapError` eagerly when an effect is already resolved.
*
* **When to use**
*
* Use when an already-resolved failed effect should apply an error
* transformation immediately while pending effects still use regular error
* mapping.
*
* **Details**
*
* Success effects pass through unchanged because there is no error to
* transform. Failure effects apply the mapping function immediately, and
* pending effects fall back to regular `mapError` behavior.
*
* **Example** (Mapping errors eagerly when possible)
*
* ```ts
* import { Effect } from "effect"
*
* // For resolved failure effects, the error mapping is applied immediately
* const failed = Effect.fail("original error")
* const mapped = Effect.mapErrorEager(failed, (err: string) => `mapped: ${err}`) // Applied eagerly
*
* // For pending effects, behaves like regular mapError
* const pending = Effect.delay(Effect.fail("error"), "100 millis")
* const mappedPending = Effect.mapErrorEager(
*   pending,
*   (err: string) => `mapped: ${err}`
* ) // Uses regular mapError
* ```
*
* @category eager
* @since 4.0.0
*/
var mapErrorEager = mapErrorEager$1;
/**
* Applies `flatMap` eagerly when an effect is already resolved.
*
* **When to use**
*
* Use when an already-resolved successful effect should bind immediately to the
* next effect while pending effects still use regular flat mapping.
*
* **Details**
*
* Success effects apply the flatMap function immediately. Failure effects pass
* through unchanged, and pending effects fall back to regular `flatMap`
* behavior.
*
* **Example** (Flat mapping eagerly when possible)
*
* ```ts
* import { Effect } from "effect"
*
* // For resolved effects, the flatMap is applied immediately
* const resolved = Effect.succeed(5)
* const flatMapped = Effect.flatMapEager(resolved, (n) => Effect.succeed(n * 2)) // Applied eagerly
*
* // For pending effects, behaves like regular flatMap
* const pending = Effect.delay(Effect.succeed(5), "100 millis")
* const flatMappedPending = Effect.flatMapEager(
*   pending,
*   (n) => Effect.succeed(n * 2)
* ) // Uses regular flatMap
* ```
*
* @category eager
* @since 4.0.0
*/
var flatMapEager = flatMapEager$1;
/**
* Applies `catch` eagerly when an effect is already resolved.
*
* **When to use**
*
* Use when an already-resolved failed effect should recover immediately while
* pending effects still use regular error recovery.
*
* **Details**
*
* Success effects pass through unchanged because there is no error to catch.
* Failure effects apply the catch function immediately, and pending effects
* fall back to regular `catch` behavior.
*
* **Example** (Catching failures eagerly when possible)
*
* ```ts
* import { Effect } from "effect"
*
* // For resolved failure effects, the catch function is applied immediately
* const failed = Effect.fail("original error")
* const recovered = Effect.catchEager(
*   failed,
*   (err: string) => Effect.succeed(`recovered from: ${err}`)
* ) // Applied eagerly
*
* // For success effects, returns success as-is
* const success = Effect.succeed(42)
* const unchanged = Effect.catchEager(
*   success,
*   (err: string) => Effect.succeed(`recovered from: ${err}`)
* ) // Returns success as-is
*
* // For pending effects, behaves like regular catch
* const pending = Effect.delay(Effect.fail("error"), "100 millis")
* const recoveredPending = Effect.catchEager(
*   pending,
*   (err: string) => Effect.succeed(`recovered from: ${err}`)
* ) // Uses regular catch
* ```
*
* @category eager
* @since 4.0.0
*/
var catchEager = catchEager$1;
/**
* Creates untraced function effects with eager evaluation optimization.
*
* **Details**
*
* Executes generator functions eagerly when all yielded effects are synchronous,
* stopping at the first async effect and deferring to normal execution.
*
* **Example** (Defining eager untraced effect functions)
*
* ```ts
* import { Effect } from "effect"
*
* const computation = Effect.fnUntracedEager(function*() {
*   yield* Effect.succeed(1)
*   yield* Effect.succeed(2)
*   return "computed eagerly"
* })
*
* const effect = computation() // Executed immediately if all effects are sync
* ```
*
* @category eager
* @since 4.0.0
*/
var fnUntracedEager = fnUntracedEager$1;
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/record.js
/**
* @since 4.0.0
*/
/** @internal */
function set$2(self, key, value) {
	if (key === "__proto__") Object.defineProperty(self, key, {
		value,
		writable: true,
		enumerable: true,
		configurable: true
	});
	else self[key] = value;
	return self;
}
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/schema/annotations.js
/** @internal */
function resolve(ast) {
	return ast.checks ? ast.checks[ast.checks.length - 1].annotations : ast.annotations;
}
/** @internal */
function resolveAt(key) {
	return (ast) => resolve(ast)?.[key];
}
/** @internal */
var resolveIdentifier = /*#__PURE__*/ resolveAt("identifier");
/** @internal */
var getExpected = /*#__PURE__*/ memoize((ast) => {
	const identifier = resolveIdentifier(ast);
	if (typeof identifier === "string") return identifier;
	return ast.getExpected(getExpected);
});
globalThis.RegExp;
/**
* Escapes special characters in a regular expression pattern.
*
* **When to use**
*
* Use to turn literal text into a safe regular expression pattern fragment.
*
* **Example** (Escaping a pattern string)
*
* ```ts
* import { RegExp } from "effect"
* import * as assert from "node:assert"
*
* assert.deepStrictEqual(RegExp.escape("a*b"), "a\\*b")
* ```
*
* @category RegExp
* @since 2.0.0
*/
var escape = (string) => string.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&");
Service()("effect/DateTime/CurrentTimeZone");
TaggedError("EncodingError");
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/SchemaIssue.js
var TypeId$6 = "~effect/SchemaIssue/Issue";
/**
* Returns `true` if the given value is an {@link Issue}.
*
* **When to use**
*
* Use when you need to narrow an `unknown` value to `Issue` in error-handling
* code, such as distinguishing an `Issue` from other error types in a catch-all
* handler.
*
* **Details**
*
* - Checks for the internal `TypeId` brand on the value.
*
* **Example** (Type-guarding an unknown error)
*
* ```ts
* import { SchemaIssue } from "effect"
*
* const issue = new SchemaIssue.MissingKey(undefined)
* console.log(SchemaIssue.isIssue(issue))
* // true
* console.log(SchemaIssue.isIssue("not an issue"))
* // false
* ```
*
* @see {@link Issue}
*
* @category guards
* @since 4.0.0
*/
function isIssue(u) {
	return hasProperty(u, TypeId$6);
}
var Base$1 = class {
	[TypeId$6] = TypeId$6;
	toString() {
		return defaultFormatter(this);
	}
};
/**
* Represents a schema issue produced when a schema filter (refinement check) fails.
*
* **When to use**
*
* Use when you need to inspect a schema issue that records which refinement
* check rejected the value.
*
* **Details**
*
* - `actual` is the raw input value that was tested (plain `unknown`, not
*   wrapped in `Option`).
* - `filter` is the AST filter node that produced this issue.
* - `issue` is the inner issue describing the failure reason.
*
* **Example** (Matching a Filter issue)
*
* ```ts
* import { SchemaIssue } from "effect"
*
* function describe(issue: SchemaIssue.Issue): string {
*   if (issue._tag === "Filter") {
*     return `Filter failed on: ${JSON.stringify(issue.actual)}`
*   }
*   return String(issue)
* }
* ```
*
* @see {@link Leaf} — terminal issue types that commonly appear as the inner `issue`
* @see {@link CheckHook} — formatter hook for `Filter` issues
*
* @category models
* @since 4.0.0
*/
var Filter$1 = class extends Base$1 {
	_tag = "Filter";
	/**
	* The input value that caused the issue.
	*/
	actual;
	/**
	* The filter that failed.
	*/
	filter;
	/**
	* The issue that occurred.
	*/
	issue;
	constructor(actual, filter, issue) {
		super();
		this.actual = actual;
		this.filter = filter;
		this.issue = issue;
	}
};
/**
* Represents a schema issue produced when a schema transformation (encode/decode step) fails.
*
* **When to use**
*
* Use when you need to inspect failures from `Schema.decodeTo` / `Schema.encodeTo`
*   transformations.
*
* **Details**
*
* - `ast` is the AST node for the transformation that failed.
* - `actual` is `Option.some(value)` when the input was present, or
*   `Option.none()` when it was absent.
* - `issue` is the inner issue describing the failure.
*
* @see {@link Filter} — failure from a refinement check (not a transformation)
* @see {@link Composite} — multiple issues from a single schema node
*
* @category models
* @since 4.0.0
*/
var Encoding = class extends Base$1 {
	_tag = "Encoding";
	/**
	* The schema that caused the issue.
	*/
	ast;
	/**
	* The input value that caused the issue.
	*/
	actual;
	/**
	* The issue that occurred.
	*/
	issue;
	constructor(ast, actual, issue) {
		super();
		this.ast = ast;
		this.actual = actual;
		this.issue = issue;
	}
};
/**
* Wraps an inner {@link Issue} with a property-key path, indicating *where* in
* a nested structure the error occurred.
*
* **When to use**
*
* Use when you need to walk the issue tree to accumulate path segments for error
* reporting.
*
* **Details**
*
* - `path` is an array of property keys (strings, numbers, or symbols).
* - Has no `actual` value — {@link getActual} returns `Option.none()`.
* - Formatters concatenate nested `Pointer` paths into a single path like
*   `["a"]["b"][0]`.
*
* @see {@link getActual} — returns `Option.none()` for `Pointer`
* @see {@link Composite} — groups multiple issues under one schema node
*
* @category models
* @since 3.10.0
*/
var Pointer = class extends Base$1 {
	_tag = "Pointer";
	/**
	* The path to the location in the input that caused the issue.
	*/
	path;
	/**
	* The issue that occurred.
	*/
	issue;
	constructor(path, issue) {
		super();
		this.path = path;
		this.issue = issue;
	}
};
/**
* Represents a schema issue produced when a required key or tuple index is missing from the input.
*
* **When to use**
*
* Use when you need to detect absent fields in struct/tuple validation.
*
* **Details**
*
* - Has no `actual` value — {@link getActual} returns `Option.none()`.
* - `annotations` may contain a custom `messageMissingKey` for formatting.
*
* @see {@link Pointer} — wraps this issue with the missing key's path
* @see {@link UnexpectedKey} — the opposite case (extra key present)
*
* @category models
* @since 4.0.0
*/
var MissingKey = class extends Base$1 {
	_tag = "MissingKey";
	/**
	* The metadata for the issue.
	*/
	annotations;
	constructor(annotations) {
		super();
		this.annotations = annotations;
	}
};
/**
* Represents a schema issue produced when an input object or tuple contains a key/index not
* declared by the schema.
*
* **When to use**
*
* Use when you need to detect excess properties during strict struct/tuple
* validation.
*
* **Details**
*
* - `actual` is the raw value at the unexpected key (plain `unknown`).
* - `ast` is the schema that was being validated against.
* - `annotations` on `ast` may contain a custom `messageUnexpectedKey`.
*
* @see {@link MissingKey} — the opposite case (required key absent)
* @see {@link Pointer} — wraps this issue with the unexpected key's path
*
* @category models
* @since 4.0.0
*/
var UnexpectedKey = class extends Base$1 {
	_tag = "UnexpectedKey";
	/**
	* The schema that caused the issue.
	*/
	ast;
	/**
	* The input value that caused the issue.
	*/
	actual;
	constructor(ast, actual) {
		super();
		this.ast = ast;
		this.actual = actual;
	}
};
/**
* Represents a schema issue that groups multiple child issues under a single schema node.
*
* **When to use**
*
* Use when you need to walk the issue tree for struct/tuple schemas that collect
* all field errors rather than failing on the first.
*
* **Details**
*
* - `issues` is a non-empty readonly array (at least one child).
* - `actual` is `Option.some(value)` when the input was present, or
*   `Option.none()` when absent.
* - Formatters flatten `Composite` by recursing into each child.
*
* @see {@link AnyOf} — used for union no-match errors (similar but different semantics)
* @see {@link Pointer} — adds path context to individual issues
*
* @category models
* @since 3.10.0
*/
var Composite = class extends Base$1 {
	_tag = "Composite";
	/**
	* The schema that caused the issue.
	*/
	ast;
	/**
	* The input value that caused the issue.
	*/
	actual;
	/**
	* The issues that occurred.
	*/
	issues;
	constructor(ast, actual, issues) {
		super();
		this.ast = ast;
		this.actual = actual;
		this.issues = issues;
	}
};
/**
* Represents a schema issue produced when the runtime type of the input does not match the type
* expected by the schema (e.g. got `null` when `string` was expected).
*
* **When to use**
*
* Use when you need to detect basic type mismatches, such as a wrong primitive
* or `null` where an object was expected.
*
* **Details**
*
* - `ast` is the schema node that expected a different type.
* - `actual` is `Option.some(value)` when the input was present, or
*   `Option.none()` when no value was provided.
* - The default formatter renders this as `"Expected <type>, got <actual>"`.
*
* **Example** (Formatted output)
*
* ```ts
* import { Schema } from "effect"
*
* try {
*   Schema.decodeUnknownSync(Schema.String)(42)
* } catch (e) {
*   if (Schema.isSchemaError(e)) {
*     console.log(String(e.issue))
*     // "Expected string, got 42"
*   }
* }
* ```
*
* @see {@link InvalidValue} — the input has the right type but fails a value constraint
*
* @category models
* @since 4.0.0
*/
var InvalidType = class extends Base$1 {
	_tag = "InvalidType";
	/**
	* The schema that caused the issue.
	*/
	ast;
	/**
	* The input value that caused the issue.
	*/
	actual;
	constructor(ast, actual) {
		super();
		this.ast = ast;
		this.actual = actual;
	}
};
/**
* Represents a schema issue produced when the input has the correct type but its value violates a
* constraint (e.g. a string that is too short, a number out of range).
*
* **When to use**
*
* Use when you need to detect constraint violations from `Schema.filter`,
* `Schema.minLength`, `Schema.greaterThan`, or similar checks.
*
* **Details**
*
* - `actual` is `Option.some(value)` when the failing value is known, or
*   `Option.none()` when absent.
* - `annotations` optionally carries a `message` string for formatting.
* - The default formatter renders this as `"Invalid data <actual>"` unless a
*   custom `message` annotation is provided.
*
* **Example** (Custom filter returning InvalidValue)
*
* ```ts
* import { Option, SchemaIssue } from "effect"
*
* const issue = new SchemaIssue.InvalidValue(
*   Option.some(""),
*   { message: "must not be empty" }
* )
* console.log(String(issue))
* // "must not be empty"
* ```
*
* @see {@link InvalidType} — the input has the wrong type entirely
* @see {@link Filter} — composite wrapper when a schema filter produces this issue
*
* @category models
* @since 4.0.0
*/
var InvalidValue = class extends Base$1 {
	_tag = "InvalidValue";
	/**
	* The value that caused the issue.
	*/
	actual;
	/**
	* The metadata for the issue.
	*/
	annotations;
	constructor(actual, annotations) {
		super();
		this.actual = actual;
		this.annotations = annotations;
	}
};
/**
* Represents a schema issue produced when a value does not match *any* member of a union schema.
*
* **When to use**
*
* Use when you need to inspect which union members were attempted and why each
* failed.
*
* **Details**
*
* - `ast` is the `Union` AST node.
* - `actual` is the raw input value (plain `unknown`).
* - `issues` contains per-member failures. When empty, the formatter falls
*   back to the union's `expected` annotation.
*
* @see {@link OneOf} — the opposite: *too many* members matched
* @see {@link Composite} — groups multiple issues under a non-union schema
*
* @category models
* @since 4.0.0
*/
var AnyOf = class extends Base$1 {
	_tag = "AnyOf";
	/**
	* The schema that caused the issue.
	*/
	ast;
	/**
	* The input value that caused the issue.
	*/
	actual;
	/**
	* The issues that occurred.
	*/
	issues;
	constructor(ast, actual, issues) {
		super();
		this.ast = ast;
		this.actual = actual;
		this.issues = issues;
	}
};
/**
* Represents a schema issue produced when a value matches *multiple* members of a union that is
* configured to allow exactly one match (oneOf mode).
*
* **When to use**
*
* Use when you need to detect ambiguous union matches when `oneOf` validation is
* enabled.
*
* **Details**
*
* - `ast` is the `Union` AST node.
* - `actual` is the raw input value (plain `unknown`).
* - `successes` lists the AST nodes of each member that accepted the input.
* - The default formatter renders this as
*   `"Expected exactly one member to match the input <actual>"`.
*
* @see {@link AnyOf} — the opposite: *no* members matched
*
* @category models
* @since 4.0.0
*/
var OneOf = class extends Base$1 {
	_tag = "OneOf";
	/**
	* The schema that caused the issue.
	*/
	ast;
	/**
	* The input value that caused the issue.
	*/
	actual;
	/**
	* The schemas that were successful.
	*/
	successes;
	constructor(ast, actual, successes) {
		super();
		this.ast = ast;
		this.actual = actual;
		this.successes = successes;
	}
};
function makeFilterIssue(input, entry) {
	if (isIssue(entry)) return entry;
	if (typeof entry === "string") return new InvalidValue(some(input), { message: entry });
	const inner = typeof entry.issue === "string" ? new InvalidValue(some(input), { message: entry.issue }) : entry.issue;
	return new Pointer(entry.path, inner);
}
/** @internal */
function makeSingle(input, out) {
	if (out === void 0) return;
	if (typeof out === "boolean") return out ? void 0 : new InvalidValue(some(input));
	return makeFilterIssue(input, out);
}
/** @internal */
function make$8(input, ast, out) {
	if (Array.isArray(out)) {
		if (isReadonlyArrayNonEmpty(out)) {
			if (out.length === 1) return makeFilterIssue(input, out[0]);
			return new Composite(ast, some(input), map$2(out, (entry) => makeFilterIssue(input, entry)));
		}
		return;
	}
	return makeSingle(input, out);
}
/**
* Returns the built-in {@link LeafHook} used by default formatters.
*
* **When to use**
*
* Use as the default leaf renderer when customizing only the {@link CheckHook}.
*
* **Details**
*
* - Checks for a `message` annotation first; returns it if present.
* - Otherwise generates a default message per `_tag`:
*   - `InvalidType` → `"Expected <type>, got <actual>"`
*   - `InvalidValue` → `"Invalid data <actual>"`
*   - `MissingKey` → `"Missing key"`
*   - `UnexpectedKey` → `"Unexpected key with value <actual>"`
*   - `Forbidden` → `"Forbidden operation"`
*   - `OneOf` → `"Expected exactly one member to match the input <actual>"`
*
* **Example** (Using defaultLeafHook with Standard Schema formatter)
*
* ```ts
* import { SchemaIssue } from "effect"
*
* const formatter = SchemaIssue.makeFormatterStandardSchemaV1({
*   leafHook: SchemaIssue.defaultLeafHook
* })
* ```
*
* @see {@link LeafHook}
* @see {@link makeFormatterStandardSchemaV1}
*
* @category Formatter
* @since 4.0.0
*/
var defaultLeafHook = (issue) => {
	const message = findMessage(issue);
	if (message !== void 0) return message;
	switch (issue._tag) {
		case "InvalidType": return getExpectedMessage(getExpected(issue.ast), formatOption(issue.actual));
		case "InvalidValue": return `Invalid data ${formatOption(issue.actual)}`;
		case "MissingKey": return "Missing key";
		case "UnexpectedKey": return `Unexpected key with value ${format$1(issue.actual)}`;
		case "Forbidden": return "Forbidden operation";
		case "OneOf": return `Expected exactly one member to match the input ${format$1(issue.actual)}`;
	}
};
/**
* Returns the built-in {@link CheckHook} used by default formatters.
*
* **When to use**
*
* Use as the default filter renderer when customizing only the {@link LeafHook}.
*
* **Details**
*
* - Looks for a `message` annotation on the inner issue first, then on the
*   filter itself.
* - Returns `undefined` when no annotation is found, causing the formatter to
*   fall back to `"Expected <filter>, got <actual>"`.
*
* @see {@link CheckHook}
* @see {@link makeFormatterStandardSchemaV1}
*
* @category Formatter
* @since 4.0.0
*/
var defaultCheckHook = (issue) => {
	return findMessage(issue.issue) ?? findMessage(issue);
};
function getExpectedMessage(expected, actual) {
	return `Expected ${expected}, got ${actual}`;
}
function toDefaultIssues(issue, path, leafHook, checkHook) {
	switch (issue._tag) {
		case "Filter": {
			const message = checkHook(issue);
			if (message !== void 0) return [{
				path,
				message
			}];
			switch (issue.issue._tag) {
				case "InvalidValue": return [{
					path,
					message: getExpectedMessage(formatCheck(issue.filter), format$1(issue.actual))
				}];
				default: return toDefaultIssues(issue.issue, path, leafHook, checkHook);
			}
		}
		case "Encoding": return toDefaultIssues(issue.issue, path, leafHook, checkHook);
		case "Pointer": return toDefaultIssues(issue.issue, [...path, ...issue.path], leafHook, checkHook);
		case "Composite": return issue.issues.flatMap((issue) => toDefaultIssues(issue, path, leafHook, checkHook));
		case "AnyOf": {
			const message = findMessage(issue);
			if (issue.issues.length === 0) {
				if (message !== void 0) return [{
					path,
					message
				}];
				return [{
					path,
					message: getExpectedMessage(getExpected(issue.ast), format$1(issue.actual))
				}];
			}
			return issue.issues.flatMap((issue) => toDefaultIssues(issue, path, leafHook, checkHook));
		}
		default: return [{
			path,
			message: leafHook(issue)
		}];
	}
}
function formatCheck(check) {
	const expected = check.annotations?.expected;
	if (typeof expected === "string") return expected;
	switch (check._tag) {
		case "Filter": return "<filter>";
		case "FilterGroup": return check.checks.map((check) => formatCheck(check)).join(" & ");
	}
}
/**
* Creates a {@link Formatter} that converts an {@link Issue} into a
* human-readable multi-line string.
*
* **When to use**
*
* Use when you need to format a `SchemaIssue.Issue` as error messages for
* logging, CLI output, or developer-facing diagnostics.
*
* **Details**
*
* This is the default formatter used by `SchemaIssue.toString()`.
*
* - Flattens the issue tree into `{ message, path }` entries using
*   {@link defaultLeafHook} and {@link defaultCheckHook}.
* - Each entry is rendered as `"<message>"` or `"<message>\n  at <path>"`.
* - Multiple entries are joined with newlines.
*
* **Example** (Formatting an issue as a string)
*
* ```ts
* import { SchemaIssue } from "effect"
*
* const formatter = SchemaIssue.makeFormatterDefault()
* ```
*
* @see {@link makeFormatterStandardSchemaV1} — produces Standard Schema V1 format instead
* @see {@link Formatter}
*
* @category Formatter
* @since 4.0.0
*/
function makeFormatterDefault() {
	return (issue) => toDefaultIssues(issue, [], defaultLeafHook, defaultCheckHook).map(formatDefaultIssue).join("\n");
}
/** @internal */
var defaultFormatter = /*#__PURE__*/ makeFormatterDefault();
function formatDefaultIssue(issue) {
	let out = issue.message;
	if (issue.path && issue.path.length > 0) {
		const path = formatPath(issue.path);
		out += `\n  at ${path}`;
	}
	return out;
}
function findMessage(issue) {
	switch (issue._tag) {
		case "InvalidType":
		case "OneOf":
		case "Composite":
		case "AnyOf": return getMessageAnnotation(issue.ast.annotations);
		case "InvalidValue":
		case "Forbidden": return getMessageAnnotation(issue.annotations);
		case "MissingKey": return getMessageAnnotation(issue.annotations, "messageMissingKey");
		case "UnexpectedKey": return getMessageAnnotation(issue.ast.annotations, "messageUnexpectedKey");
		case "Filter": return getMessageAnnotation(issue.filter.annotations);
		case "Encoding": return findMessage(issue.issue);
	}
}
function getMessageAnnotation(annotations, type = "message") {
	const message = annotations?.[type];
	if (typeof message === "string") return message;
}
function formatOption(actual) {
	if (isNone(actual)) return "no value provided";
	return format$1(actual.value);
}
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/SchemaGetter.js
/**
* Builds one-way conversions used by schemas.
*
* A `Getter<T, E, R>` receives an optional encoded value and returns an
* optional decoded value. It can also report a schema issue or require Effect
* services. Schema transformations use getters to describe one direction of a
* conversion, for example decoding a field from input data. This module
* includes basic getters, validation helpers, pure and effectful conversions,
* and ready-made conversions for common string, number, binary, date, form, and
* URL-related values.
*
* @since 4.0.0
*/
/**
* Represents a composable transformation from an encoded type `E` to a decoded type `T`.
*
* **When to use**
*
* Use when you need a schema getter to build and compose custom transformations
* for `Schema.decodeTo` or `Schema.decode`.
*
* **Details**
*
* A getter wraps a function `Option<E> -> Effect<Option<T>, Issue, R>`. It
* receives `Option.None` when the encoded key is absent, such as a missing
* struct field, and returns `Option.None` to omit the value from the decoded
* output. It fails with `Issue` on invalid input and may require Effect
* services via `R`. `.map(f)` applies `f` to the decoded value inside `Some`
* while leaving `None` unchanged. `.compose(other)` chains two getters by
* feeding the output of `this` into `other`; passthrough getters on either side
* are optimized away.
*
* **Example** (Creating and composing getters)
*
* ```ts
* import { SchemaGetter } from "effect"
*
* const parseNumber = SchemaGetter.transform<number, string>((s) => Number(s))
* const double = SchemaGetter.transform<number, number>((n) => n * 2)
* const composed = parseNumber.compose(double)
* // composed: Getter<number, string> — parses then doubles
* ```
*
* @see {@link transform} to create a getter from a pure function
* @see {@link passthrough} for the identity getter
* @see {@link transformOrFail} for fallible transformation
*
* @category models
* @since 4.0.0
*/
var Getter = class Getter extends Class$1 {
	run;
	constructor(run) {
		super();
		this.run = run;
	}
	map(f) {
		return new Getter((oe, options) => this.run(oe, options).pipe(mapEager(map$3(f))));
	}
	compose(other) {
		if (isPassthrough(this)) return other;
		if (isPassthrough(other)) return this;
		return new Getter((oe, options) => this.run(oe, options).pipe(flatMapEager((ot) => other.run(ot, options))));
	}
};
var passthrough_$1 = /*#__PURE__*/ new Getter(succeed);
function isPassthrough(getter) {
	return getter.run === passthrough_$1.run;
}
function passthrough$1() {
	return passthrough_$1;
}
/**
* Creates a getter that applies a pure function to present values.
*
* **When to use**
*
* Use when you need a schema getter for a pure, infallible transformation
* between types.
* - Building encode/decode pairs for `Schema.decodeTo`.
*
* **Details**
*
* - This is the most commonly used constructor.
* - Transforms `Some(e)` to `Some(f(e))` and leaves `None` unchanged.
* - Skips `None` inputs — only called when a value is present.
* - Never fails.
*
* **Example** (String to number transformation pair)
*
* ```ts
* import { Schema, SchemaGetter } from "effect"
*
* const NumberFromString = Schema.String.pipe(
*   Schema.decodeTo(Schema.Number, {
*     decode: SchemaGetter.transform((s) => Number(s)),
*     encode: SchemaGetter.transform((n) => String(n))
*   })
* )
* ```
*
* @see {@link transformOrFail} when the transformation can fail
* @see {@link transformOptional} when you need to handle `None` inputs
* @see {@link passthrough} when no transformation is needed
*
* @category constructors
* @since 4.0.0
*/
function transform$1(f) {
	return transformOptional(map$3(f));
}
/**
* Creates a getter that transforms the full `Option` — both present and absent values.
*
* **When to use**
*
* Use when you need a schema getter to handle both `Some` and `None` cases.
*
* **Details**
*
* The getter is pure and never fails. It receives the full `Option<E>` and
* must return `Option<T>`, so it can turn a present value into absent or an
* absent value into present.
*
* **Example** (Filter out empty strings)
*
* ```ts
* import { Option, SchemaGetter } from "effect"
*
* const skipEmpty = SchemaGetter.transformOptional<string, string>((o) =>
*   Option.filter(o, (s) => s.length > 0)
* )
* ```
*
* @see {@link transform} when you only need to transform present values
* @see {@link omit} when you always want `None`
*
* @category constructors
* @since 4.0.0
*/
function transformOptional(f) {
	return new Getter((oe) => succeed(f(oe)));
}
/**
* Creates a getter that replaces `undefined` values with a default.
*
* **When to use**
*
* Use when you need a schema getter to provide a fallback for a field that may
* be `undefined` in the encoded input.
*
* **Details**
*
* - If the input is `Some(undefined)` or `None`, produces `Some(T)`.
* - If the input is `Some(value)` where value is not `undefined`, passes it through.
* - `defaultValue` is an `Effect` that will be executed each time a default is needed.
*
* **Example** (Default value for optional field)
*
* ```ts
* import { Effect, SchemaGetter } from "effect"
*
* const withZero = SchemaGetter.withDefault(Effect.succeed(0))
* // Getter<number, number | undefined>
* ```
*
* @see {@link onNone} to handle only absent keys (not `undefined` values)
* @see {@link required} when absent input should fail instead of using a default
*
* @category constructors
* @since 4.0.0
*/
function withDefault(defaultValue) {
	return new Getter((o) => {
		const filtered = filter(o, isNotUndefined);
		return isSome(filtered) ? succeed(filtered) : mapEager(defaultValue, some);
	});
}
/**
* Coerces any value to a `string` using the global `String()` constructor.
*
* **When to use**
*
* Use when you need a schema getter to coerce a present encoded value to a
* string with `String()`.
*
* **Details**
*
* The getter is pure, never fails, and delegates to `globalThis.String`.
*
* **Example** (Coerce to string)
*
* ```ts
* import { SchemaGetter } from "effect"
*
* const toString = SchemaGetter.String<number>()
* // Getter<string, number>
* ```
*
* @see {@link transform} for custom string conversions
*
* @category Coercions
* @since 4.0.0
*/
function String$3() {
	return transform$1(globalThis.String);
}
/**
* Coerces any value to a `number` using the global `Number()` constructor.
*
* **When to use**
*
* Use when you need a schema getter to coerce a present encoded value to a
* number with `Number()`.
*
* **Details**
*
* The getter is pure, never fails, and delegates to `globalThis.Number`. It may
* produce `NaN` for non-numeric inputs.
*
* **Example** (Coerce to number)
*
* ```ts
* import { SchemaGetter } from "effect"
*
* const toNumber = SchemaGetter.Number<string>()
* // Getter<number, string>
* ```
*
* @see {@link transformOrFail} for validated number parsing
*
* @category Coercions
* @since 4.0.0
*/
function Number$3() {
	return transform$1(globalThis.Number);
}
/**
* Coerces a value to `bigint` using the global `BigInt()` constructor.
*
* **When to use**
*
* Use when you need a schema getter to convert a present string, number, or
* boolean value to `bigint`.
*
* **Details**
*
* - Delegates to `globalThis.BigInt`.
* - Throws at runtime if the input cannot be converted (e.g. non-numeric string).
*
* **Example** (Coerce to bigint)
*
* ```ts
* import { SchemaGetter } from "effect"
*
* const toBigInt = SchemaGetter.BigInt<string>()
* // Getter<bigint, string>
* ```
*
* @category Coercions
* @since 4.0.0
*/
function BigInt$3() {
	return transform$1(globalThis.BigInt);
}
/**
* Coerces a value to a `Date` using `new Date(input)`.
*
* **When to use**
*
* Use when you need a schema getter to coerce a present string, number, or
* existing date object into a new date object.
*
* **Details**
*
* - Delegates to `new globalThis.Date(input)`.
* - Does not validate the result — may produce an invalid Date.
*
* **Example** (Coerce to Date)
*
* ```ts
* import { SchemaGetter } from "effect"
*
* const toDate = SchemaGetter.Date<string>()
* // Getter<Date, string>
* ```
*
* @see {@link dateTimeUtcFromInput} for validated DateTime parsing
*
* @category Coercions
* @since 4.0.0
*/
function Date$2() {
	return transform$1((u) => new globalThis.Date(u));
}
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/SchemaTransformation.js
var TypeId$5 = "~effect/SchemaTransformation/Transformation";
/**
* Represents a bidirectional transformation between a decoded type `T` and an encoded
* type `E`, built from a pair of `Getter`s.
*
* **When to use**
*
* Use when you need a schema transformation that defines how a schema converts
* between two representations.
* - You want to compose multiple transformations into a pipeline.
* - You want to flip a transformation to swap decode/encode.
*
* **Details**
*
* This is the primary building block for `Schema.decodeTo`, `Schema.encodeTo`,
* `Schema.decode`, `Schema.encode`, and `Schema.link`. Each direction is a
* `SchemaGetter.Getter` that handles optionality, failure, and Effect services.
*
* - Immutable — `flip()` and `compose()` return new instances.
* - `flip()` swaps the decode and encode getters.
* - `compose(other)` chains: `this.decode` then `other.decode` for decoding,
*   `other.encode` then `this.encode` for encoding.
*
* **Example** (Composing two transformations)
*
* ```ts
* import { SchemaTransformation } from "effect"
*
* const trimAndLower = SchemaTransformation.trim().compose(
*   SchemaTransformation.toLowerCase()
* )
* // decode: trim then lowercase
* // encode: passthrough (both directions)
* ```
*
* @see {@link make} — construct from `{ decode, encode }` getters
* @see {@link transform} — construct from pure functions
* @see {@link transformOrFail} — construct from effectful functions
* @see {@link Middleware} — effect-pipeline-level alternative
*
* @category models
* @since 4.0.0
*/
var Transformation = class Transformation {
	[TypeId$5] = TypeId$5;
	_tag = "Transformation";
	decode;
	encode;
	constructor(decode, encode) {
		this.decode = decode;
		this.encode = encode;
	}
	flip() {
		return new Transformation(this.encode, this.decode);
	}
	compose(other) {
		return new Transformation(this.decode.compose(other.decode), other.encode.compose(this.encode));
	}
};
/**
* Returns `true` if `u` is a `Transformation` instance.
*
* **When to use**
*
* Use to check whether a value is already a schema transformation before
* wrapping it.
*
* **Details**
*
* - Pure predicate, no side effects.
* - Acts as a TypeScript type guard.
*
* **Example** (Checking a value)
*
* ```ts
* import { SchemaTransformation } from "effect"
*
* SchemaTransformation.isTransformation(SchemaTransformation.trim())
* // true
*
* SchemaTransformation.isTransformation({ decode: null, encode: null })
* // false
* ```
*
* @see {@link Transformation}
* @see {@link make}
*
* @category guards
* @since 4.0.0
*/
function isTransformation(u) {
	return hasProperty(u, TypeId$5);
}
/**
* Constructs a `Transformation` from an object with `decode` and `encode`
* `Getter`s. If the input is already a `Transformation`, returns it as-is.
*
* **When to use**
*
* Use when you already have schema getter instances and want to pair them into
* a schema transformation.
* - You want idempotent wrapping (won't double-wrap).
*
* **Details**
*
* - Returns the input unchanged if it is already a `Transformation`.
*
* **Example** (Wrapping existing getters)
*
* ```ts
* import { SchemaGetter, SchemaTransformation } from "effect"
*
* const t = SchemaTransformation.make({
*   decode: SchemaGetter.transform<number, string>((s) => Number(s)),
*   encode: SchemaGetter.transform<string, number>((n) => String(n))
* })
* ```
*
* @see {@link transform} — simpler constructor from pure functions
* @see {@link transformOrFail} — constructor from effectful functions
* @see {@link Transformation}
*
* @category constructors
* @since 3.10.0
*/
var make$7 = (options) => {
	if (isTransformation(options)) return options;
	return new Transformation(options.decode, options.encode);
};
var passthrough_ = /*#__PURE__*/ new Transformation(/*#__PURE__*/ passthrough$1(), /*#__PURE__*/ passthrough$1());
function passthrough() {
	return passthrough_;
}
/**
* Decodes a `string` into a `number` and encodes a `number` back to a
* `string`.
*
* **When to use**
*
* Use when you need a schema transformation to parse numeric strings from APIs,
* form data, or URL parameters.
*
* **Details**
*
* Decoding coerces the string to a number like `Number(s)`. Encoding coerces
* the number to a string like `String(n)`. This does not validate that the
* result is finite; combine with `Schema.Finite` or `Schema.Int` for stricter
* checks.
*
* **Example** (Number from string)
*
* ```ts
* import { Schema, SchemaTransformation } from "effect"
*
* const schema = Schema.String.pipe(
*   Schema.decodeTo(Schema.Number, SchemaTransformation.numberFromString)
* )
* ```
*
* @see {@link bigintFromString}
* @see {@link transform}
*
* @category Coercions
* @since 4.0.0
*/
var numberFromString = /*#__PURE__*/ new Transformation(/*#__PURE__*/ Number$3(), /*#__PURE__*/ String$3());
/**
* Decodes a `string` into a `bigint` and encodes a `bigint` back to a
* `string`.
*
* **When to use**
*
* Use when you need a schema transformation to parse large integer strings
* (e.g. database IDs, blockchain values).
*
* **Details**
*
* Decoding coerces the string to a bigint like `BigInt(s)`. Encoding coerces
* the bigint to a string like `String(n)`. Decoding fails if the string is not
* a valid bigint representation.
*
* **Example** (BigInt from string)
*
* ```ts
* import { Schema, SchemaTransformation } from "effect"
*
* const schema = Schema.String.pipe(
*   Schema.decodeTo(Schema.BigInt, SchemaTransformation.bigintFromString)
* )
* ```
*
* @see {@link numberFromString}
* @see {@link transform}
*
* @category Coercions
* @since 4.0.0
*/
var bigintFromString = /*#__PURE__*/ new Transformation(/*#__PURE__*/ BigInt$3(), /*#__PURE__*/ String$3());
/**
* Decodes a `string` into a `Date` and encodes a `Date` back to a `string`.
*
* **When to use**
*
* Use when you need a schema transformation to parse ISO 8601 date strings from
* APIs or user input.
*
* **Details**
*
* Decoding creates a `Date` from the string like `new Date(s)`. Encoding
* converts the `Date` to an ISO string like `date.toISOString()`, returning
* `"Invalid Date"` for invalid dates.
*
* **Example** (Date from string)
*
* ```ts
* import { Schema, SchemaTransformation } from "effect"
*
* const schema = Schema.String.pipe(
*   Schema.decodeTo(Schema.Date, SchemaTransformation.dateFromString)
* )
* ```
*
* @see {@link numberFromString}
* @see {@link dateTimeUtcFromString}
*
* @category Coercions
* @since 4.0.0
*/
var dateFromString = /*#__PURE__*/ new Transformation(/*#__PURE__*/ Date$2(), /*#__PURE__*/ transform$1(formatDate));
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/SchemaAST.js
/**
* Represents Effect schemas as runtime trees.
*
* Every `Schema` has an AST made from nodes for declarations, primitives,
* literals, arrays, objects, unions, suspended schemas, checks, annotations,
* encoding links, and parsing context. Most users work with the higher-level
* `Schema` module. Use `SchemaAST` when you need to inspect schema nodes, build
* ASTs programmatically, change encoded or decoded views, collect issues, or
* run low-level schema checks.
*
* @since 4.0.0
*/
function makeGuard(tag) {
	return (ast) => ast._tag === tag;
}
/**
* Narrows an {@link AST} to {@link Declaration}.
*
* **When to use**
*
* Use to recognize declaration AST nodes before running declaration-specific
* handling.
*
* @see {@link Declaration} for the AST node type narrowed by this guard
*
* @category guards
* @since 3.10.0
*/
var isDeclaration = /*#__PURE__*/ makeGuard("Declaration");
/**
* Narrows an {@link AST} to {@link Never}.
*
* **When to use**
*
* Use to detect the AST node for a schema that can never match before handling
* other schema variants.
*
* @see {@link Never} for the AST node type narrowed by this guard
* @see {@link never} for the singleton `Never` AST instance
*
* @category guards
* @since 4.0.0
*/
var isNever = /*#__PURE__*/ makeGuard("Never");
/**
* Narrows an {@link AST} to {@link Literal}.
*
* **When to use**
*
* Use to recognize exact string, number, boolean, or bigint literal AST nodes.
*
* @see {@link Literal} for the AST node type narrowed by this guard
* @see {@link LiteralValue} for the values stored by literal nodes
*
* @category guards
* @since 3.10.0
*/
var isLiteral = /*#__PURE__*/ makeGuard("Literal");
/**
* Narrows an {@link AST} to {@link UniqueSymbol}.
*
* @category guards
* @since 3.10.0
*/
var isUniqueSymbol = /*#__PURE__*/ makeGuard("UniqueSymbol");
/**
* Narrows an {@link AST} to {@link Arrays}.
*
* **When to use**
*
* Use to recognize array-like AST nodes before reading their element, rest, or
* mutability metadata.
*
* @see {@link Arrays} for the AST node type narrowed by this guard
*
* @category guards
* @since 4.0.0
*/
var isArrays = /*#__PURE__*/ makeGuard("Arrays");
/**
* Narrows an {@link AST} to {@link Objects}.
*
* @category guards
* @since 4.0.0
*/
var isObjects = /*#__PURE__*/ makeGuard("Objects");
/**
* Narrows an {@link AST} to {@link Union}.
*
* @category guards
* @since 3.10.0
*/
var isUnion = /*#__PURE__*/ makeGuard("Union");
/**
* Represents a single step in an {@link Encoding} chain.
*
* **Details**
*
* A link pairs a target {@link AST} with a `Transformation` or `Middleware`
* that converts values between the current node and the target.
*
* - `to` — the AST node on the other side of this transformation step.
* - `transformation` — the bidirectional conversion logic (decode/encode).
*
* Links are composed into a non-empty array ({@link Encoding}) attached to
* AST nodes that have a different encoded representation.
*
* @see {@link Encoding}
* @see {@link decodeTo}
* @category models
* @since 4.0.0
*/
var Link = class {
	to;
	transformation;
	constructor(to, transformation) {
		this.to = to;
		this.transformation = transformation;
	}
};
/** @internal */
var defaultParseOptions = {};
/**
* Represents per-property metadata attached to AST nodes via {@link Base.context}.
*
* **Details**
*
* Tracks whether a property key is optional, mutable, has a constructor
* default, or carries key-level annotations. Typically set by helpers like
* {@link optionalKey} and `Schema.mutableKey`.
*
* - `isOptional` — the property key may be absent from the input.
* - `isMutable` — the property is `readonly` when `false`.
* - `defaultValue` — an {@link Encoding} applied during construction to
*   supply missing values.
* - `annotations` — key-level annotations (e.g. description of the key
*   itself).
*
* @see {@link optionalKey}
* @see {@link isOptional}
* @category models
* @since 4.0.0
*/
var Context = class {
	isOptional;
	isMutable;
	/** Used for constructor default values (e.g. `withConstructorDefault` API) */
	defaultValue;
	annotations;
	constructor(isOptional, isMutable, defaultValue = void 0, annotations = void 0) {
		this.isOptional = isOptional;
		this.isMutable = isMutable;
		this.defaultValue = defaultValue;
		this.annotations = annotations;
	}
};
var TypeId$4 = "~effect/Schema";
/**
* Represents the abstract base class for all {@link AST} node variants.
*
* **Details**
*
* Every AST node extends `Base` and inherits these fields:
*
* - `annotations` — user-supplied metadata (identifier, title, description,
*   arbitrary keys).
* - `checks` — optional {@link Checks} for post-type-match validation.
* - `encoding` — optional {@link Encoding} chain for type ↔ wire
*   transformations.
* - `context` — optional {@link Context} for per-property metadata.
*
* Subclasses add a `_tag` discriminant and variant-specific data.
*
* @see {@link AST}
* @category models
* @since 4.0.0
*/
var Base = class {
	[TypeId$4] = TypeId$4;
	annotations;
	checks;
	encoding;
	context;
	constructor(annotations = void 0, checks = void 0, encoding = void 0, context = void 0) {
		this.annotations = annotations;
		this.checks = checks;
		this.encoding = encoding;
		this.context = context;
	}
	toString() {
		return `<${this._tag}>`;
	}
};
/**
* AST node for user-defined opaque types with custom parsing logic.
*
* **When to use**
*
* Use when you need a custom schema AST node because none of the built-in
* nodes fit.
*
* **Details**
*
* - `typeParameters` — inner schemas this declaration is parameterized over
*   (e.g. the element type for a custom collection).
* - `run` — factory that receives `typeParameters` and returns a parser that
*   validates or transforms raw input.
*
* @see {@link isDeclaration}
* @category models
* @since 3.10.0
*/
var Declaration = class Declaration extends Base {
	_tag = "Declaration";
	typeParameters;
	run;
	encodingChecks;
	constructor(typeParameters, run, annotations, checks, encoding, context, encodingChecks) {
		super(annotations, checks, encoding, context);
		this.typeParameters = typeParameters;
		this.run = run;
		this.encodingChecks = encodingChecks;
	}
	/** @internal */
	getParser() {
		const run = this.run(this.typeParameters);
		return (oinput, options) => {
			if (isNone(oinput)) return succeedNone;
			return mapEager(run(oinput.value, this, options), some);
		};
	}
	rebuild(recur, checks, encodingChecks) {
		const tps = mapOrSame(this.typeParameters, recur);
		return tps === this.typeParameters ? this : new Declaration(tps, this.run, this.annotations, checks, void 0, this.context, encodingChecks);
	}
	/** @internal */
	recur(recur) {
		return this.rebuild(recur, this.checks, this.encodingChecks);
	}
	/** @internal */
	flip(recur) {
		return this.rebuild(recur, this.encodingChecks, this.checks);
	}
	/** @internal */
	getExpected() {
		const expected = this.annotations?.expected;
		if (typeof expected === "string") return expected;
		return "<Declaration>";
	}
};
/**
* AST node matching the `null` literal value.
*
* **Details**
*
* Parsing succeeds only when the input is exactly `null`.
*
* @see {@link null_ null}
* @see {@link isNull}
* @category models
* @since 4.0.0
*/
var Null$1 = class extends Base {
	_tag = "Null";
	/** @internal */
	getParser() {
		return fromConst(this, null);
	}
	/** @internal */
	getExpected() {
		return "null";
	}
};
var null_ = /*#__PURE__*/ new Null$1();
/**
* AST node matching the `undefined` value.
*
* **Details**
*
* Parsing succeeds only when the input is exactly `undefined`.
*
* @see {@link undefined}
* @see {@link isUndefined}
* @category models
* @since 4.0.0
*/
var Undefined$1 = class extends Base {
	_tag = "Undefined";
	/** @internal */
	getParser() {
		return fromConst(this, void 0);
	}
	/** @internal */
	toCodecJson() {
		return replaceEncoding(this, [undefinedToNull]);
	}
	/** @internal */
	getExpected() {
		return "undefined";
	}
};
var undefinedToNull = /*#__PURE__*/ new Link(null_, /*#__PURE__*/ new Transformation(/*#__PURE__*/ transform$1(() => void 0), /*#__PURE__*/ transform$1(() => null)));
var undefined_ = /*#__PURE__*/ new Undefined$1();
/**
* AST node representing the `any` type — every value matches.
*
* @see {@link any}
* @see {@link isAny}
*
* @category models
* @since 4.0.0
*/
var Any$1 = class extends Base {
	_tag = "Any";
	/** @internal */
	getParser() {
		return fromRefinement(this, isUnknown);
	}
	/** @internal */
	getExpected() {
		return "any";
	}
};
/**
* Provides the singleton {@link Any} AST instance.
*
* **When to use**
*
* Use when you need the singleton AST node for the TypeScript `any` type and
* intentionally want parsing to accept every input value.
*
* @see {@link unknown} for the sibling AST singleton that also accepts every value while preserving the safer `unknown` type
*
* @category constructors
* @since 4.0.0
*/
var any = /*#__PURE__*/ new Any$1();
/**
* AST node representing the `unknown` type — every value matches.
*
* **Details**
*
* Unlike {@link Any}, this is type-safe: the parsed result is typed as
* `unknown` rather than `any`.
*
* @see {@link unknown}
* @see {@link isUnknown}
* @category models
* @since 4.0.0
*/
var Unknown$1 = class extends Base {
	_tag = "Unknown";
	/** @internal */
	getParser() {
		return fromRefinement(this, isUnknown);
	}
	/** @internal */
	getExpected() {
		return "unknown";
	}
};
/**
* Provides the singleton {@link Unknown} AST instance.
*
* **When to use**
*
* Use when you need the reusable AST singleton for a schema node that accepts
* every value while keeping parsed values opaque.
*
* @see {@link any} for the singleton that accepts every value as `any`
*
* @category constructors
* @since 4.0.0
*/
var unknown = /*#__PURE__*/ new Unknown$1();
/**
* AST node matching the TypeScript `object` type — accepts objects, arrays,
* and functions (anything non-primitive and non-null).
*
* @see {@link objectKeyword}
* @see {@link isObjectKeyword}
*
* @category models
* @since 3.10.0
*/
var ObjectKeyword$1 = class extends Base {
	_tag = "ObjectKeyword";
	/** @internal */
	getParser() {
		return fromRefinement(this, isObjectKeyword);
	}
	/** @internal */
	getExpected() {
		return "object | array | function";
	}
};
/**
* Provides the singleton {@link ObjectKeyword} AST instance.
*
* **When to use**
*
* Use to reuse the canonical AST node for the TypeScript `object` keyword when
* building or comparing `SchemaAST` values directly.
*
* @see {@link ObjectKeyword} for the AST node class
* @see {@link isObjectKeyword} for narrowing an AST to an `ObjectKeyword` node
*
* @category constructors
* @since 3.10.0
*/
var objectKeyword = /*#__PURE__*/ new ObjectKeyword$1();
/**
* AST node matching an exact primitive value (string, number, boolean, or
* bigint).
*
* **Details**
*
* Parsing succeeds only when the input is strictly equal (`===`) to the
* stored `literal`. Numeric literals must be finite — `Infinity`, `-Infinity`,
* and `NaN` are rejected at construction time.
*
* **Example** (Creating a literal AST)
*
* ```ts
* import { SchemaAST } from "effect"
*
* const ast = new SchemaAST.Literal("active")
* console.log(ast.literal) // "active"
* ```
*
* @see {@link LiteralValue}
* @see {@link isLiteral}
* @category models
* @since 3.10.0
*/
var Literal$1 = class extends Base {
	_tag = "Literal";
	literal;
	constructor(literal, annotations, checks, encoding, context) {
		super(annotations, checks, encoding, context);
		if (typeof literal === "number" && !globalThis.Number.isFinite(literal)) throw new Error(`A numeric literal must be finite, got ${format$1(literal)}`);
		this.literal = literal;
	}
	/** @internal */
	getParser() {
		return fromConst(this, this.literal);
	}
	/** @internal */
	toCodecJson() {
		return typeof this.literal === "bigint" ? literalToString(this) : this;
	}
	/** @internal */
	toCodecStringTree() {
		return typeof this.literal === "string" ? this : literalToString(this);
	}
	/** @internal */
	getExpected() {
		return typeof this.literal === "string" ? JSON.stringify(this.literal) : globalThis.String(this.literal);
	}
};
function literalToString(ast) {
	const literalAsString = globalThis.String(ast.literal);
	return replaceEncoding(ast, [new Link(new Literal$1(literalAsString), new Transformation(transform$1(() => ast.literal), transform$1(() => literalAsString)))]);
}
/**
* AST node matching any `string` value.
*
* @see {@link string}
* @see {@link isString}
*
* @category models
* @since 4.0.0
*/
var String$2 = class extends Base {
	_tag = "String";
	/** @internal */
	getParser() {
		return fromRefinement(this, isString);
	}
	/** @internal */
	getExpected() {
		return "string";
	}
};
/**
* Provides the singleton {@link String} AST instance.
*
* **When to use**
*
* Use as the shared `SchemaAST` node for unconstrained JavaScript strings.
*
* @see {@link String} for the AST node class
* @see {@link isString} for narrowing an AST to a string node
*
* @category constructors
* @since 4.0.0
*/
var string = /*#__PURE__*/ new String$2();
/**
* AST node matching any `number` value (including `NaN`, `Infinity`,
* `-Infinity`).
*
* **Details**
*
* Default JSON serialization:
*
* - Finite numbers are serialized as JSON numbers.
* - `Infinity`, `-Infinity`, and `NaN` are serialized as JSON strings.
*
* If the node has an `isFinite` or `isInt` check, the string fallback is
* skipped since non-finite values cannot occur.
*
* @see {@link number}
* @see {@link isNumber}
* @category models
* @since 4.0.0
*/
var Number$2 = class extends Base {
	_tag = "Number";
	/** @internal */
	getParser() {
		return fromRefinement(this, isNumber);
	}
	/** @internal */
	toCodecJson() {
		if (this.checks && (hasCheck(this.checks, "isFinite") || hasCheck(this.checks, "isInt"))) return this;
		return replaceEncoding(this, [numberToJson]);
	}
	/** @internal */
	toCodecStringTree() {
		if (this.checks && (hasCheck(this.checks, "isFinite") || hasCheck(this.checks, "isInt"))) return replaceEncoding(this, [finiteToString]);
		return replaceEncoding(this, [numberToString]);
	}
	/** @internal */
	getExpected() {
		return "number";
	}
};
function hasCheck(checks, tag) {
	return checks.some((c) => {
		switch (c._tag) {
			case "Filter": return c.annotations?.meta?._tag === tag;
			case "FilterGroup": return hasCheck(c.checks, tag);
		}
	});
}
/**
* Provides the singleton {@link Number} AST instance.
*
* **When to use**
*
* Use when you need the canonical `SchemaAST` node for schemas that accept any
* JavaScript number value.
*
* @see {@link Number} for the AST node class and serialization behavior
* @see {@link Literal} for exact finite numeric literal AST nodes
*
* @category constructors
* @since 4.0.0
*/
var number = /*#__PURE__*/ new Number$2();
/**
* AST node matching any `boolean` value (`true` or `false`).
*
* @see {@link boolean}
* @see {@link isBoolean}
*
* @category models
* @since 4.0.0
*/
var Boolean$2 = class extends Base {
	_tag = "Boolean";
	/** @internal */
	getParser() {
		return fromRefinement(this, isBoolean);
	}
	/** @internal */
	getExpected() {
		return "boolean";
	}
};
/**
* Provides the singleton {@link Boolean} AST instance.
*
* **When to use**
*
* Use to reuse the standard AST node that accepts either `true` or `false` when
* constructing schema ASTs directly.
*
* @see {@link Boolean} for the AST node class
* @see {@link Literal} for exact boolean literal AST nodes
*
* @category constructors
* @since 4.0.0
*/
var boolean = /*#__PURE__*/ new Boolean$2();
/**
* AST node matching any `bigint` value.
*
* **Details**
*
* When serialized to a string-based codec, bigints are converted to/from
* their decimal string representation.
*
* @see {@link bigInt}
* @see {@link isBigInt}
* @category models
* @since 4.0.0
*/
var BigInt$2 = class extends Base {
	_tag = "BigInt";
	/** @internal */
	getParser() {
		return fromRefinement(this, isBigInt);
	}
	/** @internal */
	toCodecStringTree() {
		return replaceEncoding(this, [bigIntToString]);
	}
	/** @internal */
	getExpected() {
		return "bigint";
	}
};
/**
* Provides the singleton {@link BigInt} AST instance.
*
* **When to use**
*
* Use to reuse the canonical `BigInt` AST node when constructing, inspecting,
* or transforming schemas at the AST level.
*
* @see {@link BigInt} for the AST node class and string-codec behavior
* @see {@link isBigInt} for narrowing an AST to a `BigInt` node
*
* @category constructors
* @since 4.0.0
*/
var bigInt = /*#__PURE__*/ new BigInt$2();
/**
* AST node for array-like types — both tuples and arrays.
*
* **When to use**
*
* Use when constructing or inspecting AST nodes for tuple or array-like schemas,
* including rest elements.
*
* **Details**
*
* - `elements` — positional element types (tuple elements). An element is
*   optional if its {@link Context.isOptional} is `true`.
* - `rest` — the rest/variadic element types. When non-empty, the first
*   entry is the "spread" type (e.g. `...Array<string>`), and subsequent
*   entries are trailing positional elements after the spread.
* - `isMutable` — whether the resulting array is `readonly` (`false`) or
*   mutable (`true`).
*
* **Gotchas**
*
* Construction enforces TypeScript ordering rules: a required element
* cannot follow an optional one, and an optional element cannot follow a
* rest element.
*
* **Example** (Inspecting a tuple AST)
*
* ```ts
* import { Schema, SchemaAST } from "effect"
*
* const schema = Schema.Tuple([Schema.String, Schema.Number])
* const ast = schema.ast
*
* if (SchemaAST.isArrays(ast)) {
*   console.log(ast.elements.length) // 2
*   console.log(ast.rest.length)     // 0
* }
* ```
*
* @see {@link isArrays}
* @see {@link Objects}
* @category models
* @since 4.0.0
*/
var Arrays = class Arrays extends Base {
	_tag = "Arrays";
	isMutable;
	elements;
	rest;
	encodingChecks;
	constructor(isMutable, elements, rest, annotations, checks, encoding, context, encodingChecks) {
		super(annotations, checks, encoding, context);
		this.isMutable = isMutable;
		this.elements = elements;
		this.rest = rest;
		this.encodingChecks = encodingChecks;
		const i = elements.findIndex(isOptional$1);
		if (i !== -1 && (elements.slice(i + 1).some((e) => !isOptional$1(e)) || rest.length > 1)) throw new Error("A required element cannot follow an optional element. ts(1257)");
		if (rest.length > 1 && rest.slice(1).some(isOptional$1)) throw new Error("An optional element cannot follow a rest element. ts(1266)");
	}
	/** @internal */
	getParser(recur) {
		const ast = this;
		const elements = ast.elements.map((ast) => ({
			ast,
			parser: recur(ast)
		}));
		const rest = ast.rest.map((ast) => ({
			ast,
			parser: recur(ast)
		}));
		const elementLen = elements.length;
		const [head, ...tail] = rest;
		const tailLen = tail.length;
		function getParser(tailThreshold, index) {
			if (index < elementLen) return elements[index];
			else if (index >= tailThreshold) return tail[index - tailThreshold];
			return head;
		}
		return fnUntracedEager(function* (oinput, options) {
			if (oinput._tag === "None") return oinput;
			const input = oinput.value;
			if (!Array.isArray(input)) return yield* fail(new InvalidType(ast, oinput));
			const len = input.length;
			const state = {
				ast,
				getParser,
				oinput,
				len,
				tailThreshold: resolveTailThreshold(len, elementLen, tailLen),
				output: new globalThis.Array(len),
				issues: void 0,
				options
			};
			const eff = parseArray(state, input, {
				concurrency: resolveConcurrency(options?.concurrency)?.concurrency,
				end: ast.rest.length === 0 ? elementLen : Math.max(len, elementLen + tailLen)
			});
			if (eff) yield* eff;
			if (ast.rest.length === 0 && len > elementLen) for (let i = elementLen; i <= len - 1; i++) {
				const issue = new Pointer([i], new UnexpectedKey(ast, input[i]));
				if (options.errors === "all") if (state.issues) state.issues.push(issue);
				else state.issues = [issue];
				else return yield* fail(new Composite(ast, oinput, [issue]));
			}
			if (state.issues) return yield* fail(new Composite(ast, oinput, state.issues));
			return some(state.output);
		});
	}
	rebuild(recur, checks, encodingChecks) {
		const elements = mapOrSame(this.elements, recur);
		const rest = mapOrSame(this.rest, recur);
		return elements === this.elements && rest === this.rest ? this : new Arrays(this.isMutable, elements, rest, this.annotations, checks, void 0, this.context, encodingChecks);
	}
	/** @internal */
	recur(recur) {
		return this.rebuild(recur, this.checks, this.encodingChecks);
	}
	/** @internal */
	flip(recur) {
		return this.rebuild(recur, this.encodingChecks, this.checks);
	}
	/** @internal */
	getExpected() {
		return "array";
	}
};
var parseArray = /*#__PURE__*/ iterateEager()({
	onItem(s, item, i) {
		const value = i < s.len ? some(item) : none();
		return s.getParser(s.tailThreshold, i).parser(value, s.options);
	},
	step(s, _, exit, i) {
		if (exit._tag === "Failure") return wrapPropertyKeyIssue(s, s.ast, i, exit);
		else if (exit.value._tag === "Some") s.output[i] = exit.value.value;
		else {
			const p = s.getParser(s.tailThreshold, i);
			if (isOptional$1(p.ast)) return;
			const issue = new Pointer([i], new MissingKey(p.ast.context?.annotations));
			if (s.options.errors === "all") if (s.issues) s.issues.push(issue);
			else s.issues = [issue];
			else return fail$1(new Composite(s.ast, s.oinput, [issue]));
		}
	}
});
function resolveTailThreshold(inputLen, elementLen, tailLen) {
	return Math.max(elementLen, inputLen - tailLen);
}
var resolveConcurrency = (value) => {
	value = value === "unbounded" ? Infinity : value ?? 1;
	return value > 1 ? { concurrency: value } : void 0;
};
var wrapPropertyKeyIssue = (s, ast, key, exit) => {
	const issueResult = findError(exit.cause);
	if (isFailure(issueResult)) return exit;
	const issue = new Pointer([key], issueResult.success);
	if (s.options.errors === "all") if (s.issues) s.issues.push(issue);
	else s.issues = [issue];
	else return fail$1(new Composite(ast, s.oinput, [issue]));
};
/**
* floating point or integer, with optional exponent
* @internal
*/
var FINITE_PATTERN = "[+-]?\\d*\\.?\\d+(?:[Ee][+-]?\\d+)?";
var isNumberStringRegExp = /*#__PURE__*/ new globalThis.RegExp(`(?:${FINITE_PATTERN}|Infinity|-Infinity|NaN)`);
/**
* Returns the object keys that match the index signature parameter schema.
* @internal
*/
function getIndexSignatureKeys(input, parameter) {
	const encoded = toEncoded(parameter);
	switch (encoded._tag) {
		case "String": return Object.keys(input);
		case "TemplateLiteral": {
			const regExp = getTemplateLiteralRegExp(encoded);
			return Object.keys(input).filter((k) => regExp.test(k));
		}
		case "Symbol": return Object.getOwnPropertySymbols(input);
		case "Number": return Object.keys(input).filter((k) => isNumberStringRegExp.test(k));
		case "Union": return [...new Set(encoded.types.flatMap((t) => getIndexSignatureKeys(input, t)))];
		default: return [];
	}
}
/**
* Represents a named property within an {@link Objects} node.
*
* **Details**
*
* Pairs a `name` (any `PropertyKey`) with a `type` ({@link AST}). The
* property's optionality and mutability are determined by the `type`'s
* {@link Context}.
*
* @see {@link Objects}
* @category models
* @since 3.10.0
*/
var PropertySignature = class {
	name;
	type;
	constructor(name, type) {
		this.name = name;
		this.type = type;
	}
};
/**
* Represents a bidirectional merge strategy for index signature key-value pairs.
*
* **Details**
*
* Used by {@link IndexSignature} when the same key appears multiple times
* (e.g. from `Schema.extend` or overlapping records). Provides separate
* `decode` and `encode` combiners that determine how duplicate entries are
* merged.
*
* @see {@link IndexSignature}
* @category models
* @since 4.0.0
*/
var KeyValueCombiner = class KeyValueCombiner {
	decode;
	encode;
	constructor(decode, encode) {
		this.decode = decode;
		this.encode = encode;
	}
	/** @internal */
	flip() {
		return new KeyValueCombiner(this.encode, this.decode);
	}
};
/**
* Represents an index signature entry within an {@link Objects} node.
*
* **When to use**
*
* Use when constructing or inspecting object AST entries for record-like keys
* and values.
*
* **Details**
*
* - `parameter` — the key type AST (e.g. {@link String} for `string` keys,
*   {@link TemplateLiteral} for patterned keys).
* - `type` — the value type SchemaAST.
* - `merge` — optional {@link KeyValueCombiner} for handling duplicate keys.
*
* **Gotchas**
*
* Using `Schema.optionalKey` on the value type is not allowed for index
* signatures (throws at construction); use `Schema.optional` instead.
*
* @see {@link Objects}
* @see {@link PropertySignature}
* @category models
* @since 3.10.0
*/
var IndexSignature = class {
	parameter;
	type;
	merge;
	constructor(parameter, type, merge) {
		this.parameter = parameter;
		this.type = type;
		this.merge = merge;
		if (isOptional$1(type) && !containsUndefined(type)) throw new Error("Cannot use `Schema.optionalKey` with index signatures, use `Schema.optional` instead.");
	}
};
/**
* AST node for object-like schemas, including structs and records.
*
* **When to use**
*
* Use when constructing or inspecting AST nodes for structs or records rather
* than array-like schemas.
*
* **Details**
*
* - `propertySignatures` — named properties with their types (struct fields).
* - `indexSignatures` — index signature entries (record patterns), each with
*   a `parameter` AST for matching keys and a `type` AST for values.
*
* An `Objects` node with no properties and no index signatures performs only a
* non-nullish check: it accepts any value except `null` and `undefined`,
* including primitive values.
*
* **Gotchas**
*
* Duplicate property names throw at construction time.
*
* **Example** (Inspecting a struct AST)
*
* ```ts
* import { Schema, SchemaAST } from "effect"
*
* const schema = Schema.Struct({ name: Schema.String })
* const ast = schema.ast
*
* if (SchemaAST.isObjects(ast)) {
*   for (const ps of ast.propertySignatures) {
*     console.log(ps.name, ps.type._tag)
*   }
*   // "name" "String"
* }
* ```
*
* @see {@link isObjects}
* @see {@link PropertySignature}
* @see {@link IndexSignature}
* @see {@link Arrays}
* @category models
* @since 4.0.0
*/
var Objects = class Objects extends Base {
	_tag = "Objects";
	propertySignatures;
	indexSignatures;
	encodingChecks;
	constructor(propertySignatures, indexSignatures, annotations, checks, encoding, context, encodingChecks) {
		super(annotations, checks, encoding, context);
		this.propertySignatures = propertySignatures;
		this.indexSignatures = indexSignatures;
		this.encodingChecks = encodingChecks;
		const duplicates = propertySignatures.map((ps) => ps.name).filter((name, i, arr) => arr.indexOf(name) !== i);
		if (duplicates.length > 0) throw new Error(`Duplicate identifiers: ${JSON.stringify(duplicates)}. ts(2300)`);
	}
	/** @internal */
	getParser(recur) {
		const ast = this;
		const expectedKeys = [];
		const expectedKeysSet = /* @__PURE__ */ new Set();
		const properties = [];
		for (const ps of ast.propertySignatures) {
			expectedKeys.push(ps.name);
			expectedKeysSet.add(ps.name);
			properties.push({
				ps,
				parser: recur(ps.type),
				name: ps.name,
				type: ps.type
			});
		}
		const indexCount = ast.indexSignatures.length;
		if (ast.propertySignatures.length === 0 && ast.indexSignatures.length === 0) return fromRefinement(ast, isNotNullish);
		const parseIndexes = indexCount > 0 ? iterateEager()({
			onItem: fnUntracedEager(function* (s, [key, is]) {
				const effKey = recur(indexSignatureParameterFromString(is.parameter))(some(key), s.options);
				const exitKey = effectIsExit(effKey) ? effKey : yield* exit(effKey);
				if (exitKey._tag === "Failure") {
					const eff = wrapPropertyKeyIssue(s, ast, key, exitKey);
					if (eff) yield* eff;
					return;
				}
				const value = some(s.input[key]);
				const effValue = recur(is.type)(value, s.options);
				const exitValue = effectIsExit(effValue) ? effValue : yield* exit(effValue);
				if (exitValue._tag === "Failure") {
					const eff = wrapPropertyKeyIssue(s, ast, key, exitValue);
					if (eff) yield* eff;
					return;
				} else if (exitKey.value._tag === "Some" && exitValue.value._tag === "Some") {
					const k2 = exitKey.value.value;
					if (expectedKeysSet.has(key) || expectedKeysSet.has(k2)) return;
					const v2 = exitValue.value.value;
					if (is.merge && is.merge.decode && Object.hasOwn(s.out, k2)) {
						const [k, v] = is.merge.decode.combine([k2, s.out[k2]], [k2, v2]);
						set$2(s.out, k, v);
					} else set$2(s.out, k2, v2);
				}
			}),
			step: (_s, _, exit) => exit._tag === "Failure" ? exit : void 0
		}) : void 0;
		return fnUntracedEager(function* (oinput, options) {
			if (oinput._tag === "None") return oinput;
			const input = oinput.value;
			if (!(typeof input === "object" && input !== null && !Array.isArray(input))) return yield* fail(new InvalidType(ast, oinput));
			const out = {};
			const state = {
				ast,
				oinput,
				input,
				out,
				issues: void 0,
				options
			};
			const errorsAllOption = options.errors === "all";
			const onExcessPropertyError = options.onExcessProperty === "error";
			const onExcessPropertyPreserve = options.onExcessProperty === "preserve";
			let inputKeys;
			if (ast.indexSignatures.length === 0 && (onExcessPropertyError || onExcessPropertyPreserve)) {
				inputKeys = Reflect.ownKeys(input);
				for (let i = 0; i < inputKeys.length; i++) {
					const key = inputKeys[i];
					if (!expectedKeysSet.has(key)) if (onExcessPropertyError) {
						const issue = new Pointer([key], new UnexpectedKey(ast, input[key]));
						if (errorsAllOption) {
							if (state.issues) state.issues.push(issue);
							else state.issues = [issue];
							continue;
						} else return yield* fail(new Composite(ast, oinput, [issue]));
					} else set$2(out, key, input[key]);
				}
			}
			const concurrency = resolveConcurrency(options?.concurrency);
			const eff = parseProperties(state, properties, concurrency);
			if (eff) yield* eff;
			if (parseIndexes) {
				const keyPairs = empty$1();
				for (let i = 0; i < indexCount; i++) {
					const is = ast.indexSignatures[i];
					const keys = getIndexSignatureKeys(input, is.parameter);
					for (let j = 0; j < keys.length; j++) {
						const key = keys[j];
						keyPairs.push([key, is]);
					}
				}
				const eff = parseIndexes(state, keyPairs, concurrency);
				if (eff) yield* eff;
			}
			if (state.issues) return yield* fail(new Composite(ast, oinput, state.issues));
			if (options.propertyOrder === "original") {
				const keys = (inputKeys ?? Reflect.ownKeys(input)).concat(expectedKeys);
				const preserved = {};
				for (const key of keys) if (Object.hasOwn(out, key)) set$2(preserved, key, out[key]);
				return some(preserved);
			}
			return some(out);
		});
	}
	rebuild(recur, flipMerge, checks, encodingChecks) {
		const props = mapOrSame(this.propertySignatures, (ps) => {
			const t = recur(ps.type);
			return t === ps.type ? ps : new PropertySignature(ps.name, t);
		});
		const indexes = mapOrSame(this.indexSignatures, (is) => {
			const p = recur(is.parameter);
			const t = recur(is.type);
			const merge = flipMerge ? is.merge?.flip() : is.merge;
			return p === is.parameter && t === is.type && merge === is.merge ? is : new IndexSignature(p, t, merge);
		});
		return props === this.propertySignatures && indexes === this.indexSignatures ? this : new Objects(props, indexes, this.annotations, checks, void 0, this.context, encodingChecks);
	}
	/** @internal */
	flip(recur) {
		return this.rebuild(recur, true, this.encodingChecks, this.checks);
	}
	/** @internal */
	recur(recur) {
		return this.rebuild(recur, false, this.checks, this.encodingChecks);
	}
	/** @internal */
	getExpected() {
		if (this.propertySignatures.length === 0 && this.indexSignatures.length === 0) return "object | array";
		return "object";
	}
};
var parseProperties = /*#__PURE__*/ iterateEager()({
	onItem(s, p) {
		const value = Object.hasOwn(s.input, p.name) ? some(s.input[p.name]) : none();
		return p.parser(value, s.options);
	},
	step(s, p, exit) {
		if (exit._tag === "Failure") return wrapPropertyKeyIssue(s, s.ast, p.name, exit);
		else if (exit.value._tag === "Some") set$2(s.out, p.name, exit.value.value);
		else if (!isOptional$1(p.type)) {
			const issue = new Pointer([p.name], new MissingKey(p.type.context?.annotations));
			if (s.options.errors === "all") {
				if (s.issues) s.issues.push(issue);
				else s.issues = [issue];
				return;
			} else return fail$1(new Composite(s.ast, s.oinput, [issue]));
		}
	}
});
/** @internal */
function struct(fields, checks, annotations) {
	return new Objects(Reflect.ownKeys(fields).map((key) => {
		return new PropertySignature(key, fields[key].ast);
	}), [], annotations, checks);
}
/** @internal */
function getAST(self) {
	return self.ast;
}
/** @internal */
function tuple(elements, checks = void 0) {
	return new Arrays(false, elements.map((e) => e.ast), [], void 0, checks);
}
/** @internal */
function union$1(members, mode, checks) {
	return new Union$1(members.map(getAST), mode, void 0, checks);
}
function getCandidateTypes(ast) {
	switch (ast._tag) {
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
		case "Objects": return ast.propertySignatures.length || ast.indexSignatures.length ? ["object"] : ["object", "array"];
		case "Enum": return Array.from(new Set(ast.enums.map(([, v]) => typeof v)));
		case "Literal": return [typeof ast.literal];
		case "Union": return Array.from(new Set(ast.types.flatMap(getCandidateTypes)));
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
/** @internal */
function collectSentinels(ast) {
	switch (ast._tag) {
		default: return [];
		case "Declaration": {
			const s = ast.annotations?.["~sentinels"];
			return Array.isArray(s) ? s : [];
		}
		case "Objects": return ast.propertySignatures.flatMap((ps) => {
			const type = ps.type;
			if (!isOptional$1(type)) {
				if (isLiteral(type)) return [{
					key: ps.name,
					literal: type.literal
				}];
				if (isUniqueSymbol(type)) return [{
					key: ps.name,
					literal: type.symbol
				}];
			}
			return [];
		});
		case "Arrays": return ast.elements.flatMap((e, i) => {
			return isLiteral(e) && !isOptional$1(e) ? [{
				key: i,
				literal: e.literal
			}] : [];
		});
		case "Suspend": return collectSentinels(ast.thunk());
	}
}
var candidateIndexCache = /*#__PURE__*/ new WeakMap();
function getIndex(types) {
	let idx = candidateIndexCache.get(types);
	if (idx) return idx;
	idx = {};
	for (const a of types) {
		const encoded = toEncoded(a);
		if (isNever(encoded)) continue;
		const types = getCandidateTypes(encoded);
		const sentinels = collectSentinels(encoded);
		idx.byType ??= {};
		for (const t of types) (idx.byType[t] ??= []).push(a);
		if (sentinels.length > 0) {
			idx.bySentinel ??= /* @__PURE__ */ new Map();
			for (const { key, literal } of sentinels) {
				let m = idx.bySentinel.get(key);
				if (!m) idx.bySentinel.set(key, m = /* @__PURE__ */ new Map());
				let arr = m.get(literal);
				if (!arr) m.set(literal, arr = []);
				arr.push(a);
			}
		} else {
			idx.otherwise ??= {};
			for (const t of types) (idx.otherwise[t] ??= []).push(a);
		}
	}
	candidateIndexCache.set(types, idx);
	return idx;
}
function filterLiterals(input) {
	return (ast) => {
		const encoded = toEncoded(ast);
		return encoded._tag === "Literal" ? encoded.literal === input : encoded._tag === "UniqueSymbol" ? encoded.symbol === input : true;
	};
}
/**
* The goal is to reduce the number of a union members that will be checked.
* This is useful to reduce the number of issues that will be returned.
*
* @internal
*/
function getCandidates(input, types) {
	const idx = getIndex(types);
	const runtimeType = input === null ? "null" : Array.isArray(input) ? "array" : typeof input;
	if (idx.bySentinel) {
		const base = idx.otherwise?.[runtimeType] ?? [];
		if (runtimeType === "object" || runtimeType === "array") {
			for (const [k, m] of idx.bySentinel) if (Object.hasOwn(input, k)) {
				const match = m.get(input[k]);
				if (match) return [...match, ...base].filter(filterLiterals(input));
			}
		}
		return base;
	}
	return (idx.byType?.[runtimeType] ?? []).filter(filterLiterals(input));
}
/**
* AST node representing a union of schemas.
*
* **Details**
*
* - `types` — the member AST nodes.
* - `mode` — `"anyOf"` succeeds on the first match (like TypeScript unions);
*   `"oneOf"` requires exactly one member to match (fails if multiple do).
*
* During parsing, members are tried in order. An internal candidate index
* narrows which members to try based on the runtime type of the input and
* discriminant ("sentinel") fields, making large unions efficient.
*
* **Example** (Inspecting a union AST)
*
* ```ts
* import { Schema, SchemaAST } from "effect"
*
* const schema = Schema.Union([Schema.String, Schema.Number])
* const ast = schema.ast
*
* if (SchemaAST.isUnion(ast)) {
*   console.log(ast.types.length) // 2
*   console.log(ast.mode)         // "anyOf"
* }
* ```
*
* @see {@link isUnion}
* @category models
* @since 3.10.0
*/
var Union$1 = class Union$1 extends Base {
	_tag = "Union";
	types;
	mode;
	encodingChecks;
	constructor(types, mode, annotations, checks, encoding, context, encodingChecks) {
		super(annotations, checks, encoding, context);
		this.types = types;
		this.mode = mode;
		this.encodingChecks = encodingChecks;
	}
	/** @internal */
	getParser(recur) {
		const ast = this;
		return (oinput, options) => {
			if (oinput._tag === "None") return succeed(oinput);
			const input = oinput.value;
			const candidates = getCandidates(input, ast.types);
			const state = {
				ast,
				recur,
				oinput,
				input,
				out: void 0,
				successes: [],
				issues: void 0,
				options
			};
			const eff = parseUnion(state, candidates, resolveConcurrency(options?.concurrency));
			if (!eff) return state.out ? succeed(state.out) : fail(new AnyOf(ast, input, state.issues ?? []));
			return flatMap(eff, (_) => {
				return state.out ? succeed(state.out) : fail(new AnyOf(ast, input, state.issues ?? []));
			});
		};
	}
	rebuild(recur, checks, encodingChecks) {
		const types = mapOrSame(this.types, recur);
		return types === this.types ? this : new Union$1(types, this.mode, this.annotations, checks, void 0, this.context, encodingChecks);
	}
	/** @internal */
	recur(recur) {
		return this.rebuild(recur, this.checks, this.encodingChecks);
	}
	/** @internal */
	flip(recur) {
		return this.rebuild(recur, this.encodingChecks, this.checks);
	}
	/** @internal */
	getExpected(getExpected) {
		const expected = this.annotations?.expected;
		if (typeof expected === "string") return expected;
		if (this.types.length === 0) return "never";
		const types = this.types.map((type) => {
			const encoded = toEncoded(type);
			switch (encoded._tag) {
				case "Arrays": {
					const literals = encoded.elements.filter(isLiteral);
					if (literals.length > 0) return `${formatIsMutable(encoded.isMutable)}[ ${literals.map((e) => getExpected(e) + formatIsOptional(e.context?.isOptional)).join(", ")}, ... ]`;
					break;
				}
				case "Objects": {
					const literals = encoded.propertySignatures.filter((ps) => isLiteral(ps.type));
					if (literals.length > 0) return `{ ${literals.map((ps) => `${formatIsMutable(ps.type.context?.isMutable)}${formatPropertyKey(ps.name)}${formatIsOptional(ps.type.context?.isOptional)}: ${getExpected(ps.type)}`).join(", ")}, ... }`;
					break;
				}
			}
			return getExpected(encoded);
		});
		return Array.from(new Set(types)).join(" | ");
	}
};
var parseUnion = /*#__PURE__*/ iterateEager()({
	onItem(s, ast) {
		return s.recur(ast)(s.oinput, s.options);
	},
	step(s, candidate, exit) {
		if (exit._tag === "Failure") {
			const issueResult = findError(exit.cause);
			if (isFailure(issueResult)) return exit;
			if (s.issues) s.issues.push(issueResult.success);
			else s.issues = [issueResult.success];
		} else {
			if (s.out && s.ast.mode === "oneOf") {
				s.successes.push(candidate);
				return fail$1(new OneOf(s.ast, s.input, s.successes));
			}
			s.out = exit.value;
			s.successes.push(candidate);
			if (s.ast.mode === "anyOf") return void_;
		}
	}
});
var nonFiniteLiterals = /*#__PURE__*/ new Union$1([
	/*#__PURE__*/ new Literal$1("Infinity"),
	/*#__PURE__*/ new Literal$1("-Infinity"),
	/*#__PURE__*/ new Literal$1("NaN")
], "anyOf");
var numberToJson = /*#__PURE__*/ new Link(/*#__PURE__*/ new Union$1([number, nonFiniteLiterals], "anyOf"), /*#__PURE__*/ new Transformation(/*#__PURE__*/ Number$3(), /*#__PURE__*/ transform$1((n) => globalThis.Number.isFinite(n) ? n : globalThis.String(n))));
function formatIsMutable(isMutable) {
	return isMutable ? "" : "readonly ";
}
function formatIsOptional(isOptional) {
	return isOptional ? "?" : "";
}
/** @internal */
function getEncodingChecks(ast) {
	switch (ast._tag) {
		case "Declaration":
		case "Arrays":
		case "Objects":
		case "Union": return ast.encodingChecks;
		default: return;
	}
}
/**
* Represents a single validation check attached to an AST node.
*
* **Details**
*
* - `run` — the validation function. Returns `undefined` on success, or an
*   `Issue` on failure.
* - `annotations` — optional filter-level metadata (expected message, meta
*   tags, arbitrary constraint hints).
* - `aborted` — when `true`, parsing stops immediately after this filter
*   fails (no further checks run).
*
* Use `.annotate()` to add metadata and `.abort()` to mark as aborting.
* Combine with another check via `.and()` to form a {@link FilterGroup}.
*
* @see {@link FilterGroup}
* @see {@link Check}
* @see {@link isPattern}
* @category models
* @since 4.0.0
*/
var Filter = class Filter extends Class$1 {
	_tag = "Filter";
	run;
	annotations;
	/**
	* Whether the parsing process should be aborted after this check has failed.
	*/
	aborted;
	constructor(run, annotations = void 0, aborted = false) {
		super();
		this.run = run;
		this.annotations = annotations;
		this.aborted = aborted;
	}
	annotate(annotations) {
		return new Filter(this.run, {
			...this.annotations,
			...annotations
		}, this.aborted);
	}
	abort() {
		return new Filter(this.run, this.annotations, true);
	}
	and(other, annotations) {
		return new FilterGroup([this, other], annotations);
	}
};
/**
* Represents a composite validation check grouping multiple {@link Check} values.
*
* **Details**
*
* Created by calling `.and()` on a {@link Filter} or another `FilterGroup`.
* All inner checks are run; failures from aborted filters still stop
* evaluation.
*
* @see {@link Filter}
* @see {@link Check}
* @category models
* @since 4.0.0
*/
var FilterGroup = class FilterGroup extends Class$1 {
	_tag = "FilterGroup";
	checks;
	annotations;
	constructor(checks, annotations = void 0) {
		super();
		this.checks = checks;
		this.annotations = annotations;
	}
	annotate(annotations) {
		return new FilterGroup(this.checks, {
			...this.annotations,
			...annotations
		});
	}
	and(other, annotations) {
		return new FilterGroup([this, other], annotations);
	}
};
/** @internal */
function makeFilter$1(filter, annotations, aborted = false) {
	return new Filter((input, ast, options) => make$8(input, ast, filter(input, ast, options)), annotations, aborted);
}
/**
* Creates a {@link Filter} that validates strings by running `RegExp.test`.
*
* **When to use**
*
* Use when string validation should be represented as a schema `Filter` backed
* by a regular expression.
*
* **Details**
*
* The filter can be used with `Schema.filter` or attached directly to a
* `String` AST node through checks. The regular expression source is stored in
* annotations for serialization and arbitrary generation.
*
* **Gotchas**
*
* Use a non-global, non-sticky regular expression, or reset `lastIndex`
* yourself, because `RegExp.test` is stateful for expressions with the `g` or
* `y` flag.
*
* **Example** (Validating an email pattern)
*
* ```ts
* import { SchemaAST } from "effect"
*
* const emailFilter = SchemaAST.isPattern(/^[^@]+@[^@]+$/)
* ```
*
* @see {@link Filter}
* @category constructors
* @since 4.0.0
*/
function isPattern$1(regExp, annotations) {
	const source = regExp.source;
	return makeFilter$1((s) => regExp.test(s), {
		expected: `a string matching the RegExp ${source}`,
		meta: {
			_tag: "isPattern",
			regExp
		},
		arbitrary: { constraint: { patterns: [regExp.source] } },
		...annotations
	});
}
function modifyOwnPropertyDescriptors(ast, f) {
	const d = Object.getOwnPropertyDescriptors(ast);
	f(d);
	return Object.create(Object.getPrototypeOf(ast), d);
}
/** @internal */
function replaceEncoding(ast, encoding) {
	if (ast.encoding === encoding) return ast;
	return modifyOwnPropertyDescriptors(ast, (d) => {
		d.encoding.value = encoding;
	});
}
/** @internal */
function replaceContext(ast, context) {
	if (ast.context === context) return ast;
	return modifyOwnPropertyDescriptors(ast, (d) => {
		d.context.value = context;
	});
}
/** @internal */
function annotate(ast, annotations) {
	if (ast.checks) {
		const last = ast.checks[ast.checks.length - 1];
		return replaceChecks(ast, append(ast.checks.slice(0, -1), last.annotate(annotations)));
	}
	return modifyOwnPropertyDescriptors(ast, (d) => {
		d.annotations.value = {
			...d.annotations.value,
			...annotations
		};
	});
}
/** @internal */
function replaceChecks(ast, checks) {
	if (ast._tag === "Suspend" && checks !== void 0) throw new Error("Cannot add checks to Suspend");
	if (ast.checks === checks) return ast;
	return modifyOwnPropertyDescriptors(ast, (d) => {
		d.checks.value = checks;
	});
}
/** @internal */
function appendChecks(ast, checks) {
	return replaceChecks(ast, ast.checks ? [...ast.checks, ...checks] : checks);
}
function updateLastLink(encoding, f) {
	const links = encoding;
	const last = links[links.length - 1];
	const to = f(last.to);
	if (to !== last.to) return append(encoding.slice(0, encoding.length - 1), new Link(to, last.transformation));
	return encoding;
}
/** @internal */
function applyToLastLink(f) {
	return (ast) => ast.encoding ? replaceEncoding(ast, updateLastLink(ast.encoding, f)) : ast;
}
function appendTransformation(from, transformation, to) {
	const link = new Link(from, transformation);
	return replaceEncoding(to, to.encoding ? [...to.encoding, link] : [link]);
}
function mapOrSame(as, f) {
	let changed = false;
	const out = new Array(as.length);
	for (let i = 0; i < as.length; i++) {
		const a = as[i];
		const fa = f(a);
		if (fa !== a) changed = true;
		out[i] = fa;
	}
	return changed ? out : as;
}
/** @internal */
function annotateKey(ast, annotations) {
	return replaceContext(ast, ast.context ? new Context(ast.context.isOptional, ast.context.isMutable, ast.context.defaultValue, {
		...ast.context.annotations,
		...annotations
	}) : new Context(false, false, void 0, annotations));
}
/** @internal */
var optionalKeyLastLink = /*#__PURE__*/ applyToLastLink(optionalKey$1);
/**
* Marks an AST node's property key as optional by setting
* {@link Context.isOptional} to `true`.
*
* **Details**
*
* Also propagates the optional flag through the last link of the encoding
* chain if present.
*
* @see {@link isOptional}
* @see {@link Context}
* @category transforming
* @since 4.0.0
*/
function optionalKey$1(ast) {
	return optionalKeyLastLink(replaceContext(ast, ast.context ? ast.context.isOptional === false ? new Context(true, ast.context.isMutable, ast.context.defaultValue, ast.context.annotations) : ast.context : new Context(true, false)));
}
/** @internal */
function withConstructorDefault$1(ast, defaultValue) {
	const encoding = [new Link(unknown, new Transformation(withDefault(defaultValue), passthrough$1()))];
	return replaceContext(ast, ast.context ? new Context(ast.context.isOptional, ast.context.isMutable, encoding, ast.context.annotations) : new Context(false, false, encoding));
}
/**
* Attaches a `Transformation` to the `to` AST, making it decode from the
* `from` AST and encode back to it.
*
* **Details**
*
* This is the low-level primitive behind `Schema.transform` and
* `Schema.transformOrFail`. It appends a {@link Link} to the `to` node's
* encoding chain.
*
* - Returns a new AST with the same type as `to`.
*
* @see {@link Link}
* @see {@link Encoding}
* @see {@link flip}
* @category transforming
* @since 4.0.0
*/
function decodeTo$1(from, to, transformation) {
	return appendTransformation(from, transformation, to);
}
function parseParameter(ast) {
	switch (ast._tag) {
		case "Literal": return {
			literals: isPropertyKey(ast.literal) ? [ast.literal] : [],
			parameters: []
		};
		case "UniqueSymbol": return {
			literals: [ast.symbol],
			parameters: []
		};
		case "String":
		case "Number":
		case "Symbol":
		case "TemplateLiteral": return {
			literals: [],
			parameters: [ast]
		};
		case "Union": {
			const out = {
				literals: [],
				parameters: []
			};
			for (let i = 0; i < ast.types.length; i++) {
				const parsed = parseParameter(ast.types[i]);
				out.literals = out.literals.concat(parsed.literals);
				out.parameters = out.parameters.concat(parsed.parameters);
			}
			return out;
		}
	}
	return {
		literals: [],
		parameters: []
	};
}
/** @internal */
function record(key, value, keyValueCombiner) {
	const { literals, parameters: indexSignatures } = parseParameter(key);
	return new Objects(literals.map((literal) => new PropertySignature(literal, value)), indexSignatures.map((parameter) => new IndexSignature(parameter, value, keyValueCombiner)));
}
/**
* Returns `true` if the AST node represents an optional property.
*
* **Details**
*
* Checks `ast.context?.isOptional`. Defaults to `false` when no
* {@link Context} is set.
*
* @see {@link optionalKey}
* @see {@link Context}
* @category predicates
* @since 4.0.0
*/
function isOptional$1(ast) {
	return ast.context?.isOptional ?? false;
}
/**
* Strips all encoding transformations from an AST, returning the decoded
* (type-level) representation.
*
* **Details**
*
* - Memoized: same input reference → same output reference.
* - Recursively walks into composite nodes ({@link Arrays}, {@link Objects},
*   {@link Union}, {@link Suspend}).
*
* **Example** (Getting the type AST)
*
* ```ts
* import { Schema, SchemaAST } from "effect"
*
* const schema = Schema.NumberFromString
* const typeAst = SchemaAST.toType(schema.ast)
* console.log(typeAst._tag) // "Number"
* ```
*
* @see {@link toEncoded}
* @see {@link flip}
* @category transforming
* @since 4.0.0
*/
var toType = /*#__PURE__*/ memoize((ast) => {
	if (ast.encoding) return toType(replaceEncoding(ast, void 0));
	const out = ast;
	const type = out.recur?.(toType) ?? out;
	if (getEncodingChecks(type)) return modifyOwnPropertyDescriptors(type, (d) => {
		d.encodingChecks.value = void 0;
	});
	return type;
});
/**
* Returns the encoded (wire-format) AST by flipping and then stripping
* encodings.
*
* **Details**
*
* Equivalent to `toType(flip(ast))`. This gives you the AST that describes
* the shape of the serialized/encoded data.
*
* - Memoized: same input reference → same output reference.
*
* **Example** (Getting the encoded AST)
*
* ```ts
* import { Schema, SchemaAST } from "effect"
*
* const schema = Schema.NumberFromString
* const encodedAst = SchemaAST.toEncoded(schema.ast)
* console.log(encodedAst._tag) // "String"
* ```
*
* @see {@link toType}
* @see {@link flip}
* @category transforming
* @since 4.0.0
*/
var toEncoded = /*#__PURE__*/ memoize((ast) => {
	return toType(flip(ast));
});
function flipEncoding(ast, encoding) {
	const links = encoding;
	const len = links.length;
	const last = links[len - 1];
	const ls = [new Link(flip(replaceEncoding(ast, void 0)), links[0].transformation.flip())];
	for (let i = 1; i < len; i++) ls.unshift(new Link(flip(links[i - 1].to), links[i].transformation.flip()));
	const to = flip(last.to);
	if (to.encoding) return replaceEncoding(to, [...to.encoding, ...ls]);
	else return replaceEncoding(to, ls);
}
/**
* Swaps the decode and encode directions of an AST's {@link Encoding} chain.
*
* **Details**
*
* After flipping, what was decoding becomes encoding and vice versa. This is
* the core operation behind `Schema.encode` — encoding a value is decoding
* with a flipped SchemaAST.
*
* - Memoized: same input reference → same output reference.
* - Recursively walks composite nodes.
*
* @see {@link toType}
* @see {@link toEncoded}
* @category transforming
* @since 4.0.0
*/
var flip = /*#__PURE__*/ memoize((ast) => {
	if (ast.encoding) return flipEncoding(ast, ast.encoding);
	const out = ast;
	return out.flip?.(flip) ?? out.recur?.(flip) ?? out;
});
/** @internal */
function containsUndefined(ast) {
	switch (ast._tag) {
		case "Undefined": return true;
		case "Union": return ast.types.some(containsUndefined);
		default: return false;
	}
}
function getTemplateLiteralSource(ast, top) {
	return ast.encodedParts.map((part) => handleTemplateLiteralASTPartParens(part, getTemplateLiteralASTPartPattern(part), top)).join("");
}
/** @internal */
var getTemplateLiteralRegExp = /*#__PURE__*/ memoize((ast) => {
	return new globalThis.RegExp(`^${getTemplateLiteralSource(ast, true)}$`);
});
function getTemplateLiteralASTPartPattern(part) {
	switch (part._tag) {
		case "Literal": return escape(globalThis.String(part.literal));
		case "String": return STRING_PATTERN;
		case "Number": return FINITE_PATTERN;
		case "BigInt": return BIGINT_PATTERN;
		case "TemplateLiteral": return getTemplateLiteralSource(part, false);
		case "Union": return part.types.map(getTemplateLiteralASTPartPattern).join("|");
	}
}
function handleTemplateLiteralASTPartParens(part, s, top) {
	if (isUnion(part)) {
		if (!top) return `(?:${s})`;
	} else if (!top) return s;
	return `(${s})`;
}
function fromConst(ast, value) {
	const succeed = succeedSome(value);
	return (oinput) => {
		if (oinput._tag === "None") return succeedNone;
		return oinput.value === value ? succeed : fail(new InvalidType(ast, oinput));
	};
}
function fromRefinement(ast, refinement) {
	return (oinput) => {
		if (oinput._tag === "None") return succeedNone;
		return refinement(oinput.value) ? succeed(oinput) : fail(new InvalidType(ast, oinput));
	};
}
/** @internal */
function toCodec(f) {
	function out(ast) {
		return ast.encoding ? replaceEncoding(ast, updateLastLink(ast.encoding, out)) : f(ast);
	}
	return memoize(out);
}
var indexSignatureParameterFromString = /*#__PURE__*/ toCodec((ast) => {
	switch (ast._tag) {
		default: return ast;
		case "Number": return ast.toCodecStringTree();
		case "Union": return ast.recur(indexSignatureParameterFromString);
	}
});
/**
* any string, including newlines
* @internal
*/
var STRING_PATTERN = "[\\s\\S]*?";
var isStringFiniteRegExp = /*#__PURE__*/ new globalThis.RegExp(`^${FINITE_PATTERN}$`);
/** @internal */
function isStringFinite(annotations) {
	return isPattern$1(isStringFiniteRegExp, {
		expected: "a string representing a finite number",
		meta: {
			_tag: "isStringFinite",
			regExp: isStringFiniteRegExp
		},
		...annotations
	});
}
var finiteString = /*#__PURE__*/ appendChecks(string, [/*#__PURE__*/ isStringFinite()]);
var finiteToString = /*#__PURE__*/ new Link(finiteString, numberFromString);
var numberToString = /*#__PURE__*/ new Link(/*#__PURE__*/ new Union$1([finiteString, nonFiniteLiterals], "anyOf"), numberFromString);
/**
* signed integer only (no leading "+" because TypeScript doesn't support it)
*/
var BIGINT_PATTERN = "-?\\d+";
var isStringBigIntRegExp = /*#__PURE__*/ new globalThis.RegExp(`^${BIGINT_PATTERN}$`);
/** @internal */
function isStringBigInt(annotations) {
	return isPattern$1(isStringBigIntRegExp, {
		expected: "a string representing a bigint",
		meta: {
			_tag: "isStringBigInt",
			regExp: isStringBigIntRegExp
		},
		...annotations
	});
}
var bigIntToString = /*#__PURE__*/ new Link(/* @__PURE__ */ appendChecks(string, [/*#__PURE__*/ isStringBigInt({ expected: "a string representing a bigint" })]), bigintFromString);
/** @internal */
function collectIssues(checks, value, issues, ast, options) {
	for (let i = 0; i < checks.length; i++) {
		const check = checks[i];
		if (check._tag === "FilterGroup") collectIssues(check.checks, value, issues, ast, options);
		else {
			const issue = check.run(value, ast, options);
			if (issue) {
				issues.push(new Filter$1(value, check, issue));
				if (check.aborted || options?.errors !== "all") return;
			}
		}
	}
}
/** @internal */
var ClassTypeId = "~effect/Schema/Class";
/** @internal */
var STRUCTURAL_ANNOTATION_KEY = "~structural";
var await_ = fiberAwait;
/**
* Adds a fiber to a `Scope` and returns the same fiber.
*
* **When to use**
*
* Use when a manually managed fiber should be interrupted when a Scope closes.
*
* **Details**
*
* When the scope is closed, the fiber is interrupted. If the scope is already
* closed, the fiber is interrupted immediately.
*
* **Gotchas**
*
* This does not wait for the fiber to complete. It only registers the
* interruption finalizer and returns the same fiber.
*
* @see {@link interrupt} for interrupting and waiting for completion
*
* @category resource management
* @since 4.0.0
*/
var runIn = fiberRunIn;
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/MutableRef.js
var TypeId$3 = "~effect/MutableRef";
var MutableRefProto = {
	[TypeId$3]: TypeId$3,
	...PipeInspectableProto,
	toJSON() {
		return {
			_id: "MutableRef",
			current: toJson(this.current)
		};
	}
};
/**
* Creates a new MutableRef with the specified initial value.
*
* **When to use**
*
* Use to create a synchronous `MutableRef` initialized with a value.
*
* **Example** (Creating mutable refs)
*
* ```ts
* import { MutableRef } from "effect"
*
* // Create a counter reference
* const counter = MutableRef.make(0)
* console.log(MutableRef.get(counter)) // 0
*
* // Create a configuration reference
* const config = MutableRef.make({ debug: false, timeout: 5000 })
* console.log(MutableRef.get(config)) // { debug: false, timeout: 5000 }
*
* // Create a string reference
* const status = MutableRef.make("idle")
* MutableRef.set(status, "running")
* console.log(MutableRef.get(status)) // "running"
* ```
*
* @category constructors
* @since 2.0.0
*/
var make$6 = (value) => {
	const ref = Object.create(MutableRefProto);
	ref.current = value;
	return ref;
};
/**
* Sets the MutableRef to a new value and returns the reference.
*
* **When to use**
*
* Use when you need an in-place `MutableRef` replacement that returns the same
* `MutableRef`.
*
* **Example** (Setting values)
*
* ```ts
* import { MutableRef } from "effect"
*
* const ref = MutableRef.make("initial")
*
* // Set a new value
* MutableRef.set(ref, "updated")
* console.log(MutableRef.get(ref)) // "updated"
*
* // Chain set operations (since it returns the ref)
* const result = MutableRef.set(ref, "final")
* console.log(result === ref) // true (same reference)
* console.log(MutableRef.get(ref)) // "final"
*
* // Set complex objects
* const config = MutableRef.make({ debug: false, verbose: false })
* MutableRef.set(config, { debug: true, verbose: true })
* console.log(MutableRef.get(config)) // { debug: true, verbose: true }
*
* // Pipe-able version
* const setValue = MutableRef.set("new value")
* setValue(ref)
* console.log(MutableRef.get(ref)) // "new value"
*
* // Useful for state management
* const state = MutableRef.make<"idle" | "loading" | "success" | "error">("idle")
* MutableRef.set(state, "loading")
* // ... perform async operation
* MutableRef.set(state, "success")
* ```
*
* @category general
* @since 2.0.0
*/
var set$1 = /*#__PURE__*/ dual(2, (self, value) => {
	self.current = value;
	return self;
});
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Struct.js
/**
* Wraps a plain function as a {@link Lambda} value so it can be used with
* {@link map}, {@link mapPick}, and {@link mapOmit}.
*
* **When to use**
*
* Use to create a typed lambda for struct mapping APIs that need type-level
* input and output tracking.
*
* **Details**
*
* The type parameter `L` encodes both the input and output types at the type
* level, allowing the compiler to track how struct value types change. At
* runtime, the returned value is the same function; `lambda` only adjusts the
* type.
*
* **Example** (Wrapping values in arrays)
*
* ```ts
* import { pipe, Struct } from "effect"
*
* interface AsArray extends Struct.Lambda {
*   <A>(self: A): Array<A>
*   readonly "~lambda.out": Array<this["~lambda.in"]>
* }
*
* const asArray = Struct.lambda<AsArray>((a) => [a])
* const result = pipe({ x: 1, y: "hello" }, Struct.map(asArray))
* console.log(result) // { x: [1], y: ["hello"] }
* ```
*
* @see {@link Lambda} – the type-level interface
* @see {@link map} – apply a lambda to all struct values
* @category Lambda
* @since 4.0.0
*/
var lambda = (f) => f;
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/SchemaParser.js
/**
* Runs schemas against real values.
*
* Schema parsers construct values from schema input, check whether a value
* matches a schema, decode encoded input, and encode decoded values back to
* their external form. This module exposes those operations through several
* result styles, including `Effect`, `Promise`, `Exit`, `Option`, `Result`, and
* synchronous functions that throw. It also contains the lower-level runner that
* walks a schema AST and reports schema failures as `SchemaIssue.Issue` values.
*
* @since 4.0.0
*/
var recurDefaults = /*#__PURE__*/ memoize((ast) => {
	switch (ast._tag) {
		case "Declaration": {
			const getLink = ast.annotations?.[ClassTypeId];
			if (isFunction(getLink)) {
				const link = getLink(ast.typeParameters);
				const to = recurDefaults(link.to);
				return replaceEncoding(ast, to === link.to ? [link] : [new Link(to, link.transformation)]);
			}
			return ast;
		}
		case "Objects":
		case "Arrays": return ast.recur((ast) => {
			const defaultValue = ast.context?.defaultValue;
			if (defaultValue) return replaceEncoding(recurDefaults(ast), defaultValue);
			return recurDefaults(ast);
		});
		case "Suspend": return ast.recur(recurDefaults);
		default: return ast;
	}
});
/**
* Creates an effectful maker for the schema's decoded type side.
*
* **When to use**
*
* Use to construct decoded schema values in `Effect` while preserving
* construction failures as `SchemaIssue.Issue` values in the error channel.
*
* **Details**
*
* The returned function accepts constructor input, applies constructor defaults,
* runs type-side validation unless checks are disabled, and fails with a
* `SchemaIssue.Issue` when construction fails.
*
* @category constructors
* @since 4.0.0
*/
function makeEffect(schema) {
	const parser = run(recurDefaults(toType(schema.ast)));
	return (input, options) => {
		return parser(input, options?.disableChecks ? options?.parseOptions ? {
			...options.parseOptions,
			disableChecks: true
		} : { disableChecks: true } : options?.parseOptions);
	};
}
/**
* Creates a synchronous maker that returns `Option.some` with the constructed
* value on success, or `Option.none` when construction fails.
*
* **When to use**
*
* Use when you need to validate schema constructor input and only care whether
* construction succeeds, without exposing `SchemaIssue.Issue` details.
*
* @category constructors
* @since 4.0.0
*/
function makeOption(schema) {
	const parser = makeEffect(schema);
	return (input, options) => {
		return getSuccess(runSyncExit(parser(input, options)));
	};
}
/**
* Creates a synchronous maker for the schema's decoded type side.
*
* **When to use**
*
* Use to construct decoded schema values synchronously when invalid input
* should throw an `Error` whose cause is `SchemaIssue.Issue`.
*
* **Details**
*
* The returned function constructs a value from constructor input and throws an
* `Error` with the `SchemaIssue.Issue` in its `cause` when construction fails.
*
* @category constructors
* @since 4.0.0
*/
function make$5(schema) {
	const parser = makeEffect(schema);
	return (input, options) => {
		return runSync(mapErrorEager(parser(input, options), (issue) => new Error(issue.toString(), { cause: issue })));
	};
}
/**
* Creates an effectful decoder for `unknown` input.
*
* **When to use**
*
* Use when you need to decode untyped boundary input in an `Effect` whose
* failure channel is `SchemaIssue.Issue`, while preserving transformations
* and service requirements.
*
* **Details**
*
* The returned function succeeds with the schema's decoded `Type` or fails with a
* `SchemaIssue.Issue`. Decoding service requirements are preserved in the returned
* `Effect`. Parse options may be provided when creating the decoder and overridden
* when applying it.
*
* @see {@link decodeEffect} for input already typed as the schema's `Encoded` type
*
* @category decoding
* @since 4.0.0
*/
function decodeUnknownEffect$1(schema, options) {
	const parser = run(schema.ast);
	return options === void 0 ? parser : (input, overrideOptions) => parser(input, mergeParseOptions(options, overrideOptions));
}
var mergeParseOptions = (options, overrideOptions) => overrideOptions === void 0 ? options : {
	...options,
	...overrideOptions
};
/** @internal */
function run(ast) {
	const parser = recur(ast);
	return (input, options) => flatMapEager(parser(some(input), options ?? defaultParseOptions), (oa) => {
		if (oa._tag === "None") return fail(new InvalidValue(oa));
		return succeed(oa.value);
	});
}
var recur = /*#__PURE__*/ memoize((ast) => {
	let parser;
	const encodingChecks = getEncodingChecks(ast);
	const resolvedChecks = ast.checks ?? encodingChecks;
	const astOptions = (resolvedChecks ? resolvedChecks[resolvedChecks.length - 1].annotations : ast.annotations)?.["parseOptions"];
	if (!ast.context && !ast.encoding && !ast.checks && !encodingChecks) return (ou, options) => {
		parser ??= ast.getParser(recur);
		if (astOptions) options = {
			...options,
			...astOptions
		};
		return parser(ou, options);
	};
	const isStructural = isArrays(ast) || isObjects(ast) || isDeclaration(ast) && ast.typeParameters.length > 0;
	return (ou, options) => {
		if (astOptions) options = {
			...options,
			...astOptions
		};
		const encoding = ast.encoding;
		let srou;
		if (encoding) {
			const links = encoding;
			const len = links.length;
			for (let i = len - 1; i >= 0; i--) {
				const link = links[i];
				const to = link.to;
				const parser = recur(to);
				srou = srou ? flatMapEager(srou, (ou) => parser(ou, options)) : parser(ou, options);
				if (link.transformation._tag === "Transformation") {
					const getter = link.transformation.decode;
					srou = flatMapEager(srou, (ou) => getter.run(ou, options));
				} else srou = link.transformation.decode(srou, options);
			}
			srou = mapErrorEager(srou, (issue) => new Encoding(ast, ou, issue));
		}
		parser ??= ast.getParser(recur);
		let sroa = srou ? flatMapEager(srou, (ou) => parser(ou, options)) : parser(ou, options);
		if (encodingChecks && !options?.disableChecks) sroa = flatMapEager(sroa, (oa) => {
			if (isSome(ou) && isSome(oa)) {
				const issues = [];
				collectIssues(encodingChecks, ou.value, issues, ast, options);
				if (isArrayNonEmpty(issues)) return fail(new Composite(ast, ou, issues));
			}
			return succeed(oa);
		});
		if (ast.checks && !options?.disableChecks) {
			const checks = ast.checks;
			if (options?.errors === "all" && isStructural && isSome(ou)) sroa = catchEager(sroa, (issue) => {
				const issues = [];
				collectIssues(checks.filter((check) => check.annotations?.[STRUCTURAL_ANNOTATION_KEY]), ou.value, issues, ast, options);
				return fail(isArrayNonEmpty(issues) ? issue._tag === "Composite" && issue.ast === ast ? new Composite(ast, issue.actual, [...issue.issues, ...issues]) : new Composite(ast, ou, [issue, ...issues]) : issue);
			});
			sroa = flatMapEager(sroa, (oa) => {
				if (isSome(oa)) {
					const value = oa.value;
					const issues = [];
					collectIssues(checks, value, issues, ast, options);
					if (isArrayNonEmpty(issues)) return fail(new Composite(ast, oa, issues));
				}
				return succeed(oa);
			});
		}
		return sroa;
	};
});
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/internal/schema/schema.js
/** @internal */
var TypeId$2 = "~effect/Schema/Schema";
var SchemaProto = {
	[TypeId$2]: TypeId$2,
	pipe() {
		return pipeArguments(this, arguments);
	},
	annotate(annotations) {
		return this.rebuild(annotate(this.ast, annotations));
	},
	annotateKey(annotations) {
		return this.rebuild(annotateKey(this.ast, annotations));
	},
	check(...checks) {
		return this.rebuild(appendChecks(this.ast, checks));
	}
};
/** @internal */
function make$4(ast, options) {
	const self = Object.create(SchemaProto);
	if (options) Object.assign(self, options);
	self.ast = ast;
	self.rebuild = (ast) => make$4(ast, options);
	self.makeEffect = flow(makeEffect(self), mapErrorEager((issue) => new SchemaError(issue)));
	self.make = make$5(self);
	self.makeOption = makeOption(self);
	return self;
}
/** @internal */
var SchemaErrorTypeId = "~effect/Schema/SchemaError";
var SchemaError = class {
	[SchemaErrorTypeId] = SchemaErrorTypeId;
	_tag = "SchemaError";
	name = "SchemaError";
	issue;
	constructor(issue) {
		this.issue = issue;
	}
	get message() {
		return this.issue.toString();
	}
	toString() {
		return `SchemaError(${this.message})`;
	}
};
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Schema.js
var TypeId$1 = TypeId$2;
/**
* Creates a schema for a **parametric** type (a generic container such as
* `Array<A>`, `Option<A>`, etc.) by accepting a list of type-parameter schemas
* and a decoder factory.
*
* **When to use**
*
* Use when you are defining a schema for a generic container whose validation
* depends on one or more type-parameter schemas.
*
* **Details**
*
* The outer call `declareConstructor<T, E, Iso>()` fixes the decoded type `T`,
* the encoded type `E`, and the optional iso type. The inner call receives:
* - `typeParameters` — the concrete schemas for each type variable
* - `run` — a factory that, given resolved codecs for each type parameter,
*   returns a parsing function `(u, ast, options) => Effect<T, Issue>`
* - `annotations` — optional metadata
*
* @see {@link declare} for creating schemas for non-parametric types.
*
* **Example** (Schema for a parametric `Box<A>` type)
*
* ```ts
* import { Effect, Option, Schema, SchemaIssue as Issue, SchemaParser } from "effect"
*
* interface Box<A> {
*   readonly value: A
* }
*
* const isBox = (u: unknown): u is Box<unknown> =>
*   typeof u === "object" && u !== null && "value" in u
*
* const Box = <A extends Schema.Top>(item: A) =>
*   Schema.declareConstructor<Box<A["Type"]>, Box<A["Encoded"]>>()(
*     [item],
*     ([itemCodec]) =>
*       (u, ast, options) => {
*         if (!isBox(u)) {
*           return Effect.fail(new SchemaIssue.InvalidType(ast, Option.some(u)))
*         }
*         return Effect.map(
*           SchemaParser.decodeUnknownEffect(itemCodec)(u.value, options),
*           (value) => ({ value })
*         )
*       }
*   )
*
* const schema = Box(Schema.Number)
* ```
*
* @category constructors
* @since 4.0.0
*/
function declareConstructor() {
	return (typeParameters, run, annotations) => {
		return make$3(new Declaration(typeParameters.map(getAST), (typeParameters) => run(typeParameters.map((ast) => make$3(ast))), annotations));
	};
}
/**
* Creates a schema for a **non-parametric** opaque type using a type-guard
* function. The schema accepts any unknown value and succeeds when `is` returns
* `true`, failing with an `InvalidType` issue otherwise.
*
* **When to use**
*
* Use when you are defining a schema for an opaque type with no type parameters
* and validation can be expressed as a type guard.
*
* **Example** (Schema for a custom `UserId` branded type)
*
* ```ts
* import { Schema } from "effect"
*
* type UserId = string & { readonly _tag: "UserId" }
*
* const isUserId = (u: unknown): u is UserId =>
*   typeof u === "string" && u.startsWith("user_")
*
* const UserId = Schema.declare<UserId>(isUserId, {
*   title: "UserId",
*   description: "A user identifier starting with 'user_'"
* })
* ```
*
* @see {@link declareConstructor} for creating schemas for parametric types.
*
* @category constructors
* @since 3.10.0
*/
function declare(is, annotations) {
	return declareConstructor()([], () => (input, ast) => is(input) ? succeed(input) : fail(new InvalidType(ast, some(input))), annotations);
}
/**
* Decodes an `unknown` input against a schema, returning an `Effect` that
* succeeds with the decoded value or fails with a {@link SchemaError}.
*
* **When to use**
*
* Use when you need to decode unknown input in an `Effect` whose failure
* channel is `SchemaError`.
*
* **Details**
*
* Prefer {@link decodeEffect} when the input is already typed as the schema's
* `Encoded` type.
* Options may be provided either when creating the decoder or when applying it;
* application options override creation options.
*
* @see {@link SchemaParser.decodeUnknownEffect} for the adapter that fails with `SchemaIssue.Issue` directly
*
* @category decoding
* @since 4.0.0
*/
function decodeUnknownEffect(schema, options) {
	const parser = decodeUnknownEffect$1(schema, options);
	return (input, options) => {
		return mapErrorEager(parser(input, options), (issue) => new SchemaError(issue));
	};
}
/**
* Creates a schema from an AST (Abstract Syntax Tree) node.
*
* **Details**
*
* This is the fundamental constructor for all schemas in the Effect Schema
* library. It takes an AST node and wraps it in a fully-typed schema that
* preserves all type information and provides the complete schema API.
*
* The `make` function is used internally to create all primitive schemas like
* `String`, `Number`, `Boolean`, etc., as well as more complex schemas. It's
* the bridge between the untyped AST representation and the strongly-typed
* schema.
*
* @category constructors
* @since 3.10.0
*/
var make$3 = make$4;
/**
* Checks whether a value is a `Schema`.
*
* @category guards
* @since 3.10.0
*/
function isSchema(u) {
	return hasProperty(u, TypeId$1) && u[TypeId$1] === TypeId$1;
}
/**
* Creates an exact optional key schema for struct fields. Unlike `optional`,
* this creates exact optional properties (not `| undefined`) that can be
* completely omitted from the object.
*
* **Example** (Creating a struct with optional key)
*
* ```ts
* import { Schema } from "effect"
*
* const schema = Schema.Struct({
*   name: Schema.String,
*   age: Schema.optionalKey(Schema.Number)
* })
*
* // Type: { readonly name: string; readonly age?: number }
* type Person = typeof schema["Type"]
* ```
*
* @category combinators
* @since 4.0.0
*/
var optionalKey = /*#__PURE__*/ lambda((schema) => make$3(optionalKey$1(schema.ast), { schema }));
/**
* Marks a struct field as optional, allowing the key to be absent or
* `undefined`.
*
* **Details**
*
* The resulting property may be absent or explicitly set to `undefined`.
* Equivalent to `optionalKey(UndefinedOr(S))`.
*
* Use {@link optionalKey} instead if you want exact optional semantics (absent
* only, not `undefined`).
*
* **Example** (Optional field accepting undefined)
*
* ```ts
* import { Schema } from "effect"
*
* const schema = Schema.Struct({
*   name: Schema.String,
*   age: Schema.optional(Schema.Number)
* })
*
* // { readonly name: string; readonly age?: number | undefined }
* type Person = typeof schema.Type
* ```
*
* @category combinators
* @since 3.10.0
*/
var optional = /*#__PURE__*/ lambda((self) => optionalKey(UndefinedOr(self)));
/**
* Creates a schema for a single literal value (string, number, bigint, boolean, or null).
*
* **Example** (String literal)
*
* ```ts
* import { Schema } from "effect"
*
* const schema = Schema.Literal("hello")
* // Type: Schema.Literal<"hello">
* ```
*
* @see {@link Literals} for a schema that represents a union of literals.
* @see {@link tag} for a schema that represents a literal value that can be
* used as a discriminator field in tagged unions and has a constructor default.
* @category constructors
* @since 3.10.0
*/
function Literal(literal) {
	const out = make$3(new Literal$1(literal), {
		literal,
		transform(to) {
			return out.pipe(decodeTo(Literal(to), {
				decode: transform$1(() => to),
				encode: transform$1(() => literal)
			}));
		}
	});
	return out;
}
/**
* Schema for the `any` type. Accepts any value without validation.
*
* @see {@link Unknown} for a safer alternative that uses `unknown`.
* @category schemas
* @since 3.10.0
*/
var Any = /*#__PURE__*/ make$3(any);
/**
* Schema for the `unknown` type. Accepts any value without validation.
*
* **When to use**
*
* Use as a top schema when you need to accept any input while preserving
* TypeScript's `unknown` safety at use sites.
*
* @see {@link Any} for the `any` variant.
* @category schemas
* @since 3.10.0
*/
var Unknown = /*#__PURE__*/ make$3(unknown);
/**
* Schema for the `null` literal. Validates that the input is strictly `null`.
*
* @see {@link NullOr} for a union with another schema.
* @category schemas
* @since 3.10.0
*/
var Null = /*#__PURE__*/ make$3(null_);
/**
* Schema for the `undefined` literal. Validates that the input is strictly `undefined`.
*
* @see {@link UndefinedOr} for a union with another schema.
* @category schemas
* @since 3.10.0
*/
var Undefined = /*#__PURE__*/ make$3(undefined_);
/**
* Schema for `string` values. Validates that the input is `typeof` `"string"`.
*
* @category schemas
* @since 4.0.0
*/
var String$1 = /*#__PURE__*/ make$3(string);
/**
* Schema for `number` values, including `NaN`, `Infinity`, and `-Infinity`.
*
* **Details**
*
* Default JSON serializer:
*
* - Finite numbers are serialized as numbers.
* - Non-finite values are serialized as strings (`"NaN"`, `"Infinity"`, `"-Infinity"`).
*
* @see {@link Finite} for a schema that excludes non-finite values.
* @category schemas
* @since 4.0.0
*/
var Number$1 = /*#__PURE__*/ make$3(number);
/**
* Schema for `boolean` values. Validates that the input is `typeof` `"boolean"`.
*
* **When to use**
*
* Use to validate values that are already JavaScript booleans.
*
* @see {@link BooleanFromBit} for a schema that decodes bit literals `0` or `1` into a boolean
*
* @category boolean
* @since 4.0.0
*/
var Boolean$1 = /*#__PURE__*/ make$3(boolean);
/**
* Schema for `bigint` values. Validates that the input is `typeof` `"bigint"`.
*
* **When to use**
*
* Use when the input is already a bigint and the schema should validate and
* preserve bigint values without parsing from another representation.
*
* @see {@link BigIntFromString} for parsing string input into a bigint
*
* @category schemas
* @since 4.0.0
*/
var BigInt$1 = /*#__PURE__*/ make$3(bigInt);
/**
* Schema for the `object` type. Validates that the input is a non-null object or function
* (i.e. `typeof value === "object" && value !== null || typeof value === "function"`).
*
* @category schemas
* @since 4.0.0
*/
var ObjectKeyword = /*#__PURE__*/ make$3(objectKeyword);
function makeStruct(ast, fields) {
	return make$3(ast, {
		fields,
		mapFields(f, options) {
			const fields = f(this.fields);
			return makeStruct(struct(fields, options?.unsafePreserveChecks ? this.ast.checks : void 0), fields);
		}
	});
}
/**
* Defines a struct schema from a map of field schemas.
*
* **Details**
*
* Each field value is a schema. Use {@link optionalKey} or {@link optional} to
* mark fields as optional, and {@link mutableKey} to mark them as mutable.
*
* The resulting schema's `Type` is a readonly object type with the fields'
* decoded types. The `Encoded` form mirrors the field schemas' encoded types.
*
* **Example** (Basic struct)
*
* ```ts
* import { Schema } from "effect"
*
* const Person = Schema.Struct({
*   name: Schema.String,
*   age: Schema.Number,
*   email: Schema.optionalKey(Schema.String)
* })
*
* // { readonly name: string; readonly age: number; readonly email?: string }
* type Person = typeof Person.Type
*
* const alice = Schema.decodeUnknownSync(Person)({ name: "Alice", age: 30 })
* console.log(alice)
* // { name: 'Alice', age: 30 }
* ```
*
* @category constructors
* @since 3.10.0
*/
function Struct(fields) {
	return makeStruct(struct(fields, void 0), fields);
}
/**
* Defines a record (dictionary) schema with typed keys and values.
*
* **Example** (String-keyed record of numbers)
*
* ```ts
* import { Schema } from "effect"
*
* const schema = Schema.Record(Schema.String, Schema.Number)
*
* // { readonly [x: string]: number }
* type R = typeof schema.Type
*
* const result = Schema.decodeUnknownSync(schema)({ a: 1, b: 2 })
* console.log(result)
* // { a: 1, b: 2 }
* ```
*
* @category constructors
* @since 3.10.0
*/
function Record(key, value, options) {
	const keyValueCombiner = options?.keyValueCombiner?.decode || options?.keyValueCombiner?.encode ? new KeyValueCombiner(options.keyValueCombiner.decode, options.keyValueCombiner.encode) : void 0;
	return make$3(record(key.ast, value.ast, keyValueCombiner), {
		key,
		value
	});
}
function makeTuple(ast, elements) {
	return make$3(ast, {
		elements,
		mapElements(f, options) {
			const elements = f(this.elements);
			return makeTuple(tuple(elements, options?.unsafePreserveChecks ? this.ast.checks : void 0), elements);
		}
	});
}
/**
* Defines a fixed-length tuple schema from an array of element schemas.
*
* **Example** (Pair of string and number)
*
* ```ts
* import { Schema } from "effect"
*
* const schema = Schema.Tuple([Schema.String, Schema.Number])
*
* const pair = Schema.decodeUnknownSync(schema)(["hello", 42])
* console.log(pair)
* // [ 'hello', 42 ]
* ```
*
* @category constructors
* @since 3.10.0
*/
function Tuple(elements) {
	return makeTuple(tuple(elements), elements);
}
/**
* @category constructors
* @since 4.0.0
*/
var ArraySchema = /*#__PURE__*/ lambda((schema) => make$3(new Arrays(false, [], [schema.ast]), { value: schema }));
function makeUnion(ast, members) {
	return make$3(ast, {
		members,
		mapMembers(f, options) {
			const members = f(this.members);
			return makeUnion(union$1(members, this.ast.mode, options?.unsafePreserveChecks ? this.ast.checks : void 0), members);
		}
	});
}
/**
* Creates a union schema from an array of member schemas. Members are tested in
* order; the first match is returned.
*
* **Details**
*
* Optionally, specify `mode`:
* - `"anyOf"` (default) — matches if any member matches.
* - `"oneOf"` — matches if exactly one member matches.
*
* **Example** (String or number union)
*
* ```ts
* import { Schema } from "effect"
*
* const schema = Schema.Union([Schema.String, Schema.Number])
*
* Schema.decodeUnknownSync(schema)("hello") // "hello"
* Schema.decodeUnknownSync(schema)(42)       // 42
* ```
*
* @category constructors
* @since 3.10.0
*/
function Union(members, options) {
	return makeUnion(union$1(members, options?.mode ?? "anyOf", void 0), members);
}
/**
* Creates a union schema from an array of literal values.
*
* **Example** (Status codes)
*
* ```ts
* import { Schema } from "effect"
*
* const schema = Schema.Literals(["active", "inactive", "pending"])
* // accepts "active", "inactive", or "pending"
* ```
*
* @see {@link Literal} for a schema that represents a single literal.
* @category constructors
* @since 4.0.0
*/
function Literals(literals) {
	const members = literals.map(Literal);
	return make$3(union$1(members, "anyOf", void 0), {
		literals,
		members,
		mapMembers(f) {
			return Union(f(this.members));
		},
		pick(literals) {
			return Literals(literals);
		},
		transform(to) {
			return Union(members.map((member, index) => member.transform(to[index])));
		}
	});
}
/**
* Creates a union schema of `S | null`.
*
* @category constructors
* @since 3.10.0
*/
var NullOr = /*#__PURE__*/ lambda((self) => Union([self, Null]));
/**
* Creates a union schema of `S | undefined`.
*
* @category constructors
* @since 3.10.0
*/
var UndefinedOr = /*#__PURE__*/ lambda((self) => Union([self, Undefined]));
function decodeTo(to, transformation) {
	return (from) => {
		return make$3(decodeTo$1(from.ast, to.ast, transformation ? make$7(transformation) : passthrough()), {
			from,
			to
		});
	};
}
/**
* Attaches a constructor default value to a schema field.
*
* **Details**
*
* Constructor defaults are applied only during `make*`, not during decoding or
* encoding.
*
* **Example** (Optional field with a static default)
*
* ```ts
* import { Effect, Schema } from "effect"
*
* const MySchema = Schema.Struct({
*   name: Schema.String.pipe(
*     Schema.optionalKey,
*     Schema.withConstructorDefault(Effect.succeed("anonymous"))
*   )
* })
*
* const value = MySchema.make({})
* // value: { name: "anonymous" }
* ```
*
* @category constructors
* @since 3.10.0
*/
function withConstructorDefault(defaultValue) {
	return (schema) => make$3(withConstructorDefault$1(schema.ast, mapErrorEager(defaultValue, (e) => e.issue)), { schema });
}
/**
* Combines a {@link Literal} schema with {@link withConstructorDefault}, making it ideal
* for discriminator fields in tagged unions. When constructing via `make`, the
* `_tag` field can be omitted and will be filled automatically.
*
* **Example** (Discriminated union tag)
*
* ```ts
* import { Schema } from "effect"
*
* const A = Schema.Struct({ _tag: Schema.tag("A"), value: Schema.Number })
*
* // _tag is optional in make, auto-filled to "A"
* const a = A.make({ value: 42 })
* // a: { _tag: "A", value: 42 }
* ```
*
* @see {@link tagDefaultOmit} to also omit the tag during encoding
* @see {@link TaggedStruct} for a shorthand that adds `_tag` automatically
* @category constructors
* @since 3.10.0
*/
function tag(literal) {
	return Literal(literal).pipe(withConstructorDefault(succeed(literal)));
}
/**
* Creates a struct schema with an automatically populated `_tag` field.
*
* **When to use**
*
* Use to define a tagged union case from a literal tag and a set of fields.
*
* **Details**
*
* When using the `make` method, the `_tag` field is optional and will be
* added automatically. However, when decoding or encoding, the `_tag` field
* must be present in the input.
*
* **Example** (Tagged struct as a shorthand for a struct with a `_tag` field)
*
* ```ts
* import { Schema } from "effect"
*
* // Defines a struct with a fixed `_tag` field
* const tagged = Schema.TaggedStruct("A", {
*   a: Schema.String
* })
*
* // This is the same as writing:
* const equivalent = Schema.Struct({
*   _tag: Schema.tag("A"),
*   a: Schema.String
* })
* ```
*
* **Example** (Accessing the literal value of the tag)
*
* ```ts
* import { Schema } from "effect"
*
* const tagged = Schema.TaggedStruct("A", {
*   a: Schema.String
* })
*
* // literal: "A"
* const literal = tagged.fields._tag.schema.literal
* ```
*
* @category constructors
* @since 3.10.0
*/
function TaggedStruct(value, fields) {
	return Struct({
		_tag: tag(value),
		...fields
	});
}
/**
* Creates a schema that validates values using `instanceof`.
* Decoding and encoding pass the value through unchanged.
*
* **Example** (Schema for a built-in class)
*
* ```ts
* import { Schema } from "effect"
*
* const DateSchema = Schema.instanceOf(Date)
*
* const decoded = Schema.decodeUnknownSync(DateSchema)(new Date("2024-01-01"))
* // decoded: Date
* ```
*
* @category constructors
* @since 3.10.0
*/
function instanceOf(constructor, annotations) {
	return declare((u) => u instanceof constructor, annotations);
}
/**
* Constructs an `SchemaAST.Link` that describes how a value of type `T` encodes to and decodes from a `To` schema.
* Used when building low-level AST transformations that bridge two schema types.
*
* @category transforming
* @since 4.0.0
*/
function link() {
	return (encodeTo, transformation) => {
		return new Link(encodeTo.ast, make$7(transformation));
	};
}
/**
* Creates a custom validation filter from a predicate function.
*
* **Details**
*
* The predicate receives the decoded input value, the schema AST, and parse
* options, and returns a `FilterOutput`. Non-success outputs are normalized into
* schema issues. The `annotations` parameter annotates the filter itself; with
* the default formatter, failures use `message` first, `expected` second, and
* `<filter>` when neither is provided.
*
* When `abort` is `true`, parsing stops after this filter fails instead of
* collecting later check failures.
*
* **Example** (Failure at a nested path)
*
* ```ts
* import { Schema } from "effect"
*
* const schema = Schema.Struct({ password: Schema.String, confirmPassword: Schema.String }).check(
*   Schema.makeFilter((o) =>
*     o.password === o.confirmPassword
*       ? undefined
*       : { path: ["password"], issue: "password and confirmPassword must match" }
*   )
* )
*
* console.log(String(Schema.decodeUnknownExit(schema)({ password: "123456", confirmPassword: "1234567" })))
* // Failure(Cause([Fail(SchemaError: password and confirmPassword must match
* //   at ["password"])]))
* ```
*
* **Example** (Reporting multiple failures at once)
*
* ```ts
* import { Schema } from "effect"
*
* const schema = Schema.Struct({ a: Schema.Finite, b: Schema.Finite, c: Schema.Finite }).check(
*   Schema.makeFilter((o) => {
*     const issues: Array<Schema.FilterIssue> = []
*     if (o.a > 0) {
*       if (o.b <= 0) issues.push({ path: ["b"], issue: "b must be greater than 0" })
*       if (o.c <= 0) issues.push({ path: ["c"], issue: "c must be greater than 0" })
*     }
*     return issues
*   })
* )
*
* console.log(String(Schema.decodeUnknownExit(schema)({ a: 1, b: 0, c: 0 })))
* // Failure(Cause([Fail(SchemaError: b must be greater than 0
* //   at ["b"]
* // c must be greater than 0
* //   at ["c"])]))
* ```
*
* @category constructors
* @since 4.0.0
*/
var makeFilter = makeFilter$1;
/**
* Validates that a string matches the specified regular expression pattern.
*
* **Details**
*
* JSON Schema:
*
* This check corresponds to the `pattern` constraint in JSON Schema.
*
* Arbitrary:
*
* When generating test data with fast-check, this applies a `patterns`
* constraint to ensure generated strings match the specified RegExp pattern.
*
* @category String checks
* @since 4.0.0
*/
var isPattern = isPattern$1;
/**
* Returns a RegExp for validating an RFC 9562 / RFC 4122 UUID.
*
* Optionally specify a version 1-8. If no version is specified (`undefined`), all versions are supported.
*/
var getUUIDRegExp = (version) => {
	if (version) return new globalThis.RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
	return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|[fF]{8}-[fF]{4}-[fF]{4}-[fF]{4}-[fF]{12})$/;
};
/**
* Validates that a string is a strict Universally Unique Identifier (UUID).
*
* **When to use**
*
* Use when you need UUID semantics, including version and RFC variant bits,
* rather than only the dashed hexadecimal shape.
*
* **Details**
*
* Without a version argument, this accepts UUID versions 1 through 8, the nil
* UUID (`00000000-0000-0000-0000-000000000000`), and the max UUID
* (`ffffffff-ffff-ffff-ffff-ffffffffffff`). With a version argument, this
* accepts only UUIDs with that version and RFC variant bits; nil and max UUIDs
* are not versioned UUIDs and do not match version-specific checks.
*
* JSON Schema:
*
* This check corresponds to a `pattern` constraint in JSON Schema that matches
* UUID format, and includes a `format: "uuid"` annotation.
*
* Arbitrary:
*
* When generating test data with fast-check, this applies a `patterns`
* constraint to ensure generated strings match the UUID pattern.
*
* @see {@link isGUID} for shape-only GUID validation.
* @category String checks
* @since 4.0.0
*/
function isUUID(version, annotations) {
	const regExp = getUUIDRegExp(version);
	return isPattern(regExp, {
		expected: version ? `a UUID v${version}` : "a UUID",
		meta: {
			_tag: "isUUID",
			regExp,
			version
		},
		...annotations
	});
}
/**
* Creates a greater-than-or-equal-to (`>=`) check for any ordered type from an
* `Order.Order` instance.
*
* @category Order checks
* @since 4.0.0
*/
function makeIsGreaterThanOrEqualTo(options) {
	const gte = isGreaterThanOrEqualTo$1(options.order);
	const formatter = options.formatter ?? format$1;
	return (minimum, annotations) => {
		return makeFilter((input) => gte(input, minimum), {
			expected: `a value greater than or equal to ${formatter(minimum)}`,
			arbitrary: { constraint: { ordered: {
				order: options.order,
				minimum
			} } },
			...options.annotate?.(minimum),
			...annotations
		});
	};
}
/**
* Creates a less-than-or-equal-to (`<=`) check for any ordered type from an
* `Order.Order` instance.
*
* @category Order checks
* @since 4.0.0
*/
function makeIsLessThanOrEqualTo(options) {
	const lte = isLessThanOrEqualTo$1(options.order);
	const formatter = options.formatter ?? format$1;
	return (maximum, annotations) => {
		return makeFilter((input) => lte(input, maximum), {
			expected: `a value less than or equal to ${formatter(maximum)}`,
			arbitrary: { constraint: { ordered: {
				order: options.order,
				maximum
			} } },
			...options.annotate?.(maximum),
			...annotations
		});
	};
}
/**
* Validates that a number is greater than or equal to the specified value
* (inclusive).
*
* **Details**
*
* JSON Schema:
*
* This check corresponds to the `minimum` constraint in JSON Schema.
*
* Arbitrary:
*
* When generating test data with fast-check, this applies a `minimum` constraint
* to ensure generated numbers are greater than or equal to the specified value.
*
* @category Number checks
* @since 4.0.0
*/
var isGreaterThanOrEqualTo = /*#__PURE__*/ makeIsGreaterThanOrEqualTo({
	order: Number$4,
	annotate: (minimum) => ({ meta: {
		_tag: "isGreaterThanOrEqualTo",
		minimum
	} })
});
/**
* Validates that a number is less than or equal to the specified value
* (inclusive).
*
* **Details**
*
* JSON Schema:
*
* This check corresponds to the `maximum` constraint in JSON Schema.
*
* Arbitrary:
*
* When generating test data with fast-check, this applies a `maximum` constraint
* to ensure generated numbers are less than or equal to the specified value.
*
* @category Number checks
* @since 4.0.0
*/
var isLessThanOrEqualTo = /*#__PURE__*/ makeIsLessThanOrEqualTo({
	order: Number$4,
	annotate: (maximum) => ({ meta: {
		_tag: "isLessThanOrEqualTo",
		maximum
	} })
});
/**
* Validates that a number is a safe integer (within the safe integer range
* that can be exactly represented in JavaScript).
*
* **Details**
*
* JSON Schema:
*
* This check corresponds to the `type: "integer"` constraint in JSON Schema.
*
* Arbitrary:
*
* When generating test data with fast-check, this applies an `integer: true`
* constraint to ensure generated numbers are integers.
*
* @category Integer checks
* @since 4.0.0
*/
function isInt(annotations) {
	return makeFilter((n) => globalThis.Number.isSafeInteger(n), {
		expected: "an integer",
		meta: { _tag: "isInt" },
		arbitrary: { constraint: { integer: true } },
		...annotations
	});
}
/**
* Validates that a BigInt is greater than or equal to the specified value
* (inclusive).
*
* **Details**
*
* Arbitrary:
*
* When generating test data with fast-check, this applies a `min` constraint
* to ensure generated BigInt values are greater than or equal to the specified
* value.
*
* @category BigInt checks
* @since 4.0.0
*/
var isGreaterThanOrEqualToBigInt = /*#__PURE__*/ makeIsGreaterThanOrEqualTo({
	order: BigInt$4,
	annotate: (minimum) => ({ meta: {
		_tag: "isGreaterThanOrEqualToBigInt",
		minimum
	} })
});
/**
* Validates that a BigInt is less than or equal to the specified value
* (inclusive).
*
* **Details**
*
* Arbitrary:
*
* When generating test data with fast-check, this applies a `max` constraint
* to ensure generated BigInt values are less than or equal to the specified
* value.
*
* @category BigInt checks
* @since 4.0.0
*/
var isLessThanOrEqualToBigInt = /*#__PURE__*/ makeIsLessThanOrEqualTo({
	order: BigInt$4,
	annotate: (maximum) => ({ meta: {
		_tag: "isLessThanOrEqualToBigInt",
		maximum
	} })
});
/**
* Validates that a value has at most the specified length. Works with strings
* and arrays.
*
* **Details**
*
* JSON Schema:
*
* This check corresponds to the `maxLength` constraint for strings or the
* `maxItems` constraint for arrays in JSON Schema.
*
* Arbitrary:
*
* When generating test data with fast-check, this applies a `maxLength`
* constraint to ensure generated strings or arrays have at most the required
* length.
*
* @category Length checks
* @since 4.0.0
*/
function isMaxLength(maxLength, annotations) {
	maxLength = Math.max(0, Math.floor(maxLength));
	return makeFilter((input) => input.length <= maxLength, {
		expected: `a value with a length of at most ${maxLength}`,
		meta: {
			_tag: "isMaxLength",
			maxLength
		},
		[STRUCTURAL_ANNOTATION_KEY]: true,
		arbitrary: { constraint: { maxLength } },
		...annotations
	});
}
/**
* Validates that a value's length is within the specified range. Works with
* strings and arrays.
*
* **Details**
*
* JSON Schema:
*
* This check corresponds to `minLength`/`maxLength` constraints for strings
* or `minItems`/`maxItems` constraints for arrays in JSON Schema.
*
* Arbitrary:
*
* When generating test data with fast-check, this applies `minLength` and
* `maxLength` constraints to ensure generated strings or arrays have a length
* within the specified range.
*
* @category Length checks
* @since 4.0.0
*/
function isLengthBetween(minimum, maximum, annotations) {
	minimum = Math.max(0, Math.floor(minimum));
	maximum = Math.max(0, Math.floor(maximum));
	return makeFilter((input) => input.length >= minimum && input.length <= maximum, {
		expected: minimum === maximum ? `a value with a length of ${minimum}` : `a value with a length between ${minimum} and ${maximum}`,
		meta: {
			_tag: "isLengthBetween",
			minimum,
			maximum
		},
		[STRUCTURAL_ANNOTATION_KEY]: true,
		arbitrary: { constraint: {
			minLength: minimum,
			maxLength: maximum
		} },
		...annotations
	});
}
globalThis.RegExp;
globalThis.URL;
function dateArbitraryConstraints(constraint, ordered, base, toDate) {
	const out = { ...base };
	delete out.valid;
	if (base?.valid || constraint?.valid) out.noInvalidDate = true;
	if (ordered?.minimum !== void 0) {
		const minimum = toDate === void 0 ? ordered.minimum : toDate(ordered.minimum);
		const nextMin = ordered.exclusiveMinimum ? new globalThis.Date(minimum.getTime() + 1) : minimum;
		if (out.min === void 0 || nextMin.getTime() > out.min.getTime()) out.min = nextMin;
	}
	if (ordered?.maximum !== void 0) {
		const maximum = toDate === void 0 ? ordered.maximum : toDate(ordered.maximum);
		const nextMax = ordered.exclusiveMaximum ? new globalThis.Date(maximum.getTime() - 1) : maximum;
		if (out.max === void 0 || nextMax.getTime() < out.max.getTime()) out.max = nextMax;
	}
	return out;
}
var DateString = /*#__PURE__*/ String$1.annotate({ expected: "a string in ISO 8601 format that will be decoded as a Date" });
/**
* Schema for JavaScript `Date` objects.
*
* **When to use**
*
* Use to validate in-memory values that must already be JavaScript date
* objects.
*
* **Details**
*
* This schema accepts any `Date` instance, including invalid dates. The default
* JSON serializer encodes valid dates as ISO 8601 strings; invalid dates encode
* as `"Invalid Date"`.
*
* **Example** (Date schema)
*
* ```ts
* import { Schema } from "effect"
*
* Schema.decodeUnknownSync(Schema.Date)(new Date("2024-01-01"))
* // => Date { 2024-01-01T00:00:00.000Z }
* ```
*
* @see {@link DateValid} for accepting only valid Date instances
*
* @category Date
* @since 4.0.0
*/
var Date$1 = /*#__PURE__*/ instanceOf(globalThis.Date, {
	typeConstructor: { _tag: "Date" },
	generation: {
		runtime: `Schema.Date`,
		Type: `globalThis.Date`
	},
	expected: "Date",
	toCodecJson: () => link()(DateString, dateFromString),
	toArbitrary: () => (fc, ctx) => fc.date(dateArbitraryConstraints(ctx?.constraint, ctx?.constraint?.ordered?.order === Date$3 ? ctx.constraint.ordered : void 0))
});
globalThis.File;
globalThis.FormData;
globalThis.URLSearchParams;
/**
* Schema for integers, rejecting `NaN`, `Infinity`, and `-Infinity`.
*
* @category Number
* @since 3.10.0
*/
var Int = /*#__PURE__*/ Number$1.check(/*#__PURE__*/ isInt());
globalThis.Uint8Array;
var immerable = /*#__PURE__*/ globalThis.Symbol.for("immer-draftable");
function makeClass(Inherited, identifier, struct$1, annotations, proto) {
	const getClassSchema = getClassSchemaFactory(struct$1, identifier, annotations);
	const ClassTypeId = getClassTypeId(identifier);
	const out = class extends Inherited {
		constructor(...[input, options]) {
			input = input ?? {};
			const validated = struct$1.make(input, options);
			super({
				...input,
				...validated
			}, {
				...options,
				disableChecks: true
			});
		}
		static [TypeId$1] = TypeId$1;
		get [ClassTypeId]() {
			return ClassTypeId;
		}
		static [immerable] = true;
		static identifier = identifier;
		static fields = struct$1.fields;
		static get ast() {
			return getClassSchema(this).ast;
		}
		static pipe() {
			return pipeArguments(this, arguments);
		}
		static rebuild(ast) {
			return getClassSchema(this).rebuild(ast);
		}
		static make(input, options) {
			return new this(input, options);
		}
		static makeOption(input, options) {
			return makeOption(getClassSchema(this))(input ?? {}, options);
		}
		static makeEffect(input, options) {
			return getClassSchema(this).makeEffect(input ?? {}, options);
		}
		static annotate(annotations) {
			return this.rebuild(annotate(this.ast, annotations));
		}
		static annotateKey(annotations) {
			return this.rebuild(annotateKey(this.ast, annotations));
		}
		static check(...checks) {
			return this.rebuild(appendChecks(this.ast, checks));
		}
		static extend(identifier) {
			return (newFields, annotations) => {
				const fields = {
					...struct$1.fields,
					...newFields
				};
				return makeClass(this, identifier, makeStruct(struct(fields, struct$1.ast.checks, { identifier }), fields), annotations, proto);
			};
		}
		static mapFields(f, options) {
			return struct$1.mapFields(f, options);
		}
	};
	if (proto !== void 0) Object.assign(out.prototype, proto(identifier));
	return out;
}
function getClassTransformation(self) {
	return new Transformation(transform$1((input) => new self(input)), passthrough$1());
}
function getClassTypeId(identifier) {
	return `~effect/Schema/Class/${identifier}`;
}
function getClassSchemaFactory(from, identifier, annotations) {
	let memo;
	return (self) => {
		if (memo === void 0) {
			const transformation = getClassTransformation(self);
			const to = make$3(new Declaration([from.ast], () => (input, ast) => {
				return input instanceof self || hasProperty(input, getClassTypeId(identifier)) ? succeed(input) : fail(new InvalidType(ast, some(input)));
			}, {
				identifier,
				[ClassTypeId]: ([from]) => new Link(from, transformation),
				toCodec: ([from]) => new Link(from.ast, transformation),
				toArbitrary: ([from]) => () => ({
					arbitrary: from.arbitrary.map((args) => new self(args)),
					terminal: from.terminal?.map((args) => new self(args))
				}),
				toFormatter: ([from]) => (t) => `${self.identifier}(${from(t)})`,
				"~sentinels": collectSentinels(from.ast),
				...annotations
			}));
			memo = from.pipe(decodeTo(to, transformation));
		}
		return memo;
	};
}
function isStruct(schema) {
	return isSchema(schema);
}
/**
* Creates a schema-backed error class that can be used as a typed,
* yieldable error in Effect programs. Combines {@link Class} validation with
* the `YieldableError` interface so instances can be yielded directly inside
* `Effect.gen`.
*
* **Example** (Schema-backed error)
*
* ```ts
* import { Effect, Schema } from "effect"
*
* class NotFound extends Schema.ErrorClass<NotFound>("NotFound")({
*   id: Schema.Number
* }) {}
*
* const program = Effect.gen(function*() {
*   yield* new NotFound({ id: 1 })
* })
* ```
*
* @category constructors
* @since 4.0.0
*/
var ErrorClass = (identifier) => (schema, annotations) => {
	return makeClass(Error$1, identifier, isStruct(schema) ? schema : Struct(schema), annotations, (identifier) => ({ name: identifier }));
};
/**
* Defines a schema-backed yieldable error class with an automatically populated
* `_tag` field.
*
* **When to use**
*
* Use to define typed errors that are schema validated, yielded in `Effect.gen`,
* and matched as tagged union members.
*
* **Example** (Tagged error class)
*
* ```ts
* import { Effect, Schema } from "effect"
*
* class NotFound extends Schema.TaggedErrorClass<NotFound>()("NotFound", {
*   id: Schema.Number
* }) {}
*
* const program = Effect.gen(function*() {
*   yield* new NotFound({ id: 42 })
* })
* ```
*
* @category constructors
* @since 3.10.0
*/
var TaggedErrorClass = (identifier) => {
	return (tagValue, schema, annotations) => {
		const struct = isStruct(schema) ? schema.mapFields((fields) => ({
			_tag: tag(tagValue),
			...fields
		}), { unsafePreserveChecks: true }) : TaggedStruct(tagValue, schema);
		return ErrorClass(identifier ?? tagValue)(struct, annotations);
	};
};
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/ManagedRuntime.js
var TypeId = "~effect/ManagedRuntime";
/**
* Creates a `ManagedRuntime` from a layer.
*
* **When to use**
*
* Use to create a reusable runtime from a `Layer` for application entry points
* or integration code that runs many effects without rebuilding services.
*
* **Details**
*
* The layer is built lazily on first use and its context is cached for
* subsequent runs. Resources acquired by the layer are owned by the runtime and
* are released when `dispose` or `disposeEffect` is run. `options.memoMap` can
* be used to share layer memoization with other layer builds.
*
* **Gotchas**
*
* Dispose the runtime when it is no longer needed. A runtime cannot be reused
* after disposal.
*
* **Example** (Creating a managed runtime)
*
* ```ts
* import { Context, Effect, Layer, ManagedRuntime } from "effect"
*
* class Notifications extends Context.Service<Notifications, {
*   readonly notify: (message: string) => Effect.Effect<void>
* }>()("Notifications") {
*   static readonly layer = Layer.succeed(this)({
*     notify: Effect.fn("Notifications.notify")((message) =>
*       Effect.sync(() => console.log(message))
*     )
*   })
* }
*
* const runtime = ManagedRuntime.make(Notifications.layer)
*
* const program = Effect.flatMap(
*   Notifications,
*   (_) => _.notify("Hello, world!")
* ).pipe(Effect.ensuring(runtime.disposeEffect))
*
* runtime.runPromise(program)
* // Hello, world!
* ```
*
* @see {@link ManagedRuntime} for the returned runtime interface
* @see {@link Layer.MemoMap} for shared layer memoization
* @see {@link Layer.build} for lower-level scoped layer construction
*
* @category runtime class
* @since 2.0.0
*/
var make$2 = (layer, options) => {
	const memoMap = options?.memoMap ?? makeMemoMapUnsafe();
	const scope = makeUnsafe$2("parallel");
	const layerScope = forkUnsafe(scope, "sequential");
	const defaultRunOptions = { onFiberStart: runIn(scope) };
	const mergeRunOptions = (options) => options ? {
		...options,
		onFiberStart: options.onFiberStart ? (fiber) => {
			defaultRunOptions.onFiberStart(fiber);
			options.onFiberStart(fiber);
		} : defaultRunOptions.onFiberStart
	} : defaultRunOptions;
	let buildFiber;
	const contextEffect = withFiber((fiber) => {
		if (!buildFiber) buildFiber = runFork(tap(buildWithMemoMap(layer, memoMap, layerScope), (context) => sync(() => {
			self.cachedContext = context;
		})), {
			...defaultRunOptions,
			scheduler: fiber.currentScheduler
		});
		return flatten(await_(buildFiber));
	});
	const self = {
		[TypeId]: TypeId,
		memoMap,
		scope,
		contextEffect,
		cachedContext: void 0,
		context() {
			return self.cachedContext === void 0 ? runPromise(self.contextEffect) : Promise.resolve(self.cachedContext);
		},
		dispose() {
			return runPromise(self.disposeEffect);
		},
		disposeEffect: suspend(() => {
			self.contextEffect = die("ManagedRuntime disposed");
			self.cachedContext = void 0;
			return close(self.scope, void_);
		}),
		runFork(effect, options) {
			return self.cachedContext === void 0 ? runFork(provide(self, effect), mergeRunOptions(options)) : runForkWith(self.cachedContext)(effect, mergeRunOptions(options));
		},
		runCallback(effect, options) {
			return self.cachedContext === void 0 ? runCallback(provide(self, effect), mergeRunOptions(options)) : runCallbackWith(self.cachedContext)(effect, mergeRunOptions(options));
		},
		runSyncExit(effect) {
			return self.cachedContext === void 0 ? runSyncExit(provide(self, effect)) : runSyncExitWith(self.cachedContext)(effect);
		},
		runSync(effect) {
			return self.cachedContext === void 0 ? runSync(provide(self, effect)) : runSyncWith(self.cachedContext)(effect);
		},
		runPromiseExit(effect, options) {
			return self.cachedContext === void 0 ? runPromiseExit(provide(self, effect), mergeRunOptions(options)) : runPromiseExitWith(self.cachedContext)(effect, mergeRunOptions(options));
		},
		runPromise(effect, options) {
			return self.cachedContext === void 0 ? runPromise(provide(self, effect), mergeRunOptions(options)) : runPromiseWith(self.cachedContext)(effect, mergeRunOptions(options));
		}
	};
	return self;
};
function provide(managed, effect) {
	return flatMap(managed.contextEffect, (context) => provideContext(effect, context));
}
//#endregion
//#region ../../node_modules/.bun/effect@4.0.0-beta.83/node_modules/effect/dist/Ref.js
/**
* Stores fiber-safe mutable state inside Effect programs.
*
* A `Ref<A>` holds one value and exposes reads, writes, and atomic
* transformations as effects, so state changes compose with Effect's
* concurrency model. This module includes constructors, safe and unsafe reads,
* set and get-and-set helpers, update and modify helpers, and conditional
* update variants that leave the value unchanged when an `Option.none` result
* is returned.
*
* @since 2.0.0
*/
var RefProto = {
	["~effect/Ref"]: { _A: identity },
	...PipeInspectableProto,
	toJSON() {
		return {
			_id: "Ref",
			ref: this.ref
		};
	}
};
/**
* Creates a new Ref with the specified initial value (unsafe version).
*
* **When to use**
*
* Use when you need immediate synchronous construction and can guarantee
* that creating the `Ref` outside of `Effect` is safe.
*
* **Gotchas**
*
* Prefer `Ref.make` for Effect-wrapped creation in Effect programs.
*
* **Example** (Creating a ref unsafely)
*
* ```ts
* import { Ref } from "effect"
*
* // Create a ref directly without Effect
* const counter = Ref.makeUnsafe(0)
*
* // Get the current value
* const value = Ref.getUnsafe(counter)
* console.log(value) // 0
*
* // Note: This is unsafe and should be used carefully
* // Prefer Ref.make for Effect-wrapped creation
* ```
*
* @category constructors
* @since 4.0.0
*/
var makeUnsafe = (value) => {
	const self = Object.create(RefProto);
	self.ref = make$6(value);
	return self;
};
/**
* Creates a new Ref with the specified initial value.
*
* **When to use**
*
* Use to create a `Ref` for shared mutable state inside an Effect program.
*
* **Example** (Creating a ref)
*
* ```ts
* import { Effect, Ref } from "effect"
*
* const program = Effect.gen(function*() {
*   const ref = yield* Ref.make(42)
*   const value = yield* Ref.get(ref)
*   console.log(value) // 42
* })
* ```
*
* @see {@link makeUnsafe} for synchronous construction outside Effect code
*
* @category constructors
* @since 2.0.0
*/
var make$1 = (value) => sync(() => makeUnsafe(value));
/**
* Gets the current value of the Ref.
*
* **When to use**
*
* Use to read the current `Ref` value without changing it.
*
* **Example** (Getting the current value)
*
* ```ts
* import { Effect, Ref } from "effect"
*
* const program = Effect.gen(function*() {
*   const ref = yield* Ref.make(42)
*   const value = yield* Ref.get(ref)
*   console.log(value) // 42
* })
* ```
*
* @see {@link set} for replacing the current value
*
* @category getters
* @since 2.0.0
*/
var get = (self) => sync(() => self.ref.current);
/**
* Sets the value of the Ref to the specified value.
*
* **When to use**
*
* Use to replace the current `Ref` value with a known value.
*
* **Example** (Setting a value)
*
* ```ts
* import { Effect, Ref } from "effect"
*
* const program = Effect.gen(function*() {
*   const ref = yield* Ref.make(0)
*   yield* Ref.set(ref, 42)
*   const value = yield* Ref.get(ref)
*   console.log(value) // 42
* })
*
* // Using multiple operations
* const program2 = Effect.gen(function*() {
*   const ref = yield* Ref.make(0)
*   yield* Ref.set(ref, 100)
*   const value = yield* Ref.get(ref)
*   console.log(value) // 100
* })
* ```
*
* @see {@link getAndSet} for setting while returning the previous value
* @see {@link setAndGet} for setting while returning the new value
*
* @category setters
* @since 2.0.0
*/
var set = /*#__PURE__*/ dual(2, (self, value) => sync(() => set$1(self.ref, value)));
/**
* Updates the value of the Ref atomically using the given function.
*
* **When to use**
*
* Use to apply a `Ref` state transition without returning a value.
*
* **Example** (Updating a value)
*
* ```ts
* import { Effect, Ref } from "effect"
*
* const program = Effect.gen(function*() {
*   const counter = yield* Ref.make(5)
*
*   // Update the value
*   yield* Ref.update(counter, (n) => n * 2)
*
*   const value = yield* Ref.get(counter)
*   console.log(value) // 10
* })
*
* // Using multiple operations
* const program2 = Effect.gen(function*() {
*   const counter = yield* Ref.make(5)
*   yield* Ref.update(counter, (n: number) => n + 10)
*   const value = yield* Ref.get(counter)
*   console.log(value) // 15
* })
* ```
*
* @see {@link updateAndGet} for returning the new value
* @see {@link getAndUpdate} for returning the previous value
*
* @category setters
* @since 2.0.0
*/
var update = /*#__PURE__*/ dual(2, (self, f) => sync(() => {
	self.ref.current = f(self.ref.current);
}));
var jsonSchema = Union([
	Union([
		String$1,
		Number$1,
		Boolean$1,
		Null
	]),
	Record(String$1, Any),
	ArraySchema(Any)
]);
var bufferSchema = typeof Buffer === "undefined" ? Unknown : instanceOf(Buffer);
function columnToSchema(column) {
	let schema;
	const dimensions = column.dimensions;
	if (typeof dimensions === "number" && dimensions > 0) return pgArrayColumnToSchema(column, dimensions);
	const { type, constraint } = extractExtendedColumnType(column);
	switch (type) {
		case "array":
			schema = arrayColumnToSchema(column, constraint);
			break;
		case "object":
			schema = objectColumnToSchema(column, constraint);
			break;
		case "number":
			schema = numberColumnToSchema(column, constraint);
			break;
		case "bigint":
			schema = bigintColumnToSchema(column, constraint);
			break;
		case "boolean":
			schema = Boolean$1;
			break;
		case "string":
			schema = stringColumnToSchema(column, constraint);
			break;
		case "custom":
			schema = Any;
			break;
		default: schema = Any;
	}
	return schema;
}
function numberColumnToSchema(column, constraint) {
	let min;
	let max;
	let integer = false;
	switch (constraint) {
		case "int8":
			min = CONSTANTS.INT8_MIN;
			max = CONSTANTS.INT8_MAX;
			integer = true;
			break;
		case "uint8":
			min = 0;
			max = CONSTANTS.INT8_UNSIGNED_MAX;
			integer = true;
			break;
		case "int16":
			min = CONSTANTS.INT16_MIN;
			max = CONSTANTS.INT16_MAX;
			integer = true;
			break;
		case "uint16":
			min = 0;
			max = CONSTANTS.INT16_UNSIGNED_MAX;
			integer = true;
			break;
		case "int24":
			min = CONSTANTS.INT24_MIN;
			max = CONSTANTS.INT24_MAX;
			integer = true;
			break;
		case "uint24":
			min = 0;
			max = CONSTANTS.INT24_UNSIGNED_MAX;
			integer = true;
			break;
		case "int32":
			min = CONSTANTS.INT32_MIN;
			max = CONSTANTS.INT32_MAX;
			integer = true;
			break;
		case "uint32":
			min = 0;
			max = CONSTANTS.INT32_UNSIGNED_MAX;
			integer = true;
			break;
		case "int53":
			min = Number.MIN_SAFE_INTEGER;
			max = Number.MAX_SAFE_INTEGER;
			integer = true;
			break;
		case "uint53":
			min = 0;
			max = Number.MAX_SAFE_INTEGER;
			integer = true;
			break;
		case "float":
			min = CONSTANTS.INT24_MIN;
			max = CONSTANTS.INT24_MAX;
			break;
		case "ufloat":
			min = 0;
			max = CONSTANTS.INT24_UNSIGNED_MAX;
			break;
		case "double":
			min = CONSTANTS.INT48_MIN;
			max = CONSTANTS.INT48_MAX;
			break;
		case "udouble":
			min = 0;
			max = CONSTANTS.INT48_UNSIGNED_MAX;
			break;
		case "year":
			min = 1901;
			max = 2155;
			integer = true;
			break;
		case "unsigned":
			min = 0;
			max = Number.MAX_SAFE_INTEGER;
			break;
		default:
			min = Number.MIN_SAFE_INTEGER;
			max = Number.MAX_SAFE_INTEGER;
			break;
	}
	let schema = integer ? Int : Number$1;
	schema = schema.check(isGreaterThanOrEqualTo(min), isLessThanOrEqualTo(max));
	return schema;
}
var bigintStringModeSchema = BigInt$1.check(isGreaterThanOrEqualToBigInt(CONSTANTS.INT64_MIN), isLessThanOrEqualToBigInt(CONSTANTS.INT64_MAX));
var unsignedBigintStringModeSchema = BigInt$1.check(isGreaterThanOrEqualToBigInt(0n), isLessThanOrEqualToBigInt(CONSTANTS.INT64_UNSIGNED_MAX));
function bigintColumnToSchema(column, constraint) {
	let min;
	let max;
	switch (constraint) {
		case "int64":
			min = CONSTANTS.INT64_MIN;
			max = CONSTANTS.INT64_MAX;
			break;
		case "uint64":
			min = 0n;
			max = CONSTANTS.INT64_UNSIGNED_MAX;
			break;
	}
	let schema = BigInt$1;
	if (min !== void 0) schema = schema.check(isGreaterThanOrEqualToBigInt(min));
	if (max !== void 0) schema = schema.check(isLessThanOrEqualToBigInt(max));
	return schema;
}
function pgArrayColumnToSchema(column, dimensions) {
	const [baseType, baseConstraint] = column.dataType.split(" ");
	let baseSchema;
	switch (baseType) {
		case "number":
			baseSchema = numberColumnToSchema(column, baseConstraint);
			break;
		case "bigint":
			baseSchema = bigintColumnToSchema(column, baseConstraint);
			break;
		case "boolean":
			baseSchema = Boolean$1;
			break;
		case "string":
			baseSchema = stringColumnToSchema(column, baseConstraint);
			break;
		case "object":
			baseSchema = objectColumnToSchema(column, baseConstraint);
			break;
		case "array":
			baseSchema = arrayColumnToSchema(column, baseConstraint);
			break;
		default: baseSchema = Any;
	}
	let schema = ArraySchema(baseSchema);
	for (let i = 1; i < dimensions; i++) schema = ArraySchema(schema);
	return schema;
}
function arrayColumnToSchema(column, constraint) {
	switch (constraint) {
		case "geometry":
		case "point": return Tuple([Number$1, Number$1]);
		case "line": return Tuple([
			Number$1,
			Number$1,
			Number$1
		]);
		case "vector":
		case "halfvector": {
			const length = column.length;
			const schema = ArraySchema(Number$1);
			return length ? schema.check(isLengthBetween(length, length)) : schema;
		}
		case "int64vector": {
			const length = column.length;
			const schema = ArraySchema(BigInt$1.check(isGreaterThanOrEqualToBigInt(CONSTANTS.INT64_MIN), isLessThanOrEqualToBigInt(CONSTANTS.INT64_MAX)));
			return length ? schema.check(isLengthBetween(length, length)) : schema;
		}
		case "basecolumn": {
			const baseColumn = column.baseColumn;
			if (baseColumn) {
				const baseSchema = columnToSchema(baseColumn);
				const length = column.length;
				const schema = ArraySchema(baseSchema);
				if (length) return schema.check(isLengthBetween(length, length));
				return schema;
			}
			return ArraySchema(Any);
		}
		default: return ArraySchema(Any);
	}
}
function objectColumnToSchema(column, constraint) {
	switch (constraint) {
		case "buffer": return bufferSchema;
		case "date": return Date$1;
		case "geometry":
		case "point": return Struct({
			x: Number$1,
			y: Number$1
		});
		case "json": return jsonSchema;
		case "line": return Struct({
			a: Number$1,
			b: Number$1,
			c: Number$1
		});
		default: return ObjectKeyword;
	}
}
function stringColumnToSchema(column, constraint) {
	const { name: columnName, length, isLengthExact } = column;
	let regex;
	if (constraint === "binary") regex = /^[01]*$/;
	if (constraint === "uuid") return String$1.check(isUUID());
	if (constraint === "enum") {
		const enumValues = column.enumValues;
		if (!enumValues) throw new Error(`Column "${getTableName(getColumnTable(column))}"."${columnName}" is of 'enum' type, but lacks enum values`);
		return Literals(enumValues);
	}
	if (constraint === "int64") return bigintStringModeSchema;
	if (constraint === "uint64") return unsignedBigintStringModeSchema;
	let schema = String$1;
	schema = regex ? schema.check(isPattern(regex)) : schema;
	return length && isLengthExact ? schema.check(isLengthBetween(length, length)) : length ? schema.check(isMaxLength(length)) : schema;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/effect-schema/schema.js
function isOptional(schema) {
	if ((typeof schema !== "object" || schema === null) && typeof schema !== "function") return false;
	return isSchema(schema) && schema.ast?.context?.isOptional === true;
}
function isStructField(schema) {
	if (isSchema(schema)) return true;
	return isOptional(schema);
}
function handleColumns(columns, refinements, conditions) {
	const columnSchemas = {};
	for (const [key, selected] of Object.entries(columns)) {
		if (!is(selected, Column) && !is(selected, SQL) && !is(selected, SQL.Aliased) && typeof selected === "object") {
			columnSchemas[key] = handleColumns(isTable(selected) || isView(selected) ? getColumns(selected) : selected, refinements[key] ?? {}, conditions);
			continue;
		}
		const refinement = refinements[key];
		if (refinement !== void 0 && !(typeof refinement === "function" && !isStructField(refinement))) {
			columnSchemas[key] = refinement;
			continue;
		}
		const column = is(selected, Column) ? selected : void 0;
		const schema = column ? columnToSchema(column) : Any;
		const _refined = isStructField(refinement) || typeof refinement !== "function" ? schema : refinement(schema);
		const refined = isOptional(_refined) ? _refined.schema : _refined;
		if (conditions.never(column)) continue;
		else columnSchemas[key] = refined;
		if (column) {
			if (conditions.nullable(column)) columnSchemas[key] = NullOr(columnSchemas[key]);
			if (conditions.optional(column)) columnSchemas[key] = optional(UndefinedOr(columnSchemas[key]));
		}
	}
	return Struct(columnSchemas);
}
function handleEnum(enum_) {
	return Literals(enum_.enumValues);
}
var selectConditions = {
	never: () => false,
	optional: () => false,
	nullable: (column) => !column.notNull
};
var insertConditions = {
	never: (column) => column?.generated?.type === "always" || column?.generatedIdentity?.type === "always" || "identity" in (column ?? {}) && typeof column?.identity !== "undefined",
	optional: (column) => !column.notNull || column.notNull && column.hasDefault,
	nullable: (column) => !column.notNull
};
var createSelectSchema = (entity, refine) => {
	if (isWithEnum(entity)) return handleEnum(entity);
	return handleColumns(getColumns(entity), refine ?? {}, selectConditions);
};
var createInsertSchema = (entity, refine) => {
	return handleColumns(getColumns(entity), refine ?? {}, insertConditions);
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/foreign-keys.js
var ForeignKeyBuilder = class {
	static [entityKind] = "SQLiteForeignKeyBuilder";
	/** @internal */
	reference;
	/** @internal */
	_onUpdate;
	/** @internal */
	_onDelete;
	constructor(config, actions) {
		this.reference = () => {
			const { name, columns, foreignColumns } = config();
			return {
				name,
				columns,
				foreignTable: foreignColumns[0].table,
				foreignColumns
			};
		};
		if (actions) {
			this._onUpdate = actions.onUpdate;
			this._onDelete = actions.onDelete;
		}
	}
	onUpdate(action) {
		this._onUpdate = action;
		return this;
	}
	onDelete(action) {
		this._onDelete = action;
		return this;
	}
	/** @internal */
	build(table) {
		return new ForeignKey(table, this);
	}
};
var ForeignKey = class {
	static [entityKind] = "SQLiteForeignKey";
	reference;
	onUpdate;
	onDelete;
	constructor(table, builder) {
		this.table = table;
		this.reference = builder.reference;
		this.onUpdate = builder._onUpdate;
		this.onDelete = builder._onDelete;
	}
	getName() {
		const { name, columns, foreignColumns } = this.reference();
		const columnNames = columns.map((column) => column.name);
		const foreignColumnNames = foreignColumns.map((column) => column.name);
		const chunks = [
			this.table[TableName],
			...columnNames,
			foreignColumns[0].table[TableName],
			...foreignColumnNames
		];
		return name ?? `${chunks.join("_")}_fk`;
	}
	isNameExplicit() {
		return !!this.reference().name;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/columns/common.js
var SQLiteColumnBuilder = class extends ColumnBuilder {
	static [entityKind] = "SQLiteColumnBuilder";
	foreignKeyConfigs = [];
	references(ref, actions = {}) {
		this.foreignKeyConfigs.push({
			ref,
			actions
		});
		return this;
	}
	unique(name) {
		this.config.isUnique = true;
		this.config.uniqueName = name;
		return this;
	}
	generatedAlwaysAs(as, config) {
		this.config.generated = {
			as,
			type: "always",
			mode: config?.mode ?? "virtual"
		};
		return this;
	}
	/** @internal */
	buildForeignKeys(column, table) {
		return this.foreignKeyConfigs.map(({ ref, actions }) => {
			return ((ref, actions) => {
				const builder = new ForeignKeyBuilder(() => {
					const foreignColumn = ref();
					return {
						columns: [column],
						foreignColumns: [foreignColumn]
					};
				});
				if (actions.onUpdate) builder.onUpdate(actions.onUpdate);
				if (actions.onDelete) builder.onDelete(actions.onDelete);
				return builder.build(table);
			})(ref, actions);
		});
	}
};
var SQLiteColumn = class extends Column {
	static [entityKind] = "SQLiteColumn";
	/** @internal */
	table;
	constructor(table, config) {
		super(table, config);
		this.table = table;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/columns/blob.js
function hexToText(hexString) {
	let result = "";
	for (let i = 0; i < hexString.length; i += 2) {
		const hexPair = hexString.slice(i, i + 2);
		const decimalValue = Number.parseInt(hexPair, 16);
		result += String.fromCodePoint(decimalValue);
	}
	return result;
}
var SQLiteBigIntBuilder = class extends SQLiteColumnBuilder {
	static [entityKind] = "SQLiteBigIntBuilder";
	constructor(name) {
		super(name, "bigint int64", "SQLiteBigInt");
	}
	/** @internal */
	build(table) {
		return new SQLiteBigInt(table, this.config);
	}
};
var SQLiteBigInt = class extends SQLiteColumn {
	static [entityKind] = "SQLiteBigInt";
	getSQLType() {
		return "blob";
	}
	mapFromDriverValue = (value) => {
		if (typeof value === "string") return BigInt(hexToText(value));
		if (typeof Buffer !== "undefined" && Buffer.from) {
			const buf = Buffer.isBuffer(value) ? value : value instanceof ArrayBuffer ? Buffer.from(value) : value.buffer ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : Buffer.from(value);
			return BigInt(buf.toString("utf8"));
		}
		return BigInt(textDecoder.decode(value));
	};
	mapToDriverValue = (value) => {
		return Buffer.from(value.toString());
	};
};
var SQLiteBlobJsonBuilder = class extends SQLiteColumnBuilder {
	static [entityKind] = "SQLiteBlobJsonBuilder";
	constructor(name) {
		super(name, "object json", "SQLiteBlobJson");
	}
	/** @internal */
	build(table) {
		return new SQLiteBlobJson(table, this.config);
	}
};
var SQLiteBlobJson = class extends SQLiteColumn {
	static [entityKind] = "SQLiteBlobJson";
	getSQLType() {
		return "blob";
	}
	mapFromDriverValue = (value) => {
		if (typeof value === "string") return JSON.parse(hexToText(value));
		if (typeof Buffer !== "undefined" && Buffer.from) {
			const buf = Buffer.isBuffer(value) ? value : value instanceof ArrayBuffer ? Buffer.from(value) : value.buffer ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : Buffer.from(value);
			return JSON.parse(buf.toString("utf8"));
		}
		return JSON.parse(textDecoder.decode(value));
	};
	mapToDriverValue = (value) => {
		return Buffer.from(JSON.stringify(value));
	};
};
var SQLiteBlobBufferBuilder = class extends SQLiteColumnBuilder {
	static [entityKind] = "SQLiteBlobBufferBuilder";
	constructor(name) {
		super(name, "object buffer", "SQLiteBlobBuffer");
	}
	/** @internal */
	build(table) {
		return new SQLiteBlobBuffer(table, this.config);
	}
};
var SQLiteBlobBuffer = class extends SQLiteColumn {
	static [entityKind] = "SQLiteBlobBuffer";
	mapFromDriverValue = (value) => {
		if (Buffer.isBuffer(value)) return value;
		if (typeof value === "string") return Buffer.from(value, "hex");
		return Buffer.from(value);
	};
	getSQLType() {
		return "blob";
	}
};
function blob(a, b) {
	const { name, config } = getColumnNameAndConfig(a, b);
	if (config?.mode === "bigint") return new SQLiteBigIntBuilder(name);
	if (config?.mode === "buffer") return new SQLiteBlobBufferBuilder(name);
	return new SQLiteBlobJsonBuilder(name);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/columns/custom.js
var SQLiteCustomColumnBuilder = class extends SQLiteColumnBuilder {
	static [entityKind] = "SQLiteCustomColumnBuilder";
	constructor(name, fieldConfig, customTypeParams) {
		super(name, "custom", "SQLiteCustomColumn");
		this.config.fieldConfig = fieldConfig;
		this.config.customTypeParams = customTypeParams;
	}
	/** @internal */
	build(table) {
		return new SQLiteCustomColumn(table, this.config);
	}
};
var SQLiteCustomColumn = class extends SQLiteColumn {
	static [entityKind] = "SQLiteCustomColumn";
	sqlName;
	mapTo;
	mapFrom;
	mapJson;
	forJsonSelect;
	constructor(table, config) {
		super(table, config);
		this.sqlName = config.customTypeParams.dataType(config.fieldConfig);
		this.mapTo = config.customTypeParams.toDriver;
		this.mapFrom = config.customTypeParams.fromDriver;
		this.mapJson = config.customTypeParams.fromJson;
		this.forJsonSelect = config.customTypeParams.forJsonSelect;
	}
	getSQLType() {
		return this.sqlName;
	}
	mapFromDriverValue = (value) => {
		return typeof this.mapFrom === "function" ? this.mapFrom(value) : value;
	};
	mapFromJsonValue(value) {
		return typeof this.mapJson === "function" ? this.mapJson(value) : this.mapFromDriverValue(value);
	}
	jsonSelectIdentifier(identifier, sql) {
		if (typeof this.forJsonSelect === "function") return this.forJsonSelect(identifier, sql);
		const rawType = this.getSQLType().toLowerCase();
		const parenPos = rawType.indexOf("(");
		switch (parenPos + 1 ? rawType.slice(0, parenPos) : rawType) {
			case "numeric":
			case "decimal":
			case "bigint": return sql`cast(${identifier} as text)`;
			case "blob": return sql`hex(${identifier})`;
			default: return identifier;
		}
	}
	mapToDriverValue = (value) => {
		return typeof this.mapTo === "function" ? this.mapTo(value) : value;
	};
};
/**
* Custom sqlite database data type generator
*/
function customType(customTypeParams) {
	return (a, b) => {
		const { name, config } = getColumnNameAndConfig(a, b);
		return new SQLiteCustomColumnBuilder(name, config, customTypeParams);
	};
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/columns/integer.js
var SQLiteBaseIntegerBuilder = class extends SQLiteColumnBuilder {
	static [entityKind] = "SQLiteBaseIntegerBuilder";
	constructor(name, dataType, columnType) {
		super(name, dataType, columnType);
		this.config.autoIncrement = false;
	}
	primaryKey(config) {
		if (config?.autoIncrement) this.config.autoIncrement = true;
		this.config.hasDefault = true;
		return super.primaryKey();
	}
};
var SQLiteBaseInteger = class extends SQLiteColumn {
	static [entityKind] = "SQLiteBaseInteger";
	autoIncrement = this.config.autoIncrement;
	getSQLType() {
		return "integer";
	}
};
var SQLiteIntegerBuilder = class extends SQLiteBaseIntegerBuilder {
	static [entityKind] = "SQLiteIntegerBuilder";
	constructor(name) {
		super(name, "number int53", "SQLiteInteger");
	}
	build(table) {
		return new SQLiteInteger(table, this.config);
	}
};
var SQLiteInteger = class extends SQLiteBaseInteger {
	static [entityKind] = "SQLiteInteger";
};
var SQLiteTimestampBuilder = class extends SQLiteBaseIntegerBuilder {
	static [entityKind] = "SQLiteTimestampBuilder";
	constructor(name, mode) {
		super(name, "object date", "SQLiteTimestamp");
		this.config.mode = mode;
	}
	/**
	* @deprecated Use `default()` with your own expression instead.
	*
	* Adds `DEFAULT (cast((julianday('now') - 2440587.5)*86400000 as integer))` to the column, which is the current epoch timestamp in milliseconds.
	*/
	defaultNow() {
		return this.default(sql`(cast((julianday('now') - 2440587.5)*86400000 as integer))`);
	}
	build(table) {
		return new SQLiteTimestamp(table, this.config);
	}
};
var SQLiteTimestamp = class extends SQLiteBaseInteger {
	static [entityKind] = "SQLiteTimestamp";
	mode = this.config.mode;
	mapFromDriverValue = (value) => {
		if (typeof value === "string") return new Date(value.replaceAll("\"", ""));
		if (this.config.mode === "timestamp") return /* @__PURE__ */ new Date(value * 1e3);
		return new Date(value);
	};
	mapToDriverValue = (value) => {
		if (typeof value === "number") return value;
		const unix = value.getTime();
		if (this.config.mode === "timestamp") return Math.floor(unix / 1e3);
		return unix;
	};
};
var SQLiteBooleanBuilder = class extends SQLiteBaseIntegerBuilder {
	static [entityKind] = "SQLiteBooleanBuilder";
	constructor(name, mode) {
		super(name, "boolean", "SQLiteBoolean");
		this.config.mode = mode;
	}
	build(table) {
		return new SQLiteBoolean(table, this.config);
	}
};
var SQLiteBoolean = class extends SQLiteBaseInteger {
	static [entityKind] = "SQLiteBoolean";
	mode = this.config.mode;
	mapFromDriverValue = (value) => {
		return Number(value) === 1;
	};
	mapToDriverValue = (value) => {
		return value ? 1 : 0;
	};
};
function integer(a, b) {
	const { name, config } = getColumnNameAndConfig(a, b);
	if (config?.mode === "timestamp" || config?.mode === "timestamp_ms") return new SQLiteTimestampBuilder(name, config.mode);
	if (config?.mode === "boolean") return new SQLiteBooleanBuilder(name, config.mode);
	return new SQLiteIntegerBuilder(name);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/columns/numeric.js
var SQLiteNumericBuilder = class extends SQLiteColumnBuilder {
	static [entityKind] = "SQLiteNumericBuilder";
	constructor(name) {
		super(name, "string numeric", "SQLiteNumeric");
	}
	/** @internal */
	build(table) {
		return new SQLiteNumeric(table, this.config);
	}
};
var SQLiteNumeric = class extends SQLiteColumn {
	static [entityKind] = "SQLiteNumeric";
	mapFromDriverValue = (value) => {
		if (typeof value === "string") return value;
		return String(value);
	};
	getSQLType() {
		return "numeric";
	}
};
var SQLiteNumericNumberBuilder = class extends SQLiteColumnBuilder {
	static [entityKind] = "SQLiteNumericNumberBuilder";
	constructor(name) {
		super(name, "number", "SQLiteNumericNumber");
	}
	/** @internal */
	build(table) {
		return new SQLiteNumericNumber(table, this.config);
	}
};
var SQLiteNumericNumber = class extends SQLiteColumn {
	static [entityKind] = "SQLiteNumericNumber";
	mapFromDriverValue = (value) => {
		if (typeof value === "number") return value;
		return Number(value);
	};
	mapToDriverValue = String;
	getSQLType() {
		return "numeric";
	}
};
var SQLiteNumericBigIntBuilder = class extends SQLiteColumnBuilder {
	static [entityKind] = "SQLiteNumericBigIntBuilder";
	constructor(name) {
		super(name, "bigint int64", "SQLiteNumericBigInt");
	}
	/** @internal */
	build(table) {
		return new SQLiteNumericBigInt(table, this.config);
	}
};
var SQLiteNumericBigInt = class extends SQLiteColumn {
	static [entityKind] = "SQLiteNumericBigInt";
	mapFromDriverValue = BigInt;
	mapToDriverValue = String;
	getSQLType() {
		return "numeric";
	}
};
function numeric(a, b) {
	const { name, config } = getColumnNameAndConfig(a, b);
	const mode = config?.mode;
	return mode === "number" ? new SQLiteNumericNumberBuilder(name) : mode === "bigint" ? new SQLiteNumericBigIntBuilder(name) : new SQLiteNumericBuilder(name);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/columns/real.js
var SQLiteRealBuilder = class extends SQLiteColumnBuilder {
	static [entityKind] = "SQLiteRealBuilder";
	constructor(name) {
		super(name, "number double", "SQLiteReal");
	}
	/** @internal */
	build(table) {
		return new SQLiteReal(table, this.config);
	}
};
var SQLiteReal = class extends SQLiteColumn {
	static [entityKind] = "SQLiteReal";
	getSQLType() {
		return "real";
	}
};
function real(name) {
	return new SQLiteRealBuilder(name ?? "");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/columns/text.js
var SQLiteTextBuilder = class extends SQLiteColumnBuilder {
	static [entityKind] = "SQLiteTextBuilder";
	constructor(name, config) {
		super(name, config.enum?.length ? "string enum" : "string", "SQLiteText");
		this.config.enumValues = config.enum;
		this.config.length = config.length;
	}
	/** @internal */
	build(table) {
		return new SQLiteText(table, this.config);
	}
};
var SQLiteText = class extends SQLiteColumn {
	static [entityKind] = "SQLiteText";
	enumValues = this.config.enumValues;
	constructor(table, config) {
		super(table, config);
	}
	getSQLType() {
		return `text${this.config.length ? `(${this.config.length})` : ""}`;
	}
};
var SQLiteTextJsonBuilder = class extends SQLiteColumnBuilder {
	static [entityKind] = "SQLiteTextJsonBuilder";
	constructor(name) {
		super(name, "object json", "SQLiteTextJson");
	}
	/** @internal */
	build(table) {
		return new SQLiteTextJson(table, this.config);
	}
};
var SQLiteTextJson = class extends SQLiteColumn {
	static [entityKind] = "SQLiteTextJson";
	getSQLType() {
		return "text";
	}
	mapFromDriverValue = (value) => {
		return JSON.parse(value);
	};
	mapToDriverValue = (value) => {
		return JSON.stringify(value);
	};
};
function text(a, b = {}) {
	const { name, config } = getColumnNameAndConfig(a, b);
	if (config.mode === "json") return new SQLiteTextJsonBuilder(name);
	return new SQLiteTextBuilder(name, config);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/columns/all.js
function getSQLiteColumnBuilders() {
	return {
		blob,
		customType,
		integer,
		numeric,
		real,
		text
	};
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/casing.js
function toSnakeCase(input) {
	return (input.replace(/['\u2019]/g, "").match(/[\da-z]+|[A-Z]+(?![a-z])|[A-Z][\da-z]+/g) ?? []).map((word) => word.toLowerCase()).join("_");
}
function toCamelCase(input) {
	return (input.replace(/['\u2019]/g, "").match(/[\da-z]+|[A-Z]+(?![a-z])|[A-Z][\da-z]+/g) ?? []).reduce((acc, word, i) => {
		return acc + (i === 0 ? word.toLowerCase() : `${word[0].toUpperCase()}${word.slice(1)}`);
	}, "");
}
function getCasingFn(casing) {
	if (casing === "snake_case") return toSnakeCase;
	if (casing === "camelCase") return toCamelCase;
	return (name) => name;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/table.js
/** @internal */
var InlineForeignKeys = Symbol.for("drizzle:SQLiteInlineForeignKeys");
var SQLiteTable = class extends Table {
	static [entityKind] = "SQLiteTable";
	/** @internal */
	static Symbol = Object.assign({}, Table.Symbol, { InlineForeignKeys });
	/** @internal */
	[Table.Symbol.Columns];
	/** @internal */
	[InlineForeignKeys] = [];
	/** @internal */
	[Table.Symbol.ExtraConfigBuilder] = void 0;
};
/** @internal */
function sqliteTableBase(name, columns, extraConfig, schema, casing, baseName = name) {
	const casingFn = getCasingFn(casing);
	const rawTable = new SQLiteTable(name, schema, baseName);
	const parsedColumns = typeof columns === "function" ? columns(getSQLiteColumnBuilders()) : columns;
	const builtColumns = Object.fromEntries(Object.entries(parsedColumns).map(([name, colBuilderBase]) => {
		const colBuilder = colBuilderBase;
		colBuilder.setName(name, casingFn);
		const column = colBuilder.build(rawTable).postBuild();
		rawTable[InlineForeignKeys].push(...colBuilder.buildForeignKeys(column, rawTable));
		return [name, column];
	}));
	const table = Object.assign(rawTable, builtColumns);
	table[Table.Symbol.Columns] = builtColumns;
	table[Table.Symbol.ExtraConfigColumns] = builtColumns;
	if (extraConfig) table[SQLiteTable.Symbol.ExtraConfigBuilder] = extraConfig;
	return table;
}
/** @internal */
function sqliteTableWithCasing(casing) {
	return (name, columns, extraConfig) => sqliteTableBase(name, columns, extraConfig, void 0, casing);
}
var sqliteTable = sqliteTableWithCasing(void 0);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/indexes.js
var IndexBuilderOn = class {
	static [entityKind] = "SQLiteIndexBuilderOn";
	constructor(name, unique) {
		this.name = name;
		this.unique = unique;
	}
	on(...columns) {
		return new IndexBuilder(this.name, columns, this.unique);
	}
};
var IndexBuilder = class {
	static [entityKind] = "SQLiteIndexBuilder";
	/** @internal */
	config;
	constructor(name, columns, unique) {
		this.config = {
			name,
			columns,
			unique,
			where: void 0
		};
	}
	/**
	* Condition for partial index.
	*/
	where(condition) {
		this.config.where = condition;
		return this;
	}
	/** @internal */
	build(table) {
		return new Index(this.config, table);
	}
};
var Index = class {
	static [entityKind] = "SQLiteIndex";
	config;
	isNameExplicit;
	constructor(config, table) {
		this.config = {
			...config,
			table
		};
		this.isNameExplicit = !!config.name;
	}
};
function index(name) {
	return new IndexBuilderOn(name, false);
}
function uniqueIndex(name) {
	return new IndexBuilderOn(name, true);
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/utils.js
function extractUsedTable(table) {
	if (is(table, SQLiteTable)) return [`${table[Table.Symbol.BaseName]}`];
	if (is(table, Subquery)) return table._.usedTables ?? [];
	if (is(table, SQL)) return table.usedTables ?? [];
	return [];
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/view-base.js
var SQLiteViewBase = class extends View {
	static [entityKind] = "SQLiteViewBase";
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/alias.js
var ColumnTableAliasProxyHandler = class {
	static [entityKind] = "ColumnTableAliasProxyHandler";
	constructor(table, ignoreColumnAlias) {
		this.table = table;
		this.ignoreColumnAlias = ignoreColumnAlias;
	}
	get(columnObj, prop) {
		if (prop === "table") return this.table;
		if (prop === "isAlias" && this.ignoreColumnAlias) return false;
		return columnObj[prop];
	}
};
var ViewSelectionAliasProxyHandler = class {
	static [entityKind] = "ViewSelectionAliasProxyHandler";
	constructor(view, selection, ignoreColumnAlias) {
		this.view = view;
		this.selection = selection;
		this.ignoreColumnAlias = ignoreColumnAlias;
	}
	get(selection, prop) {
		const value = selection[prop];
		if (is(value, Column)) return new Proxy(value, new ColumnTableAliasProxyHandler(this.view, this.ignoreColumnAlias));
		if (is(value, Subquery) || is(value, SQL) || is(value, SQL.Aliased) || isSQLWrapper(value) || typeof value !== "object" || value === null) return value;
		return new Proxy(value, this);
	}
};
var TableAliasProxyHandler = class {
	static [entityKind] = "TableAliasProxyHandler";
	constructor(alias, replaceOriginalName, ignoreColumnAlias) {
		this.alias = alias;
		this.replaceOriginalName = replaceOriginalName;
		this.ignoreColumnAlias = ignoreColumnAlias;
	}
	get(target, prop) {
		if (prop === Table.Symbol.IsAlias) return true;
		if (prop === Table.Symbol.Name) return this.alias;
		if (this.replaceOriginalName && prop === Table.Symbol.OriginalName) return this.alias;
		if (prop === ViewBaseConfig) return {
			...target[ViewBaseConfig],
			name: this.alias,
			isAlias: true,
			selectedFields: new Proxy(target[ViewBaseConfig].selectedFields, new ViewSelectionAliasProxyHandler(new Proxy(target, this), target[ViewBaseConfig].selectedFields, this.ignoreColumnAlias))
		};
		if (prop === Table.Symbol.Columns) {
			const columns = target[Table.Symbol.Columns];
			if (!columns) return columns;
			if (is(target, View)) return new Proxy(target[Table.Symbol.Columns], new ViewSelectionAliasProxyHandler(new Proxy(target, this), target[Table.Symbol.Columns], this.ignoreColumnAlias));
			const proxiedColumns = {};
			Object.keys(columns).map((key) => {
				proxiedColumns[key] = new Proxy(columns[key], new ColumnTableAliasProxyHandler(new Proxy(target, this), this.ignoreColumnAlias));
			});
			return proxiedColumns;
		}
		const value = target[prop];
		if (is(value, Column)) return new Proxy(value, new ColumnTableAliasProxyHandler(new Proxy(target, this), this.ignoreColumnAlias));
		return value;
	}
};
var ColumnAliasProxyHandler = class {
	static [entityKind] = "ColumnAliasProxyHandler";
	constructor(alias) {
		this.alias = alias;
	}
	get(target, prop) {
		if (prop === "isAlias") return true;
		if (prop === "name") return this.alias;
		if (prop === "keyAsName") return false;
		if (prop === OriginalColumn) return () => target;
		return target[prop];
	}
};
function aliasedTable(table, tableAlias) {
	return new Proxy(table, new TableAliasProxyHandler(tableAlias, false, false));
}
function aliasedColumn(column, alias) {
	return new Proxy(column, new ColumnAliasProxyHandler(alias));
}
Column.prototype.as = function(alias) {
	return aliasedColumn(this, alias);
};
function getOriginalColumnFromAlias(column) {
	return column[OriginalColumn]();
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/selection-proxy.js
var SelectionProxyHandler = class SelectionProxyHandler {
	static [entityKind] = "SelectionProxyHandler";
	config;
	constructor(config) {
		this.config = { ...config };
	}
	get(subquery, prop) {
		if (prop === "_") return {
			...subquery["_"],
			selectedFields: new Proxy(subquery._.selectedFields, this)
		};
		if (prop === ViewBaseConfig) return {
			...subquery[ViewBaseConfig],
			selectedFields: new Proxy(subquery[ViewBaseConfig].selectedFields, this)
		};
		if (typeof prop === "symbol") return subquery[prop];
		const value = (is(subquery, Subquery) ? subquery._.selectedFields : is(subquery, View) ? subquery[ViewBaseConfig].selectedFields : subquery)[prop];
		if (is(value, SQL.Aliased)) {
			if (this.config.sqlAliasedBehavior === "sql" && !value.isSelectionField) return value.sql;
			const newValue = value.clone();
			newValue.isSelectionField = true;
			newValue.origin = this.config.alias;
			return newValue;
		}
		if (is(value, SQL)) {
			if (this.config.sqlBehavior === "sql") return value;
			throw new Error(`You tried to reference "${prop}" field from a subquery, which is a raw SQL field, but it doesn't have an alias declared. Please add an alias to the field using ".as('alias')" method.`);
		}
		if (is(value, Column)) {
			if (this.config.alias) return new Proxy(value, new ColumnTableAliasProxyHandler(new Proxy(value.table, new TableAliasProxyHandler(this.config.alias, this.config.replaceOriginalName ?? false, true)), true));
			return value;
		}
		if (typeof value !== "object" || value === null) return value;
		return new Proxy(value, new SelectionProxyHandler(this.config));
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/query-builders/query-builder.js
var TypedQueryBuilder = class {
	static [entityKind] = "TypedQueryBuilder";
	/** @internal */
	getSelectedFields() {
		return this._.selectedFields;
	}
	/** @internal */
	withoutSelectionCastCodecs() {
		return this;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/query-builders/select.js
var SQLiteSelectBuilder = class {
	static [entityKind] = "SQLiteSelectBuilder";
	fields;
	session;
	dialect;
	withList;
	distinct;
	constructor(config, builder = SQLiteSelectBase) {
		this.builder = builder;
		this.fields = config.fields;
		this.session = config.session;
		this.dialect = config.dialect;
		this.withList = config.withList;
		this.distinct = config.distinct;
	}
	from(source) {
		const isPartialSelect = !!this.fields;
		let fields;
		if (this.fields) fields = this.fields;
		else if (is(source, Subquery)) fields = Object.fromEntries(Object.keys(source._.selectedFields).map((key) => [key, source[key]]));
		else if (is(source, SQLiteViewBase)) fields = source[ViewBaseConfig].selectedFields;
		else if (is(source, SQL)) fields = {};
		else fields = getTableColumns(source);
		return new this.builder({
			table: source,
			fields,
			isPartialSelect,
			session: this.session,
			dialect: this.dialect,
			withList: this.withList ?? [],
			distinct: this.distinct
		});
	}
};
var SQLiteSelectBase = class extends TypedQueryBuilder {
	static [entityKind] = "SQLiteSelectQueryBuilder";
	_;
	/** @internal */
	config;
	joinsNotNullableMap;
	tableName;
	isPartialSelect;
	session;
	dialect;
	cacheConfig = void 0;
	usedTables = /* @__PURE__ */ new Set();
	constructor({ table, fields, isPartialSelect, session, dialect, withList, distinct }) {
		super();
		this.config = {
			withList,
			table,
			fields: { ...fields },
			distinct,
			setOperators: []
		};
		this.isPartialSelect = isPartialSelect;
		this.session = session;
		this.dialect = dialect;
		this._ = {
			selectedFields: fields,
			config: this.config
		};
		this.tableName = getTableLikeName(table);
		this.joinsNotNullableMap = typeof this.tableName === "string" ? { [this.tableName]: true } : {};
		for (const item of extractUsedTable(table)) this.usedTables.add(item);
	}
	/** @internal */
	getUsedTables() {
		return [...this.usedTables];
	}
	createJoin(joinType) {
		return (table, on) => {
			const baseTableName = this.tableName;
			const tableName = getTableLikeName(table);
			for (const item of extractUsedTable(table)) this.usedTables.add(item);
			if (typeof tableName === "string" && this.config.joins?.some((join) => join.alias === tableName)) throw new Error(`Alias "${tableName}" is already used in this query`);
			if (!this.isPartialSelect) {
				if (Object.keys(this.joinsNotNullableMap).length === 1 && typeof baseTableName === "string") this.config.fields = { [baseTableName]: this.config.fields };
				if (typeof tableName === "string" && !is(table, SQL)) {
					const selection = is(table, Subquery) ? table._.selectedFields : is(table, View) ? table[ViewBaseConfig].selectedFields : table[Table.Symbol.Columns];
					this.config.fields[tableName] = selection;
				}
			}
			if (typeof on === "function") on = on(new Proxy(this.config.fields, new SelectionProxyHandler({
				sqlAliasedBehavior: "sql",
				sqlBehavior: "sql"
			})));
			if (!this.config.joins) this.config.joins = [];
			this.config.joins.push({
				on,
				table,
				joinType,
				alias: tableName
			});
			if (typeof tableName === "string") switch (joinType) {
				case "left":
					this.joinsNotNullableMap[tableName] = false;
					break;
				case "right":
					this.joinsNotNullableMap = Object.fromEntries(Object.entries(this.joinsNotNullableMap).map(([key]) => [key, false]));
					this.joinsNotNullableMap[tableName] = true;
					break;
				case "cross":
				case "inner":
					this.joinsNotNullableMap[tableName] = true;
					break;
				case "full":
					this.joinsNotNullableMap = Object.fromEntries(Object.entries(this.joinsNotNullableMap).map(([key]) => [key, false]));
					this.joinsNotNullableMap[tableName] = false;
					break;
			}
			return this;
		};
	}
	/**
	* Executes a `left join` operation by adding another table to the current query.
	*
	* Calling this method associates each row of the table with the corresponding row from the joined table, if a match is found. If no matching row exists, it sets all columns of the joined table to null.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#left-join}
	*
	* @param table the table to join.
	* @param on the `on` clause.
	*
	* @example
	*
	* ```ts
	* // Select all users and their pets
	* const usersWithPets: { user: User; pets: Pet | null; }[] = await db.select()
	*   .from(users)
	*   .leftJoin(pets, eq(users.id, pets.ownerId))
	*
	* // Select userId and petId
	* const usersIdsAndPetIds: { userId: number; petId: number | null; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .leftJoin(pets, eq(users.id, pets.ownerId))
	* ```
	*/
	leftJoin = this.createJoin("left");
	/**
	* Executes a `right join` operation by adding another table to the current query.
	*
	* Calling this method associates each row of the joined table with the corresponding row from the main table, if a match is found. If no matching row exists, it sets all columns of the main table to null.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#right-join}
	*
	* @param table the table to join.
	* @param on the `on` clause.
	*
	* @example
	*
	* ```ts
	* // Select all users and their pets
	* const usersWithPets: { user: User | null; pets: Pet; }[] = await db.select()
	*   .from(users)
	*   .rightJoin(pets, eq(users.id, pets.ownerId))
	*
	* // Select userId and petId
	* const usersIdsAndPetIds: { userId: number | null; petId: number; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .rightJoin(pets, eq(users.id, pets.ownerId))
	* ```
	*/
	rightJoin = this.createJoin("right");
	/**
	* Executes an `inner join` operation, creating a new table by combining rows from two tables that have matching values.
	*
	* Calling this method retrieves rows that have corresponding entries in both joined tables. Rows without matching entries in either table are excluded, resulting in a table that includes only matching pairs.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#inner-join}
	*
	* @param table the table to join.
	* @param on the `on` clause.
	*
	* @example
	*
	* ```ts
	* // Select all users and their pets
	* const usersWithPets: { user: User; pets: Pet; }[] = await db.select()
	*   .from(users)
	*   .innerJoin(pets, eq(users.id, pets.ownerId))
	*
	* // Select userId and petId
	* const usersIdsAndPetIds: { userId: number; petId: number; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .innerJoin(pets, eq(users.id, pets.ownerId))
	* ```
	*/
	innerJoin = this.createJoin("inner");
	/**
	* Executes a `full join` operation by combining rows from two tables into a new table.
	*
	* Calling this method retrieves all rows from both main and joined tables, merging rows with matching values and filling in `null` for non-matching columns.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#full-join}
	*
	* @param table the table to join.
	* @param on the `on` clause.
	*
	* @example
	*
	* ```ts
	* // Select all users and their pets
	* const usersWithPets: { user: User | null; pets: Pet | null; }[] = await db.select()
	*   .from(users)
	*   .fullJoin(pets, eq(users.id, pets.ownerId))
	*
	* // Select userId and petId
	* const usersIdsAndPetIds: { userId: number | null; petId: number | null; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .fullJoin(pets, eq(users.id, pets.ownerId))
	* ```
	*/
	fullJoin = this.createJoin("full");
	/**
	* Executes a `cross join` operation by combining rows from two tables into a new table.
	*
	* Calling this method retrieves all rows from both main and joined tables, merging all rows from each table.
	*
	* See docs: {@link https://orm.drizzle.team/docs/joins#cross-join}
	*
	* @param table the table to join.
	*
	* @example
	*
	* ```ts
	* // Select all users, each user with every pet
	* const usersWithPets: { user: User; pets: Pet; }[] = await db.select()
	*   .from(users)
	*   .crossJoin(pets)
	*
	* // Select userId and petId
	* const usersIdsAndPetIds: { userId: number; petId: number; }[] = await db.select({
	*   userId: users.id,
	*   petId: pets.id,
	* })
	*   .from(users)
	*   .crossJoin(pets)
	* ```
	*/
	crossJoin = this.createJoin("cross");
	createSetOperator(type, isAll) {
		return (rightSelection) => {
			const rightSelect = typeof rightSelection === "function" ? rightSelection(getSQLiteSetOperators()) : rightSelection;
			if (!haveSameKeys(this.getSelectedFields(), rightSelect.getSelectedFields())) throw new Error("Set operator error (union / intersect / except): selected fields are not the same or are in a different order");
			this.config.setOperators.push({
				type,
				isAll,
				rightSelect
			});
			return this;
		};
	}
	/**
	* Adds `union` set operator to the query.
	*
	* Calling this method will combine the result sets of the `select` statements and remove any duplicate rows that appear across them.
	*
	* See docs: {@link https://orm.drizzle.team/docs/set-operations#union}
	*
	* @example
	*
	* ```ts
	* // Select all unique names from customers and users tables
	* await db.select({ name: users.name })
	*   .from(users)
	*   .union(
	*     db.select({ name: customers.name }).from(customers)
	*   );
	* // or
	* import { union } from 'drizzle-orm/sqlite-core'
	*
	* await union(
	*   db.select({ name: users.name }).from(users),
	*   db.select({ name: customers.name }).from(customers)
	* );
	* ```
	*/
	union = this.createSetOperator("union", false);
	/**
	* Adds `union all` set operator to the query.
	*
	* Calling this method will combine the result-set of the `select` statements and keep all duplicate rows that appear across them.
	*
	* See docs: {@link https://orm.drizzle.team/docs/set-operations#union-all}
	*
	* @example
	*
	* ```ts
	* // Select all transaction ids from both online and in-store sales
	* await db.select({ transaction: onlineSales.transactionId })
	*   .from(onlineSales)
	*   .unionAll(
	*     db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
	*   );
	* // or
	* import { unionAll } from 'drizzle-orm/sqlite-core'
	*
	* await unionAll(
	*   db.select({ transaction: onlineSales.transactionId }).from(onlineSales),
	*   db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
	* );
	* ```
	*/
	unionAll = this.createSetOperator("union", true);
	/**
	* Adds `intersect` set operator to the query.
	*
	* Calling this method will retain only the rows that are present in both result sets and eliminate duplicates.
	*
	* See docs: {@link https://orm.drizzle.team/docs/set-operations#intersect}
	*
	* @example
	*
	* ```ts
	* // Select course names that are offered in both departments A and B
	* await db.select({ courseName: depA.courseName })
	*   .from(depA)
	*   .intersect(
	*     db.select({ courseName: depB.courseName }).from(depB)
	*   );
	* // or
	* import { intersect } from 'drizzle-orm/sqlite-core'
	*
	* await intersect(
	*   db.select({ courseName: depA.courseName }).from(depA),
	*   db.select({ courseName: depB.courseName }).from(depB)
	* );
	* ```
	*/
	intersect = this.createSetOperator("intersect", false);
	/**
	* Adds `except` set operator to the query.
	*
	* Calling this method will retrieve all unique rows from the left query, except for the rows that are present in the result set of the right query.
	*
	* See docs: {@link https://orm.drizzle.team/docs/set-operations#except}
	*
	* @example
	*
	* ```ts
	* // Select all courses offered in department A but not in department B
	* await db.select({ courseName: depA.courseName })
	*   .from(depA)
	*   .except(
	*     db.select({ courseName: depB.courseName }).from(depB)
	*   );
	* // or
	* import { except } from 'drizzle-orm/sqlite-core'
	*
	* await except(
	*   db.select({ courseName: depA.courseName }).from(depA),
	*   db.select({ courseName: depB.courseName }).from(depB)
	* );
	* ```
	*/
	except = this.createSetOperator("except", false);
	/** @internal */
	addSetOperators(setOperators) {
		this.config.setOperators.push(...setOperators);
		return this;
	}
	/**
	* Adds a `where` clause to the query.
	*
	* Calling this method will select only those rows that fulfill a specified condition.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#filtering}
	*
	* @param where the `where` clause.
	*
	* @example
	* You can use conditional operators and `sql function` to filter the rows to be selected.
	*
	* ```ts
	* // Select all cars with green color
	* await db.select().from(cars).where(eq(cars.color, 'green'));
	* // or
	* await db.select().from(cars).where(sql`${cars.color} = 'green'`)
	* ```
	*
	* You can logically combine conditional operators with `and()` and `or()` operators:
	*
	* ```ts
	* // Select all BMW cars with a green color
	* await db.select().from(cars).where(and(eq(cars.color, 'green'), eq(cars.brand, 'BMW')));
	*
	* // Select all cars with the green or blue color
	* await db.select().from(cars).where(or(eq(cars.color, 'green'), eq(cars.color, 'blue')));
	* ```
	*/
	where(where) {
		if (typeof where === "function") where = where(new Proxy(this.config.fields, new SelectionProxyHandler({
			sqlAliasedBehavior: "sql",
			sqlBehavior: "sql"
		})));
		this.config.where = where;
		return this;
	}
	/**
	* Adds a `having` clause to the query.
	*
	* Calling this method will select only those rows that fulfill a specified condition. It is typically used with aggregate functions to filter the aggregated data based on a specified condition.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#aggregations}
	*
	* @param having the `having` clause.
	*
	* @example
	*
	* ```ts
	* // Select all brands with more than one car
	* await db.select({
	* 	brand: cars.brand,
	* 	count: sql<number>`cast(count(${cars.id}) as int)`,
	* })
	*   .from(cars)
	*   .groupBy(cars.brand)
	*   .having(({ count }) => gt(count, 1));
	* ```
	*/
	having(having) {
		if (typeof having === "function") having = having(new Proxy(this.config.fields, new SelectionProxyHandler({
			sqlAliasedBehavior: "sql",
			sqlBehavior: "sql"
		})));
		this.config.having = having;
		return this;
	}
	groupBy(...columns) {
		if (typeof columns[0] === "function") {
			const groupBy = columns[0](new Proxy(this.config.fields, new SelectionProxyHandler({
				sqlAliasedBehavior: "alias",
				sqlBehavior: "sql"
			})));
			this.config.groupBy = Array.isArray(groupBy) ? groupBy : [groupBy];
		} else this.config.groupBy = columns;
		return this;
	}
	orderBy(...columns) {
		if (typeof columns[0] === "function") {
			const orderBy = columns[0](new Proxy(this.config.fields, new SelectionProxyHandler({
				sqlAliasedBehavior: "alias",
				sqlBehavior: "sql"
			})));
			const orderByArray = Array.isArray(orderBy) ? orderBy : [orderBy];
			if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).orderBy = orderByArray;
			else this.config.orderBy = orderByArray;
		} else {
			const orderByArray = columns;
			if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).orderBy = orderByArray;
			else this.config.orderBy = orderByArray;
		}
		return this;
	}
	/**
	* Adds a `limit` clause to the query.
	*
	* Calling this method will set the maximum number of rows that will be returned by this query.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#limit--offset}
	*
	* @param limit the `limit` clause.
	*
	* @example
	*
	* ```ts
	* // Get the first 10 people from this query.
	* await db.select().from(people).limit(10);
	* ```
	*/
	limit(limit) {
		if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).limit = limit;
		else this.config.limit = limit;
		return this;
	}
	/**
	* Adds an `offset` clause to the query.
	*
	* Calling this method will skip a number of rows when returning results from this query.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#limit--offset}
	*
	* @param offset the `offset` clause.
	*
	* @example
	*
	* ```ts
	* // Get the 10th-20th people from this query.
	* await db.select().from(people).offset(10).limit(10);
	* ```
	*/
	offset(offset) {
		if (this.config.setOperators.length > 0) this.config.setOperators.at(-1).offset = offset;
		else this.config.offset = offset;
		return this;
	}
	$withCache(config) {
		this.cacheConfig = config === void 0 ? {
			config: {},
			enabled: true,
			autoInvalidate: true
		} : config === false ? { enabled: false } : {
			enabled: true,
			autoInvalidate: true,
			...config
		};
		return this;
	}
	getSQL() {
		this.config.fieldsFlat = orderSelectedFields(this.config.fields);
		return this.dialect.buildSelectQuery(this.config);
	}
	toSQL() {
		return this.dialect.sqlToQuery(this.getSQL());
	}
	as(alias) {
		const usedTables = [];
		usedTables.push(...extractUsedTable(this.config.table));
		if (this.config.joins) for (const it of this.config.joins) usedTables.push(...extractUsedTable(it.table));
		return new Proxy(new Subquery(this.getSQL(), this.config.fields, alias, false, [...new Set(usedTables)]), new SelectionProxyHandler({
			alias,
			sqlAliasedBehavior: "alias",
			sqlBehavior: "error"
		}));
	}
	/** @internal */
	getSelectedFields() {
		return new Proxy(this.config.fields, new SelectionProxyHandler({
			alias: this.tableName,
			sqlAliasedBehavior: "alias",
			sqlBehavior: "error"
		}));
	}
	/** @internal */
	withoutSelectionCastCodecs() {
		return this;
	}
	$dynamic() {
		return this;
	}
};
function createSetOperator(type, isAll) {
	return (leftSelect, rightSelect, ...restSelects) => {
		const setOperators = [rightSelect, ...restSelects].map((select) => ({
			type,
			isAll,
			rightSelect: select
		}));
		for (const setOperator of setOperators) if (!haveSameKeys(leftSelect.getSelectedFields(), setOperator.rightSelect.getSelectedFields())) throw new Error("Set operator error (union / intersect / except): selected fields are not the same or are in a different order");
		return leftSelect.addSetOperators(setOperators);
	};
}
var getSQLiteSetOperators = () => ({
	union,
	unionAll,
	intersect,
	except
});
/**
* Adds `union` set operator to the query.
*
* Calling this method will combine the result sets of the `select` statements and remove any duplicate rows that appear across them.
*
* See docs: {@link https://orm.drizzle.team/docs/set-operations#union}
*
* @example
*
* ```ts
* // Select all unique names from customers and users tables
* import { union } from 'drizzle-orm/sqlite-core'
*
* await union(
*   db.select({ name: users.name }).from(users),
*   db.select({ name: customers.name }).from(customers)
* );
* // or
* await db.select({ name: users.name })
*   .from(users)
*   .union(
*     db.select({ name: customers.name }).from(customers)
*   );
* ```
*/
var union = createSetOperator("union", false);
/**
* Adds `union all` set operator to the query.
*
* Calling this method will combine the result-set of the `select` statements and keep all duplicate rows that appear across them.
*
* See docs: {@link https://orm.drizzle.team/docs/set-operations#union-all}
*
* @example
*
* ```ts
* // Select all transaction ids from both online and in-store sales
* import { unionAll } from 'drizzle-orm/sqlite-core'
*
* await unionAll(
*   db.select({ transaction: onlineSales.transactionId }).from(onlineSales),
*   db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
* );
* // or
* await db.select({ transaction: onlineSales.transactionId })
*   .from(onlineSales)
*   .unionAll(
*     db.select({ transaction: inStoreSales.transactionId }).from(inStoreSales)
*   );
* ```
*/
var unionAll = createSetOperator("union", true);
/**
* Adds `intersect` set operator to the query.
*
* Calling this method will retain only the rows that are present in both result sets and eliminate duplicates.
*
* See docs: {@link https://orm.drizzle.team/docs/set-operations#intersect}
*
* @example
*
* ```ts
* // Select course names that are offered in both departments A and B
* import { intersect } from 'drizzle-orm/sqlite-core'
*
* await intersect(
*   db.select({ courseName: depA.courseName }).from(depA),
*   db.select({ courseName: depB.courseName }).from(depB)
* );
* // or
* await db.select({ courseName: depA.courseName })
*   .from(depA)
*   .intersect(
*     db.select({ courseName: depB.courseName }).from(depB)
*   );
* ```
*/
var intersect = createSetOperator("intersect", false);
/**
* Adds `except` set operator to the query.
*
* Calling this method will retrieve all unique rows from the left query, except for the rows that are present in the result set of the right query.
*
* See docs: {@link https://orm.drizzle.team/docs/set-operations#except}
*
* @example
*
* ```ts
* // Select all courses offered in department A but not in department B
* import { except } from 'drizzle-orm/sqlite-core'
*
* await except(
*   db.select({ courseName: depA.courseName }).from(depA),
*   db.select({ courseName: depB.courseName }).from(depB)
* );
* // or
* await db.select({ courseName: depA.courseName })
*   .from(depA)
*   .except(
*     db.select({ courseName: depB.courseName }).from(depB)
*   );
* ```
*/
var except = createSetOperator("except", false);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/errors.js
var DrizzleError = class extends Error {
	static [entityKind] = "DrizzleError";
	constructor({ message, cause }) {
		super(message);
		this.name = "DrizzleError";
		this.cause = cause;
	}
};
var DrizzleQueryError = class DrizzleQueryError extends Error {
	static [entityKind] = "DrizzleQueryError";
	constructor(query, params, cause) {
		super(`Failed query: ${query}\nparams: ${params}`);
		this.query = query;
		this.params = params;
		this.cause = cause;
		this.name = "DrizzleQueryError";
		Error.captureStackTrace(this, DrizzleQueryError);
		if (cause) this.cause = cause;
	}
};
var TransactionRollbackError = class extends DrizzleError {
	static [entityKind] = "TransactionRollbackError";
	constructor() {
		super({ message: "Rollback" });
		this.name = "TransactionRollbackError";
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sql/expressions/conditions.js
function bindIfParam(value, column) {
	if (isDriverValueEncoder(column) && !isSQLWrapper(value) && !is(value, Param) && !is(value, Placeholder) && !is(value, Column) && !is(value, Table) && !is(value, View)) return new Param(value, column);
	return value;
}
/**
* Test that two values are equal.
*
* Remember that the SQL standard dictates that
* two NULL values are not equal, so if you want to test
* whether a value is null, you may want to use
* `isNull` instead.
*
* ## Examples
*
* ```ts
* // Select cars made by Ford
* db.select().from(cars)
*   .where(eq(cars.make, 'Ford'))
* ```
*
* @see isNull for a way to test equality to NULL.
*/
var eq = (left, right) => {
	return sql`${left} = ${bindIfParam(right, left)}`;
};
/**
* Test that two values are not equal.
*
* Remember that the SQL standard dictates that
* two NULL values are not equal, so if you want to test
* whether a value is not null, you may want to use
* `isNotNull` instead.
*
* ## Examples
*
* ```ts
* // Select cars not made by Ford
* db.select().from(cars)
*   .where(ne(cars.make, 'Ford'))
* ```
*
* @see isNotNull for a way to test whether a value is not null.
*/
var ne = (left, right) => {
	return sql`${left} <> ${bindIfParam(right, left)}`;
};
function and(...unfilteredConditions) {
	const conditions = unfilteredConditions.filter((c) => c !== void 0);
	if (conditions.length === 0) return;
	if (conditions.length === 1) return new SQL(conditions);
	return new SQL([
		new StringChunk("("),
		sql.join(conditions.map((c) => sql`(${c})`), new StringChunk(" and ")),
		new StringChunk(")")
	]);
}
function or(...unfilteredConditions) {
	const conditions = unfilteredConditions.filter((c) => c !== void 0);
	if (conditions.length === 0) return;
	if (conditions.length === 1) return new SQL(conditions);
	return new SQL([
		new StringChunk("("),
		sql.join(conditions.map((c) => sql`(${c})`), new StringChunk(" or ")),
		new StringChunk(")")
	]);
}
/**
* Negate the meaning of an expression using the `not` keyword.
*
* ## Examples
*
* ```ts
* // Select cars _not_ made by GM or Ford.
* db.select().from(cars)
*   .where(not(inArray(cars.make, ['GM', 'Ford'])))
* ```
*/
function not(condition) {
	return is(condition, SQL) ? sql`not (${condition})` : sql`not ${condition}`;
}
/**
* Test that the first expression passed is greater than
* the second expression.
*
* ## Examples
*
* ```ts
* // Select cars made after 2000.
* db.select().from(cars)
*   .where(gt(cars.year, 2000))
* ```
*
* @see gte for greater-than-or-equal
*/
var gt = (left, right) => {
	return sql`${left} > ${bindIfParam(right, left)}`;
};
/**
* Test that the first expression passed is greater than
* or equal to the second expression. Use `gt` to
* test whether an expression is strictly greater
* than another.
*
* ## Examples
*
* ```ts
* // Select cars made on or after 2000.
* db.select().from(cars)
*   .where(gte(cars.year, 2000))
* ```
*
* @see gt for a strictly greater-than condition
*/
var gte = (left, right) => {
	return sql`${left} >= ${bindIfParam(right, left)}`;
};
/**
* Test that the first expression passed is less than
* the second expression.
*
* ## Examples
*
* ```ts
* // Select cars made before 2000.
* db.select().from(cars)
*   .where(lt(cars.year, 2000))
* ```
*
* @see lte for less-than-or-equal
*/
var lt = (left, right) => {
	return sql`${left} < ${bindIfParam(right, left)}`;
};
/**
* Test that the first expression passed is less than
* or equal to the second expression.
*
* ## Examples
*
* ```ts
* // Select cars made before 2000.
* db.select().from(cars)
*   .where(lte(cars.year, 2000))
* ```
*
* @see lt for a strictly less-than condition
*/
var lte = (left, right) => {
	return sql`${left} <= ${bindIfParam(right, left)}`;
};
function inArray(column, values) {
	if (Array.isArray(values)) {
		if (values.length === 0) return sql`false`;
		return sql`${column} in ${values.map((v) => bindIfParam(v, column))}`;
	}
	return sql`${column} in ${bindIfParam(values, column)}`;
}
function notInArray(column, values) {
	if (Array.isArray(values)) {
		if (values.length === 0) return sql`true`;
		return sql`${column} not in ${values.map((v) => bindIfParam(v, column))}`;
	}
	return sql`${column} not in ${bindIfParam(values, column)}`;
}
/**
* Test whether an expression is NULL. By the SQL standard,
* NULL is neither equal nor not equal to itself, so
* it's recommended to use `isNull` and `notIsNull` for
* comparisons to NULL.
*
* ## Examples
*
* ```ts
* // Select cars that have no discontinuedAt date.
* db.select().from(cars)
*   .where(isNull(cars.discontinuedAt))
* ```
*
* @see isNotNull for the inverse of this test
*/
function isNull(value) {
	return sql`(${value} is null)`;
}
/**
* Test whether an expression is not NULL. By the SQL standard,
* NULL is neither equal nor not equal to itself, so
* it's recommended to use `isNull` and `notIsNull` for
* comparisons to NULL.
*
* ## Examples
*
* ```ts
* // Select cars that have been discontinued.
* db.select().from(cars)
*   .where(isNotNull(cars.discontinuedAt))
* ```
*
* @see isNull for the inverse of this test
*/
function isNotNull(value) {
	return sql`(${value} is not null)`;
}
/**
* Test whether a subquery evaluates to have any rows.
*
* ## Examples
*
* ```ts
* // Users whose `homeCity` column has a match in a cities
* // table.
* db
*   .select()
*   .from(users)
*   .where(
*     exists(db.select()
*       .from(cities)
*       .where(eq(users.homeCity, cities.id))),
*   );
* ```
*
* @see notExists for the inverse of this test
*/
function exists(subquery) {
	return sql`exists ${subquery}`;
}
/**
* Test whether a subquery doesn't include any result
* rows.
*
* ## Examples
*
* ```ts
* // Users whose `homeCity` column doesn't match
* // a row in the cities table.
* db
*   .select()
*   .from(users)
*   .where(
*     notExists(db.select()
*       .from(cities)
*       .where(eq(users.homeCity, cities.id))),
*   );
* ```
*
* @see exists for the inverse of this test
*/
function notExists(subquery) {
	return sql`not exists ${subquery}`;
}
function between(column, min, max) {
	return sql`${column} between ${bindIfParam(min, column)} and ${bindIfParam(max, column)}`;
}
function notBetween(column, min, max) {
	return sql`${column} not between ${bindIfParam(min, column)} and ${bindIfParam(max, column)}`;
}
/**
* Compare a column to a pattern, which can include `%` and `_`
* characters to match multiple variations. Including `%`
* in the pattern matches zero or more characters, and including
* `_` will match a single character.
*
* ## Examples
*
* ```ts
* // Select all cars with 'Turbo' in their names.
* db.select().from(cars)
*   .where(like(cars.name, '%Turbo%'))
* ```
*
* @see ilike for a case-insensitive version of this condition
*/
function like(column, value) {
	return sql`${column} like ${value}`;
}
/**
* The inverse of like - this tests that a given column
* does not match a pattern, which can include `%` and `_`
* characters to match multiple variations. Including `%`
* in the pattern matches zero or more characters, and including
* `_` will match a single character.
*
* ## Examples
*
* ```ts
* // Select all cars that don't have "ROver" in their name.
* db.select().from(cars)
*   .where(notLike(cars.name, '%Rover%'))
* ```
*
* @see like for the inverse condition
* @see notIlike for a case-insensitive version of this condition
*/
function notLike(column, value) {
	return sql`${column} not like ${value}`;
}
/**
* Case-insensitively compare a column to a pattern,
* which can include `%` and `_`
* characters to match multiple variations. Including `%`
* in the pattern matches zero or more characters, and including
* `_` will match a single character.
*
* Unlike like, this performs a case-insensitive comparison.
*
* ## Examples
*
* ```ts
* // Select all cars with 'Turbo' in their names.
* db.select().from(cars)
*   .where(ilike(cars.name, '%Turbo%'))
* ```
*
* @see like for a case-sensitive version of this condition
*/
function ilike(column, value) {
	return sql`${column} ilike ${value}`;
}
/**
* The inverse of ilike - this case-insensitively tests that a given column
* does not match a pattern, which can include `%` and `_`
* characters to match multiple variations. Including `%`
* in the pattern matches zero or more characters, and including
* `_` will match a single character.
*
* ## Examples
*
* ```ts
* // Select all cars that don't have "Rover" in their name.
* db.select().from(cars)
*   .where(notLike(cars.name, '%Rover%'))
* ```
*
* @see ilike for the inverse condition
* @see notLike for a case-sensitive version of this condition
*/
function notIlike(column, value) {
	return sql`${column} not ilike ${value}`;
}
function arrayContains(column, values) {
	if (Array.isArray(values)) {
		if (values.length === 0) throw new Error("arrayContains requires at least one value");
		const par = bindIfParam(values, column);
		return sql`${column} @> ${sql`${Array.isArray(par) ? new Param(par) : par}`}`;
	}
	return sql`${column} @> ${bindIfParam(values, column)}`;
}
function arrayContained(column, values) {
	if (Array.isArray(values)) {
		if (values.length === 0) throw new Error("arrayContained requires at least one value");
		const par = bindIfParam(values, column);
		return sql`${column} <@ ${sql`${Array.isArray(par) ? new Param(par) : par}`}`;
	}
	return sql`${column} <@ ${bindIfParam(values, column)}`;
}
function arrayOverlaps(column, values) {
	if (Array.isArray(values)) {
		if (values.length === 0) throw new Error("arrayOverlaps requires at least one value");
		const par = bindIfParam(values, column);
		return sql`${column} && ${sql`${Array.isArray(par) ? new Param(par) : par}`}`;
	}
	return sql`${column} && ${bindIfParam(values, column)}`;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sql/expressions/select.js
/**
* Used in sorting, this specifies that the given
* column or expression should be sorted in ascending
* order. By the SQL standard, ascending order is the
* default, so it is not usually necessary to specify
* ascending sort order.
*
* ## Examples
*
* ```ts
* // Return cars, starting with the oldest models
* // and going in ascending order to the newest.
* db.select().from(cars)
*   .orderBy(asc(cars.year));
* ```
*
* @see desc to sort in descending order
*/
function asc(column) {
	return sql`${column} asc`;
}
/**
* Used in sorting, this specifies that the given
* column or expression should be sorted in descending
* order.
*
* ## Examples
*
* ```ts
* // Select users, with the most recently created
* // records coming first.
* db.select().from(users)
*   .orderBy(desc(users.createdAt));
* ```
*
* @see asc to sort in ascending order
*/
function desc(column) {
	return sql`${column} desc`;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/relations.js
function processRelations(tablesConfig, tables) {
	for (const tableConfig of Object.values(tablesConfig)) for (const [relationFieldName, relation] of Object.entries(tableConfig.relations)) {
		if (!is(relation, Relation)) continue;
		relation.sourceTable = tableConfig.table;
		relation.fieldName = relationFieldName;
	}
	for (const [sourceTableName, tableConfig] of Object.entries(tablesConfig)) for (const [relationFieldName, relation] of Object.entries(tableConfig.relations)) {
		if (!is(relation, Relation)) continue;
		let reverseRelation;
		const { targetTableName, alias, sourceColumns, targetColumns, throughTable, sourceTable, through, where, sourceColumnTableNames, targetColumnTableNames } = relation;
		const relationPrintName = `relations -> ${tableConfig.name}: { ${relationFieldName}: r.${is(relation, One) ? "one" : "many"}.${targetTableName}(...) }`;
		if (relationFieldName in tableConfig.table[TableColumns]) throw new Error(`${relationPrintName}: relation name collides with column "${relationFieldName}" of table "${tableConfig.name}"`);
		if (typeof alias === "string" && !alias) throw new Error(`${relationPrintName}: "alias" cannot be an empty string - omit it if you don't need it`);
		if (sourceColumns?.length === 0) throw new Error(`${relationPrintName}: "from" cannot be empty`);
		if (targetColumns?.length === 0) throw new Error(`${relationPrintName}: "to" cannot be empty`);
		if (sourceColumns && targetColumns) {
			if (sourceColumns.length !== targetColumns.length && !throughTable) throw new Error(`${relationPrintName}: "from" and "to" fields without "through" must have the same length`);
			for (const sName of sourceColumnTableNames) if (sName !== sourceTableName) throw new Error(`${relationPrintName}: all "from" columns must belong to table "${sourceTableName}", found column of table "${sName}"`);
			for (const tName of targetColumnTableNames) if (tName !== targetTableName) throw new Error(`${relationPrintName}: all "to" columns must belong to table "${targetTableName}", found column of table "${tName}"`);
			if (through) {
				if (through.source.length !== sourceColumns.length || through.target.length !== targetColumns.length) throw new Error(`${relationPrintName}: ".through(column)" must be used either on all columns in "from" and "to" or not defined on any of them`);
				for (const column of through.source) if (tables[column._.tableName] !== throughTable) throw new Error(`${relationPrintName}: ".through(column)" must be used on the same table by all columns of the relation`);
				for (const column of through.target) if (tables[column._.tableName] !== throughTable) throw new Error(`${relationPrintName}: ".through(column)" must be used on the same table by all columns of the relation`);
			}
			continue;
		}
		if (sourceColumns || targetColumns) throw new Error(`${relationPrintName}: relation must have either both "from" and "to" defined, or none of them`);
		const reverseTableConfig = tablesConfig[targetTableName];
		if (!reverseTableConfig) throw new Error(`${relationPrintName}: not enough data provided to build the relation - "from"/"to" are not defined, and no reverse relations of table "${targetTableName}" were found"`);
		if (alias) {
			const reverseRelations = Object.values(reverseTableConfig.relations).filter((it) => is(it, Relation) && it.alias === alias && it !== relation);
			if (reverseRelations.length > 1) throw new Error(`${relationPrintName}: not enough data provided to build the relation - "from"/"to" are not defined, and multiple relations with alias "${alias}" found in table "${targetTableName}": ${reverseRelations.map((it) => `"${it.fieldName}"`).join(", ")}`);
			reverseRelation = reverseRelations[0];
			if (!reverseRelation) throw new Error(`${relationPrintName}: not enough data provided to build the relation - "from"/"to" are not defined, and there is no reverse relation of table "${targetTableName}" with alias "${alias}"`);
		} else {
			const reverseRelations = Object.values(reverseTableConfig.relations).filter((it) => is(it, Relation) && it.targetTable === sourceTable && !it.alias && it !== relation);
			if (reverseRelations.length > 1) throw new Error(`${relationPrintName}: not enough data provided to build the relation - "from"/"to" are not defined, and multiple relations between "${targetTableName}" and "${sourceTableName}" were found.\nHint: you can specify "alias" on both sides of the relation with the same value`);
			reverseRelation = reverseRelations[0];
			if (!reverseRelation) throw new Error(`${relationPrintName}: not enough data provided to build the relation - "from"/"to" are not defined, and no reverse relation of table "${targetTableName}" with target table "${sourceTableName}" was found`);
		}
		if (!reverseRelation.sourceColumns || !reverseRelation.targetColumns) throw new Error(`${relationPrintName}: not enough data provided to build the relation - "from"/"to" are not defined, and reverse relation "${targetTableName}.${reverseRelation.fieldName}" does not have "from"/"to" defined`);
		relation.sourceColumns = reverseRelation.targetColumns;
		relation.targetColumns = reverseRelation.sourceColumns;
		relation.through = reverseRelation.through ? {
			source: reverseRelation.through.target,
			target: reverseRelation.through.source
		} : void 0;
		relation.throughTable = reverseRelation.throughTable;
		relation.isReversed = !where;
		relation.where = where ?? reverseRelation.where;
	}
	return tablesConfig;
}
/** Builds relational config for every table in schema */
function buildRelations(tables, config) {
	const tablesConfig = {};
	for (const [tsName, table] of Object.entries(tables)) tablesConfig[tsName] = {
		table,
		name: tsName,
		relations: config[tsName] ?? {}
	};
	return processRelations(tablesConfig, tables);
}
var Relation = class {
	static [entityKind] = "RelationV2";
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
	/** @internal */
	sourceColumnTableNames = [];
	/** @internal */
	targetColumnTableNames = [];
	constructor(targetTable, targetTableName) {
		this.targetTableName = targetTableName;
		this.targetTable = targetTable;
	}
};
var One = class extends Relation {
	static [entityKind] = "OneV2";
	relationType = "one";
	optional;
	constructor(tables, targetTable, targetTableName, config) {
		super(targetTable, targetTableName);
		this.alias = config?.alias;
		this.where = config?.where;
		if (config?.from) this.sourceColumns = (Array.isArray(config.from) ? config.from : [config.from]).map((it) => {
			this.throughTable ??= it._.through ? tables[it._.through._.tableName] : void 0;
			this.sourceColumnTableNames.push(it._.tableName);
			return it._.column;
		});
		if (config?.to) this.targetColumns = (Array.isArray(config.to) ? config.to : [config.to]).map((it) => {
			this.throughTable ??= it._.through ? tables[it._.through._.tableName] : void 0;
			this.targetColumnTableNames.push(it._.tableName);
			return it._.column;
		});
		if (this.throughTable) this.through = {
			source: (Array.isArray(config?.from) ? config.from : config?.from ? [config.from] : []).map((c) => c._.through),
			target: (Array.isArray(config?.to) ? config.to : config?.to ? [config.to] : []).map((c) => c._.through)
		};
		this.optional = config?.optional ?? true;
	}
};
var Many = class extends Relation {
	static [entityKind] = "ManyV2";
	relationType = "many";
	constructor(tables, targetTable, targetTableName, config) {
		super(targetTable, targetTableName);
		this.config = config;
		this.alias = config?.alias;
		this.where = config?.where;
		if (config?.from) this.sourceColumns = (Array.isArray(config.from) ? config.from : [config.from]).map((it) => {
			this.throughTable ??= it._.through ? tables[it._.through._.tableName] : void 0;
			this.sourceColumnTableNames.push(it._.tableName);
			return it._.column;
		});
		if (config?.to) this.targetColumns = (Array.isArray(config.to) ? config.to : [config.to]).map((it) => {
			this.throughTable ??= it._.through ? tables[it._.through._.tableName] : void 0;
			this.targetColumnTableNames.push(it._.tableName);
			return it._.column;
		});
		if (this.throughTable) this.through = {
			source: (Array.isArray(config?.from) ? config.from : config?.from ? [config.from] : []).map((c) => c._.through),
			target: (Array.isArray(config?.to) ? config.to : config?.to ? [config.to] : []).map((c) => c._.through)
		};
	}
};
var AggregatedField = class {
	static [entityKind] = "AggregatedField";
	table;
	onTable(table) {
		this.table = table;
		return this;
	}
};
var Count = class extends AggregatedField {
	static [entityKind] = "AggregatedFieldCount";
	query;
	getSQL() {
		if (!this.query) {
			if (!this.table) throw new Error("Table must be set before building aggregate field");
			this.query = sql`select count(*) as ${sql.identifier("r")} from ${getTableAsAliasSQL(this.table)}`.mapWith(Number);
		}
		return this.query;
	}
};
var operators = {
	and,
	between,
	eq,
	exists,
	gt,
	gte,
	ilike,
	inArray,
	arrayContains,
	arrayContained,
	arrayOverlaps,
	isNull,
	isNotNull,
	like,
	lt,
	lte,
	ne,
	not,
	notBetween,
	notExists,
	notLike,
	notIlike,
	notInArray,
	or,
	sql
};
var orderByOperators = {
	sql,
	asc,
	desc
};
function mapRelationalRow(rows, isOne, buildQueryResultSelection, parseJson = false, parseJsonIfString = false, useJsonMappers = true) {
	const maxIdx = isOne ? 1 : rows.length;
	const decoders = buildQueryResultSelection.map(({ field, codec, arrayDimensions }) => {
		let decoder;
		if (is(field, Column)) decoder = field;
		else if (is(field, SQL)) decoder = field.decoder;
		else if (is(field, SQL.Aliased)) decoder = field.sql.decoder;
		else if (is(field, Table) || is(field, View)) decoder = noopDecoder;
		else decoder = field.getSQL().decoder;
		if (useJsonMappers && field.mapFromJsonValue) return (v) => field.mapFromJsonValue(v);
		return decoder.mapFromDriverValue.isNoop ? codec ? (value) => codec(value, arrayDimensions) : void 0 : codec ? (value) => decoder.mapFromDriverValue(codec(value, arrayDimensions)) : (value) => decoder.mapFromDriverValue(value);
	});
	for (let i = 0; i < maxIdx; ++i) {
		const row = isOne ? rows : rows[i];
		for (let selectionItemIdx = 0; selectionItemIdx < buildQueryResultSelection.length; ++selectionItemIdx) {
			const selectionItem = buildQueryResultSelection[selectionItemIdx];
			if (selectionItem.selection) {
				if (row[selectionItem.key] === null) continue;
				if (parseJson) {
					row[selectionItem.key] = JSON.parse(row[selectionItem.key]);
					if (row[selectionItem.key] === null) continue;
				} else if (parseJsonIfString && typeof row[selectionItem.key] === "string") row[selectionItem.key] = JSON.parse(row[selectionItem.key]);
				if (selectionItem.isArray) {
					mapRelationalRow(row[selectionItem.key], false, selectionItem.selection, false, parseJsonIfString);
					continue;
				}
				mapRelationalRow(row[selectionItem.key], true, selectionItem.selection, false, parseJsonIfString);
				continue;
			}
			if (row[selectionItem.key] === null) continue;
			const decoder = decoders[selectionItemIdx];
			if (!decoder) continue;
			row[selectionItem.key] = decoder(row[selectionItem.key]);
		}
	}
	return rows;
}
function mapRelationalRowFromArrays(rows, isOne, buildQueryResultSelection, parseJson = false, parseJsonIfString = false) {
	const maxIdx = isOne ? 1 : rows.length;
	const decoders = buildQueryResultSelection.map(({ field, codec, arrayDimensions }) => {
		let decoder;
		if (is(field, Column)) decoder = field;
		else if (is(field, SQL)) decoder = field.decoder;
		else if (is(field, SQL.Aliased)) decoder = field.sql.decoder;
		else if (is(field, Table) || is(field, View)) decoder = noopDecoder;
		else decoder = field.getSQL().decoder;
		return decoder.mapFromDriverValue.isNoop ? codec ? (value) => codec(value, arrayDimensions) : void 0 : codec ? (value) => decoder.mapFromDriverValue(codec(value, arrayDimensions)) : (value) => decoder.mapFromDriverValue(value);
	});
	const results = Array.from({ length: maxIdx });
	for (let i = 0; i < maxIdx; ++i) {
		const row = isOne ? rows : rows[i];
		const result = {};
		for (let selectionItemIdx = 0; selectionItemIdx < buildQueryResultSelection.length; ++selectionItemIdx) {
			const selectionItem = buildQueryResultSelection[selectionItemIdx];
			let value = row[selectionItemIdx];
			if (selectionItem.selection) {
				if (value === null) {
					result[selectionItem.key] = null;
					continue;
				}
				if (parseJson) {
					value = JSON.parse(value);
					if (value === null) {
						result[selectionItem.key] = null;
						continue;
					}
				} else if (parseJsonIfString && typeof value === "string") value = JSON.parse(value);
				if (selectionItem.isArray) mapRelationalRow(value, false, selectionItem.selection, false, parseJsonIfString);
				else mapRelationalRow(value, true, selectionItem.selection, false, parseJsonIfString);
				result[selectionItem.key] = value;
				continue;
			}
			if (value === null) {
				result[selectionItem.key] = null;
				continue;
			}
			const decoder = decoders[selectionItemIdx];
			result[selectionItem.key] = decoder ? decoder(value) : value;
		}
		results[i] = result;
	}
	return isOne ? results[0] : results;
}
function makeDefaultRqbMapper({ selection, isFirst, parseJson, parseJsonIfString, rootJsonMappers, arrayModeRoot }) {
	return ((rows) => {
		if (isFirst && !rows[0]) return rows[0];
		return arrayModeRoot ? mapRelationalRowFromArrays(isFirst ? rows[0] : rows, isFirst, selection, parseJson, parseJsonIfString) : mapRelationalRow(isFirst ? rows[0] : rows, isFirst, selection, parseJson, parseJsonIfString, rootJsonMappers);
	});
}
function makeJitRqbMapperInner(selection, rowExpr, selectionVar, parseJson, parseJsonIfString, useJsonMappers, preFn, counter, accessByIdx) {
	const bodyStmts = [];
	const literalEntries = [];
	let hasWork = false;
	const fieldVars = selection.map(() => `c${counter.n++}`);
	const destructurePieces = selection.map((item, idx) => accessByIdx ? fieldVars[idx] : `${JSON.stringify(item.key)}: ${fieldVars[idx]}`);
	bodyStmts.push(accessByIdx ? `let [ ${destructurePieces.join(", ")} ] = ${rowExpr};` : `let { ${destructurePieces.join(", ")} } = ${rowExpr};`);
	for (const [idx, { field, key, codec, isArray, selection: innerSelection, arrayDimensions }] of selection.entries()) {
		const sel = `${selectionVar}[${idx}]`;
		const keyStr = JSON.stringify(key);
		const slot = fieldVars[idx];
		if (innerSelection) {
			if (parseJson) {
				bodyStmts.push(`if (${slot} !== null) ${slot} = JSON.parse(${slot});`);
				hasWork = true;
			} else if (parseJsonIfString) {
				bodyStmts.push(`if (typeof ${slot} === 'string') ${slot} = JSON.parse(${slot});`);
				hasWork = true;
			}
			const nestedSelVar = `s${counter.n++}`;
			const savedPreFnLen = preFn.length;
			preFn.push(`const { selection: ${nestedSelVar} } = ${sel};`);
			if (isArray) {
				const j = `j${counter.n++}`;
				const inner = makeJitRqbMapperInner(innerSelection, `${slot}[${j}]`, nestedSelVar, false, parseJsonIfString, true, preFn, counter, false);
				if (inner.hasWork) {
					hasWork = true;
					bodyStmts.push(`if (${slot} !== null) {`);
					bodyStmts.push(`\tfor (let ${j} = 0; ${j} < ${slot}.length; ++${j}) {`);
					for (const s of inner.bodyStmts) bodyStmts.push(`\t\t${s}`);
					bodyStmts.push(`\t\t${slot}[${j}] = ${inner.literal};`);
					bodyStmts.push(`\t}`);
					bodyStmts.push(`}`);
				} else preFn.splice(savedPreFnLen, 1);
			} else {
				const inner = makeJitRqbMapperInner(innerSelection, slot, nestedSelVar, false, parseJsonIfString, true, preFn, counter, false);
				if (inner.hasWork) {
					hasWork = true;
					bodyStmts.push(`if (${slot} !== null) {`);
					for (const s of inner.bodyStmts) bodyStmts.push(`\t${s}`);
					bodyStmts.push(`\t${slot} = ${inner.literal};`);
					bodyStmts.push(`}`);
				} else preFn.splice(savedPreFnLen, 1);
			}
			literalEntries.push(`${keyStr}: ${slot}`);
			continue;
		}
		let decoderExpr = "";
		let destructure = "";
		let bypassCodecs = false;
		if (is(field, Column)) {
			if (useJsonMappers && field.mapFromJsonValue) {
				bypassCodecs = true;
				const id = counter.n++;
				destructure = `field: dec${id}`;
				decoderExpr = `dec${id}.mapFromJsonValue`;
			} else if (!field.mapFromDriverValue.isNoop) {
				const id = counter.n++;
				destructure = `field: dec${id}`;
				decoderExpr = `dec${id}.mapFromDriverValue`;
			}
		} else if (is(field, SQL)) {
			if (useJsonMappers && field.decoder.mapFromJsonValue) {
				bypassCodecs = true;
				const id = counter.n++;
				destructure = `field: { decoder: dec${id} }`;
				decoderExpr = `dec${id}.mapFromJsonValue`;
			} else if (!field.decoder.mapFromDriverValue.isNoop) {
				const id = counter.n++;
				destructure = `field: { decoder: dec${id} }`;
				decoderExpr = `dec${id}.mapFromDriverValue`;
			}
		} else if (is(field, SQL.Aliased)) {
			if (useJsonMappers && field.sql.decoder.mapFromJsonValue) {
				bypassCodecs = true;
				const id = counter.n++;
				destructure = `field: { sql: { decoder: dec${id} } }`;
				decoderExpr = `dec${id}.mapFromJsonValue`;
			} else if (!field.sql.decoder.mapFromDriverValue.isNoop) {
				const id = counter.n++;
				destructure = `field: { sql: { decoder: dec${id} } }`;
				decoderExpr = `dec${id}.mapFromDriverValue`;
			}
		} else if (is(field, Table) || is(field, View)) {} else {
			const sqlExpr = field.getSQL();
			if (useJsonMappers && sqlExpr.decoder.mapFromJsonValue) {
				bypassCodecs = true;
				const id = counter.n++;
				preFn.push(`const dec${id} = ${sel}.field.getSQL().decoder;`);
				decoderExpr = `dec${id}.mapFromJsonValue`;
			} else if (!sqlExpr.decoder.mapFromDriverValue.isNoop) {
				const id = counter.n++;
				preFn.push(`const dec${id} = ${sel}.field.getSQL().decoder;`);
				decoderExpr = `dec${id}.mapFromDriverValue`;
			}
		}
		let codecVar = "";
		if (!bypassCodecs && codec) codecVar = `codec${counter.n++}`;
		if (destructure || codecVar) {
			const parts = [];
			if (destructure) parts.push(destructure);
			if (codecVar) parts.push(`codec: ${codecVar}`);
			preFn.push(`const { ${parts.join(", ")} } = ${sel};`);
		}
		if (decoderExpr || codecVar) {
			hasWork = true;
			let decoded = slot;
			if (codecVar) decoded = `${codecVar}(${decoded}, ${arrayDimensions})`;
			if (decoderExpr) decoded = `${decoderExpr}(${decoded})`;
			literalEntries.push(`${keyStr}: ${slot} === null ? null : ${decoded}`);
		} else literalEntries.push(`${keyStr}: ${slot}`);
	}
	return {
		bodyStmts,
		literal: `{ ${literalEntries.join(", ")} }`,
		hasWork
	};
}
function makeJitRqbMapper({ selection, isFirst, parseJson, parseJsonIfString, rootJsonMappers, arrayModeRoot }) {
	const preFn = [];
	const inner = makeJitRqbMapperInner(selection, "row", "selection", parseJson, parseJsonIfString, arrayModeRoot ? false : rootJsonMappers, preFn, { n: 0 }, !!arrayModeRoot);
	const lines = [];
	lines.push(`\t"use strict";
	const { selection } = this;`);
	for (const p of preFn) lines.push(`\t${p}`);
	if (arrayModeRoot) if (isFirst) {
		lines.push(`\tconst row = rows[0];`);
		lines.push(`\tif (!row) return undefined;`);
		for (const s of inner.bodyStmts) lines.push(`\t${s}`);
		lines.push(`\treturn ${inner.literal};`);
	} else {
		lines.push(`\tconst { length } = rows;`);
		lines.push(`\tconst mapped = Array.from({ length });`);
		lines.push(`\tfor (let i = 0; i < length; ++i) {`);
		lines.push(`\t\tconst row = rows[i];`);
		for (const s of inner.bodyStmts) lines.push(`\t\t${s}`);
		lines.push(`\t\tmapped[i] = ${inner.literal};`);
		lines.push(`\t}`);
		lines.push(`\treturn mapped;`);
	}
	else if (!inner.hasWork) lines.push(isFirst ? `\treturn rows[0];` : `\treturn rows;`);
	else if (isFirst) {
		lines.push(`\tconst row = rows[0];`);
		lines.push(`\tif (!row) return undefined;`);
		for (const s of inner.bodyStmts) lines.push(`\t${s}`);
		lines.push(`\trows[0] = ${inner.literal};`);
		lines.push(`\treturn rows[0];`);
	} else {
		lines.push(`\tfor (let i = 0; i < rows.length; ++i) {`);
		lines.push(`\t\tconst row = rows[i];`);
		for (const s of inner.bodyStmts) lines.push(`\t\t${s}`);
		lines.push(`\t\trows[i] = ${inner.literal};`);
		lines.push(`\t}`);
		lines.push(`\treturn rows;`);
	}
	lines.push("	//# sourceURL=drizzle:jit-relational-query-mapper");
	const compiled = lines.join("\n");
	return Object.assign(new FnConstructor("rows", compiled).bind({ selection }), { body: `function jitRqbMapper (rows) {\n${compiled}\n}` });
}
var RelationsBuilderTable = class {
	static [entityKind] = "RelationsBuilderTable";
	_;
	constructor(table, name) {
		this._ = {
			name,
			table
		};
	}
};
var RelationsBuilderColumn = class {
	static [entityKind] = "RelationsBuilderColumn";
	_;
	constructor(column, tableName, key) {
		this._ = {
			tableName,
			column,
			key
		};
	}
	through(column) {
		return new RelationsBuilderJunctionColumn(this._.column, this._.tableName, this._.key, column);
	}
};
var RelationsBuilderJunctionColumn = class {
	static [entityKind] = "RelationsBuilderColumn";
	_;
	constructor(column, tableName, key, through) {
		this._ = {
			tableName,
			column,
			through,
			key
		};
	}
};
var RelationsHelperStatic = class {
	static [entityKind] = "RelationsHelperStatic";
	_;
	constructor(tables) {
		this._ = { tables };
		const one = {};
		const many = {};
		for (const [tableName, table] of Object.entries(tables)) {
			one[tableName] = (config) => {
				return new One(tables, table, tableName, config);
			};
			many[tableName] = (config) => {
				return new Many(tables, table, tableName, config);
			};
		}
		this.one = one;
		this.many = many;
	}
	one;
	many;
	/** @internal - to be reworked */
	aggs = { count() {
		return new Count();
	} };
};
function createRelationsHelper(tables) {
	const helperStatic = new RelationsHelperStatic(tables);
	const relationsTables = Object.entries(tables).reduce((acc, [tKey, value]) => {
		const rTable = new RelationsBuilderTable(value, tKey);
		const columns = Object.entries(value[TableColumns]).reduce((acc, [cKey, column]) => {
			acc[cKey] = new RelationsBuilderColumn(column, tKey, cKey);
			return acc;
		}, {});
		acc[tKey] = Object.assign(rTable, columns);
		return acc;
	}, {});
	return Object.assign(helperStatic, relationsTables);
}
function extractTablesFromSchema(schema) {
	return Object.fromEntries(Object.entries(schema).filter(([_, e]) => is(e, Table) || is(e, View)));
}
function defineRelations(schema, relations) {
	const tables = extractTablesFromSchema(schema);
	return buildRelations(tables, relations ? relations(createRelationsHelper(tables)) : {});
}
/** @internal */
function fieldSelectionToSQL(table, target) {
	const field = table[TableColumns][target];
	return field ? is(field, Column) ? field : is(field, SQL.Aliased) ? sql`${table}.${sql.identifier(field.fieldAlias)}` : sql`${table}.${sql.identifier(target)}` : sql`${table}.${sql.identifier(target)}`;
}
function relationsFieldFilterToSQL(column, filter) {
	if (typeof filter !== "object" || is(filter, Placeholder)) return eq(column, filter);
	const entries = Object.entries(filter);
	if (!entries.length) return void 0;
	const parts = [];
	for (const [target, value] of entries) {
		if (value === void 0) continue;
		switch (target) {
			case "NOT": {
				const res = relationsFieldFilterToSQL(column, value);
				if (!res) continue;
				parts.push(not(res));
				continue;
			}
			case "OR":
				if (!value.length) continue;
				parts.push(or(...value.map((subFilter) => relationsFieldFilterToSQL(column, subFilter))));
				continue;
			case "AND":
				if (!value.length) continue;
				parts.push(and(...value.map((subFilter) => relationsFieldFilterToSQL(column, subFilter))));
				continue;
			case "isNotNull":
			case "isNull":
				if (!value) continue;
				parts.push(operators[target](column));
				continue;
			case "in":
				parts.push(operators.inArray(column, value));
				continue;
			case "notIn":
				parts.push(operators.notInArray(column, value));
				continue;
			default:
				parts.push(operators[target](column, value));
				continue;
		}
	}
	if (!parts.length) return void 0;
	return and(...parts);
}
function relationsFilterToSQL(table, filter, tableRelations = {}, tablesRelations = {}, depth = 0) {
	const entries = Object.entries(filter);
	if (!entries.length) return void 0;
	const parts = [];
	for (const [target, value] of entries) {
		if (value === void 0) continue;
		switch (target) {
			case "RAW": {
				const processed = typeof value === "function" ? value(table, operators) : value.getSQL();
				parts.push(processed);
				continue;
			}
			case "OR":
				if (!value?.length) continue;
				parts.push(or(...value.map((subFilter) => relationsFilterToSQL(table, subFilter, tableRelations, tablesRelations, depth))));
				continue;
			case "AND":
				if (!value?.length) continue;
				parts.push(and(...value.map((subFilter) => relationsFilterToSQL(table, subFilter, tableRelations, tablesRelations, depth))));
				continue;
			case "NOT": {
				if (value === void 0) continue;
				const built = relationsFilterToSQL(table, value, tableRelations, tablesRelations, depth);
				if (!built) continue;
				parts.push(not(built));
				continue;
			}
			default: {
				if (table[TableColumns][target]) {
					const colFilter = relationsFieldFilterToSQL(fieldSelectionToSQL(table, target), value);
					if (colFilter) parts.push(colFilter);
					continue;
				}
				const relation = tableRelations[target];
				if (!relation) throw new DrizzleError({ message: `Unknown relational filter field: "${target}"` });
				const targetTable = aliasedTable(relation.targetTable, `f${depth}`);
				const throughTable = relation.throughTable ? aliasedTable(relation.throughTable, `ft${depth}`) : void 0;
				const targetConfig = tablesRelations[relation.targetTableName];
				const { filter: relationFilter, joinCondition } = relationToSQL(relation, table, targetTable, throughTable);
				const filter = and(relationFilter, typeof value === "boolean" ? void 0 : relationsFilterToSQL(targetTable, value, targetConfig.relations, tablesRelations, depth + 1));
				const subquery = throughTable ? sql`(select * from ${getTableAsAliasSQL(targetTable)} inner join ${getTableAsAliasSQL(throughTable)} on ${joinCondition}${sql` where ${filter}`.if(filter)} limit 1)` : sql`(select * from ${getTableAsAliasSQL(targetTable)}${sql` where ${filter}`.if(filter)} limit 1)`;
				if (filter) parts.push((value ? exists : notExists)(subquery));
			}
		}
	}
	return and(...parts);
}
function relationsOrderToSQL(table, orders) {
	if (typeof orders === "function") {
		const data = orders(table, orderByOperators);
		return is(data, SQL) ? data : Array.isArray(data) ? data.length ? sql.join(data.map((o) => is(o, SQL) ? o : asc(o)), sql`, `) : void 0 : is(data, Column) ? asc(data) : void 0;
	}
	const entries = Object.entries(orders).filter(([_, value]) => value);
	if (!entries.length) return void 0;
	return sql.join(entries.map(([target, value]) => (value === "asc" ? asc : desc)(fieldSelectionToSQL(table, target))), sql`, `);
}
function relationExtrasToSQL(table, extras, codecs, inJson) {
	const subqueries = [];
	const selection = [];
	for (const [key, field] of Object.entries(extras)) {
		if (!field) continue;
		const subq = (typeof field === "function" ? field(table, { sql: operators.sql }) : field).getSQL();
		const column = codecs ? getColumnFromDecoder(subq) : void 0;
		const query = column && (!inJson || !column.jsonSelectIdentifier) ? sql`${codecs.apply(column, inJson ? "castInJson" : "cast", sql`(${subq})`)} as ${sql.identifier(key)}` : sql`(${subq}) as ${sql.identifier(key)}`;
		query.decoder = subq.decoder;
		subqueries.push(query);
		selection.push(column && (!inJson || !column.mapFromJsonValue) ? {
			key,
			field: query,
			codec: codecs.get(column, inJson ? "normalizeInJson" : "normalize"),
			arrayDimensions: column.dimensions
		} : {
			key,
			field: query
		});
	}
	return {
		sql: subqueries.length ? sql.join(subqueries, sql`, `) : void 0,
		selection
	};
}
function relationToSQL(relation, sourceTable, targetTable, throughTable) {
	if (relation.through) {
		const outerColumnWhere = relation.sourceColumns.map((s, i) => {
			const t = relation.through.source[i];
			return eq(sql`${sourceTable}.${sql.identifier(s.name)}`, sql`${throughTable}.${sql.identifier(is(t._.column, Column) ? t._.column.name : t._.key)}`);
		});
		const innerColumnWhere = relation.targetColumns.map((s, i) => {
			const t = relation.through.target[i];
			return eq(sql`${throughTable}.${sql.identifier(is(t._.column, Column) ? t._.column.name : t._.key)}`, sql`${targetTable}.${sql.identifier(s.name)}`);
		});
		return {
			filter: and(relation.where ? relationsFilterToSQL(relation.isReversed ? sourceTable : targetTable, relation.where) : void 0, ...outerColumnWhere),
			joinCondition: and(...innerColumnWhere)
		};
	}
	return { filter: and(...relation.sourceColumns.map((s, i) => {
		const t = relation.targetColumns[i];
		return eq(sql`${sourceTable}.${sql.identifier(s.name)}`, sql`${targetTable}.${sql.identifier(t.name)}`);
	}), relation.where ? relationsFilterToSQL(relation.isReversed ? sourceTable : targetTable, relation.where) : void 0) };
}
function getTableAsAliasSQL(table) {
	return sql`${table[IsAlias] ? sql`${sql`${sql.identifier(table[TableSchema] ?? "")}.`.if(table[TableSchema])}${sql.identifier(table[OriginalName])} as ${table}` : table}`;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/dialect.js
var SQLiteDialect = class {
	static [entityKind] = "SQLiteDialect";
	mapperGenerators;
	constructor(config) {
		this.mapperGenerators = config?.useJitMappers ? {
			rows: makeJitQueryMapper,
			relationalRows: makeJitRqbMapper
		} : {
			rows: makeDefaultQueryMapper,
			relationalRows: makeDefaultRqbMapper
		};
	}
	escapeName(name) {
		return `"${name.replace(/"/g, "\"\"")}"`;
	}
	escapeParam(_num) {
		return "?";
	}
	escapeString(str) {
		return `'${str.replace(/'/g, "''")}'`;
	}
	buildWithCTE(queries) {
		if (!queries?.length) return void 0;
		const withSqlChunks = [sql`with `];
		for (const [i, w] of queries.entries()) {
			withSqlChunks.push(sql`${sql.identifier(w._.alias)} as (${w._.sql})`);
			if (i < queries.length - 1) withSqlChunks.push(sql`, `);
		}
		withSqlChunks.push(sql` `);
		return sql.join(withSqlChunks);
	}
	buildDeleteQuery({ table, where, returning, withList, limit, orderBy }) {
		const withSql = this.buildWithCTE(withList);
		const returningSql = returning ? sql` returning ${this.buildSelection(returning, { isSingleTable: true })}` : void 0;
		return sql`${withSql}delete from ${table}${where ? sql` where ${where}` : void 0}${returningSql}${this.buildOrderBy(orderBy)}${this.buildLimit(limit)}`;
	}
	buildUpdateSet(table, set) {
		const tableColumns = table[Table.Symbol.Columns];
		const columnNames = Object.keys(tableColumns).filter((colName) => set[colName] !== void 0 || tableColumns[colName]?.onUpdateFn !== void 0);
		const setLength = columnNames.length;
		return sql.join(columnNames.flatMap((colName, i) => {
			const col = tableColumns[colName];
			const onUpdateFnResult = col.onUpdateFn?.();
			const value = set[colName] ?? (is(onUpdateFnResult, SQL) ? onUpdateFnResult : sql.param(onUpdateFnResult, col));
			const res = sql`${sql.identifier(col.name)} = ${value}`;
			if (i < setLength - 1) return [res, sql.raw(", ")];
			return [res];
		}));
	}
	buildUpdateQuery({ table, set, where, returning, withList, joins, from, limit, orderBy }) {
		const withSql = this.buildWithCTE(withList);
		const setSql = this.buildUpdateSet(table, set);
		const fromSql = from && sql.join([sql.raw(" from "), this.buildFromTable(from)]);
		const joinsSql = this.buildJoins(joins);
		const returningSql = returning ? sql` returning ${this.buildSelection(returning, { isSingleTable: true })}` : void 0;
		return sql`${withSql}update ${table} set ${setSql}${fromSql}${joinsSql}${where ? sql` where ${where}` : void 0}${returningSql}${this.buildOrderBy(orderBy)}${this.buildLimit(limit)}`;
	}
	/**
	* Builds selection SQL with provided fields/expressions
	*
	* Examples:
	*
	* `select <selection> from`
	*
	* `insert ... returning <selection>`
	*
	* If `isSingleTable` is true, then columns won't be prefixed with table name
	*/
	buildSelection(fields, { isSingleTable = false } = {}) {
		const columnsLen = fields.length;
		const chunks = fields.flatMap(({ field }, i) => {
			const chunk = [];
			if (is(field, SQL.Aliased)) if (field.isSelectionField) {
				if (!isSingleTable && field.origin !== void 0) chunk.push(sql.identifier(field.origin), sql.raw("."));
				chunk.push(sql.identifier(field.fieldAlias));
			} else {
				const query = field.sql;
				if (isSingleTable) {
					const newSql = new SQL(query.queryChunks.map((c) => {
						if (is(c, Column)) return sql.identifier(c.name);
						return c;
					}));
					chunk.push(query.shouldInlineParams ? newSql.inlineParams() : newSql);
				} else chunk.push(query);
				chunk.push(sql` as ${sql.identifier(field.fieldAlias)}`);
			}
			else if (is(field, SQL)) {
				const query = field;
				if (isSingleTable) {
					const newSql = new SQL(query.queryChunks.map((c) => {
						if (is(c, Column)) return sql.identifier(c.name);
						return c;
					}));
					chunk.push(query.shouldInlineParams ? newSql.inlineParams() : newSql);
				} else chunk.push(query);
			} else if (is(field, Column)) if (field.columnType === "SQLiteNumericBigInt" || field.columnType === "SQLiteNumeric") if (isSingleTable) chunk.push(field.isAlias ? sql`cast(${sql.identifier(getOriginalColumnFromAlias(field).name)} as text) as ${field}` : sql`cast(${sql.identifier(field.name)} as text)`);
			else chunk.push(field.isAlias ? sql`cast(${getOriginalColumnFromAlias(field)} as text) as ${field}` : sql`cast(${field} as text)`);
			else if (isSingleTable) chunk.push(field.isAlias ? sql`${sql.identifier(getOriginalColumnFromAlias(field).name)} as ${field}` : sql.identifier(field.name));
			else chunk.push(field.isAlias ? sql`${getOriginalColumnFromAlias(field)} as ${field}` : field);
			else if (is(field, Subquery)) if (!field._.isWith) chunk.push(sql`(${field._.sql}) ${sql.identifier(field._.alias)}`);
			else chunk.push(field);
			if (i < columnsLen - 1) chunk.push(sql`, `);
			return chunk;
		});
		return sql.join(chunks);
	}
	buildJoins(joins) {
		if (!joins || joins.length === 0) return;
		const joinsArray = [];
		if (joins) for (const [index, joinMeta] of joins.entries()) {
			if (index === 0) joinsArray.push(sql` `);
			const table = joinMeta.table;
			const onSql = joinMeta.on ? sql` on ${joinMeta.on}` : void 0;
			if (is(table, SQLiteTable)) {
				const tableName = table[SQLiteTable.Symbol.Name];
				const tableSchema = table[SQLiteTable.Symbol.Schema];
				const origTableName = table[SQLiteTable.Symbol.OriginalName];
				const alias = tableName === origTableName ? void 0 : joinMeta.alias;
				joinsArray.push(sql`${sql.raw(joinMeta.joinType)} join ${tableSchema ? sql`${sql.identifier(tableSchema)}.` : void 0}${sql.identifier(origTableName)}${alias && sql` ${sql.identifier(alias)}`}${onSql}`);
			} else joinsArray.push(sql`${sql.raw(joinMeta.joinType)} join ${table}${onSql}`);
			if (index < joins.length - 1) joinsArray.push(sql` `);
		}
		return sql.join(joinsArray);
	}
	buildLimit(limit) {
		return typeof limit === "object" || typeof limit === "number" && limit >= 0 ? sql` limit ${limit}` : void 0;
	}
	buildOrderBy(orderBy) {
		const orderByList = [];
		if (orderBy) for (const [index, orderByValue] of orderBy.entries()) {
			orderByList.push(orderByValue);
			if (index < orderBy.length - 1) orderByList.push(sql`, `);
		}
		return orderByList.length > 0 ? sql` order by ${sql.join(orderByList)}` : void 0;
	}
	buildFromTable(table) {
		if (is(table, Table) && table[Table.Symbol.IsAlias]) return sql`${sql`${sql.identifier(table[Table.Symbol.Schema] ?? "")}.`.if(table[Table.Symbol.Schema])}${sql.identifier(table[Table.Symbol.OriginalName])} ${sql.identifier(table[Table.Symbol.Name])}`;
		if (is(table, View) && table[ViewBaseConfig].isAlias) {
			let fullName = sql`${sql.identifier(table[ViewBaseConfig].originalName)}`;
			if (table[ViewBaseConfig].schema) fullName = sql`${sql.identifier(table[ViewBaseConfig].schema)}.${fullName}`;
			return sql`${fullName} ${sql.identifier(table[ViewBaseConfig].name)}`;
		}
		return table;
	}
	buildSelectQuery({ withList, fields, fieldsFlat, where, having, table, joins, orderBy, groupBy, limit, offset, distinct, setOperators }) {
		const fieldsList = fieldsFlat ?? orderSelectedFields(fields);
		for (const f of fieldsList) if (is(f.field, Column) && getTableName(f.field.table) !== (is(table, Subquery) ? table._.alias : is(table, SQLiteViewBase) ? table[ViewBaseConfig].name : is(table, SQL) ? void 0 : getTableName(table)) && !((table) => joins?.some(({ alias }) => alias === (table[Table.Symbol.IsAlias] ? getTableName(table) : table[Table.Symbol.BaseName])))(f.field.table)) {
			const tableName = getTableName(f.field.table);
			throw new Error(`Your "${f.path.join("->")}" field references a column "${tableName}"."${f.field.name}", but the table "${tableName}" is not part of the query! Did you forget to join it?`);
		}
		const isSingleTable = !joins || joins.length === 0;
		const withSql = this.buildWithCTE(withList);
		const distinctSql = distinct ? sql` distinct` : void 0;
		const selection = this.buildSelection(fieldsList, { isSingleTable });
		const tableSql = this.buildFromTable(table);
		const joinsSql = this.buildJoins(joins);
		const whereSql = where ? sql` where ${where}` : void 0;
		const havingSql = having ? sql` having ${having}` : void 0;
		const groupByList = [];
		if (groupBy) for (const [index, groupByValue] of groupBy.entries()) {
			groupByList.push(groupByValue);
			if (index < groupBy.length - 1) groupByList.push(sql`, `);
		}
		const finalQuery = sql`${withSql}select${distinctSql} ${selection} from ${tableSql}${joinsSql}${whereSql}${groupByList.length > 0 ? sql` group by ${sql.join(groupByList)}` : void 0}${havingSql}${this.buildOrderBy(orderBy)}${this.buildLimit(limit)}${offset ? sql` offset ${offset}` : void 0}`;
		if (setOperators.length > 0) return this.buildSetOperations(finalQuery, setOperators);
		return finalQuery;
	}
	buildSetOperations(leftSelect, setOperators) {
		const [setOperator, ...rest] = setOperators;
		if (!setOperator) throw new Error("Cannot pass undefined values to any set operator");
		if (rest.length === 0) return this.buildSetOperationQuery({
			leftSelect,
			setOperator
		});
		return this.buildSetOperations(this.buildSetOperationQuery({
			leftSelect,
			setOperator
		}), rest);
	}
	buildSetOperationQuery({ leftSelect, setOperator: { type, isAll, rightSelect, limit, orderBy, offset } }) {
		const leftChunk = sql`${leftSelect.getSQL()} `;
		const rightChunk = sql`${rightSelect.getSQL()}`;
		let orderBySql;
		if (orderBy && orderBy.length > 0) {
			const orderByValues = [];
			for (const singleOrderBy of orderBy) if (is(singleOrderBy, SQLiteColumn)) orderByValues.push(sql.identifier(singleOrderBy.name));
			else if (is(singleOrderBy, SQL)) {
				for (let i = 0; i < singleOrderBy.queryChunks.length; i++) {
					const chunk = singleOrderBy.queryChunks[i];
					if (is(chunk, SQLiteColumn)) singleOrderBy.queryChunks[i] = sql.identifier(chunk.name);
				}
				orderByValues.push(sql`${singleOrderBy}`);
			} else orderByValues.push(sql`${singleOrderBy}`);
			orderBySql = sql` order by ${sql.join(orderByValues, sql`, `)}`;
		}
		const limitSql = typeof limit === "object" || typeof limit === "number" && limit >= 0 ? sql` limit ${limit}` : void 0;
		const operatorChunk = sql.raw(`${type} ${isAll ? "all " : ""}`);
		const offsetSql = offset ? sql` offset ${offset}` : void 0;
		return sql`${leftChunk}${operatorChunk}${rightChunk}${orderBySql}${limitSql}${offsetSql}`;
	}
	buildInsertQuery({ table, values: valuesOrSelect, onConflict, returning, withList, select }) {
		const valuesSqlList = [];
		const columns = table[Table.Symbol.Columns];
		const colEntries = Object.entries(columns);
		const colEntriesFiltered = select && !is(valuesOrSelect, SQL) ? Object.keys(valuesOrSelect.getSelectedFields()).map((key) => [key, columns[key]]) : colEntries.filter(([_, col]) => !col.shouldDisableInsert());
		const insertOrder = colEntriesFiltered.map(([, column]) => sql.identifier(column.name));
		if (select) {
			const select = valuesOrSelect;
			if (is(select, SQL)) valuesSqlList.push(select);
			else valuesSqlList.push(select.getSQL());
		} else {
			const values = valuesOrSelect;
			valuesSqlList.push(sql.raw("values "));
			for (const [valueIndex, value] of values.entries()) {
				const valueList = [];
				for (const [fieldName, col] of colEntriesFiltered) {
					const colValue = value[fieldName];
					if (colValue === void 0 || is(colValue, Param) && colValue.value === void 0) {
						let defaultValue;
						if (col.default !== null && col.default !== void 0) defaultValue = is(col.default, SQL) ? col.default : sql.param(col.default, col);
						else if (col.defaultFn !== void 0) {
							const defaultFnResult = col.defaultFn();
							defaultValue = is(defaultFnResult, SQL) ? defaultFnResult : sql.param(defaultFnResult, col);
						} else if (!col.default && col.onUpdateFn !== void 0) {
							const onUpdateFnResult = col.onUpdateFn();
							defaultValue = is(onUpdateFnResult, SQL) ? onUpdateFnResult : sql.param(onUpdateFnResult, col);
						} else defaultValue = sql`null`;
						valueList.push(defaultValue);
					} else valueList.push(colValue);
				}
				valuesSqlList.push(valueList);
				if (valueIndex < values.length - 1) valuesSqlList.push(sql`, `);
			}
		}
		const withSql = this.buildWithCTE(withList);
		const valuesSql = sql.join(valuesSqlList);
		const returningSql = returning ? sql` returning ${this.buildSelection(returning, { isSingleTable: true })}` : void 0;
		return sql`${withSql}insert into ${table} ${insertOrder} ${valuesSql}${onConflict?.length ? sql.join(onConflict) : void 0}${returningSql}`;
	}
	sqlToQuery(sql, invokeSource) {
		return sql.toQuery({
			escapeName: this.escapeName,
			escapeParam: this.escapeParam,
			escapeString: this.escapeString,
			invokeSource
		});
	}
	nestedSelectionerror() {
		throw new DrizzleError({ message: `Views with nested selections are not supported by the relational query builder` });
	}
	buildRqbColumn(table, column, key, inJson) {
		if (is(column, Column)) {
			const name = sql`${table}.${sql.identifier(column.name)}`;
			switch (column.columnType) {
				case "SQLiteBigInt":
				case "SQLiteBlobJson":
				case "SQLiteBlobBuffer":
					if (!inJson) return sql`${name} as ${sql.identifier(key)}`;
					return sql`hex(${name}) as ${sql.identifier(key)}`;
				case "SQLiteNumeric":
				case "SQLiteNumericNumber":
				case "SQLiteNumericBigInt": return sql`cast(${name} as text) as ${sql.identifier(key)}`;
				case "SQLiteCustomColumn":
					if (!inJson) return sql`${name} as ${sql.identifier(key)}`;
					return sql`${column.jsonSelectIdentifier(name, sql)} as ${sql.identifier(key)}`;
				default: return sql`${name} as ${sql.identifier(key)}`;
			}
		}
		return sql`${table}.${is(column, SQL.Aliased) ? sql.identifier(column.fieldAlias) : isSQLWrapper(column) ? sql.identifier(key) : this.nestedSelectionerror()} as ${sql.identifier(key)}`;
	}
	unwrapAllColumns = (table, selection, inJson) => {
		return sql.join(Object.entries(table[TableColumns]).map(([k, v]) => {
			selection.push({
				key: k,
				field: v
			});
			return this.buildRqbColumn(table, v, k, inJson);
		}), sql`, `);
	};
	getSelectedTableColumns = (table, columns) => {
		const selectedColumns = [];
		const columnContainer = table[TableColumns];
		const entries = Object.entries(columns);
		let colSelectionMode;
		for (const [k, v] of entries) {
			if (v === void 0) continue;
			colSelectionMode = colSelectionMode || v;
			if (v) {
				const column = columnContainer[k];
				selectedColumns.push({
					column,
					tsName: k
				});
			}
		}
		if (colSelectionMode === false) for (const [k, v] of Object.entries(columnContainer)) {
			if (columns[k] === false) continue;
			selectedColumns.push({
				column: v,
				tsName: k
			});
		}
		return selectedColumns;
	};
	buildColumns = (table, selection, inJson, params) => params?.columns ? (() => {
		const columnIdentifiers = [];
		const selectedColumns = this.getSelectedTableColumns(table, params?.columns);
		for (const { column, tsName } of selectedColumns) {
			columnIdentifiers.push(this.buildRqbColumn(table, column, tsName, inJson));
			selection.push({
				key: tsName,
				field: column
			});
		}
		return columnIdentifiers.length ? sql.join(columnIdentifiers, sql`, `) : void 0;
	})() : this.unwrapAllColumns(table, selection, inJson);
	buildRelationalQuery({ schema, table, tableConfig, queryConfig: config, relationWhere, mode, isNested, errorPath, depth, throughJoin, jsonb }) {
		const selection = [];
		const isSingle = mode === "first";
		const params = config === true ? void 0 : config;
		const currentPath = errorPath ?? "";
		const currentDepth = depth ?? 0;
		if (!currentDepth) table = aliasedTable(table, `d${currentDepth}`);
		const limit = isSingle ? 1 : params?.limit;
		const offset = params?.offset;
		const columns = this.buildColumns(table, selection, !!isNested, params);
		const where = params?.where && relationWhere ? and(relationsFilterToSQL(table, params.where, tableConfig.relations, schema), relationWhere) : params?.where ? relationsFilterToSQL(table, params.where, tableConfig.relations, schema) : relationWhere;
		const order = params?.orderBy ? relationsOrderToSQL(table, params.orderBy) : void 0;
		const extras = params?.extras ? relationExtrasToSQL(table, params.extras) : void 0;
		if (extras) selection.push(...extras.selection);
		const joins = params ? (() => {
			const { with: joins } = params;
			if (!joins) return;
			const withEntries = Object.entries(joins).filter(([_, v]) => v);
			if (!withEntries.length) return;
			return sql.join(withEntries.map(([k, join]) => {
				const relation = tableConfig.relations[k];
				const isSingle = is(relation, One);
				const targetTable = aliasedTable(relation.targetTable, `d${currentDepth + 1}`);
				const throughTable = relation.throughTable ? aliasedTable(relation.throughTable, `tr${currentDepth}`) : void 0;
				const { filter, joinCondition } = relationToSQL(relation, table, targetTable, throughTable);
				const throughJoin = throughTable ? sql` inner join ${getTableAsAliasSQL(throughTable)} on ${joinCondition}` : void 0;
				const innerQuery = this.buildRelationalQuery({
					table: targetTable,
					mode: isSingle ? "first" : "many",
					schema,
					queryConfig: join,
					tableConfig: schema[relation.targetTableName],
					relationWhere: filter,
					isNested: true,
					errorPath: `${currentPath.length ? `${currentPath}.` : ""}${k}`,
					depth: currentDepth + 1,
					throughJoin,
					jsonb
				});
				selection.push({
					field: targetTable,
					key: k,
					selection: innerQuery.selection,
					isArray: !isSingle,
					isOptional: (relation.optional ?? false) || join !== true && !!join.where
				});
				const jsonColumns = sql.join(innerQuery.selection.map((s) => {
					return sql`${sql.raw(this.escapeString(s.key))}, ${s.selection ? sql`${jsonb}(${sql.identifier(s.key)})` : sql.identifier(s.key)}`;
				}), sql`, `);
				const json = isNested ? jsonb : sql`json`;
				return isSingle ? sql`(select ${json}_object(${jsonColumns}) as ${sql.identifier("r")} from (${innerQuery.sql}) as ${sql.identifier("t")}) as ${sql.identifier(k)}` : sql`coalesce((select ${json}_group_array(json_object(${jsonColumns})) as ${sql.identifier("r")} from (${innerQuery.sql}) as ${sql.identifier("t")}), ${jsonb}_array()) as ${sql.identifier(k)}`;
			}), sql`, `);
		})() : void 0;
		const selectionArr = [
			columns,
			extras?.sql,
			joins
		].filter((e) => e !== void 0);
		if (!selectionArr.length) throw new DrizzleError({ message: `No fields selected for table "${tableConfig.name}"${currentPath ? ` ("${currentPath}")` : ""}` });
		return {
			sql: sql`select ${sql.join(selectionArr, sql`, `)} from ${getTableAsAliasSQL(table)}${throughJoin}${sql` where ${where}`.if(where)}${sql` order by ${order}`.if(order)}${sql` limit ${limit}`.if(limit !== void 0)}${sql` offset ${offset}`.if(offset !== void 0)}`,
			selection
		};
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/query-builders/query-builder.js
var QueryBuilder = class {
	static [entityKind] = "SQLiteQueryBuilder";
	dialect;
	dialectConfig;
	constructor(dialect) {
		this.dialect = is(dialect, SQLiteDialect) ? dialect : void 0;
		this.dialectConfig = is(dialect, SQLiteDialect) ? void 0 : dialect;
	}
	$with = (alias, selection) => {
		const queryBuilder = this;
		const as = (qb) => {
			if (typeof qb === "function") qb = qb(queryBuilder);
			return new Proxy(new WithSubquery(qb.getSQL(), selection ?? ("getSelectedFields" in qb ? qb.getSelectedFields() ?? {} : {}), alias, true), new SelectionProxyHandler({
				alias,
				sqlAliasedBehavior: "alias",
				sqlBehavior: "error"
			}));
		};
		return { as };
	};
	with(...queries) {
		const self = this;
		function select(fields) {
			return new SQLiteSelectBuilder({
				fields: fields ?? void 0,
				session: void 0,
				dialect: self.getDialect(),
				withList: queries
			});
		}
		function selectDistinct(fields) {
			return new SQLiteSelectBuilder({
				fields: fields ?? void 0,
				session: void 0,
				dialect: self.getDialect(),
				withList: queries,
				distinct: true
			});
		}
		return {
			select,
			selectDistinct
		};
	}
	select(fields) {
		return new SQLiteSelectBuilder({
			fields: fields ?? void 0,
			session: void 0,
			dialect: this.getDialect()
		});
	}
	selectDistinct(fields) {
		return new SQLiteSelectBuilder({
			fields: fields ?? void 0,
			session: void 0,
			dialect: this.getDialect(),
			distinct: true
		});
	}
	getDialect() {
		if (!this.dialect) this.dialect = new SQLiteDialect(this.dialectConfig);
		return this.dialect;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/query-promise.js
var QueryPromise = class {
	static [entityKind] = "QueryPromise";
	[Symbol.toStringTag] = "QueryPromise";
	catch(onRejected) {
		return this.then(void 0, onRejected);
	}
	finally(onFinally) {
		return this.then((value) => {
			onFinally?.();
			return value;
		}, (reason) => {
			onFinally?.();
			throw reason;
		});
	}
	then(onFulfilled, onRejected) {
		return this.execute().then(onFulfilled, onRejected);
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/query-builders/count.js
var SQLiteCountBuilder = class SQLiteCountBuilder extends SQL {
	static [entityKind] = "SQLiteCountBuilder";
	dialect;
	session;
	static buildCount(source, filters, parens) {
		const query = sql`select count(*) from ${source}${sql` where ${filters}`.if(filters)}`;
		return parens ? sql`(${query})` : query;
	}
	constructor(countConfig) {
		super(SQLiteCountBuilder.buildCount(countConfig.source, countConfig.filters, true).queryChunks);
		this.countConfig = countConfig;
		this.dialect = countConfig.dialect;
		this.session = countConfig.session;
		this.mapWith((e) => {
			if (typeof e === "number") return e;
			return Number(e ?? 0);
		});
	}
	executableSql;
	build() {
		if (!this.executableSql) {
			const { source, filters } = this.countConfig;
			this.executableSql = SQLiteCountBuilder.buildCount(source, filters);
		}
		return this.dialect.sqlToQuery(this.executableSql);
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/async/count.js
var SQLiteAsyncCountBuilder = class extends SQLiteCountBuilder {
	static [entityKind] = "SQLiteAsyncCountBuilder";
	constructor(countConfig) {
		super(countConfig);
	}
	/** @internal */
	executeRaw(placeholderValues) {
		return this.session.prepareQuery(this.build(), "arrays", false, "all", (rows) => {
			const v = rows[0]?.[0];
			if (typeof v === "number") return v;
			return v ? Number(v) : 0;
		}).execute(placeholderValues);
	}
	async execute(placeholderValues) {
		return await this.executeRaw(placeholderValues);
	}
};
applyMixins(SQLiteAsyncCountBuilder, [QueryPromise]);
var SQLiteSyncCountBuilder = class extends SQLiteAsyncCountBuilder {
	static [entityKind] = "SQLiteSyncCountBuilder";
	sync(placeholderValues) {
		return this.executeRaw(placeholderValues).sync();
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/query-builders/query.js
var RelationalQueryBuilder = class {
	static [entityKind] = "SQLiteRelationalQueryBuilderV2";
	constructor(mode, schema, table, tableConfig, dialect, session, forbidJsonb, builder = SQLiteRelationalQuery) {
		this.mode = mode;
		this.schema = schema;
		this.table = table;
		this.tableConfig = tableConfig;
		this.dialect = dialect;
		this.session = session;
		this.forbidJsonb = forbidJsonb;
		this.builder = builder;
	}
	findMany(config) {
		return new this.builder(this.mode, this.schema, this.table, this.tableConfig, this.dialect, this.session, config ?? true, "many", this.forbidJsonb);
	}
	findFirst(config) {
		return new this.builder(this.mode, this.schema, this.table, this.tableConfig, this.dialect, this.session, config ?? true, "first", this.forbidJsonb);
	}
};
var SQLiteRelationalQuery = class {
	static [entityKind] = "SQLiteRelationalQueryV2";
	/** @internal */
	mode;
	/** @internal */
	table;
	/** @internal */
	resultKind;
	constructor(resultKind, schema, table, tableConfig, dialect, session, config, mode, forbidJsonb) {
		this.schema = schema;
		this.tableConfig = tableConfig;
		this.dialect = dialect;
		this.session = session;
		this.config = config;
		this.forbidJsonb = forbidJsonb;
		this.resultKind = resultKind;
		this.mode = mode;
		this.table = table;
	}
	getSQL() {
		return this._getQuery().sql;
	}
	_getQuery() {
		const jsonb = this.forbidJsonb ? sql`json` : sql`jsonb`;
		return this.dialect.buildRelationalQuery({
			schema: this.schema,
			table: this.table,
			tableConfig: this.tableConfig,
			queryConfig: this.config,
			mode: this.mode,
			jsonb
		});
	}
	_toSQL() {
		const query = this._getQuery();
		return {
			query,
			builtQuery: this.dialect.sqlToQuery(query.sql)
		};
	}
	toSQL() {
		return this._toSQL().builtQuery;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/async/query.js
var SQLiteAsyncRelationalQuery = class extends SQLiteRelationalQuery {
	static [entityKind] = "SQLiteAsyncRelationalQueryV2";
	/** @internal */
	_prepare(prepare = false) {
		const { query, builtQuery } = this._toSQL();
		const mapper = this.dialect.mapperGenerators.relationalRows({
			isFirst: this.mode === "first",
			parseJson: true,
			parseJsonIfString: false,
			rootJsonMappers: false,
			selection: query.selection,
			arrayModeRoot: true
		});
		return this.session.prepareQuery(builtQuery, "arrays", prepare, "all", mapper);
	}
	prepare() {
		return this._prepare(true);
	}
	async execute(placeholderValues) {
		return this._prepare().execute(placeholderValues);
	}
};
var SQLiteSyncRelationalQuery = class extends SQLiteAsyncRelationalQuery {
	static [entityKind] = "SQLiteSyncRelationalQueryV2";
	sync(placeholderValues) {
		return this._prepare().execute(placeholderValues).sync();
	}
};
applyMixins(SQLiteAsyncRelationalQuery, [QueryPromise]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/query-builders/delete.js
var SQLiteDeleteBase = class {
	static [entityKind] = "SQLiteDelete";
	/** @internal */
	config;
	constructor(table, session, dialect, withList) {
		this.table = table;
		this.session = session;
		this.dialect = dialect;
		this.config = {
			table,
			withList
		};
	}
	/**
	* Adds a `where` clause to the query.
	*
	* Calling this method will delete only those rows that fulfill a specified condition.
	*
	* See docs: {@link https://orm.drizzle.team/docs/delete}
	*
	* @param where the `where` clause.
	*
	* @example
	* You can use conditional operators and `sql function` to filter the rows to be deleted.
	*
	* ```ts
	* // Delete all cars with green color
	* db.delete(cars).where(eq(cars.color, 'green'));
	* // or
	* db.delete(cars).where(sql`${cars.color} = 'green'`)
	* ```
	*
	* You can logically combine conditional operators with `and()` and `or()` operators:
	*
	* ```ts
	* // Delete all BMW cars with a green color
	* db.delete(cars).where(and(eq(cars.color, 'green'), eq(cars.brand, 'BMW')));
	*
	* // Delete all cars with the green or blue color
	* db.delete(cars).where(or(eq(cars.color, 'green'), eq(cars.color, 'blue')));
	* ```
	*/
	where(where) {
		this.config.where = where;
		return this;
	}
	orderBy(...columns) {
		if (typeof columns[0] === "function") {
			const orderBy = columns[0](new Proxy(this.config.table[Table.Symbol.Columns], new SelectionProxyHandler({
				sqlAliasedBehavior: "alias",
				sqlBehavior: "sql"
			})));
			const orderByArray = Array.isArray(orderBy) ? orderBy : [orderBy];
			this.config.orderBy = orderByArray;
		} else {
			const orderByArray = columns;
			this.config.orderBy = orderByArray;
		}
		return this;
	}
	limit(limit) {
		this.config.limit = limit;
		return this;
	}
	returning(fields = this.table[SQLiteTable.Symbol.Columns]) {
		this.config.returning = orderSelectedFields(fields);
		return this;
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
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/async/delete.js
var SQLiteAsyncDeleteBase = class extends SQLiteDeleteBase {
	static [entityKind] = "SQLiteAsyncDelete";
	/** @internal */
	_prepare(prepare = false) {
		return this.session.prepareQuery(this.dialect.sqlToQuery(this.getSQL()), "arrays", prepare, this.config.returning ? "all" : "run", this.config.returning ? this.dialect.mapperGenerators.rows(this.config.returning, void 0) : void 0, {
			type: "delete",
			tables: extractUsedTable(this.config.table)
		});
	}
	prepare() {
		return this._prepare(true);
	}
	run = (placeholderValues) => {
		return this._prepare().run(placeholderValues);
	};
	all = (placeholderValues) => {
		return this._prepare().all(placeholderValues);
	};
	get = (placeholderValues) => {
		return this._prepare().get(placeholderValues);
	};
	values = (placeholderValues) => {
		return this._prepare().values(placeholderValues);
	};
	async execute(placeholderValues) {
		return this._prepare().execute(placeholderValues);
	}
};
applyMixins(SQLiteAsyncDeleteBase, [QueryPromise]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/query-builders/insert.js
var SQLiteInsertBuilder = class {
	static [entityKind] = "SQLiteInsertBuilder";
	constructor(table, session, dialect, withList, builder = SQLiteInsertBase) {
		this.table = table;
		this.session = session;
		this.dialect = dialect;
		this.withList = withList;
		this.builder = builder;
	}
	values(values) {
		values = Array.isArray(values) ? values : [values];
		if (values.length === 0) throw new Error("values() must be called with at least one value");
		const mappedValues = values.map((entry) => {
			const result = {};
			const cols = this.table[Table.Symbol.Columns];
			for (const colKey of Object.keys(entry)) {
				const colValue = entry[colKey];
				result[colKey] = is(colValue, SQL) ? colValue : new Param(colValue, cols[colKey]);
			}
			return result;
		});
		return new this.builder(this.table, mappedValues, this.session, this.dialect, this.withList);
	}
	select(selectQuery) {
		const select = typeof selectQuery === "function" ? selectQuery(new QueryBuilder()) : selectQuery;
		if (!is(select, SQL)) {
			const insertCols = Object.keys(this.table[Table.Symbol.Columns]);
			const selected = Object.keys(select._.selectedFields);
			for (const col of selected) if (!insertCols.includes(col)) throw new Error(`Insert select error: column "${col}" does not exist in table "${this.table[Table.Symbol.Name]}"`);
		}
		return new this.builder(this.table, select, this.session, this.dialect, this.withList, true);
	}
};
var SQLiteInsertBase = class {
	static [entityKind] = "SQLiteInsert";
	/** @internal */
	config;
	constructor(table, values, session, dialect, withList, select) {
		this.session = session;
		this.dialect = dialect;
		this.config = {
			table,
			values,
			withList,
			select
		};
	}
	returning(fields = this.config.table[SQLiteTable.Symbol.Columns]) {
		this.config.returning = orderSelectedFields(fields);
		return this;
	}
	/**
	* Adds an `on conflict do nothing` clause to the query.
	*
	* Calling this method simply avoids inserting a row as its alternative action.
	*
	* See docs: {@link https://orm.drizzle.team/docs/insert#on-conflict-do-nothing}
	*
	* @param config The `target` and `where` clauses.
	*
	* @example
	* ```ts
	* // Insert one row and cancel the insert if there's a conflict
	* await db.insert(cars)
	*   .values({ id: 1, brand: 'BMW' })
	*   .onConflictDoNothing();
	*
	* // Explicitly specify conflict target
	* await db.insert(cars)
	*   .values({ id: 1, brand: 'BMW' })
	*   .onConflictDoNothing({ target: cars.id });
	* ```
	*/
	onConflictDoNothing(config = {}) {
		if (!this.config.onConflict) this.config.onConflict = [];
		if (config.target === void 0) this.config.onConflict.push(sql` on conflict do nothing`);
		else {
			const targetSql = Array.isArray(config.target) ? sql`${config.target}` : sql`${[config.target]}`;
			const whereSql = config.where ? sql` where ${config.where}` : sql``;
			this.config.onConflict.push(sql` on conflict ${targetSql} do nothing${whereSql}`);
		}
		return this;
	}
	/**
	* Adds an `on conflict do update` clause to the query.
	*
	* Calling this method will update the existing row that conflicts with the row proposed for insertion as its alternative action.
	*
	* See docs: {@link https://orm.drizzle.team/docs/insert#upserts-and-conflicts}
	*
	* @param config The `target`, `set` and `where` clauses.
	*
	* @example
	* ```ts
	* // Update the row if there's a conflict
	* await db.insert(cars)
	*   .values({ id: 1, brand: 'BMW' })
	*   .onConflictDoUpdate({
	*     target: cars.id,
	*     set: { brand: 'Porsche' }
	*   });
	*
	* // Upsert with 'where' clause
	* await db.insert(cars)
	*   .values({ id: 1, brand: 'BMW' })
	*   .onConflictDoUpdate({
	*     target: cars.id,
	*     set: { brand: 'newBMW' },
	*     where: sql`${cars.createdAt} > '2023-01-01'::date`,
	*   });
	* ```
	*/
	onConflictDoUpdate(config) {
		if (config.where && (config.targetWhere || config.setWhere)) throw new Error("You cannot use both \"where\" and \"targetWhere\"/\"setWhere\" at the same time - \"where\" is deprecated, use \"targetWhere\" or \"setWhere\" instead.");
		if (!this.config.onConflict) this.config.onConflict = [];
		const whereSql = config.where ? sql` where ${config.where}` : void 0;
		const targetWhereSql = config.targetWhere ? sql` where ${config.targetWhere}` : void 0;
		const setWhereSql = config.setWhere ? sql` where ${config.setWhere}` : void 0;
		const targetSql = Array.isArray(config.target) ? sql`${config.target}` : sql`${[config.target]}`;
		const setSql = this.dialect.buildUpdateSet(this.config.table, mapUpdateSet(this.config.table, config.set));
		this.config.onConflict.push(sql` on conflict ${targetSql}${targetWhereSql} do update set ${setSql}${whereSql}${setWhereSql}`);
		return this;
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
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/async/insert.js
var SQLiteAsyncInsertBase = class extends SQLiteInsertBase {
	static [entityKind] = "SQLiteAsyncInsert";
	/** @internal */
	_prepare(prepare = false) {
		return this.session.prepareQuery(this.dialect.sqlToQuery(this.getSQL()), "arrays", prepare, this.config.returning ? "all" : "run", this.config.returning ? this.dialect.mapperGenerators.rows(this.config.returning, void 0) : void 0, {
			type: "insert",
			tables: extractUsedTable(this.config.table)
		});
	}
	prepare() {
		return this._prepare(true);
	}
	run = (placeholderValues) => {
		return this._prepare().run(placeholderValues);
	};
	all = (placeholderValues) => {
		return this._prepare().all(placeholderValues);
	};
	get = (placeholderValues) => {
		return this._prepare().get(placeholderValues);
	};
	values = (placeholderValues) => {
		return this._prepare().values(placeholderValues);
	};
	async execute() {
		return this._prepare().execute();
	}
};
applyMixins(SQLiteAsyncInsertBase, [QueryPromise]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/query-builders/raw.js
var SQLiteRaw = class {
	static [entityKind] = "SQLiteRaw";
	constructor(prepared, sql, query) {
		this.prepared = prepared;
		this.sql = sql;
		this.query = query;
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
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/async/raw.js
var SQLiteAsyncRaw = class extends SQLiteRaw {
	static [entityKind] = "SQLiteAsyncRaw";
	constructor(prepared, sql, query) {
		super(prepared, sql, query);
	}
	execute(placeholderValues) {
		return this.prepared.execute(placeholderValues);
	}
};
applyMixins(SQLiteAsyncRaw, [QueryPromise]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/async/select.js
var SQLiteAsyncSelectBase = class extends SQLiteSelectBase {
	static [entityKind] = "SQLiteAsyncSelect";
	/** @internal */
	_prepare(prepare = false) {
		const query = this.dialect.sqlToQuery(this.getSQL());
		const fieldsList = this.config.fieldsFlat;
		const mapper = this.dialect.mapperGenerators.rows(fieldsList, this.joinsNotNullableMap);
		return this.session.prepareQuery(query, "arrays", prepare, "all", mapper, {
			type: "select",
			tables: [...this.usedTables]
		}, this.cacheConfig);
	}
	prepare() {
		return this._prepare(true);
	}
	run = (placeholderValues) => {
		return this._prepare().run(placeholderValues);
	};
	all = (placeholderValues) => {
		return this._prepare().all(placeholderValues);
	};
	get = (placeholderValues) => {
		return this._prepare().get(placeholderValues);
	};
	values = (placeholderValues) => {
		return this._prepare().values(placeholderValues);
	};
	async execute() {
		return this._prepare().execute();
	}
};
applyMixins(SQLiteAsyncSelectBase, [QueryPromise]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/query-builders/update.js
var SQLiteUpdateBuilder = class {
	static [entityKind] = "SQLiteUpdateBuilder";
	constructor(table, session, dialect, withList, builder = SQLiteUpdateBase) {
		this.table = table;
		this.session = session;
		this.dialect = dialect;
		this.withList = withList;
		this.builder = builder;
	}
	set(values) {
		return new this.builder(this.table, mapUpdateSet(this.table, values), this.session, this.dialect, this.withList);
	}
};
var SQLiteUpdateBase = class {
	static [entityKind] = "SQLiteUpdate";
	/** @internal */
	config;
	constructor(table, set, session, dialect, withList) {
		this.session = session;
		this.dialect = dialect;
		this.config = {
			set,
			table,
			withList,
			joins: []
		};
	}
	from(source) {
		this.config.from = source;
		return this;
	}
	createJoin(joinType) {
		return ((table, on) => {
			const tableName = getTableLikeName(table);
			if (typeof tableName === "string" && this.config.joins.some((join) => join.alias === tableName)) throw new Error(`Alias "${tableName}" is already used in this query`);
			if (typeof on === "function") {
				const from = this.config.from ? is(table, SQLiteTable) ? table[Table.Symbol.Columns] : is(table, Subquery) ? table._.selectedFields : is(table, SQLiteViewBase) ? table[ViewBaseConfig].selectedFields : void 0 : void 0;
				on = on(new Proxy(this.config.table[Table.Symbol.Columns], new SelectionProxyHandler({
					sqlAliasedBehavior: "sql",
					sqlBehavior: "sql"
				})), from && new Proxy(from, new SelectionProxyHandler({
					sqlAliasedBehavior: "sql",
					sqlBehavior: "sql"
				})));
			}
			this.config.joins.push({
				on,
				table,
				joinType,
				alias: tableName
			});
			return this;
		});
	}
	leftJoin = this.createJoin("left");
	rightJoin = this.createJoin("right");
	innerJoin = this.createJoin("inner");
	fullJoin = this.createJoin("full");
	/**
	* Adds a 'where' clause to the query.
	*
	* Calling this method will update only those rows that fulfill a specified condition.
	*
	* See docs: {@link https://orm.drizzle.team/docs/update}
	*
	* @param where the 'where' clause.
	*
	* @example
	* You can use conditional operators and `sql function` to filter the rows to be updated.
	*
	* ```ts
	* // Update all cars with green color
	* db.update(cars).set({ color: 'red' })
	*   .where(eq(cars.color, 'green'));
	* // or
	* db.update(cars).set({ color: 'red' })
	*   .where(sql`${cars.color} = 'green'`)
	* ```
	*
	* You can logically combine conditional operators with `and()` and `or()` operators:
	*
	* ```ts
	* // Update all BMW cars with a green color
	* db.update(cars).set({ color: 'red' })
	*   .where(and(eq(cars.color, 'green'), eq(cars.brand, 'BMW')));
	*
	* // Update all cars with the green or blue color
	* db.update(cars).set({ color: 'red' })
	*   .where(or(eq(cars.color, 'green'), eq(cars.color, 'blue')));
	* ```
	*/
	where(where) {
		this.config.where = where;
		return this;
	}
	orderBy(...columns) {
		if (typeof columns[0] === "function") {
			const orderBy = columns[0](new Proxy(this.config.table[Table.Symbol.Columns], new SelectionProxyHandler({
				sqlAliasedBehavior: "alias",
				sqlBehavior: "sql"
			})));
			const orderByArray = Array.isArray(orderBy) ? orderBy : [orderBy];
			this.config.orderBy = orderByArray;
		} else {
			const orderByArray = columns;
			this.config.orderBy = orderByArray;
		}
		return this;
	}
	limit(limit) {
		this.config.limit = limit;
		return this;
	}
	returning(fields = this.config.table[SQLiteTable.Symbol.Columns]) {
		this.config.returning = orderSelectedFields(fields);
		return this;
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
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/async/update.js
var SQLiteAsyncUpdateBase = class extends SQLiteUpdateBase {
	static [entityKind] = "SQLiteAsyncUpdate";
	/** @internal */
	_prepare(prepare = false) {
		return this.session.prepareQuery(this.dialect.sqlToQuery(this.getSQL()), "arrays", prepare, this.config.returning ? "all" : "run", this.config.returning ? this.dialect.mapperGenerators.rows(this.config.returning, void 0) : void 0, {
			type: "update",
			tables: extractUsedTable(this.config.table)
		});
	}
	prepare() {
		return this._prepare(true);
	}
	run = (placeholderValues) => {
		return this._prepare().run(placeholderValues);
	};
	all = (placeholderValues) => {
		return this._prepare().all(placeholderValues);
	};
	get = (placeholderValues) => {
		return this._prepare().get(placeholderValues);
	};
	values = (placeholderValues) => {
		return this._prepare().values(placeholderValues);
	};
	async execute() {
		return this.config.returning ? this.all() : this.run();
	}
};
applyMixins(SQLiteAsyncUpdateBase, [QueryPromise]);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/async/db.js
var SQLiteAsyncDatabase = class {
	static [entityKind] = "BaseSQLiteDatabase";
	query;
	constructor(resultKind, dialect, session, relations, forbidJsonb) {
		this.resultKind = resultKind;
		this.dialect = dialect;
		this.session = session;
		this.forbidJsonb = forbidJsonb;
		this._ = {
			relations,
			session,
			resultKind
		};
		this.query = {};
		for (const [tableName, relation] of Object.entries(relations)) this.query[tableName] = new RelationalQueryBuilder(resultKind, relations, relations[relation.name].table, relation, dialect, session, forbidJsonb, resultKind === "sync" ? SQLiteSyncRelationalQuery : SQLiteAsyncRelationalQuery);
		this.$cache = { invalidate: async (_params) => {} };
	}
	/**
	* Creates a subquery that defines a temporary named result set as a CTE.
	*
	* It is useful for breaking down complex queries into simpler parts and for reusing the result set in subsequent parts of the query.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#with-clause}
	*
	* @param alias The alias for the subquery.
	*
	* Failure to provide an alias will result in a DrizzleTypeError, preventing the subquery from being referenced in other queries.
	*
	* @example
	*
	* ```ts
	* // Create a subquery with alias 'sq' and use it in the select query
	* const sq = db.$with('sq').as(db.select().from(users).where(eq(users.id, 42)));
	*
	* const result = await db.with(sq).select().from(sq);
	* ```
	*
	* To select arbitrary SQL values as fields in a CTE and reference them in other CTEs or in the main query, you need to add aliases to them:
	*
	* ```ts
	* // Select an arbitrary SQL value as a field in a CTE and reference it in the main query
	* const sq = db.$with('sq').as(db.select({
	*   name: sql<string>`upper(${users.name})`.as('name'),
	* })
	* .from(users));
	*
	* const result = await db.with(sq).select({ name: sq.name }).from(sq);
	* ```
	*/
	$with = (alias, selection) => {
		const self = this;
		const as = (qb) => {
			if (typeof qb === "function") qb = qb(new QueryBuilder(self.dialect));
			return new Proxy(new WithSubquery(qb.getSQL(), selection ?? ("getSelectedFields" in qb ? qb.getSelectedFields() ?? {} : {}), alias, true), new SelectionProxyHandler({
				alias,
				sqlAliasedBehavior: "alias",
				sqlBehavior: "error"
			}));
		};
		return { as };
	};
	$count(source, filters) {
		return this.resultKind === "async" ? new SQLiteAsyncCountBuilder({
			source,
			filters,
			session: this.session,
			dialect: this.dialect
		}) : new SQLiteSyncCountBuilder({
			source,
			filters,
			session: this.session,
			dialect: this.dialect
		});
	}
	/**
	* Incorporates a previously defined CTE (using `$with`) into the main query.
	*
	* This method allows the main query to reference a temporary named result set.
	*
	* See docs: {@link https://orm.drizzle.team/docs/select#with-clause}
	*
	* @param queries The CTEs to incorporate into the main query.
	*
	* @example
	*
	* ```ts
	* // Define a subquery 'sq' as a CTE using $with
	* const sq = db.$with('sq').as(db.select().from(users).where(eq(users.id, 42)));
	*
	* // Incorporate the CTE 'sq' into the main query and select from it
	* const result = await db.with(sq).select().from(sq);
	* ```
	*/
	with(...queries) {
		const self = this;
		function select(fields) {
			return new SQLiteSelectBuilder({
				fields: fields ?? void 0,
				session: self.session,
				dialect: self.dialect,
				withList: queries
			}, SQLiteAsyncSelectBase);
		}
		function selectDistinct(fields) {
			return new SQLiteSelectBuilder({
				fields: fields ?? void 0,
				session: self.session,
				dialect: self.dialect,
				withList: queries,
				distinct: true
			}, SQLiteAsyncSelectBase);
		}
		/**
		* Creates an update query.
		*
		* Calling this method without `.where()` clause will update all rows in a table. The `.where()` clause specifies which rows should be updated.
		*
		* Use `.set()` method to specify which values to update.
		*
		* See docs: {@link https://orm.drizzle.team/docs/update}
		*
		* @param table The table to update.
		*
		* @example
		*
		* ```ts
		* // Update all rows in the 'cars' table
		* await db.update(cars).set({ color: 'red' });
		*
		* // Update rows with filters and conditions
		* await db.update(cars).set({ color: 'red' }).where(eq(cars.brand, 'BMW'));
		*
		* // Update with returning clause
		* const updatedCar: Car[] = await db.update(cars)
		*   .set({ color: 'red' })
		*   .where(eq(cars.id, 1))
		*   .returning();
		* ```
		*/
		function update(table) {
			return new SQLiteUpdateBuilder(table, self.session, self.dialect, queries, SQLiteAsyncUpdateBase);
		}
		/**
		* Creates an insert query.
		*
		* Calling this method will create new rows in a table. Use `.values()` method to specify which values to insert.
		*
		* See docs: {@link https://orm.drizzle.team/docs/insert}
		*
		* @param table The table to insert into.
		*
		* @example
		*
		* ```ts
		* // Insert one row
		* await db.insert(cars).values({ brand: 'BMW' });
		*
		* // Insert multiple rows
		* await db.insert(cars).values([{ brand: 'BMW' }, { brand: 'Porsche' }]);
		*
		* // Insert with returning clause
		* const insertedCar: Car[] = await db.insert(cars)
		*   .values({ brand: 'BMW' })
		*   .returning();
		* ```
		*/
		function insert(into) {
			return new SQLiteInsertBuilder(into, self.session, self.dialect, queries, SQLiteAsyncInsertBase);
		}
		/**
		* Creates a delete query.
		*
		* Calling this method without `.where()` clause will delete all rows in a table. The `.where()` clause specifies which rows should be deleted.
		*
		* See docs: {@link https://orm.drizzle.team/docs/delete}
		*
		* @param table The table to delete from.
		*
		* @example
		*
		* ```ts
		* // Delete all rows in the 'cars' table
		* await db.delete(cars);
		*
		* // Delete rows with filters and conditions
		* await db.delete(cars).where(eq(cars.color, 'green'));
		*
		* // Delete with returning clause
		* const deletedCar: Car[] = await db.delete(cars)
		*   .where(eq(cars.id, 1))
		*   .returning();
		* ```
		*/
		function delete_(from) {
			return new SQLiteAsyncDeleteBase(from, self.session, self.dialect, queries);
		}
		return {
			select,
			selectDistinct,
			update,
			insert,
			delete: delete_
		};
	}
	select(fields) {
		return new SQLiteSelectBuilder({
			fields: fields ?? void 0,
			session: this.session,
			dialect: this.dialect
		}, SQLiteAsyncSelectBase);
	}
	selectDistinct(fields) {
		return new SQLiteSelectBuilder({
			fields: fields ?? void 0,
			session: this.session,
			dialect: this.dialect,
			distinct: true
		}, SQLiteAsyncSelectBase);
	}
	/**
	* Creates an update query.
	*
	* Calling this method without `.where()` clause will update all rows in a table. The `.where()` clause specifies which rows should be updated.
	*
	* Use `.set()` method to specify which values to update.
	*
	* See docs: {@link https://orm.drizzle.team/docs/update}
	*
	* @param table The table to update.
	*
	* @example
	*
	* ```ts
	* // Update all rows in the 'cars' table
	* await db.update(cars).set({ color: 'red' });
	*
	* // Update rows with filters and conditions
	* await db.update(cars).set({ color: 'red' }).where(eq(cars.brand, 'BMW'));
	*
	* // Update with returning clause
	* const updatedCar: Car[] = await db.update(cars)
	*   .set({ color: 'red' })
	*   .where(eq(cars.id, 1))
	*   .returning();
	* ```
	*/
	update(table) {
		return new SQLiteUpdateBuilder(table, this.session, this.dialect, void 0, SQLiteAsyncUpdateBase);
	}
	$cache;
	/**
	* Creates an insert query.
	*
	* Calling this method will create new rows in a table. Use `.values()` method to specify which values to insert.
	*
	* See docs: {@link https://orm.drizzle.team/docs/insert}
	*
	* @param table The table to insert into.
	*
	* @example
	*
	* ```ts
	* // Insert one row
	* await db.insert(cars).values({ brand: 'BMW' });
	*
	* // Insert multiple rows
	* await db.insert(cars).values([{ brand: 'BMW' }, { brand: 'Porsche' }]);
	*
	* // Insert with returning clause
	* const insertedCar: Car[] = await db.insert(cars)
	*   .values({ brand: 'BMW' })
	*   .returning();
	* ```
	*/
	insert(into) {
		return new SQLiteInsertBuilder(into, this.session, this.dialect, void 0, SQLiteAsyncInsertBase);
	}
	/**
	* Creates a delete query.
	*
	* Calling this method without `.where()` clause will delete all rows in a table. The `.where()` clause specifies which rows should be deleted.
	*
	* See docs: {@link https://orm.drizzle.team/docs/delete}
	*
	* @param table The table to delete from.
	*
	* @example
	*
	* ```ts
	* // Delete all rows in the 'cars' table
	* await db.delete(cars);
	*
	* // Delete rows with filters and conditions
	* await db.delete(cars).where(eq(cars.color, 'green'));
	*
	* // Delete with returning clause
	* const deletedCar: Car[] = await db.delete(cars)
	*   .where(eq(cars.id, 1))
	*   .returning();
	* ```
	*/
	delete(from) {
		return new SQLiteAsyncDeleteBase(from, this.session, this.dialect);
	}
	run(query) {
		const sequel = typeof query === "string" ? sql.raw(query) : query.getSQL();
		const builtQuery = this.dialect.sqlToQuery(sequel);
		const prepared = this.session.prepareQuery(builtQuery, "raw", false, "run");
		if (this.resultKind === "async") return new SQLiteAsyncRaw(prepared, sequel, builtQuery);
		return this.session.run(sequel);
	}
	all(query) {
		const sequel = typeof query === "string" ? sql.raw(query) : query.getSQL();
		const builtQuery = this.dialect.sqlToQuery(sequel);
		const prepared = this.session.prepareQuery(builtQuery, "objects", false, "all");
		if (this.resultKind === "async") return new SQLiteAsyncRaw(prepared, sequel, builtQuery);
		return this.session.objects(sequel);
	}
	get(query) {
		const sequel = typeof query === "string" ? sql.raw(query) : query.getSQL();
		const builtQuery = this.dialect.sqlToQuery(sequel);
		const prepared = this.session.prepareQuery(builtQuery, "objects", false, "get");
		if (this.resultKind === "async") return new SQLiteAsyncRaw(prepared, sequel, builtQuery);
		return this.session.object(sequel);
	}
	values(query) {
		const sequel = typeof query === "string" ? sql.raw(query) : query.getSQL();
		const builtQuery = this.dialect.sqlToQuery(sequel);
		const prepared = this.session.prepareQuery(builtQuery, "objects", false, "values");
		if (this.resultKind === "async") return new SQLiteAsyncRaw(prepared, sequel, builtQuery);
		return this.session.arrays(sequel);
	}
	transaction(transaction, config) {
		return this.session.transaction(transaction, config);
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/migrator.utils.js
function formatToMillis(dateStr) {
	const year = parseInt(dateStr.slice(0, 4), 10);
	const month = parseInt(dateStr.slice(4, 6), 10) - 1;
	const day = parseInt(dateStr.slice(6, 8), 10);
	const hour = parseInt(dateStr.slice(8, 10), 10);
	const minute = parseInt(dateStr.slice(10, 12), 10);
	const second = parseInt(dateStr.slice(12, 14), 10);
	return Date.UTC(year, month, day, hour, minute, second);
}
function getMigrationsToRun(params) {
	const { localMigrations, dbMigrations } = params;
	const dbNamesSet = new Set(dbMigrations.map((m) => m.name).filter((n) => n !== null));
	return localMigrations.filter((lm) => !lm.name || !dbNamesSet.has(lm.name));
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/up-migrations/utils.js
var MIGRATIONS_TABLE_VERSIONS = {
	sqlite: 1,
	pg: 1,
	effect: 1,
	mysql: 1,
	mssql: 1,
	cockroach: 1,
	singlestore: 1
};
var GET_VERSION_FOR = {
	mysql: (columns) => {
		if (columns.includes("name")) return 1;
		return 0;
	},
	pg: (columns) => {
		if (columns.includes("name")) return 1;
		return 0;
	},
	effect: (columns) => {
		if (columns.includes("name")) return 1;
		return 0;
	},
	mssql: (columns) => {
		if (columns.includes("name")) return 1;
		return 0;
	},
	cockroach: (columns) => {
		if (columns.includes("name")) return 1;
		return 0;
	},
	singlestore: (columns) => {
		if (columns.includes("name")) return 1;
		return 0;
	},
	sqlite: (columns) => {
		if (columns.includes("name")) return 1;
		return 0;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/up-migrations/sqlite.js
/**
* Detects the current version of the migrations table schema and upgrades it if needed.
*
* Version 0: Original schema (id, hash, created_at)
* Version 1: Extended schema (id, hash, created_at, name, applied_at)
*/
async function upgradeAsyncIfNeeded(migrationsTable, db, localMigrations) {
	if ((await db.session.objects(sql`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ${migrationsTable}`)).length === 0) return { newDb: true };
	const rows = await db.session.objects(sql`SELECT name as column_name FROM pragma_table_info(${migrationsTable})`);
	const version = GET_VERSION_FOR.sqlite(rows.map((r) => r.column_name));
	for (let v = version; v < MIGRATIONS_TABLE_VERSIONS.sqlite; v++) {
		const upgradeFn = upgradeAsyncFunctions[v];
		if (!upgradeFn) throw new Error(`No upgrade path from migration table version ${v} to ${v + 1}`);
		await upgradeFn(migrationsTable, db, localMigrations);
	}
	return { newDb: false };
}
var upgradeAsyncFunctions = { 0: async (migrationsTable, db, localMigrations) => {
	const table = sql`${sql.identifier(migrationsTable)}`;
	const dbRows = await db.session.objects(sql`SELECT id, hash, created_at FROM ${table} ORDER BY id ASC`);
	localMigrations.sort((a, b) => a.folderMillis !== b.folderMillis ? a.folderMillis - b.folderMillis : (a.name ?? "").localeCompare(b.name ?? ""));
	const byMillis = /* @__PURE__ */ new Map();
	const byHash = /* @__PURE__ */ new Map();
	for (const lm of localMigrations) {
		if (!byMillis.has(lm.folderMillis)) byMillis.set(lm.folderMillis, []);
		byMillis.get(lm.folderMillis).push(lm);
		byHash.set(lm.hash, lm);
	}
	const toApply = [];
	let unmatched = [];
	for (const dbRow of dbRows) {
		const stringified = String(dbRow.created_at);
		const millis = Number(stringified.substring(0, stringified.length - 3) + "000");
		const candidates = byMillis.get(millis);
		let matched;
		let matchedBy = null;
		if (candidates && candidates.length === 1) {
			matched = candidates[0];
			matchedBy = "millis";
		} else if (candidates && candidates.length > 1) {
			matched = candidates.find((c) => c.hash && dbRow.hash && c.hash === dbRow.hash);
			if (matched) matchedBy = "hash";
		} else {
			matched = byHash.get(dbRow.hash);
			if (matched) matchedBy = "hash";
		}
		if (matched) toApply.push({
			id: dbRow.id,
			name: matched.name,
			hash: dbRow.hash,
			created_at: stringified,
			matchedBy: dbRow.id ? "id" : matchedBy
		});
		else unmatched.push(dbRow);
	}
	if (unmatched.length > 0) throw Error(`While upgrading your database migrations table we found ${unmatched.length} (${unmatched.map((it) => `[id: ${it.id}, created_at: ${it.created_at}]`).join(", ")}) migrations in the database that do not match any local migration. This means that some migrations were applied to the database but are missing from the local environment`);
	const statements = [sql`ALTER TABLE ${table} ADD COLUMN ${sql.identifier("name")} text`, sql`ALTER TABLE ${table} ADD COLUMN ${sql.identifier("applied_at")} TEXT`];
	for (const backfillEntry of toApply) {
		const updateQuery = sql`UPDATE ${table} SET ${sql.identifier("name")} = ${backfillEntry.name}, ${sql.identifier("applied_at")} = NULL WHERE`;
		if (backfillEntry.id) updateQuery.append(sql` ${sql.identifier("id")} = ${backfillEntry.id}`);
		else if (backfillEntry.matchedBy === "millis") updateQuery.append(sql` ${sql.identifier("created_at")} = ${backfillEntry.created_at}`);
		else updateQuery.append(sql` ${sql.identifier("hash")} = ${backfillEntry.hash}`);
		statements.push(updateQuery);
	}
	await db.transaction(async (tx) => {
		for (const statement of statements) await tx.run(statement);
	});
} };
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/cache/core/cache.js
var Cache = class {
	static [entityKind] = "Cache";
};
var NoopCache = class extends Cache {
	static [entityKind] = "NoopCache";
	strategy() {
		return "all";
	}
	async get(_key) {}
	async put(_hashedQuery, _response, _tables, _config) {}
	async onMutate(_params) {}
};
var strategyFor = async (query, params, queryMetadata, withCacheConfig) => {
	if (!queryMetadata) return { type: "skip" };
	const { type, tables } = queryMetadata;
	if ((type === "insert" || type === "update" || type === "delete") && tables.length > 0) return {
		type: "invalidate",
		tables
	};
	if (!withCacheConfig) return { type: "skip" };
	if (!withCacheConfig.enabled) return { type: "skip" };
	if (type === "select") return {
		type: "try",
		key: withCacheConfig.tag ?? await hashQuery(query, params),
		isTag: typeof withCacheConfig.tag !== "undefined",
		autoInvalidate: withCacheConfig.autoInvalidate,
		tables: queryMetadata.tables,
		config: withCacheConfig.config
	};
	return { type: "skip" };
};
async function hashQuery(sql, params) {
	const dataToHash = `${sql}-${JSON.stringify(params, (_, v) => typeof v === "bigint" ? `${v}n` : v)}`;
	const data = new TextEncoder().encode(dataToHash);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	return [...new Uint8Array(hashBuffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/session.js
var SQLitePreparedQuery = class {
	static [entityKind] = "SQLiteBasePreparedQuery";
	/** @internal */
	mapper;
	/** @internal */
	executeMethod;
	constructor(executeMethod, query, mapper, mode) {
		this.query = query;
		this.mode = mode;
		this.mapper = mapper;
		this.executeMethod = executeMethod;
	}
	getQuery() {
		return this.query;
	}
};
var SQLiteSession = class {
	static [entityKind] = "SQLiteSession";
	constructor(dialect) {
		this.dialect = dialect;
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/sqlite-core/async/session.js
var ExecuteResultSync = class extends QueryPromise {
	static [entityKind] = "ExecuteResultSync";
	constructor(resultCb) {
		super();
		this.resultCb = resultCb;
	}
	async execute() {
		return this.resultCb();
	}
	sync() {
		return this.resultCb();
	}
};
var SQLiteAsyncPreparedQuery = class extends SQLitePreparedQuery {
	static [entityKind] = "SQLiteAsyncPreparedQuery";
	fastPath;
	constructor(resultKind, executeMethod = "all", executors, query, mapper, mode, logger, cache, queryMetadata, cacheConfig) {
		super(executeMethod, query, mapper, mode);
		this.resultKind = resultKind;
		this.executors = executors;
		this.logger = logger;
		this.cache = cache;
		this.queryMetadata = queryMetadata;
		this.cacheConfig = cacheConfig;
		if (cache && cache.strategy() === "all" && cacheConfig === void 0) this.cacheConfig = {
			enabled: true,
			autoInvalidate: true
		};
		if (!this.cacheConfig?.enabled) this.cacheConfig = void 0;
		this.fastPath = cacheConfig === void 0 && (cache === void 0 || is(cache, NoopCache));
	}
	/** @internal */
	async queryWithCache(queryString, params, executeMethod, query) {
		const cacheStrat = this.cache !== void 0 && !is(this.cache, NoopCache) ? await strategyFor(queryString, params, this.queryMetadata, this.cacheConfig) : { type: "skip" };
		if (cacheStrat.type === "skip") return query().catch((e) => {
			throw new DrizzleQueryError(queryString, params, e);
		});
		const cache = this.cache;
		if (cacheStrat.type === "invalidate") return Promise.all([query(), cache.onMutate({ tables: cacheStrat.tables })]).then((res) => res[0]).catch((e) => {
			throw new DrizzleQueryError(queryString, params, e);
		});
		if (cacheStrat.type === "try") {
			const { tables, key: _key, isTag, autoInvalidate, config } = cacheStrat;
			const key = `${executeMethod}_${_key}`;
			const fromCache = await cache.get(key, tables, isTag, autoInvalidate);
			if (fromCache === void 0) {
				const result = await query().catch((e) => {
					throw new DrizzleQueryError(queryString, params, e);
				});
				await cache.put(key, result, autoInvalidate ? tables : [], isTag, config);
				return result;
			}
			return fromCache;
		}
		assertUnreachable(cacheStrat);
	}
	run(placeholderValues = {}) {
		const { query, logger, executors, fastPath, resultKind } = this;
		const sql = query._sql ? query._sql.join(" ") : query.sql;
		const params = query.params.length === 0 ? query.params : fillPlaceholders(query.params, placeholderValues);
		logger.logQuery(sql, params);
		if (resultKind === "sync") try {
			return executors.run(params);
		} catch (e) {
			throw new DrizzleQueryError(sql, params, e);
		}
		return fastPath ? executors.run(params).catch((e) => {
			throw new DrizzleQueryError(sql, params, e);
		}) : this.queryWithCache(sql, params, "run", () => executors.run(params));
	}
	all(placeholderValues = {}) {
		const { query, logger, executors, mapper, fastPath, resultKind } = this;
		const sql = query._sql ? query._sql.join(" ") : query.sql;
		const params = query.params.length === 0 ? query.params : fillPlaceholders(query.params, placeholderValues);
		logger.logQuery(sql, params);
		if (resultKind === "sync") {
			let res;
			try {
				res = executors.all(params);
			} catch (e) {
				throw new DrizzleQueryError(sql, params, e);
			}
			if (!mapper) return res;
			return mapper(res);
		}
		const res = fastPath ? executors.all(params).catch((e) => {
			throw new DrizzleQueryError(sql, params, e);
		}) : this.queryWithCache(sql, params, "all", () => executors.all(params));
		if (!mapper) return res;
		return res.then((rows) => mapper(rows));
	}
	get(placeholderValues = {}) {
		const { query, logger, executors, mapper, fastPath, resultKind } = this;
		const sql = query._sql ? query._sql.join(" ") : query.sql;
		const params = query.params.length === 0 ? query.params : fillPlaceholders(query.params, placeholderValues);
		logger.logQuery(sql, params);
		if (resultKind === "sync") {
			let res;
			try {
				res = executors.get(params);
			} catch (e) {
				throw new DrizzleQueryError(sql, params, e);
			}
			if (!res) return void 0;
			if (!mapper) return res;
			return mapper([res])[0];
		}
		const res = fastPath ? executors.get(params).catch((e) => {
			throw new DrizzleQueryError(sql, params, e);
		}) : this.queryWithCache(sql, params, "get", () => executors.get(params));
		if (!mapper) return res.then((row) => row ? row : void 0);
		return res.then((row) => row ? mapper([row])[0] : void 0);
	}
	values(placeholderValues = {}) {
		const { query, logger, executors, fastPath, resultKind } = this;
		const sql = query._sql ? query._sql.join(" ") : query.sql;
		const params = query.params.length === 0 ? query.params : fillPlaceholders(query.params, placeholderValues);
		logger.logQuery(sql, params);
		if (resultKind === "sync") try {
			return executors.values(params);
		} catch (e) {
			throw new DrizzleQueryError(sql, params, e);
		}
		return fastPath ? executors.values(params).catch((e) => {
			throw new DrizzleQueryError(sql, params, e);
		}) : this.queryWithCache(sql, params, "values", () => executors.values(params));
	}
	execute(placeholderValues) {
		if (this.resultKind === "async") return this[this.executeMethod](placeholderValues);
		return new ExecuteResultSync(() => this[this.executeMethod](placeholderValues));
	}
};
var SQLiteAsyncSession = class extends SQLiteSession {
	static [entityKind] = "SQLiteAsyncSession";
	constructor(dialect, resultKind) {
		super(dialect);
		this.resultKind = resultKind;
	}
	run(query) {
		return this.prepareQuery(this.dialect.sqlToQuery(query), "raw", false).run();
	}
	objects(query) {
		return this.prepareQuery(this.dialect.sqlToQuery(query), "objects", false).all();
	}
	object(query) {
		return this.prepareQuery(this.dialect.sqlToQuery(query), "objects", false).get();
	}
	arrays(query) {
		return this.prepareQuery(this.dialect.sqlToQuery(query), "arrays", false).all();
	}
	array(query) {
		return this.prepareQuery(this.dialect.sqlToQuery(query), "arrays", false).get();
	}
};
var SQLiteAsyncTransaction = class extends SQLiteAsyncDatabase {
	static [entityKind] = "SQLiteAsyncTransaction";
	constructor(resultType, dialect, session, relations, nestedIndex = 0, forbidJsonb) {
		super(resultType, dialect, session, relations, forbidJsonb);
		this.nestedIndex = nestedIndex;
	}
	rollback() {
		throw new TransactionRollbackError();
	}
};
async function migrateAsync(migrations, db, config) {
	const migrationsTable = config === void 0 ? "__drizzle_migrations" : typeof config === "string" ? "__drizzle_migrations" : config.migrationsTable ?? "__drizzle_migrations";
	const { newDb } = await upgradeAsyncIfNeeded(migrationsTable, db, migrations);
	if (newDb) {
		const migrationTableCreate = sql`
			CREATE TABLE IF NOT EXISTS ${sql.identifier(migrationsTable)} (
				id INTEGER PRIMARY KEY,
				hash text NOT NULL,
				created_at numeric,
				name text,
				applied_at TEXT
			)
		`;
		await db.session.run(migrationTableCreate);
	}
	const dbMigrations = await db.session.objects(sql`SELECT id, hash, created_at, name FROM ${sql.identifier(migrationsTable)};`);
	if (typeof config === "object" && config.init) {
		if (dbMigrations.length) return { exitCode: "databaseMigrations" };
		if (migrations.length > 1) return { exitCode: "localMigrations" };
		const [migration] = migrations;
		if (!migration) return;
		await db.session.run(sql`insert into ${sql.identifier(migrationsTable)} ("hash", "created_at", "name", "applied_at") values(${migration.hash}, ${migration.folderMillis}, ${migration.name}, ${(/* @__PURE__ */ new Date()).toISOString()})`);
		return;
	}
	const migrationsToRun = getMigrationsToRun({
		localMigrations: migrations,
		dbMigrations
	});
	await db.session.transaction(async (tx) => {
		for (const migration of migrationsToRun) {
			for (const stmt of migration.sql) await tx.run(sql.raw(stmt));
			await tx.run(sql`insert into ${sql.identifier(migrationsTable)} ("hash", "created_at", "name", "applied_at") values(${migration.hash}, ${migration.folderMillis}, ${migration.name}, ${(/* @__PURE__ */ new Date()).toISOString()})`);
		}
	});
}
//#endregion
//#region ../../node_modules/.bun/nanoid@5.1.16/node_modules/nanoid/url-alphabet/index.js
var urlAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
//#endregion
//#region ../../node_modules/.bun/nanoid@5.1.16/node_modules/nanoid/index.js
var POOL_SIZE_MULTIPLIER = 128;
var pool, poolOffset;
function fillPool(bytes) {
	if (bytes < 0) throw new RangeError("Wrong ID size");
	try {
		if (!pool || pool.length < bytes) {
			pool = Buffer.allocUnsafe(bytes * POOL_SIZE_MULTIPLIER);
			webcrypto.getRandomValues(pool);
			poolOffset = 0;
		} else if (poolOffset + bytes > pool.length) {
			webcrypto.getRandomValues(pool);
			poolOffset = 0;
		}
	} catch (e) {
		pool = void 0;
		throw e;
	}
	poolOffset += bytes;
}
function nanoid(size = 21) {
	fillPool(size |= 0);
	let id = "";
	for (let i = poolOffset - size; i < poolOffset; i++) id += urlAlphabet[pool[i] & 63];
	return id;
}
//#endregion
//#region ../../packages/db/src/schema.ts
var schema_exports = /* @__PURE__ */ __exportAll({
	batches: () => batches,
	categories: () => categories,
	invoiceItems: () => invoiceItems,
	invoices: () => invoices,
	products: () => products,
	stockMovements: () => stockMovements
});
var timestamps = {
	createdAt: integer().notNull(),
	updatedAt: integer().notNull(),
	deletedAt: integer()
};
var primaryId = text().primaryKey().$defaultFn(() => nanoid());
var categories = sqliteTable("categories", {
	id: primaryId,
	name: text().notNull(),
	...timestamps
}, (table) => [uniqueIndex("categories_name_idx").on(table.name)]);
var products = sqliteTable("products", {
	id: primaryId,
	name: text().notNull(),
	categoryId: text().notNull().default("general").references(() => categories.id),
	aisle: text(),
	composition: text(),
	strength: text(),
	unitsPerPack: integer().notNull().default(1),
	packPrice: integer(),
	unitPrice: integer(),
	visible: integer({ mode: "boolean" }).notNull().default(true),
	...timestamps
}, (table) => [index("products_category_id_idx").on(table.categoryId)]);
var batches = sqliteTable("batches", {
	id: primaryId,
	productId: text().notNull().references(() => products.id),
	batchNumber: text(),
	expiresAt: integer(),
	packQuantity: integer().notNull().default(0),
	unitQuantity: integer().notNull().default(0),
	...timestamps
}, (table) => [index("batches_product_id_idx").on(table.productId)]);
var invoices = sqliteTable("invoices", {
	id: primaryId,
	invoiceNumber: text().notNull(),
	customerName: text(),
	total: integer().notNull().default(0),
	organizationId: text().notNull().default("local"),
	createdByUserId: text().notNull().default("local"),
	deviceId: text().notNull().default("local"),
	operationId: text().notNull(),
	...timestamps
}, (table) => [uniqueIndex("invoices_invoice_number_idx").on(table.invoiceNumber), uniqueIndex("invoices_operation_id_idx").on(table.operationId)]);
var invoiceItems = sqliteTable("invoice_items", {
	id: primaryId,
	invoiceId: text().notNull().references(() => invoices.id),
	productId: text().notNull().references(() => products.id),
	batchId: text().notNull().references(() => batches.id),
	productName: text().notNull(),
	batchNumber: text(),
	quantity: integer().notNull(),
	quantityType: text({ enum: ["unit", "pack"] }).notNull().default("unit"),
	baseUnitQuantity: integer().notNull(),
	salePrice: integer().notNull(),
	...timestamps
}, (table) => [index("invoice_items_invoice_id_idx").on(table.invoiceId)]);
var stockMovements = sqliteTable("stock_movements", {
	id: primaryId,
	productId: text().notNull().references(() => products.id),
	batchId: text().notNull().references(() => batches.id),
	invoiceId: text().references(() => invoices.id),
	type: text({ enum: [
		"stock_in",
		"sale",
		"open_pack",
		"adjustment"
	] }).notNull(),
	packDelta: integer().notNull().default(0),
	unitDelta: integer().notNull().default(0),
	note: text(),
	organizationId: text().notNull().default("local"),
	actorUserId: text().notNull().default("local"),
	deviceId: text().notNull().default("local"),
	operationId: text().notNull(),
	createdAt: integer().notNull()
}, (table) => [
	index("stock_movements_product_id_idx").on(table.productId),
	index("stock_movements_batch_id_idx").on(table.batchId),
	index("stock_movements_invoice_id_idx").on(table.invoiceId)
]);
//#endregion
//#region ../../packages/contracts/src/index.ts
var productRow = createSelectSchema(products);
var productInsert = createInsertSchema(products);
var { deletedAt: _categoryDeletedAt, ...categoryFields } = createSelectSchema(categories).fields;
var Category = Struct(categoryFields);
var batchRow = createSelectSchema(batches);
var batchInsert = createInsertSchema(batches);
var { deletedAt: _batchDeletedAt, ...batchFields } = batchRow.fields;
var Batch = Struct(batchFields);
var { id: _batchId, createdAt: _batchCreatedAt, updatedAt: _batchUpdatedAt, deletedAt: _batchInsertDeletedAt, ...createBatchFields } = batchInsert.fields;
var CreateBatchInput = Struct(createBatchFields);
var { deletedAt: _productDeletedAt, ...productFields } = productRow.fields;
Struct({
	...productFields,
	category: Category,
	batches: ArraySchema(Batch)
});
var { id: _productId, createdAt: _productCreatedAt, updatedAt: _productUpdatedAt, deletedAt: _productInsertDeletedAt, ...createProductFields } = productInsert.fields;
var CreateProductInput = Struct(createProductFields);
var UpdateProductInput = Struct({
	id: String$1,
	...createProductFields
});
var ProductIdInput = Struct({ id: String$1 });
var invoiceRow = createSelectSchema(invoices);
var { deletedAt: _invoiceItemDeletedAt, ...invoiceItemFields } = createSelectSchema(invoiceItems).fields;
var InvoiceItem = Struct(invoiceItemFields);
var { deletedAt: _invoiceDeletedAt, ...invoiceFields } = invoiceRow.fields;
Struct({
	...invoiceFields,
	items: ArraySchema(InvoiceItem)
});
var CreateInvoiceLineInput = Struct({
	productId: String$1,
	batchId: NullOr(String$1),
	quantity: Number$1,
	quantityType: Literals(["unit", "pack"]),
	salePrice: Number$1
});
var CreateInvoiceInput = Struct({
	customerName: NullOr(String$1),
	items: ArraySchema(CreateInvoiceLineInput)
});
var InvoiceIdInput = Struct({ id: String$1 });
Struct(createSelectSchema(stockMovements).fields);
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/logger.js
var ConsoleLogWriter = class {
	static [entityKind] = "ConsoleLogWriter";
	write(message) {
		console.log(message);
	}
};
var DefaultLogger = class {
	static [entityKind] = "DefaultLogger";
	writer;
	constructor(config) {
		this.writer = config?.writer ?? new ConsoleLogWriter();
	}
	logQuery(query, params) {
		const stringifiedParams = params.map((p) => {
			try {
				return JSON.stringify(p);
			} catch {
				return String(p);
			}
		});
		const paramsStr = stringifiedParams.length ? ` -- params: [${stringifiedParams.join(", ")}]` : "";
		this.writer.write(`Query: ${query}${paramsStr}`);
	}
};
var NoopLogger = class {
	static [entityKind] = "NoopLogger";
	logQuery() {}
};
//#endregion
//#region ../../packages/db/src/relations.ts
var relations = defineRelations(schema_exports, (r) => ({
	categories: { products: r.many.products() },
	products: {
		category: r.one.categories({
			from: r.products.categoryId,
			to: r.categories.id,
			optional: false
		}),
		batches: r.many.batches(),
		stockMovements: r.many.stockMovements()
	},
	batches: {
		product: r.one.products({
			from: r.batches.productId,
			to: r.products.id,
			optional: false
		}),
		stockMovements: r.many.stockMovements()
	},
	invoices: {
		items: r.many.invoiceItems(),
		stockMovements: r.many.stockMovements()
	},
	invoiceItems: {
		invoice: r.one.invoices({
			from: r.invoiceItems.invoiceId,
			to: r.invoices.id,
			optional: false
		}),
		product: r.one.products({
			from: r.invoiceItems.productId,
			to: r.products.id,
			optional: false
		}),
		batch: r.one.batches({
			from: r.invoiceItems.batchId,
			to: r.batches.id,
			optional: false
		})
	},
	stockMovements: {
		product: r.one.products({
			from: r.stockMovements.productId,
			to: r.products.id,
			optional: false
		}),
		batch: r.one.batches({
			from: r.stockMovements.batchId,
			to: r.batches.id,
			optional: false
		}),
		invoice: r.one.invoices({
			from: r.stockMovements.invoiceId,
			to: r.invoices.id,
			optional: true
		})
	}
}));
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/tursodatabase-sync/session.js
var TursoDatabaseSyncSession = class TursoDatabaseSyncSession extends SQLiteAsyncSession {
	static [entityKind] = "TursoDatabaseSyncSession";
	logger;
	cache;
	constructor(client, dialect, relations, options) {
		super(dialect, "async");
		this.client = client;
		this.relations = relations;
		this.options = options;
		this.logger = options.logger ?? new NoopLogger();
		this.cache = options.cache ?? new NoopCache();
	}
	prepareQuery(query, mode, prepare, executeMethod, mapper, queryMetadata, cacheConfig) {
		let stmt;
		return new SQLiteAsyncPreparedQuery("async", executeMethod, prepare ? {
			all: async (params) => {
				stmt ??= await this.client.prepare(query.sql);
				return stmt.raw(mode === "arrays").all(params);
			},
			get: async (params) => {
				stmt ??= await this.client.prepare(query.sql);
				return stmt.raw(mode === "arrays").get(params);
			},
			run: async (params) => {
				stmt ??= await this.client.prepare(query.sql);
				return stmt.run(params);
			},
			values: async (params) => {
				stmt ??= await this.client.prepare(query.sql);
				return stmt.raw(true).all(params);
			}
		} : {
			all: async (params) => {
				if (stmt || mode === "arrays") {
					stmt ??= await this.client.prepare(query.sql);
					return stmt.raw(mode === "arrays").all(params);
				}
				return this.client.all(query.sql, ...params);
			},
			get: async (params) => {
				if (stmt || mode === "arrays") {
					stmt ??= await this.client.prepare(query.sql);
					return stmt.raw(mode === "arrays").get(params);
				}
				return this.client.get(query.sql, ...params);
			},
			run: (params) => stmt ? stmt.run(params) : this.client.run(query.sql, ...params),
			values: async (params) => {
				stmt ??= await this.client.prepare(query.sql);
				return stmt.raw(true).all(params);
			}
		}, query, mapper, mode, this.logger, this.cache, queryMetadata, cacheConfig);
	}
	async transaction(transaction, _config) {
		const session = new TursoDatabaseSyncSession(this.client, this.dialect, this.relations, this.options);
		const tx = new TursoDatabaseSyncTransaction("async", this.dialect, session, this.relations);
		return await this.client.transaction(async () => await transaction(tx))();
	}
};
var TursoDatabaseSyncTransaction = class TursoDatabaseSyncTransaction extends SQLiteAsyncTransaction {
	static [entityKind] = "TursoDatabaseSyncTransaction";
	async transaction(transaction) {
		const savepointName = `sp${this.nestedIndex}`;
		const tx = new TursoDatabaseSyncTransaction("async", this.dialect, this.session, this._.relations, this.nestedIndex + 1);
		await this.session.run(sql.raw(`savepoint ${savepointName}`));
		try {
			const result = await transaction(tx);
			await this.session.run(sql.raw(`release savepoint ${savepointName}`));
			return result;
		} catch (err) {
			await this.session.run(sql.raw(`rollback to savepoint ${savepointName}`));
			throw err;
		}
	}
};
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/tursodatabase-sync/driver.js
var TursoDatabaseSyncDatabase = class extends SQLiteAsyncDatabase {
	static [entityKind] = "TursoDatabaseSyncDatabase";
};
function construct(client, config = {}) {
	const dialect = new SQLiteDialect({ useJitMappers: jitCompatCheck(config.jit) });
	let logger;
	if (config.logger === true) logger = new DefaultLogger();
	else if (config.logger !== false) logger = config.logger;
	const relations = config.relations ?? {};
	const db = new TursoDatabaseSyncDatabase("async", dialect, new TursoDatabaseSyncSession(client, dialect, relations, {
		logger,
		cache: config.cache
	}), relations);
	db.$client = client;
	db.$cache = config.cache;
	if (db.$cache) db.$cache["invalidate"] = config.cache?.onMutate;
	return db;
}
function drizzle(...params) {
	if (typeof params[0] === "string") return construct(new Database({ path: params[0] }), params[1]);
	const { connection, client, ...drizzleConfig } = params[0];
	if (client) return construct(client, drizzleConfig);
	return construct(typeof connection === "string" ? new Database({ path: connection }) : new Database(connection), drizzleConfig);
}
(function(_drizzle) {
	function mock(config) {
		return construct({}, config);
	}
	_drizzle.mock = mock;
})(drizzle || (drizzle = {}));
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/migrator.js
function readMigrationFiles(config) {
	if (fs.existsSync(`${config.migrationsFolder}/meta/_journal.json`)) throw Error("We detected that you have old drizzle-kit migration folders. You must upgrade drizzle-kit and run \"drizzle-kit up\"");
	const migrationFolderTo = config.migrationsFolder;
	const migrationQueries = [];
	const migrations = readdirSync(migrationFolderTo).map((subdir) => ({
		path: join(migrationFolderTo, subdir, "migration.sql"),
		name: subdir
	})).filter((it) => existsSync(it.path));
	migrations.sort((a, b) => a.name.localeCompare(b.name));
	for (const migration of migrations) {
		const migrationPath = migration.path;
		const migrationDate = migration.name.slice(0, 14);
		const query = fs.readFileSync(migrationPath).toString();
		const result = query.split("--> statement-breakpoint").map((it) => {
			return it;
		});
		const millis = formatToMillis(migrationDate);
		migrationQueries.push({
			sql: result,
			bps: true,
			folderMillis: millis,
			hash: crypto$1.createHash("sha256").update(query).digest("hex"),
			name: migration.name
		});
	}
	return migrationQueries;
}
//#endregion
//#region ../../node_modules/.bun/drizzle-orm@1.0.0-rc.4+79b2656292c36c89/node_modules/drizzle-orm/tursodatabase-sync/migrator.js
async function migrate(db, config) {
	return migrateAsync(readMigrationFiles(config), db, config);
}
//#endregion
//#region ../../packages/persistence/src/index.ts
var PersistenceError = class extends TaggedErrorClass()("PersistenceError", {
	operation: String$1,
	message: String$1
}) {};
var ProductNotFoundError = class extends TaggedErrorClass()("ProductNotFoundError", { id: String$1 }) {};
var InvoiceNotFoundError = class extends TaggedErrorClass()("InvoiceNotFoundError", { id: String$1 }) {};
var OfflineStore = class extends Service()("@store/persistence/OfflineStore") {};
var messageOf = (cause) => cause instanceof Error ? cause.message : String(cause);
var attempt = (operation, evaluate) => tryPromise({
	try: () => Promise.resolve(evaluate()),
	catch: (cause) => new PersistenceError({
		operation,
		message: messageOf(cause)
	})
});
var toCategory = ({ deletedAt: _deletedAt, ...category }) => category;
var toBatch = ({ deletedAt: _deletedAt, ...batch }) => batch;
var toProduct = ({ deletedAt: _deletedAt, category, batches: batchRows, ...product }) => ({
	...product,
	category: toCategory(category),
	batches: batchRows.map(toBatch)
});
var toInvoice = ({ deletedAt: _deletedAt, items, ...invoice }) => ({
	...invoice,
	items: items.map(({ deletedAt: _itemDeletedAt, ...item }) => item)
});
var toStockMovement = (movement) => movement;
var byEarliestExpiry = (a, b) => (a.expiresAt ?? Number.POSITIVE_INFINITY) - (b.expiresAt ?? Number.POSITIVE_INFINITY) || a.createdAt - b.createdAt;
var make = (config) => gen(function* () {
	const mutationContext = () => config.mutationContext?.() ?? {
		organizationId: "local",
		userId: "local",
		deviceId: "local"
	};
	const configured = Boolean(config.syncUrl);
	let syncEnabled = false;
	const db = drizzle({
		connection: configured ? {
			path: config.path,
			url: () => syncEnabled ? config.syncUrl : null,
			...config.authToken ? { authToken: config.authToken } : {},
			clientName: "store-electron"
		} : { path: config.path },
		relations
	});
	yield* attempt("connect database", () => db.$client.connect());
	yield* attempt("migrate database", () => migrate(db, { migrationsFolder: config.migrationsFolder }));
	const status = yield* make$1({
		phase: configured ? "idle" : "local-only",
		configured,
		lastSyncedAt: null,
		message: configured ? "Ready to sync" : "Add Turso credentials to enable cloud sync"
	});
	yield* addFinalizer(() => attempt("close database", () => db.$client.close()).pipe(orDie));
	const listCategories = attempt("list categories", () => db.query.categories.findMany({
		orderBy: { name: "asc" },
		where: { deletedAt: { isNull: true } }
	})).pipe(map((rows) => rows.map(toCategory)));
	const withProductRelations = {
		category: true,
		batches: {
			where: { deletedAt: { isNull: true } },
			orderBy: {
				expiresAt: "asc",
				createdAt: "asc"
			}
		}
	};
	const findProduct = (id) => db.query.products.findFirst({
		where: {
			id,
			deletedAt: { isNull: true }
		},
		with: withProductRelations
	});
	const listProducts = attempt("list products", () => db.query.products.findMany({
		orderBy: { name: "asc" },
		where: { deletedAt: { isNull: true } },
		with: withProductRelations
	})).pipe(map((rows) => rows.map(toProduct)));
	const getProduct = fn("OfflineStore.getProduct")(function* (id) {
		const row = yield* attempt("find product", () => findProduct(id));
		if (!row) return yield* new ProductNotFoundError({ id });
		return toProduct(row);
	});
	const createProduct = fn("OfflineStore.createProduct")(function* (input) {
		const now = Date.now();
		return toProduct(yield* attempt("create product", async () => {
			const id = crypto.randomUUID();
			await db.insert(products).values({
				...input,
				id,
				name: input.name.trim(),
				createdAt: now,
				updatedAt: now
			}).run();
			const created = await findProduct(id);
			if (!created) throw new Error("Created product could not be loaded");
			return created;
		}));
	});
	const updateProduct = fn("OfflineStore.updateProduct")(function* (input) {
		const { id, ...changes } = input;
		const row = yield* attempt("update product", async () => {
			if (!await db.update(products).set({
				...changes,
				name: changes.name.trim(),
				updatedAt: Date.now()
			}).where(and(eq(products.id, id), isNull(products.deletedAt))).returning({ id: products.id }).get()) return void 0;
			return findProduct(id);
		});
		if (!row) return yield* new ProductNotFoundError({ id });
		return toProduct(row);
	});
	const deleteProduct = fn("OfflineStore.deleteProduct")(function* (id) {
		if (!(yield* attempt("delete product", () => db.update(products).set({
			deletedAt: Date.now(),
			updatedAt: Date.now()
		}).where(and(eq(products.id, id), isNull(products.deletedAt))).returning({ id: products.id }).get()))) return yield* new ProductNotFoundError({ id });
	});
	const createBatch = fn("OfflineStore.createBatch")(function* (input) {
		const packQuantity = input.packQuantity ?? 0;
		const unitQuantity = input.unitQuantity ?? 0;
		if (!Number.isInteger(packQuantity) || !Number.isInteger(unitQuantity) || packQuantity < 0 || unitQuantity < 0 || packQuantity + unitQuantity < 1) return yield* new PersistenceError({
			operation: "create batch",
			message: "Pack and unit quantities must be non-negative whole numbers with some stock"
		});
		if (!(yield* attempt("find product", () => findProduct(input.productId)))) return yield* new ProductNotFoundError({ id: input.productId });
		const now = Date.now();
		const actor = mutationContext();
		const operationId = crypto.randomUUID();
		return toBatch(yield* attempt("create batch", async () => {
			const id = crypto.randomUUID();
			return db.transaction(async (tx) => {
				await tx.insert(batches).values({
					...input,
					id,
					packQuantity,
					unitQuantity,
					createdAt: now,
					updatedAt: now
				}).run();
				await tx.insert(stockMovements).values({
					id: crypto.randomUUID(),
					productId: input.productId,
					batchId: id,
					invoiceId: null,
					type: "stock_in",
					packDelta: packQuantity,
					unitDelta: unitQuantity,
					note: "Initial batch stock",
					organizationId: actor.organizationId,
					actorUserId: actor.userId,
					deviceId: actor.deviceId,
					operationId,
					createdAt: now
				}).run();
				const created = await tx.query.batches.findFirst({ where: { id } });
				if (!created) throw new Error("Created batch could not be loaded");
				return created;
			});
		}));
	});
	const listStockMovements = (productId) => attempt("list stock movements", () => db.query.stockMovements.findMany({
		orderBy: { createdAt: "desc" },
		where: { productId }
	})).pipe(map((rows) => rows.map(toStockMovement)));
	const listInvoices = attempt("list invoices", () => db.query.invoices.findMany({
		orderBy: { createdAt: "desc" },
		where: { deletedAt: { isNull: true } },
		with: { items: true }
	})).pipe(map((rows) => rows.map(toInvoice)));
	const getInvoice = fn("OfflineStore.getInvoice")(function* (id) {
		const row = yield* attempt("find invoice", () => db.query.invoices.findFirst({
			where: {
				id,
				deletedAt: { isNull: true }
			},
			with: { items: true }
		}));
		if (!row) return yield* new InvoiceNotFoundError({ id });
		return toInvoice(row);
	});
	const createInvoice = fn("OfflineStore.createInvoice")(function* (input) {
		const invalid = (message) => new PersistenceError({
			operation: "create invoice",
			message
		});
		if (input.items.length === 0) return yield* invalid("Add at least one item to the sale");
		for (const line of input.items) {
			if (!Number.isInteger(line.quantity) || line.quantity < 1) return yield* invalid("Quantities must be whole numbers of 1 or more");
			if (!Number.isInteger(line.salePrice) || line.salePrice < 0) return yield* invalid("Sale prices cannot be negative");
		}
		const now = Date.now();
		const actor = mutationContext();
		const operationId = crypto.randomUUID();
		return toInvoice(yield* attempt("create invoice", () => db.transaction(async (tx) => {
			const allocations = [];
			const id = crypto.randomUUID();
			const invoiceNumber = `${actor.deviceId.replace(/-/g, "").slice(0, 8) || "local"}-${operationId}`;
			const total = input.items.reduce((sum, line) => sum + line.quantity * line.salePrice, 0);
			await tx.insert(invoices).values({
				id,
				invoiceNumber,
				customerName: input.customerName?.trim() || null,
				total,
				organizationId: actor.organizationId,
				createdByUserId: actor.userId,
				deviceId: actor.deviceId,
				operationId,
				createdAt: now,
				updatedAt: now
			}).run();
			for (const line of input.items) {
				const product = await tx.query.products.findFirst({ where: {
					id: line.productId,
					deletedAt: { isNull: true }
				} });
				if (!product) throw new Error("One of the products no longer exists");
				const productBatches = await tx.query.batches.findMany({ where: {
					productId: line.productId,
					deletedAt: { isNull: true }
				} });
				const open = line.batchId ? productBatches.filter((batch) => batch.id === line.batchId) : productBatches.sort(byEarliestExpiry).filter((batch) => line.quantityType === "pack" ? batch.packQuantity > 0 : batch.packQuantity * product.unitsPerPack + batch.unitQuantity > 0);
				if (line.batchId && open.length === 0) throw new Error(`The selected batch for ${product.name} no longer exists`);
				const available = open.reduce((sum, batch) => sum + (line.quantityType === "pack" ? batch.packQuantity : batch.packQuantity * product.unitsPerPack + batch.unitQuantity), 0);
				if (available < line.quantity) throw new Error(`Not enough stock for ${product.name}: ${available} in stock, ${line.quantity} requested`);
				let remaining = line.quantity;
				for (const batch of open) {
					if (remaining === 0) break;
					const batchAvailable = line.quantityType === "pack" ? batch.packQuantity : batch.packQuantity * product.unitsPerPack + batch.unitQuantity;
					const taken = Math.min(batchAvailable, remaining);
					remaining -= taken;
					allocations.push({
						productId: product.id,
						productName: product.name,
						batchId: batch.id,
						batchNumber: batch.batchNumber,
						quantity: taken,
						quantityType: line.quantityType,
						baseUnitQuantity: taken * (line.quantityType === "pack" ? product.unitsPerPack : 1),
						salePrice: line.salePrice
					});
					if (line.quantityType === "pack") {
						await tx.update(batches).set({
							packQuantity: batch.packQuantity - taken,
							updatedAt: now
						}).where(eq(batches.id, batch.id)).run();
						await tx.insert(stockMovements).values({
							id: crypto.randomUUID(),
							productId: product.id,
							batchId: batch.id,
							invoiceId: id,
							type: "sale",
							packDelta: -taken,
							unitDelta: 0,
							note: `Invoice #${invoiceNumber}`,
							organizationId: actor.organizationId,
							actorUserId: actor.userId,
							deviceId: actor.deviceId,
							operationId,
							createdAt: now
						}).run();
					} else {
						const packsOpened = Math.max(0, Math.ceil((taken - batch.unitQuantity) / product.unitsPerPack));
						const looseUnits = batch.unitQuantity + packsOpened * product.unitsPerPack;
						await tx.update(batches).set({
							packQuantity: batch.packQuantity - packsOpened,
							unitQuantity: looseUnits - taken,
							updatedAt: now
						}).where(eq(batches.id, batch.id)).run();
						if (packsOpened > 0) await tx.insert(stockMovements).values({
							id: crypto.randomUUID(),
							productId: product.id,
							batchId: batch.id,
							invoiceId: id,
							type: "open_pack",
							packDelta: -packsOpened,
							unitDelta: packsOpened * product.unitsPerPack,
							note: `Opened for invoice #${invoiceNumber}`,
							organizationId: actor.organizationId,
							actorUserId: actor.userId,
							deviceId: actor.deviceId,
							operationId,
							createdAt: now
						}).run();
						await tx.insert(stockMovements).values({
							id: crypto.randomUUID(),
							productId: product.id,
							batchId: batch.id,
							invoiceId: id,
							type: "sale",
							packDelta: 0,
							unitDelta: -taken,
							note: `Invoice #${invoiceNumber}`,
							organizationId: actor.organizationId,
							actorUserId: actor.userId,
							deviceId: actor.deviceId,
							operationId,
							createdAt: now
						}).run();
					}
				}
			}
			for (const allocation of allocations) await tx.insert(invoiceItems).values({
				...allocation,
				id: crypto.randomUUID(),
				invoiceId: id,
				createdAt: now,
				updatedAt: now
			}).run();
			const created = await tx.query.invoices.findFirst({
				where: { id },
				with: { items: true }
			});
			if (!created) throw new Error("Created invoice could not be loaded");
			return created;
		})));
	});
	const sync = fn("OfflineStore.sync")(function* () {
		if (!configured) return yield* get(status);
		yield* update(status, (current) => ({
			...current,
			phase: "syncing",
			message: "Pushing local changes…"
		}));
		syncEnabled = true;
		const result$2 = yield* attempt("sync with Turso", async () => {
			await db.$client.push();
			await db.$client.pull();
		}).pipe(result);
		if (result$2._tag === "Failure") {
			yield* update(status, (current) => ({
				...current,
				phase: "error",
				message: result$2.failure.message
			}));
			return yield* result$2.failure;
		}
		const next = {
			phase: "idle",
			configured: true,
			lastSyncedAt: Date.now(),
			message: "Local and cloud data are in sync"
		};
		yield* set(status, next);
		return next;
	});
	return OfflineStore.of({
		listCategories,
		listProducts,
		getProduct,
		createProduct,
		updateProduct,
		deleteProduct,
		createBatch,
		listStockMovements,
		listInvoices,
		getInvoice,
		createInvoice,
		getSyncStatus: get(status),
		sync: sync()
	});
});
var layer = (config) => effect(OfflineStore, make(config));
var program = {
	listCategories: flatMap(OfflineStore, (store) => store.listCategories),
	listProducts: flatMap(OfflineStore, (store) => store.listProducts),
	getProduct: (id) => flatMap(OfflineStore, (store) => store.getProduct(id)),
	createProduct: (input) => flatMap(OfflineStore, (store) => store.createProduct(input)),
	updateProduct: (input) => flatMap(OfflineStore, (store) => store.updateProduct(input)),
	deleteProduct: (id) => flatMap(OfflineStore, (store) => store.deleteProduct(id)),
	createBatch: (input) => flatMap(OfflineStore, (store) => store.createBatch(input)),
	listStockMovements: (productId) => flatMap(OfflineStore, (store) => store.listStockMovements(productId)),
	listInvoices: flatMap(OfflineStore, (store) => store.listInvoices),
	getInvoice: (id) => flatMap(OfflineStore, (store) => store.getInvoice(id)),
	createInvoice: (input) => flatMap(OfflineStore, (store) => store.createInvoice(input)),
	getSyncStatus: flatMap(OfflineStore, (store) => store.getSyncStatus),
	sync: flatMap(OfflineStore, (store) => store.sync)
};
//#endregion
//#region electron/auth.ts
var RequestError = class extends Error {
	status;
	constructor(message, status) {
		super(message);
		this.status = status;
	}
};
var unauthenticated = (isOnline) => ({
	status: "unauthenticated",
	user: null,
	activeOrganization: null,
	organizations: [],
	isOnline
});
var slugOf = (name) => name.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || `organization-${crypto.randomUUID().slice(0, 8)}`;
var AuthBroker = class {
	#baseUrl;
	#electronOrigin;
	#listeners = /* @__PURE__ */ new Set();
	#token = "";
	#snapshot = unauthenticated(false);
	constructor(baseUrl, electronProtocol = "com.tabaaq.desktop") {
		this.#baseUrl = baseUrl.replace(/\/api\/?$/, "").replace(/\/$/, "");
		this.#electronOrigin = `${electronProtocol.replace(/:\/?$/, "")}:/`;
	}
	get snapshot() {
		return this.#snapshot;
	}
	get authorizationHeader() {
		return this.#token ? `Bearer ${this.#token}` : void 0;
	}
	onChange(listener) {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}
	async initialize() {
		const persisted = await this.#readPersisted();
		if (persisted) {
			this.#token = persisted.token;
			this.#snapshot = {
				...persisted.snapshot,
				isOnline: false
			};
		}
		return this.refresh();
	}
	async refresh() {
		if (!this.#token) return this.#publish(unauthenticated(navigatorOnline()));
		try {
			const session = await this.#request("/api/auth/get-session");
			if (!session.user) {
				await this.#clear();
				return this.#publish(unauthenticated(true));
			}
			return this.#loadOrganizations(session.user);
		} catch (error) {
			if (error instanceof RequestError && (error.status === 401 || error.status === 403)) {
				await this.#clear();
				return this.#publish(unauthenticated(true));
			}
			return this.#publish({
				...this.#snapshot,
				isOnline: false
			});
		}
	}
	async signIn(input) {
		const response = await this.#requestWithResponse("/api/auth/sign-in/email", {
			method: "POST",
			body: input
		}, false);
		this.#captureToken(response.response);
		if (!this.#token) throw new Error("The server did not return a desktop session token.");
		return this.#loadOrganizations(response.data.user);
	}
	async signUp(input) {
		const response = await this.#requestWithResponse("/api/auth/sign-up/email", {
			method: "POST",
			body: {
				name: input.name,
				email: input.email,
				password: input.password
			}
		}, false);
		this.#captureToken(response.response);
		if (!this.#token) throw new Error("The server did not return a desktop session token.");
		return this.#loadOrganizations(response.data.user);
	}
	async signOut() {
		try {
			await this.#request("/api/auth/sign-out", { method: "POST" });
		} finally {
			await this.#clear();
			this.#publish(unauthenticated(navigatorOnline()));
		}
	}
	async switchOrganization(input) {
		await this.#request("/api/auth/organization/set-active", {
			method: "POST",
			body: { organizationId: input.organizationId }
		});
		const selected = this.#snapshot.organizations.find((org) => org.id === input.organizationId);
		const member = await this.#request("/api/auth/organization/get-active-member");
		const active = selected ? {
			...selected,
			role: member.role ?? selected.role
		} : void 0;
		if (!active) throw new Error("That organization is not available to this account.");
		return this.#persistAndPublish({
			...this.#snapshot,
			activeOrganization: active,
			isOnline: true
		});
	}
	async createOrganization(input) {
		const created = await this.#request("/api/auth/organization/create", {
			method: "POST",
			body: {
				name: input.name.trim(),
				slug: slugOf(input.name)
			}
		});
		await this.#request("/api/auth/organization/set-active", {
			method: "POST",
			body: { organizationId: created.id }
		});
		const organization = {
			...created,
			role: "owner"
		};
		return this.#persistAndPublish({
			...this.#snapshot,
			activeOrganization: organization,
			organizations: [...this.#snapshot.organizations, organization],
			isOnline: true
		});
	}
	async apiRequest(pathname, init) {
		return this.#request(pathname, init);
	}
	async #loadOrganizations(user) {
		let organizations = (await this.#request("/api/auth/organization/list")).map((organization) => ({
			...organization,
			role: "member"
		}));
		const previousId = this.#snapshot.activeOrganization?.id;
		const activeOrganization = organizations.find((organization) => organization.id === previousId) ?? organizations[0] ?? null;
		if (activeOrganization && activeOrganization.id !== previousId) await this.#request("/api/auth/organization/set-active", {
			method: "POST",
			body: { organizationId: activeOrganization.id }
		});
		if (activeOrganization) {
			const member = await this.#request("/api/auth/organization/get-active-member");
			if (member.role) organizations = organizations.map((organization) => organization.id === activeOrganization.id ? {
				...organization,
				role: member.role
			} : organization);
		}
		const resolvedActive = organizations.find((organization) => organization.id === activeOrganization?.id) ?? null;
		return this.#persistAndPublish({
			status: "authenticated",
			user,
			activeOrganization: resolvedActive,
			organizations,
			isOnline: true
		});
	}
	async #request(pathname, init) {
		return (await this.#requestWithResponse(pathname, init)).data;
	}
	async #requestWithResponse(pathname, init, includeAuthorization = true) {
		const headers = new Headers(init?.headers);
		headers.set("electron-origin", this.#electronOrigin);
		if (includeAuthorization && this.authorizationHeader) headers.set("authorization", this.authorizationHeader);
		let body = init?.body;
		if (body && !(body instanceof FormData) && typeof body !== "string") {
			headers.set("content-type", "application/json");
			body = JSON.stringify(body);
		}
		const response = await fetch(`${this.#baseUrl}${pathname}`, {
			...init,
			headers,
			body
		});
		const payload = await response.json().catch(() => null);
		if (!response.ok) {
			const nested = payload?.error;
			throw new RequestError(payload?.message ?? (typeof nested === "string" ? nested : nested?.message) ?? `Request failed (${response.status})`, response.status);
		}
		return {
			data: payload,
			response
		};
	}
	#captureToken(response) {
		this.#token = response.headers.get("set-auth-token") ?? "";
	}
	#publish(snapshot) {
		this.#snapshot = snapshot;
		for (const listener of this.#listeners) listener(snapshot);
		return snapshot;
	}
	async #persistAndPublish(snapshot) {
		this.#publish(snapshot);
		await this.#writePersisted({
			token: this.#token,
			snapshot
		});
		return snapshot;
	}
	async #clear() {
		this.#token = "";
		this.#snapshot = unauthenticated(navigatorOnline());
		await rm(this.#storagePath(), { force: true });
	}
	#storagePath() {
		return path.join(app.getPath("userData"), "auth", "session.bin");
	}
	async #readPersisted() {
		try {
			const encrypted = await readFile(this.#storagePath());
			if (!safeStorage.isEncryptionAvailable()) return null;
			return JSON.parse(safeStorage.decryptString(encrypted));
		} catch {
			return null;
		}
	}
	async #writePersisted(value) {
		if (!safeStorage.isEncryptionAvailable()) {
			if (!app.isPackaged) {
				await rm(this.#storagePath(), { force: true });
				return;
			}
			throw new Error("Secure credential storage is unavailable on this system.");
		}
		await mkdir(path.dirname(this.#storagePath()), { recursive: true });
		await writeFile(this.#storagePath(), safeStorage.encryptString(JSON.stringify(value)), { mode: 384 });
	}
};
var navigatorOnline = () => true;
//#endregion
//#region electron/main.ts
var __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname, "..");
var VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
var MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
var RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
var envFiles = [
	path.join(process.env.APP_ROOT, ".env"),
	path.join(process.env.APP_ROOT, "..", "..", ".env"),
	path.join(process.env.APP_ROOT, "..", "..", "packages", "persistence", ".env")
];
for (const file of envFiles) try {
	process.loadEnvFile(file);
} catch {}
var win;
var runtime;
var activeOrganizationId = null;
var deviceId = "local";
var authBroker = new AuthBroker(process.env["STORE_API_URL"] ?? process.env["VITE_API_URL"] ?? "http://localhost:8787", process.env["ELECTRON_PROTOCOL"] ?? "com.tabaaq.desktop");
var runStore = (effect) => {
	if (!runtime) return Promise.reject(/* @__PURE__ */ new Error("The local store is not ready"));
	return runtime.runPromise(effect).catch((cause) => {
		const message = typeof cause === "object" && cause !== null && "message" in cause ? String(cause.message) : String(cause);
		throw new Error(message);
	});
};
function registerStoreIpc() {
	ipcMain.handle("store:categories:list", () => runStore(program.listCategories));
	ipcMain.handle("store:products:list", () => runStore(program.listProducts));
	ipcMain.handle("store:products:get", (_event, input) => runStore(decodeUnknownEffect(ProductIdInput)(input).pipe(flatMap(({ id }) => program.getProduct(id)))));
	ipcMain.handle("store:products:create", (_event, input) => runStore(decodeUnknownEffect(CreateProductInput)(input).pipe(flatMap(program.createProduct))));
	ipcMain.handle("store:products:update", (_event, input) => runStore(decodeUnknownEffect(UpdateProductInput)(input).pipe(flatMap(program.updateProduct))));
	ipcMain.handle("store:products:delete", (_event, input) => runStore(decodeUnknownEffect(ProductIdInput)(input).pipe(flatMap(({ id }) => program.deleteProduct(id)))));
	ipcMain.handle("store:batches:create", (_event, input) => runStore(decodeUnknownEffect(CreateBatchInput)(input).pipe(flatMap(program.createBatch))));
	ipcMain.handle("store:stock-movements:list", (_event, input) => runStore(decodeUnknownEffect(ProductIdInput)(input).pipe(flatMap(({ id }) => program.listStockMovements(id)))));
	ipcMain.handle("store:invoices:list", () => runStore(program.listInvoices));
	ipcMain.handle("store:invoices:get", (_event, input) => runStore(decodeUnknownEffect(InvoiceIdInput)(input).pipe(flatMap(({ id }) => program.getInvoice(id)))));
	ipcMain.handle("store:invoices:create", (_event, input) => runStore(decodeUnknownEffect(CreateInvoiceInput)(input).pipe(flatMap(program.createInvoice))));
	ipcMain.handle("store:sync:status", () => runStore(program.getSyncStatus));
	ipcMain.handle("store:sync:run", async () => {
		if (activeOrganizationId) await activateOrganization(activeOrganizationId, true);
		return runStore(program.sync);
	});
}
var organizationKey = (organizationId) => createHash("sha256").update(organizationId).digest("hex").slice(0, 32);
var migrationsFolder = () => app.isPackaged ? path.join(process.resourcesPath, "database-migrations") : path.join(process.env.APP_ROOT, "..", "..", "packages", "db", "drizzle");
async function loadDeviceId() {
	const file = path.join(app.getPath("userData"), "device-id");
	try {
		return (await readFile(file, "utf8")).trim();
	} catch {
		const created = crypto.randomUUID();
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, created, { mode: 384 });
		return created;
	}
}
async function disposeRuntime() {
	const current = runtime;
	runtime = void 0;
	activeOrganizationId = null;
	if (current) await current.dispose();
}
async function activateLockedRuntime() {
	await disposeRuntime();
	const databasePath = path.join(app.getPath("userData"), "locked", "store.db");
	await mkdir(path.dirname(databasePath), { recursive: true });
	runtime = make$2(layer({
		path: databasePath,
		migrationsFolder: migrationsFolder()
	}));
}
async function activateOrganization(organizationId, refreshCredentials = false) {
	if (activeOrganizationId === organizationId && runtime && !refreshCredentials) return;
	let credentials;
	try {
		credentials = await authBroker.apiRequest("/api/sync/credentials", { method: "POST" });
		if (credentials.organizationId !== organizationId) throw new Error("The sync credential does not match the active organization.");
	} catch {}
	await disposeRuntime();
	const key = organizationKey(organizationId);
	const databasePath = path.join(app.getPath("userData"), "organizations", key, "store.db");
	await mkdir(path.dirname(databasePath), { recursive: true });
	runtime = make$2(layer({
		path: databasePath,
		migrationsFolder: migrationsFolder(),
		syncUrl: credentials?.url,
		authToken: credentials?.authToken,
		mutationContext: () => ({
			organizationId,
			userId: authBroker.snapshot.user?.id ?? "offline",
			deviceId
		})
	}));
	activeOrganizationId = organizationId;
}
async function applyAuthSnapshot(snapshot) {
	if (snapshot.status === "authenticated" && snapshot.activeOrganization) await activateOrganization(snapshot.activeOrganization.id);
	else await activateLockedRuntime();
	win?.webContents.send("auth:session-changed", snapshot);
	return snapshot;
}
var inputString = (input, key, maximum = 160) => {
	if (!input || typeof input !== "object") throw new Error("Invalid authentication request.");
	const value = Reflect.get(input, key);
	if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error(`Invalid ${key}.`);
	return value.trim();
};
function registerAuthIpc() {
	ipcMain.handle("auth:get-session", () => authBroker.snapshot);
	ipcMain.handle("auth:sign-in", async (_event, input) => applyAuthSnapshot(await authBroker.signIn({
		email: inputString(input, "email"),
		password: inputString(input, "password", 256)
	})));
	ipcMain.handle("auth:sign-up", async (_event, input) => applyAuthSnapshot(await authBroker.signUp({
		name: inputString(input, "name"),
		email: inputString(input, "email"),
		password: inputString(input, "password", 256)
	})));
	ipcMain.handle("auth:sign-out", async () => {
		await authBroker.signOut();
		await applyAuthSnapshot(authBroker.snapshot);
	});
	ipcMain.handle("auth:organization:switch", async (_event, input) => applyAuthSnapshot(await authBroker.switchOrganization({ organizationId: inputString(input, "organizationId") })));
	ipcMain.handle("auth:organization:create", async (_event, input) => applyAuthSnapshot(await authBroker.createOrganization({ name: inputString(input, "name") })));
}
function registerServerIpc() {
	ipcMain.handle("server:models", () => authBroker.apiRequest("/api/models"));
	ipcMain.handle("server:uploads", async (_event, input) => {
		if (!input || !Array.isArray(input.files) || typeof input.model !== "string") throw new Error("Invalid invoice upload request.");
		const body = new FormData();
		for (const file of input.files) {
			if (!file || typeof file.name !== "string" || typeof file.type !== "string" || !(file.bytes instanceof ArrayBuffer)) throw new Error("Invalid invoice attachment.");
			const inferredType = file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "text/csv";
			body.append("files", new File([file.bytes], file.name, { type: file.type || inferredType }));
		}
		body.append("model", input.model);
		return authBroker.apiRequest("/api/uploads", {
			method: "POST",
			body
		});
	});
}
function createWindow() {
	win = new BrowserWindow({
		icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
		frame: false,
		webPreferences: {
			preload: path.join(__dirname, "preload.mjs"),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true
		}
	});
	win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
	win.webContents.on("will-navigate", (event, url) => {
		const expected = VITE_DEV_SERVER_URL ?? `file://${RENDERER_DIST}`;
		if (!url.startsWith(expected)) event.preventDefault();
	});
	win.on("enter-full-screen", () => {
		win?.webContents.send("window-controls:full-screen-changed", true);
	});
	win.on("leave-full-screen", () => {
		win?.webContents.send("window-controls:full-screen-changed", false);
	});
	if (VITE_DEV_SERVER_URL) win.loadURL(VITE_DEV_SERVER_URL);
	else win.loadFile(path.join(RENDERER_DIST, "index.html"));
}
ipcMain.on("window-controls:minimize", (event) => {
	BrowserWindow.fromWebContents(event.sender)?.minimize();
});
ipcMain.handle("window-controls:toggle-maximize", (event) => {
	const window = BrowserWindow.fromWebContents(event.sender);
	if (!window) return false;
	if (window.isMaximized()) window.unmaximize();
	else window.maximize();
	return window.isMaximized();
});
ipcMain.handle("window-controls:is-maximized", (event) => {
	return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false;
});
ipcMain.handle("window-controls:is-full-screen", (event) => {
	return BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false;
});
ipcMain.on("window-controls:close", (event) => {
	BrowserWindow.fromWebContents(event.sender)?.close();
});
app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
		win = null;
	}
});
app.on("activate", () => {
	if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
app.on("before-quit", () => {
	disposeRuntime();
});
app.whenReady().then(async () => {
	deviceId = await loadDeviceId();
	const snapshot = await authBroker.initialize();
	registerStoreIpc();
	registerAuthIpc();
	registerServerIpc();
	if (snapshot.status === "authenticated" && snapshot.activeOrganization) await activateOrganization(snapshot.activeOrganization.id);
	else await activateLockedRuntime();
	createWindow();
});
//#endregion
export { MAIN_DIST, RENDERER_DIST, VITE_DEV_SERVER_URL };
