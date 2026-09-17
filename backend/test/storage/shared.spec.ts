import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hexFromBytes, isUnsafeIpAddress, readBoundedResponseBytes, readBoundedResponseText, runSchemaStatement } from '../../src/storage/shared';

describe('shared storage', () => {
    describe('hexFromBytes', () => {
        it('returns an empty string for an empty Uint8Array', () => {
            expect(hexFromBytes(new Uint8Array())).toBe('');
        });

        it('returns correct hex for single bytes', () => {
            expect(hexFromBytes(new Uint8Array([0]))).toBe('00');
            expect(hexFromBytes(new Uint8Array([15]))).toBe('0f');
            expect(hexFromBytes(new Uint8Array([16]))).toBe('10');
            expect(hexFromBytes(new Uint8Array([255]))).toBe('ff');
        });

        it('returns correct hex for multiple bytes', () => {
            expect(hexFromBytes(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe('deadbeef');
            expect(hexFromBytes(new Uint8Array([0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef]))).toBe('0123456789abcdef');
        });
    });

    describe('runSchemaStatement', () => {
        beforeEach(() => {
            vi.restoreAllMocks();
        });

        it('executes the sql statement correctly with normalized whitespace', async () => {
            const execSpy = vi.spyOn(env.KEEPROOT_DB, 'exec').mockResolvedValue({} as any);

            await runSchemaStatement(env as any, '  CREATE   TABLE   test  ( id TEXT )  ');

            expect(execSpy).toHaveBeenCalledWith('CREATE TABLE test ( id TEXT )');
        });

        it('swallows errors containing "duplicate column name"', async () => {
            const execSpy = vi.spyOn(env.KEEPROOT_DB, 'exec').mockRejectedValue(new Error('SQLITE_ERROR: duplicate column name: test'));

            await expect(runSchemaStatement(env as any, 'ALTER TABLE test ADD COLUMN test TEXT')).resolves.toBeUndefined();
            expect(execSpy).toHaveBeenCalled();
        });

        it('swallows errors containing "already exists"', async () => {
            const execSpy = vi.spyOn(env.KEEPROOT_DB, 'exec').mockRejectedValue(new Error('SQLITE_ERROR: table test already exists'));

            await expect(runSchemaStatement(env as any, 'CREATE TABLE test ( id TEXT )')).resolves.toBeUndefined();
            expect(execSpy).toHaveBeenCalled();
        });

        it('rethrows other errors', async () => {
            const error = new Error('SQLITE_ERROR: syntax error');
            const execSpy = vi.spyOn(env.KEEPROOT_DB, 'exec').mockRejectedValue(error);

            await expect(runSchemaStatement(env as any, 'INVALID SQL')).rejects.toThrow('SQLITE_ERROR: syntax error');
            expect(execSpy).toHaveBeenCalled();
        });
    });

    describe('isUnsafeIpAddress', () => {
        it('identifies unsafe IPv4 addresses', () => {
            expect(isUnsafeIpAddress('127.0.0.1')).toBe(true);
            expect(isUnsafeIpAddress('10.0.0.1')).toBe(true);
            expect(isUnsafeIpAddress('192.168.1.1')).toBe(true);
            expect(isUnsafeIpAddress('172.16.0.1')).toBe(true);
            expect(isUnsafeIpAddress('172.31.255.255')).toBe(true);
            expect(isUnsafeIpAddress('169.254.1.1')).toBe(true);
            expect(isUnsafeIpAddress('224.0.0.1')).toBe(true);
            expect(isUnsafeIpAddress('0.0.0.0')).toBe(true);
            expect(isUnsafeIpAddress('255.255.255.255')).toBe(true);
        });

        it('identifies safe IPv4 addresses', () => {
            expect(isUnsafeIpAddress('8.8.8.8')).toBe(false);
            expect(isUnsafeIpAddress('1.1.1.1')).toBe(false);
            expect(isUnsafeIpAddress('192.0.1.1')).toBe(false);
        });

        it('identifies unsafe IPv6 addresses', () => {
            expect(isUnsafeIpAddress('::1')).toBe(true);
            expect(isUnsafeIpAddress('::')).toBe(true);
            expect(isUnsafeIpAddress('fe80::1')).toBe(true);
            expect(isUnsafeIpAddress('fc00::')).toBe(true);
            expect(isUnsafeIpAddress('fd00::1')).toBe(true);
            expect(isUnsafeIpAddress('ff00::')).toBe(true);
        });

        it('identifies safe IPv6 addresses', () => {
            expect(isUnsafeIpAddress('2001:4860:4860::8888')).toBe(false);
            expect(isUnsafeIpAddress('2606:4700:4700::1111')).toBe(false);
        });

        it('handles IPv4-mapped IPv6 addresses (dot-decimal)', () => {
            expect(isUnsafeIpAddress('::ffff:127.0.0.1')).toBe(true); // Unsafe mapped
            expect(isUnsafeIpAddress('::ffff:8.8.8.8')).toBe(false); // Safe mapped
        });

        it('handles IPv4-mapped IPv6 addresses (hex group)', () => {
            // 127.0.0.1 -> 7f00:0001
            expect(isUnsafeIpAddress('::ffff:7f00:0001')).toBe(true);
            expect(isUnsafeIpAddress('::ffff:7f00:1')).toBe(true); // Shortened

            // 8.8.8.8 -> 0808:0808
            expect(isUnsafeIpAddress('::ffff:0808:0808')).toBe(false);
        });

        it('handles bracketed IPv6 notation', () => {
            expect(isUnsafeIpAddress('[::1]')).toBe(true);
            expect(isUnsafeIpAddress('[2001:4860:4860::8888]')).toBe(false);
            expect(isUnsafeIpAddress('[::ffff:127.0.0.1]')).toBe(true);
        });

        it('handles malformed or invalid inputs gracefully', () => {
            // These don't match unsafe patterns, so they should return false
            expect(isUnsafeIpAddress('not-an-ip')).toBe(false);
            expect(isUnsafeIpAddress('')).toBe(false);
            expect(isUnsafeIpAddress('256.256.256.256')).toBe(false); // Invalid IPv4, safe default
            expect(isUnsafeIpAddress('1.2.3')).toBe(false);
        });
    });

    describe('readBoundedResponseBytes and readBoundedResponseText', () => {
        it('throws error when Content-Length header exceeds maximumBytes', async () => {
            const response = new Response(null, {
                headers: { 'Content-Length': '2048' },
            });
            await expect(readBoundedResponseBytes(response, 1024, 'Test label'))
                .rejects.toThrow('Test label exceeded the 1 KiB safety limit');
        });

        it('throws error and cancels body reader when stream exceeds limit mid-stream', async () => {
            let cancelCalled = false;
            const encoder = new TextEncoder();
            const chunk1 = encoder.encode('a'.repeat(800));
            const chunk2 = encoder.encode('b'.repeat(800));
            let readCount = 0;

            const mockReader = {
                read: vi.fn().mockImplementation(async () => {
                    readCount += 1;
                    if (readCount === 1) return { done: false, value: chunk1 };
                    if (readCount === 2) return { done: false, value: chunk2 };
                    return { done: true, value: undefined };
                }),
                cancel: vi.fn().mockImplementation(async () => {
                    cancelCalled = true;
                }),
                releaseLock: vi.fn(),
            };

            const mockResponse = {
                headers: new Headers(),
                body: {
                    getReader: () => mockReader,
                },
            } as unknown as Response;

            await expect(readBoundedResponseText(mockResponse, 1024, 'Stream test'))
                .rejects.toThrow('Stream test exceeded the 1 KiB safety limit');
            expect(cancelCalled).toBe(true);
            expect(mockReader.releaseLock).toHaveBeenCalled();
        });

        it('returns decoded text and Uint8Array bytes when stream is within limit', async () => {
            const sampleText = 'Hello, World!';
            const encoder = new TextEncoder();
            const response1 = new Response(encoder.encode(sampleText));
            const bytes = await readBoundedResponseBytes(response1, 1024, 'Valid test');
            expect(bytes).toEqual(encoder.encode(sampleText));

            const response2 = new Response(encoder.encode(sampleText));
            const text = await readBoundedResponseText(response2, 1024, 'Valid test');
            expect(text).toBe(sampleText);
        });
    });
});
