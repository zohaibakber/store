import type { ESTree, Scope, SourceCode, Variable } from "vite-plus/lint/plugins";

function resolveVariable(
  sourceCode: SourceCode,
  identifier: ESTree.IdentifierReference,
): Variable | null {
  let scope: Scope | null = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return null;
}

/** Reports whether an identifier with the given name refers to the global binding. */
export function isGlobalName(
  sourceCode: SourceCode,
  expression: ESTree.Node,
  name: string,
): boolean {
  if (expression.type !== "Identifier" || expression.name !== name) return false;
  if (sourceCode.isGlobalReference(expression)) return true;
  const variable = resolveVariable(sourceCode, expression);
  return variable === null || variable.defs.length === 0;
}

/** Reports whether a module specifier belongs to the Effect packages. */
export function isEffectSpecifier(specifier: string): boolean {
  return specifier === "effect" || specifier.startsWith("effect/") || specifier.startsWith("@effect/");
}

/** Reports whether a program imports from effect or an @effect package. */
export function importsEffect(program: ESTree.Program): boolean {
  return program.body.some(
    (statement) =>
      statement.type === "ImportDeclaration" &&
      typeof statement.source.value === "string" &&
      isEffectSpecifier(statement.source.value),
  );
}

/** Returns the static property name of a member expression, or null when it is computed. */
export function staticPropertyName(member: ESTree.Node): string | null {
  if (member.type !== "MemberExpression") return null;
  if (!member.computed) return member.property.type === "Identifier" ? member.property.name : null;
  return member.property.type === "Literal" && typeof member.property.value === "string"
    ? member.property.value
    : null;
}

/** Reports whether an expression is `<object>.<property>` with identifier object and static property. */
export function isNamespaceMember(
  node: ESTree.Node,
  objectName: string,
  matchesProperty: (name: string) => boolean,
): boolean {
  if (node.type !== "MemberExpression") return false;
  if (node.object.type !== "Identifier" || node.object.name !== objectName) return false;
  const name = staticPropertyName(node);
  return name !== null && matchesProperty(name);
}

/** Reports whether a call is `Effect.<name>(...)` for a matching name. */
export function isEffectCall(
  node: ESTree.CallExpression,
  matchesProperty: (name: string) => boolean,
): boolean {
  return isNamespaceMember(node.callee, "Effect", matchesProperty);
}
