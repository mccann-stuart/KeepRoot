import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';
import type { VerifiedAuthenticationResponse, VerifiedRegistrationResponse } from '@simplewebauthn/server';
import { errorResponse, jsonResponse, parseJson, type RouteContext } from '../http';
import {
	createSession,
	createUserWithCredential,
	deleteAuthChallenge,
	getUserByUsername,
	getUserCredentials,
	getValidAuthChallenge,
	storeAuthChallenge,
	updateCredentialCounter,
} from '../storage';

const RP_NAME = 'KeepRoot';

async function loadWebAuthn() {
	return import('@simplewebauthn/server');
}

function getExpectedOrigins(context: RouteContext): string[] {
	const requestOrigin = context.request.headers.get('Origin');
	const expectedOrigins = [context.origin];

	if (requestOrigin && /^(chrome-extension|moz-extension|safari-web-extension):\/\//.test(requestOrigin)) {
		expectedOrigins.push(requestOrigin);
	}

	return expectedOrigins;
}

export async function handleAuthRoute(context: RouteContext): Promise<Response | undefined> {
	if (context.request.method === 'POST' && context.pathname === '/auth/generate-registration') {
		try {
			const { username } = await parseJson<{ username?: string }>(context.request);
			const normalizedUsername = username?.trim();
			if (!normalizedUsername) {
				return errorResponse(context.request, 'Username required', 400);
			}

			const existingUser = await getUserByUsername(context.env, normalizedUsername);
			if (existingUser) {
				return errorResponse(context.request, 'User already exists', 400);
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

	if (context.request.method === 'POST' && context.pathname === '/auth/verify-registration') {
		try {
			const body = await parseJson<{ response: any; username?: string }>(context.request);
			const normalizedUsername = body.username?.trim();
			if (!normalizedUsername || !body.response) {
				return errorResponse(context.request, 'Invalid registration payload', 400);
			}

			const challenge = await getValidAuthChallenge(context.env, normalizedUsername, 'registration');
			if (!challenge?.user_id) {
				return errorResponse(context.request, 'Session expired', 400);
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
				return errorResponse(context.request, 'Verification failed', 400);
			}

			if (!verification.verified || !verification.registrationInfo) {
				return errorResponse(context.request, 'Verification failed', 400);
			}

			const existingUser = await getUserByUsername(context.env, normalizedUsername);
			if (existingUser) {
				return errorResponse(context.request, 'User already exists', 400);
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
			return errorResponse(context.request, 'Unable to verify registration', 500);
		}
	}

	if (context.request.method === 'POST' && context.pathname === '/auth/generate-authentication') {
		try {
			const { username } = await parseJson<{ username?: string }>(context.request);
			const normalizedUsername = username?.trim();
			if (!normalizedUsername) {
				return errorResponse(context.request, 'Username required', 400);
			}

			const user = await getUserByUsername(context.env, normalizedUsername);
			if (!user) {
				return errorResponse(context.request, 'User not found', 404);
			}

			const { generateAuthenticationOptions } = await loadWebAuthn();
			const credentials = await getUserCredentials(context.env, normalizedUsername);
			const options = await generateAuthenticationOptions({
				allowCredentials: credentials.map((credential) => ({
					id: credential.credentialId,
					transports: credential.transports as AuthenticatorTransportFuture[] | undefined,
				})),
				rpID: context.rpID,
				userVerification: 'preferred',
			});

			await storeAuthChallenge(context.env, {
				challenge: options.challenge,
				type: 'authentication',
				userId: user.id,
				username: normalizedUsername,
			});

			return jsonResponse(context.request, options);
		} catch (error) {
			console.error(error);
			return errorResponse(context.request, 'Invalid request', 400);
		}
	}

	if (context.request.method === 'POST' && context.pathname === '/auth/verify-authentication') {
		try {
			const body = await parseJson<{ response: any; username?: string }>(context.request);
			const normalizedUsername = body.username?.trim();
			if (!normalizedUsername || !body.response) {
				return errorResponse(context.request, 'Invalid authentication payload', 400);
			}

			const challenge = await getValidAuthChallenge(context.env, normalizedUsername, 'authentication');
			if (!challenge) {
				return errorResponse(context.request, 'Session expired', 400);
			}

			const user = await getUserByUsername(context.env, normalizedUsername);
			if (!user) {
				return errorResponse(context.request, 'User not found', 404);
			}

			const authenticators = await getUserCredentials(context.env, normalizedUsername);
			const authenticator = authenticators.find((credential) => credential.credentialId === body.response.rawId);
			if (!authenticator) {
				return errorResponse(context.request, 'Authenticator not registered', 400);
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
				return errorResponse(context.request, 'Verification failed', 400);
			}

			if (!verification.verified || !verification.authenticationInfo) {
				return errorResponse(context.request, 'Verification failed', 400);
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
			return errorResponse(context.request, 'Unable to verify authentication', 500);
		}
	}

	return undefined;
}
