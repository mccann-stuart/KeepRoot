declare module 'turndown' {
	interface TurndownServiceOptions {
		codeBlockStyle?: 'fenced' | 'indented';
		headingStyle?: 'atx' | 'setext';
	}

	interface TurndownNode {
		getAttribute(name: string): string | null;
	}

	interface TurndownRule {
		filter: string | string[] | ((node: TurndownNode) => boolean);
		replacement(content: string, node: TurndownNode): string;
	}

	export default class TurndownService {
		constructor(options?: TurndownServiceOptions);
		addRule(key: string, rule: TurndownRule): this;
		turndown(input: unknown): string;
	}
}
