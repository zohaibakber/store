import { defineRule } from "@oxlint/plugins";

export const noCommentsRule = defineRule({
	meta: {
		type: "problem",
		docs: {
			description:
				"Disallow comments; encode intent in names, types, and assertions instead of prose beside the code.",
		},
		messages: {
			comment:
				"Comments are not allowed here. Encode the fact in a name, a sum type, a branded value, or a test assertion. A suppression comment means the underlying code needs the fix instead.",
		},
	},
	createOnce(context) {
		return {
			Program(node) {
				for (const comment of node.comments) {
					context.report({ node: comment, messageId: "comment" });
				}
			},
		};
	},
});
