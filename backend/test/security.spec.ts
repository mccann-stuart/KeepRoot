import { describe, expect, it } from 'vitest';
import { validateSafeUrl, parseStringArray } from '../src/storage/shared';
import { applyCorsHeaders } from '../src/http';

describe('security utilities', () => {
	describe('validateSafeUrl', () => {
		it('allows public http and https URLs', () => {
			expect(() => validateSafeUrl('https://example.com')).not.toThrow();
			expect(() => validateSafeUrl('http://google.com/search?q=test')).not.toThrow();
		});

		it('throws on invalid URLs', () => {
			expect(() => validateSafeUrl('not-a-url')).toThrow('Invalid URL');
		});

		it('throws on non-http/https protocols', () => {
			expect(() => validateSafeUrl('ftp://example.com')).toThrow('Only http and https protocols are allowed');
			expect(() => validateSafeUrl('file:///etc/passwd')).toThrow('Only http and https protocols are allowed');
			expect(() => validateSafeUrl('javascript:alert(1)')).toThrow('Only http and https protocols are allowed');
		});

		it('blocks local hostnames', () => {
			expect(() => validateSafeUrl('http://localhost')).toThrow('Access to local network is restricted');
			expect(() => validateSafeUrl('https://localhost:8080')).toThrow('Access to local network is restricted');
			expect(() => validateSafeUrl('http://127.0.0.1')).toThrow('Access to local network is restricted');
			expect(() => validateSafeUrl('http://[::1]')).toThrow('Access to local network is restricted');
			expect(() => validateSafeUrl('http://myserver.local')).toThrow('Access to local network is restricted');
			expect(() => validateSafeUrl('http://internal.service.internal')).toThrow('Access to local network is restricted');
		});

		it('blocks private IPv4 ranges', () => {
			expect(() => validateSafeUrl('http://10.0.0.1')).toThrow('Access to private IP ranges is restricted');
			expect(() => validateSafeUrl('http://172.16.0.1')).toThrow('Access to private IP ranges is restricted');
			expect(() => validateSafeUrl('http://172.31.255.255')).toThrow('Access to private IP ranges is restricted');
			expect(() => validateSafeUrl('http://192.168.1.1')).toThrow('Access to private IP ranges is restricted');
			expect(() => validateSafeUrl('http://169.254.169.254')).toThrow('Access to private IP ranges is restricted');
			expect(() => validateSafeUrl('http://127.0.0.1')).toThrow('Access to local network is restricted'); // Already covered by host check but pattern also hits
		});

		it('blocks 0.0.0.0', () => {
			expect(() => validateSafeUrl('http://0.0.0.0')).toThrow('Access to local network is restricted');
		});
	});

	describe('applyCorsHeaders', () => {
		const requestUrl = 'https://keeproot.local/api/test';

		it('allows origin matching request origin', () => {
			const request = new Request(requestUrl, {
				headers: { Origin: 'https://keeproot.local' }
			});
			const headers = new Headers();
			applyCorsHeaders(request, headers);
			expect(headers.get('Access-Control-Allow-Origin')).toBe('https://keeproot.local');
		});

		it('blocks unauthorized extension origins', () => {
			const request = new Request(requestUrl, {
				headers: { Origin: 'chrome-extension://malicious-id' }
			});
			const headers = new Headers();
			applyCorsHeaders(request, headers, { ALLOWED_EXTENSION_IDS: '["safe-id"]' } as any);
			expect(headers.get('Access-Control-Allow-Origin')).toBeNull();
		});

		it('allows authorized extension origins', () => {
			const request = new Request(requestUrl, {
				headers: { Origin: 'chrome-extension://safe-id' }
			});
			const headers = new Headers();
			applyCorsHeaders(request, headers, { ALLOWED_EXTENSION_IDS: '["safe-id"]' } as any);
			expect(headers.get('Access-Control-Allow-Origin')).toBe('chrome-extension://safe-id');
		});

		it('handles multiple authorized extension IDs', () => {
			const request = new Request(requestUrl, {
				headers: { Origin: 'moz-extension://safe-id-2' }
			});
			const headers = new Headers();
			applyCorsHeaders(request, headers, { ALLOWED_EXTENSION_IDS: '["safe-id-1", "safe-id-2"]' } as any);
			expect(headers.get('Access-Control-Allow-Origin')).toBe('moz-extension://safe-id-2');
		});

		it('denies other origins by default', () => {
			const request = new Request(requestUrl, {
				headers: { Origin: 'https://evil.com' }
			});
			const headers = new Headers();
			applyCorsHeaders(request, headers);
			expect(headers.get('Access-Control-Allow-Origin')).toBeNull();
		});
	});
});
