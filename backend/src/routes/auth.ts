import type {
	AuthenticationResponseJSON,
	AuthenticatorTransportFuture,
	RegistrationResponseJSON,
	VerifiedAuthenticationResponse,
	VerifiedRegistrationResponse,
} from '@simplewebauthn/server';
import { clearDashboardSessionCookie, createDashboardSessionCookie, errorResponse, getRequestAuthToken, isAllowedRequestOrigin, jsonResponse, parseJson, type ProtectedRouteContext, type RouteContext } from '../http';
import {
	createSession,
	createUserWithCredential,
	deleteAuthChallenge,
	deleteSessionByToken,
	deleteUserSessions,
	getLatestAuthChallengeUserId,
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

function getAuthenticationOrigin(context: RouteContext): string {
	const configuredOrigin = context.env.AUTH_ORIGIN?.trim();
	if (!configuredOrigin) {
		return context.origin;
	}

	try {
		return new URL(configuredOrigin).origin;
	} catch {
		return context.origin;
	}
}

function getAllowedPreviewOrigin(context: ProtectedRouteContext): string | null {
	const authenticationOrigin = getAuthenticationOrigin(context);
	if (context.origin !== authenticationOrigin) {
		return null;
	}

	const returnTo = context.url.searchParams.get('return_to');
	if (!returnTo) {
		return null;
	}

	try {
		const authenticationUrl = new URL(authenticationOrigin);
		const previewUrl = new URL(returnTo);
		const authenticationLabels = authenticationUrl.hostname.split('.');
		const previewLabels = previewUrl.hostname.split('.');
		const matchesWorkerPreviewHostname = previewLabels.length === authenticationLabels.length
			&& previewLabels[0].endsWith(`-${authenticationLabels[0]}`)
			&& previewLabels.slice(1).every((label, index) => label === authenticationLabels[index + 1]);
		const isOriginOnly = returnTo === previewUrl.origin || returnTo === `${previewUrl.origin}/`;

		if (!matchesWorkerPreviewHostname
			|| !isOriginOnly
			|| previewUrl.protocol !== authenticationUrl.protocol
			|| previewUrl.port !== authenticationUrl.port) {
			return null;
		}

		return previewUrl.origin;
	} catch {
		return null;
	}
}

async function loadWebAuthn() {
	return import('@simplewebauthn/server');
}

function createDecoyCredentialId(challengeUserId: string): string {
	// Unknown usernames reuse an opaque server-generated value so repeated
	// requests do not reveal whether the returned credential ID is genuine.
	return challengeUserId.replaceAll('-', '');
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

		return jsonResponse(context.request, { token, verified: true }, 200, {
			'Set-Cookie': createDashboardSessionCookie(context.request, token),
		});
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

		const [user, credentials, previousChallengeUserId] = await Promise.all([
			getUserByUsername(context.env, normalizedUsername),
			getUserCredentials(context.env, normalizedUsername),
			getLatestAuthChallengeUserId(context.env, normalizedUsername, 'authentication'),
		]);
		const challengeUserId = user?.id ?? previousChallengeUserId ?? crypto.randomUUID();
		const allowCredentials = credentials.length > 0
			? credentials.map((credential) => ({
				id: credential.credentialId,
			}))
			: [{
				id: createDecoyCredentialId(challengeUserId),
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
			userId: challengeUserId,
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

		return jsonResponse(context.request, { token, verified: true }, 200, {
			'Set-Cookie': createDashboardSessionCookie(context.request, token),
		});
	} catch (error) {
		console.error(error);
		return errorResponse(context.request, 'Authentication failed', 400);
	}
}

export async function handleAuthRoute(context: RouteContext): Promise<Response | undefined> {
	if (context.request.method === 'GET' && context.pathname === '/auth/context') {
		const authenticationOrigin = getAuthenticationOrigin(context);
		return jsonResponse(context.request, {
			authenticationOrigin,
			requiresHandoff: authenticationOrigin !== context.origin,
		});
	}

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
	if (context.request.method === 'GET' && context.pathname === '/auth/preview-session') {
		if (context.authUser.tokenType !== 'session') {
			return errorResponse(context.request, 'Session authentication required', 403);
		}

		const previewOrigin = getAllowedPreviewOrigin(context);
		if (!previewOrigin) {
			return errorResponse(context.request, 'Invalid preview return origin', 400);
		}

		const token = await createSession(context.env, context.authUser, { scopeOrigin: previewOrigin });
		const location = new URL(previewOrigin);
		location.hash = new URLSearchParams({ preview_session: token }).toString();
		return new Response(null, {
			headers: { Location: location.toString() },
			status: 302,
		});
	}

	if (context.request.method !== 'POST' || (context.pathname !== '/auth/logout' && context.pathname !== '/auth/logout-all')) {
		return undefined;
	}

	if (context.authUser.tokenType !== 'session') {
		return errorResponse(context.request, 'Session authentication required', 403);
	}

	if (context.pathname === '/auth/logout-all') {
		const revoked = await deleteUserSessions(context.env, context.authUser.userId);
		return jsonResponse(context.request, { revoked }, 200, {
			'Set-Cookie': clearDashboardSessionCookie(context.request),
		});
	}

	const requestAuth = getRequestAuthToken(context.request);
	if (requestAuth) {
		await deleteSessionByToken(context.env, requestAuth.token);
	}
	return jsonResponse(context.request, { message: 'Logged out' }, 200, {
		'Set-Cookie': clearDashboardSessionCookie(context.request),
	});
}
