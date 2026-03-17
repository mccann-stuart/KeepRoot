import type { AccountFeatures, SourceKind, SourceRecord } from './state';

export interface McpPreset {
	id: 'claude-code' | 'openai';
	language: 'bash' | 'json';
	note: string;
	title: string;
	value: string;
}

export interface SourceKindOption {
	description: string;
	disabled: boolean;
	identifierHelp: string;
	identifierLabel: string;
	kind: SourceKind;
	label: string;
	requiresBridgeUrl: boolean;
}

const SOURCE_KIND_METADATA: Record<SourceKind, Omit<SourceKindOption, 'disabled' | 'kind'>> = {
	email: {
		description: 'Create a KeepRoot email alias for forwarded reading queues and newsletters.',
		identifierHelp: 'Use a short label to distinguish this inbox.',
		identifierLabel: 'Alias Label',
		label: 'Email',
		requiresBridgeUrl: false,
	},
	rss: {
		description: 'Poll a standard RSS or Atom feed URL.',
		identifierHelp: 'Paste the feed URL you want KeepRoot to ingest.',
		identifierLabel: 'Feed URL',
		label: 'RSS',
		requiresBridgeUrl: false,
	},
	x: {
		description: 'Connect an X/Twitter source through an operator-managed RSS bridge URL.',
		identifierHelp: 'Use the profile URL, handle, or source label you want to track.',
		identifierLabel: 'Profile Identifier',
		label: 'X',
		requiresBridgeUrl: true,
	},
	youtube: {
		description: 'Track a YouTube channel URL, handle, or channel id.',
		identifierHelp: 'Paste a channel URL, @handle, or UC… channel id.',
		identifierLabel: 'Channel Identifier',
		label: 'YouTube',
		requiresBridgeUrl: false,
	},
};

export function getMcpEndpoint(origin: string): string {
	return `${origin.replace(/\/$/, '')}/mcp`;
}

export function buildClaudeCodePreset(endpoint: string): string {
	return `claude mcp add --transport http keeproot ${endpoint} --header "Authorization: Bearer <API_KEY>"`;
}

export function buildOpenAiPreset(endpoint: string): string {
	return JSON.stringify({
		authorization: 'Bearer <API_KEY>',
		require_approval: 'always',
		server_label: 'keeproot',
		server_url: endpoint,
		type: 'mcp',
	}, null, 2);
}

export function buildMcpPresets(origin: string): McpPreset[] {
	const endpoint = getMcpEndpoint(origin);
	return [
		{
			id: 'claude-code',
			language: 'bash',
			note: 'Remote HTTP server with a Bearer auth header.',
			title: 'Claude Code',
			value: buildClaudeCodePreset(endpoint),
		},
		{
			id: 'openai',
			language: 'json',
			note: 'Responses API MCP tool config. ChatGPT Developer Mode can also import this server from Settings > Connectors.',
			title: 'OpenAI',
			value: buildOpenAiPreset(endpoint),
		},
	];
}

export function getSourceKindOptions(features: AccountFeatures | null): SourceKindOption[] {
	return (Object.keys(SOURCE_KIND_METADATA) as SourceKind[]).map((kind) => ({
		...SOURCE_KIND_METADATA[kind],
		disabled: features ? features[kind] === false : false,
		kind,
	}));
}

export function getDefaultSourceKind(features: AccountFeatures | null, currentKind?: string): SourceKind {
	const options = getSourceKindOptions(features);
	const matching = options.find((option) => option.kind === currentKind && !option.disabled);
	if (matching) {
		return matching.kind;
	}

	return options.find((option) => !option.disabled)?.kind ?? 'rss';
}

export function getSourceSummaryLine(source: SourceRecord): string {
	if (source.kind === 'email' && source.emailAlias) {
		return source.emailAlias;
	}

	return source.normalizedIdentifier || source.pollUrl || source.name;
}
