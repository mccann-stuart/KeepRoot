import type {
	AuthenticationResponseJSON,
	AuthenticatorTransportFuture,
	RegistrationResponseJSON,
	VerifiedAuthenticationResponse,
	VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import { errorResponse, isAllowedRequestOrigin, jsonResponse, parseJson, type ProtectedRouteContext, type RouteContext } from '../http';
import {
	createSession,
	createUserWithCredential,
	deleteAuthChallenge,
	deleteSessionByToken,
	deleteUserSessions,
	getUserByUsername,
	getUserCredentials,
	getValidAuthChallenge,
	storeAuthChallenge,
	updateCredentialCounter,
} from '../storage';

const RP_NAME = 'KeepRoot';
const MIN_AUTH_RESPONSE_MS = 150;

async function withMinimumAuthDuration(task: () => Promise<Response>): Promise<Response> {
	const startedAt = Date.now();
	const response = await task();
	const remainingMs = MIN_AUTH_RESPONSE_MS - (Date.now() - startedAt);
	if (remainingMs > 0) {
		await new Promise((resolve) => setTimeout(resolve, remainingMs));
	}
	return response;
}

function isRegistrationAllowed(context: RouteContext): boolean {
	return context.env.ALLOW_REGISTRATION === '1';
}

async function loadWebAuthn() {
	return import('@simplewebauthn/server');
}

function createDecoyCredentialId(): string {
	// Keep unknown-user responses generic and credential-shaped without allowing
	// Safari to choose a passkey registered to a different KeepRoot username.
	return crypto.randomUUID().replaceAll('-', '');
}

function getExpectedOrigins(context: RouteContext): string[] {
	const requestOrigin = context.request.headers.get('Origin');
	const expectedOrigins = [context.origin];

	if (requestOrigin && requestOrigin !== context.origin && isAllowedRequestOrigin(requestOrigin, context.origin, context.env)) {
		expectedOrigins.push(requestOrigin);
	}

	return expectedOrigins;
}

async function handleGenerateRegistration(context: RouteContext): Promise<Response> {
	if (!isRegistrationAllowed(context)) {
		return errorResponse(context.request, 'Registration is disabled', 403);
	}

	try {
		const { username } = await parseJson<{ username?: string }>(context.request);
		const normalizedUsername = username?.trim();
		if (!normalizedUsername) {
			return errorResponse(context.request, 'Username required', 400);
		}

		const { generateRegistrationOptions } = await loadWebAuthn();
		const userId = crypto.randomUUID();
		const options = await generateRegistrationOptions({
			attestationType: 'none',
			authenticatorSelection: {
				residentKey: 'required',
				userVerification: 'preferred',
			},
			rpID: context.rpID,
			rpName: RP_NAME,
			userID: new TextEncoder().encode(userId) as unknown as Uint8Array<ArrayBuffer>,
			userName: normalizedUsername,
		});

		await storeAuthChallenge(context.env, {
			challenge: options.challenge,
			type: 'registration',
			userId,
			username: normalizedUsername,
		});

		return jsonResponse(context.request, options);
	} catch (error) {
		console.error(error);
		return errorResponse(context.request, 'Invalid request', 400);
	}
}

async function handleVerifyRegistration(context: RouteContext): Promise<Response> {
	if (!isRegistrationAllowed(context)) {
		return errorResponse(context.request, 'Registration is disabled', 403);
	}

	try {
		const body = await parseJson<{ response: RegistrationResponseJSON; username?: string }>(context.request);
		const normalizedUsername = body.username?.trim();
		if (!normalizedUsername || !body.response) {
			return errorResponse(context.request, 'Invalid registration payload', 400);
		}

		const challenge = await getValidAuthChallenge(context.env, normalizedUsername, 'registration');
		if (!challenge?.user_id) {
			return errorResponse(context.request, 'Registration failed', 400);
		}

		const expectedOrigins = getExpectedOrigins(context);
		const { verifyRegistrationResponse } = await loadWebAuthn();
		let verification: VerifiedRegistrationResponse;
		try {
			verification = await verifyRegistrationResponse({
				expectedChallenge: challenge.challenge,
				expectedOrigin: expectedOrigins,
				expectedRPID: context.rpID,
				response: body.response,
			});
		} catch (error) {
			console.error(error);
			return errorResponse(context.request, 'Registration failed', 400);
		}

		if (!verification.verified || !verification.registrationInfo) {
			return errorResponse(context.request, 'Registration failed', 400);
		}

		const existingUser = await getUserByUsername(context.env, normalizedUsername);
		if (existingUser) {
			return errorResponse(context.request, 'Registration failed', 400);
		}

		const { credential, credentialBackedUp, credentialDeviceType } = verification.registrationInfo;
		await createUserWithCredential(context.env, normalizedUsername, challenge.user_id, {
			backedUp: credentialBackedUp,
			counter: credential.counter,
			credentialId: credential.id,
			deviceType: credentialDeviceType ?? null,
			publicKey: new Uint8Array(credential.publicKey),
			transports: credential.transports,
		});
		await deleteAuthChallenge(context.env, normalizedUsername, 'registration');

		const token = await createSession(context.env, {
			userId: challenge.user_id,
			username: normalizedUsername,
		});

		return jsonResponse(context.request, { token, verified: true });
	} catch (error) {
		console.error(error);
		return errorResponse(context.request, 'Registration failed', 400);
	}
}

async function handleGenerateAuthentication(context: RouteContext): Promise<Response> {
	try {
		const { username } = await parseJson<{ username?: string }>(context.request);
		const normalizedUsername = username?.trim();
		if (!normalizedUsername) {
			return errorResponse(context.request, 'Username required', 400);
		}

		const [user, credentials] = await Promise.all([
			getUserByUsername(context.env, normalizedUsername),
			getUserCredentials(context.env, normalizedUsername),
		]);
		const allowCredentials = credentials.length > 0
			? credentials.map((credential) => ({
				id: credential.credentialId,
				transports: credential.transports as AuthenticatorTransportFuture[] | undefined,
			}))
			: [{
				id: createDecoyCredentialId(),
				transports: ['internal', 'hybrid'] as AuthenticatorTransportFuture[],
			}];

		const { generateAuthenticationOptions } = await loadWebAuthn();
		const options = await generateAuthenticationOptions({
			allowCredentials,
			rpID: context.rpID,
			userVerification: 'preferred',
		});

		await storeAuthChallenge(context.env, {
			challenge: options.challenge,
			type: 'authentication',
			userId: user?.id ?? crypto.randomUUID(),
			username: normalizedUsername,
		});

		return jsonResponse(context.request, options);
	} catch (error) {
		console.error(error);
		return errorResponse(context.request, 'Invalid request', 400);
	}
}

async function handleVerifyAuthentication(context: RouteContext): Promise<Response> {
	try {
		const body = await parseJson<{ response: AuthenticationResponseJSON; username?: string }>(context.request);
		const normalizedUsername = body.username?.trim();
		if (!normalizedUsername || !body.response) {
			return errorResponse(context.request, 'Invalid authentication payload', 400);
		}

		const challenge = await getValidAuthChallenge(context.env, normalizedUsername, 'authentication');
		if (!challenge) {
			return errorResponse(context.request, 'Authentication failed', 400);
		}

		const user = await getUserByUsername(context.env, normalizedUsername);
		if (!user) {
			return errorResponse(context.request, 'Authentication failed', 400);
		}

		const authenticators = await getUserCredentials(context.env, normalizedUsername);
		const authenticator = authenticators.find((credential) => credential.credentialId === body.response.rawId);
		if (!authenticator) {
			return errorResponse(context.request, 'Authentication failed', 400);
		}

		const expectedOrigins = getExpectedOrigins(context);
		const { verifyAuthenticationResponse } = await loadWebAuthn();
		let verification: VerifiedAuthenticationResponse;
		try {
			verification = await verifyAuthenticationResponse({
				credential: {
					counter: authenticator.counter,
					id: authenticator.credentialId,
					publicKey: authenticator.publicKey as unknown as Uint8Array<ArrayBuffer>,
					transports: authenticator.transports as AuthenticatorTransportFuture[] | undefined,
				},
				expectedChallenge: challenge.challenge,
				expectedOrigin: expectedOrigins,
				expectedRPID: context.rpID,
				response: body.response,
			});
		} catch (error) {
			console.error(error);
			return errorResponse(context.request, 'Authentication failed', 400);
		}

		if (!verification.verified || !verification.authenticationInfo) {
			return errorResponse(context.request, 'Authentication failed', 400);
		}

		await updateCredentialCounter(context.env, normalizedUsername, authenticator.credentialId, verification.authenticationInfo.newCounter);
		await deleteAuthChallenge(context.env, normalizedUsername, 'authentication');

		const token = await createSession(context.env, {
			userId: user.id,
			username: normalizedUsername,
		});

		return jsonResponse(context.request, { token, verified: true });
	} catch (error) {
		console.error(error);
		return errorResponse(context.request, 'Authentication failed', 400);
	}
}

export async function handleAuthRoute(context: RouteContext): Promise<Response | undefined> {
	if (context.request.method === 'POST') {
		switch (context.pathname) {
			case '/auth/generate-registration':
				return withMinimumAuthDuration(() => handleGenerateRegistration(context));
			case '/auth/verify-registration':
				return withMinimumAuthDuration(() => handleVerifyRegistration(context));
			case '/auth/generate-authentication':
				return withMinimumAuthDuration(() => handleGenerateAuthentication(context));
			case '/auth/verify-authentication':
				return withMinimumAuthDuration(() => handleVerifyAuthentication(context));
		}
	}

	return undefined;
}

export async function handleProtectedAuthRoute(context: ProtectedRouteContext): Promise<Response | undefined> {
	if (context.request.method !== 'POST' || (context.pathname !== '/auth/logout' && context.pathname !== '/auth/logout-all')) {
		return undefined;
	}

	if (context.authUser.tokenType !== 'session') {
		return errorResponse(context.request, 'Session authentication required', 403);
	}

	if (context.pathname === '/auth/logout-all') {
		const revoked = await deleteUserSessions(context.env, context.authUser.userId);
		return jsonResponse(context.request, { revoked });
	}

	const authorization = context.request.headers.get('Authorization');
	const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
	await deleteSessionByToken(context.env, token);
	return jsonResponse(context.request, { message: 'Logged out' });
}
