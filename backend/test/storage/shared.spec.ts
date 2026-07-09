import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSchemaStatement } from '../../src/storage/shared';

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
});
