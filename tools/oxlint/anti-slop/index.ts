import { eslintCompatPlugin } from "vite-plus/lint/plugins";

import { noChainedTypeAssertionsRule } from "./rules/no-chained-type-assertions.ts";
import { noCommentsRule } from "./rules/no-comments.ts";
import { noConditionalEmptyObjectSpreadRule } from "./rules/no-conditional-empty-object-spread.ts";
import { noKnownValueWideningRule } from "./rules/no-known-value-widening.ts";
import { noModuleMockingRule } from "./rules/no-module-mocking.ts";
import { noObjectParametersRule } from "./rules/no-object-parameters.ts";
import { noReflectApplyRule } from "./rules/no-reflect-apply.ts";
import { noReflectGetRule } from "./rules/no-reflect-get.ts";
import { noRuntimeTypeofRule } from "./rules/no-runtime-typeof.ts";
import { noForbiddenTermInSymbolNamesRule } from "./rules/no-shape-in-symbol-names.ts";
import { noUnknownParametersRule } from "./rules/no-unknown-parameters.ts";
import { noUnknownReturnsRule } from "./rules/no-unknown-returns.ts";
import { noUnknownTypeAliasesRule } from "./rules/no-unknown-type-aliases.ts";
import { noUnsafeDictionaryTypeRule } from "./rules/no-unsafe-dictionary-type.ts";
import { noWidenThenAssertRule } from "./rules/no-widen-then-assert.ts";
import { requireSafetyCommentForTypeAssertionRule } from "./rules/require-safety-comment-for-type-assertion.ts";
import { noAbsorbingDefaultOnTagRule } from "./rules/no-absorbing-default-on-tag.ts";
import { noDateNowInEffectRule } from "./rules/no-date-now-in-effect.ts";
import { noEffectRunOutsideEdgeRule } from "./rules/no-effect-run-outside-edge.ts";
import { noErrorMessageFromCauseRule } from "./rules/no-error-message-from-cause.ts";
import { noGlobalCryptoRule } from "./rules/no-global-crypto.ts";
import { noNodeFsInEffectRule } from "./rules/no-node-fs-in-effect.ts";
import { noNumberIsSafeIntegerRule } from "./rules/no-number-is-safe-integer.ts";
import { noPlainErrorInEffectRule } from "./rules/no-plain-error-in-effect.ts";
import { noYieldEffectFailRule } from "./rules/no-yield-effect-fail.ts";
import { preferTaggedStructRule } from "./rules/prefer-tagged-struct.ts";
import { serviceIdShapeRule } from "./rules/service-id-shape.ts";
import { taggedErrorTagMatchesClassRule } from "./rules/tagged-error-tag-matches-class.ts";

/** Generic Oxlint rules that reject low-evidence and low-signal implementation patterns. */
const antiSlopPlugin = eslintCompatPlugin({
	meta: { name: "anti-slop" },
	rules: {
		"no-chained-type-assertions": noChainedTypeAssertionsRule,
		"no-comments": noCommentsRule,
		"no-conditional-empty-object-spread": noConditionalEmptyObjectSpreadRule,
		"no-known-value-widening": noKnownValueWideningRule,
		"no-module-mocking": noModuleMockingRule,
		"no-object-parameters": noObjectParametersRule,
		"no-reflect-apply": noReflectApplyRule,
		"no-reflect-get": noReflectGetRule,
		"no-runtime-typeof": noRuntimeTypeofRule,
		"no-unsafe-dictionary-type": noUnsafeDictionaryTypeRule,
		"no-shape-in-symbol-names": noForbiddenTermInSymbolNamesRule,
		"no-unknown-parameters": noUnknownParametersRule,
		"no-unknown-returns": noUnknownReturnsRule,
		"no-unknown-type-aliases": noUnknownTypeAliasesRule,
		"no-widen-then-assert": noWidenThenAssertRule,
		"require-safety-comment-for-type-assertion": requireSafetyCommentForTypeAssertionRule,
		"no-absorbing-default-on-tag": noAbsorbingDefaultOnTagRule,
		"no-date-now-in-effect": noDateNowInEffectRule,
		"no-effect-run-outside-edge": noEffectRunOutsideEdgeRule,
		"no-error-message-from-cause": noErrorMessageFromCauseRule,
		"no-global-crypto": noGlobalCryptoRule,
		"no-node-fs-in-effect": noNodeFsInEffectRule,
		"no-number-is-safe-integer": noNumberIsSafeIntegerRule,
		"no-plain-error-in-effect": noPlainErrorInEffectRule,
		"no-yield-effect-fail": noYieldEffectFailRule,
		"prefer-tagged-struct": preferTaggedStructRule,
		"service-id-shape": serviceIdShapeRule,
		"tagged-error-tag-matches-class": taggedErrorTagMatchesClassRule,
	},
});

export default antiSlopPlugin;
