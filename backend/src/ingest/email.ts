import PostalMime from 'postal-mime';
import { saveItemContent } from '../storage/items';
import { getSourceByEmailAlias } from '../storage/sources';
import type { StorageEnv } from '../storage/shared';

function extractFirstUrl(value: string): string | null {
	const match = value.match(/https?:\/\/[^\s<>"')]+/i);
	return match?.[0] ?? null;
}

async function getUsername(env: StorageEnv, userId: string): Promise<string> {
	const user = await env.KEEPROOT_DB.prepare(
		'SELECT username FROM users WHERE id = ? LIMIT 1',
	)
		.bind(userId)
		.first<{ username: string }>();

	return user?.username ?? userId;
}

export async function ingestEmailMessage(env: StorageEnv, message: ForwardableEmailMessage): Promise<void> {
	const source = await getSourceByEmailAlias(env, message.to);
	if (!source) {
		message.setReject('Unknown KeepRoot email source');
		return;
	}

	const parsed = await PostalMime.parse(message.raw);
	const text = String(parsed.text ?? '').trim();
	const html = typeof parsed.html === 'string' ? parsed.html : '';
	const candidateUrl = extractFirstUrl(text || html);
	if (!candidateUrl) {
		console.warn('Email source received a message without a URL');
		return;
	}

	const username = await getUsername(env, source.userId);
	await saveItemContent(
		env,
		{
			userId: source.userId,
			username,
		},
		{
			htmlData: html || undefined,
			notes: parsed.subject ? `Saved from email: ${parsed.subject}` : 'Saved from email',
			sourceId: source.id,
			status: 'saved',
			textContent: text || candidateUrl,
			title: parsed.subject || candidateUrl,
			url: candidateUrl,
		},
		'email_ingest',
	);
}
