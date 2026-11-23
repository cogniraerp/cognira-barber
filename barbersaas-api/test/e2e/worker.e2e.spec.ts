/** El proceso worker (APP_MODE=worker) arranca: todas sus dependencias se resuelven. */
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { WorkerModule } from '../../src/worker/worker.module';
import { WorkerService } from '../../src/worker/worker.service';

describe('worker', () => {
  it('el módulo del worker compila con todas sus dependencias', async () => {
    const mod = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    expect(mod.get(WorkerService)).toBeDefined();
    await mod.close();
  });
});
