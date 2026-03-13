import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { KeepRootApi } from './api';

export async function registerWithPasskey(api: KeepRootApi, username: string): Promise<string> {
	const options = await api.publicRequest<any>('/auth/generate-registration', {
		bodyJson: { username },
		method: 'POST',
	});
	const response = await startRegistration({ optionsJSON: options });
	const verification = await api.publicRequest<{ error?: string; token?: string; verified?: boolean }>('/auth/verify-registration', {
		bodyJson: { response, username },
		method: 'POST',
	});

	if (!verification.verified || !verification.token) {
		throw new Error(verification.error || 'Verification failed');
	}

	return verification.token;
}

export async function loginWithPasskey(api: KeepRootApi, username: string): Promise<string> {
	const options = await api.publicRequest<any>('/auth/generate-authentication', {
		bodyJson: { username },
		method: 'POST',
	});
	const response = await startAuthentication({ optionsJSON: options });
	const verification = await api.publicRequest<{ error?: string; token?: string; verified?: boolean }>('/auth/verify-authentication', {
		bodyJson: { response, username },
		method: 'POST',
	});

	if (!verification.verified || !verification.token) {
		throw new Error(verification.error || 'Verification failed');
	}

	return verification.token;
}
