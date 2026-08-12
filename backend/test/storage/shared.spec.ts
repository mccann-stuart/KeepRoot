import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hexFromBytes, runSchemaStatement } from '../../src/storage/shared';

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
});
