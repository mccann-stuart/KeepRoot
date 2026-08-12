import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSchemaStatement, isUnsafeIpAddress } from '../../src/storage/shared';

describe('shared storage', () => {
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
});
