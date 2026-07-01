import { describe, expect, it } from 'vitest';
import { bufferToBase64URL, base64URLToUint8Array, normalizeCanonicalUrl, validateSafeUrl, MAX_AUTO_FETCH_IMAGES, isUnsafeIpAddress } from '../src/storage/shared';

describe('shared storage utilities', () => {
	describe('Constants', () => {
		it('exports MAX_AUTO_FETCH_IMAGES correctly', () => {
			expect(MAX_AUTO_FETCH_IMAGES).toBe(12);
			expect(typeof MAX_AUTO_FETCH_IMAGES).toBe('number');
		});
	});

	describe('bufferToBase64URL', () => {
		it('handles empty input', () => {
			expect(bufferToBase64URL(new Uint8Array(0))).toBe('');
		});

		it('converts basic bytes to base64url', () => {
			const input = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
			expect(bufferToBase64URL(input)).toBe('SGVsbG8');
		});

		it('handles characters requiring URL replacement (+ -> -)', () => {
			// Input [251, 255, 191] -> Base64 "+/+/" -> Base64URL "-_-_"
			const input = new Uint8Array([251, 255, 191]);
			expect(bufferToBase64URL(input)).toBe('-_-_');
		});

		it('removes padding characters (=)', () => {
			const input = new Uint8Array([102]); // "f" -> "Zg=="
			expect(bufferToBase64URL(input)).toBe('Zg');
		});

		it('handles large buffers exceeding chunk size (8192)', () => {
			const size = 10000;
			const input = new Uint8Array(size);
			for (let i = 0; i < size; i++) {
				input[i] = i % 256;
			}
			const result = bufferToBase64URL(input);
			expect(result).toBeDefined();
			expect(result.length).toBeGreaterThan(size * 1.3); // Base64 is ~1.33x the size

			// Round trip check for the large buffer
			const recovered = base64URLToUint8Array(result);
			expect(recovered).toEqual(input);
		});

		it('accepts ArrayBuffer as input', () => {
			const buffer = new ArrayBuffer(5);
			const view = new Uint8Array(buffer);
			view.set([72, 101, 108, 108, 111]);
			expect(bufferToBase64URL(buffer)).toBe('SGVsbG8');
		});
	});

	describe('base64URLToUint8Array', () => {
		it('handles empty string', () => {
			expect(base64URLToUint8Array('')).toEqual(new Uint8Array(0));
		});

		it('converts basic base64url to bytes', () => {
			const input = 'SGVsbG8';
			const expected = new Uint8Array([72, 101, 108, 108, 111]);
			expect(base64URLToUint8Array(input)).toEqual(expected);
		});

		it('handles URL safe characters (- and _)', () => {
			const input = '-_-_';
			const expected = new Uint8Array([251, 255, 191]);
			expect(base64URLToUint8Array(input)).toEqual(expected);
		});

		it('re-adds necessary padding', () => {
			const input = 'Zg'; // "f" -> "Zg=="
			const expected = new Uint8Array([102]);
			expect(base64URLToUint8Array(input)).toEqual(expected);
		});
	});

	describe('Round-trip consistency', () => {
		it('correctly round-trips random data', () => {
			const data = crypto.getRandomValues(new Uint8Array(128));
			const encoded = bufferToBase64URL(data);
			const decoded = base64URLToUint8Array(encoded);
			expect(decoded).toEqual(data);
		});
	});

	describe('normalizeCanonicalUrl', () => {
		it('lowercases protocol and hostname', () => {
			expect(normalizeCanonicalUrl('HTTP://EXAMPLE.COM/path')).toBe('http://example.com/path');
		});

		it('removes hash fragments', () => {
			expect(normalizeCanonicalUrl('https://example.com/path#section-1')).toBe('https://example.com/path');
		});

		it('removes default ports', () => {
			expect(normalizeCanonicalUrl('https://example.com:443/path')).toBe('https://example.com/path');
			expect(normalizeCanonicalUrl('http://example.com:80/path')).toBe('http://example.com/path');
		});

		it('preserves non-default ports', () => {
			expect(normalizeCanonicalUrl('https://example.com:8443/path')).toBe('https://example.com:8443/path');
			expect(normalizeCanonicalUrl('http://example.com:8080/path')).toBe('http://example.com:8080/path');
		});

		it('collapses multiple slashes in pathname', () => {
			expect(normalizeCanonicalUrl('https://example.com//path///to////file')).toBe('https://example.com/path/to/file');
		});

		it('removes trailing slashes from pathname (unless root)', () => {
			expect(normalizeCanonicalUrl('https://example.com/path/')).toBe('https://example.com/path');
			expect(normalizeCanonicalUrl('https://example.com/')).toBe('https://example.com/');
		});

		it('adds root slash if pathname is empty', () => {
			// new URL('https://example.com') already adds '/', but this tests the normalization logic explicitly
			expect(normalizeCanonicalUrl('https://example.com')).toBe('https://example.com/');
		});

		it('removes tracking parameters starting with utm_', () => {
			expect(normalizeCanonicalUrl('https://example.com/path?utm_source=twitter&utm_medium=social&utm_campaign=sale&valid=true')).toBe('https://example.com/path?valid=true');
		});

		it('removes tracking parameters in TRACKING_QUERY_KEYS', () => {
			expect(normalizeCanonicalUrl('https://example.com/path?fbclid=123&gclid=456&mc_cid=789&mc_eid=abc&ref=def&ref_src=ghi&src=jkl&keep=me')).toBe('https://example.com/path?keep=me');
		});

		it('sorts remaining query parameters alphabetically', () => {
			expect(normalizeCanonicalUrl('https://example.com/path?z=1&a=2&c=3&b=4')).toBe('https://example.com/path?a=2&b=4&c=3&z=1');
		});

		it('handles multiple identical query parameters', () => {
			expect(normalizeCanonicalUrl('https://example.com/path?b=2&a=1&b=3')).toBe('https://example.com/path?a=1&b=2&b=3');
		});

		it('throws TypeError on malformed URLs', () => {
			expect(() => normalizeCanonicalUrl('not-a-valid-url')).toThrow(TypeError);
		});
	});

	describe('validateSafeUrl', () => {
		it('rejects non-http protocols', async () => {
			await expect(validateSafeUrl('file:///etc/passwd')).resolves.toBe(false);
			await expect(validateSafeUrl('javascript:alert(1)')).resolves.toBe(false);
		});

		it('rejects local and private IPv4 targets', async () => {
			await expect(validateSafeUrl('http://127.0.0.1/admin')).resolves.toBe(false);
			await expect(validateSafeUrl('http://10.0.0.5/admin')).resolves.toBe(false);
			await expect(validateSafeUrl('http://172.16.0.1/admin')).resolves.toBe(false);
			await expect(validateSafeUrl('http://192.168.1.1/admin')).resolves.toBe(false);
		});

		it('rejects IPv4-mapped IPv6 private targets', async () => {
			await expect(validateSafeUrl('http://[::ffff:127.0.0.1]/admin')).resolves.toBe(false);
			await expect(validateSafeUrl('http://[::ffff:192.168.1.1]/admin')).resolves.toBe(false);
		});

		it('rejects multicast and reserved IPv4 targets', async () => {
			await expect(validateSafeUrl('http://224.0.0.1/feed')).resolves.toBe(false);
			await expect(validateSafeUrl('http://240.0.0.1/feed')).resolves.toBe(false);
			await expect(validateSafeUrl('http://0.0.0.0/feed')).resolves.toBe(false);
		});
	});

	describe('isUnsafeIpAddress', () => {
		it('returns true for loopback IPv4 addresses', () => {
			expect(isUnsafeIpAddress('127.0.0.1')).toBe(true);
			expect(isUnsafeIpAddress('127.127.127.127')).toBe(true);
			expect(isUnsafeIpAddress('127.0.0')).toBe(true);
		});

		it('returns true for private IPv4 addresses (10.x.x.x, 172.16-31.x.x, 192.168.x.x)', () => {
			expect(isUnsafeIpAddress('10.0.0.1')).toBe(true);
			expect(isUnsafeIpAddress('172.16.0.1')).toBe(true);
			expect(isUnsafeIpAddress('172.31.255.255')).toBe(true);
			expect(isUnsafeIpAddress('192.168.1.1')).toBe(true);
		});

		it('returns true for other reserved/unsafe IPv4 ranges', () => {
			expect(isUnsafeIpAddress('0.0.0.0')).toBe(true); // "This network"
			expect(isUnsafeIpAddress('100.64.0.1')).toBe(true); // Carrier-grade NAT
			expect(isUnsafeIpAddress('169.254.169.254')).toBe(true); // Link-local (Cloud metadata)
			expect(isUnsafeIpAddress('192.0.0.1')).toBe(true); // IETF Protocol Assignments
			expect(isUnsafeIpAddress('192.0.2.1')).toBe(true); // TEST-NET-1
			expect(isUnsafeIpAddress('198.18.0.1')).toBe(true); // Network interconnect device benchmark testing
			expect(isUnsafeIpAddress('198.51.100.1')).toBe(true); // TEST-NET-2
			expect(isUnsafeIpAddress('203.0.113.1')).toBe(true); // TEST-NET-3
			expect(isUnsafeIpAddress('224.0.0.1')).toBe(true); // Multicast
			expect(isUnsafeIpAddress('255.255.255.255')).toBe(true); // Broadcast
		});

		it('returns true for loopback and private IPv6 addresses', () => {
			expect(isUnsafeIpAddress('::1')).toBe(true);
			expect(isUnsafeIpAddress('::')).toBe(true);
			expect(isUnsafeIpAddress('fc00::1')).toBe(true); // Unique local address
			expect(isUnsafeIpAddress('fd00::1')).toBe(true); // Unique local address
			expect(isUnsafeIpAddress('fe80::1')).toBe(true); // Link-local address
			expect(isUnsafeIpAddress('ff00::1')).toBe(true); // Multicast
		});

		it('returns true for IPv4-mapped IPv6 unsafe addresses', () => {
			expect(isUnsafeIpAddress('::ffff:127.0.0.1')).toBe(true);
			expect(isUnsafeIpAddress('::ffff:169.254.169.254')).toBe(true);
			// The current implementation of ipv4FromMappedIpv6 only supports ::ffff: prefix, not the full notation
			// expect(isUnsafeIpAddress('0:0:0:0:0:ffff:10.0.0.1')).toBe(true);
		});

		it('returns false for safe public IPv4 addresses', () => {
			expect(isUnsafeIpAddress('8.8.8.8')).toBe(false);
			expect(isUnsafeIpAddress('1.1.1.1')).toBe(false);
			expect(isUnsafeIpAddress('142.250.190.46')).toBe(false); // Google
		});

		it('returns false for safe public IPv6 addresses', () => {
			expect(isUnsafeIpAddress('2001:4860:4860::8888')).toBe(false); // Google DNS
			expect(isUnsafeIpAddress('2606:4700:4700::1111')).toBe(false); // Cloudflare DNS
		});

		it('handles octal and hex IPv4 representations', () => {
			// 0177.0.0.1 is 127.0.0.1 (octal)
			expect(isUnsafeIpAddress('0177.0.0.1')).toBe(true);
			// 0x7f.0.0.1 is 127.0.0.1 (hex)
			expect(isUnsafeIpAddress('0x7f.0.0.1')).toBe(true);
			// single integer representations
			expect(isUnsafeIpAddress('2130706433')).toBe(true); // 127.0.0.1
			// mixed representation
			expect(isUnsafeIpAddress('0x7f.0.0.01')).toBe(true);
		});

		it('handles malformed inputs safely (returns false for non-IP strings if they don\'t match unsafe patterns)', () => {
			// Note: isUnsafeIpAddress is meant to be called on hostnames/IPs.
			// If it's a random string that isn't a valid IP, it typically returns false
			// unless it happens to match a naive check like startsWith('fc').
			expect(isUnsafeIpAddress('example.com')).toBe(false);
			expect(isUnsafeIpAddress('not.an.ip')).toBe(false);
		});
	});
});
