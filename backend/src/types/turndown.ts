declare module 'turndown' {
	interface TurndownServiceOptions {
		codeBlockStyle?: 'fenced' | 'indented';
		headingStyle?: 'atx' | 'setext';
	}

	export default class TurndownService {
		constructor(options?: TurndownServiceOptions);
		turndown(input: unknown): string;
	}
}
