import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Freshest } from './index';

/** boolean -> string -> { s: string } -> number, walks down from v3 to v1 only. */
const chain = Freshest.create<boolean>()
  .add((b): string => (b ? 'yes' : 'no'))
  .add(
    (s): { s: string } => ({ s }),
    o => o.s
  )
  .add(
    (o): number => o.s.length,
    n => ({ s: 'x'.repeat(n) })
  );

describe('Freshest.isMigrated', () => {
  it('detects migrated vintages', () => {
    assert.equal(Freshest.isMigrated({ __vintage__: 0, value: 1 }), true);
    assert.equal(Freshest.isMigrated({ __vintage__: 2, value: undefined }), true);
  });

  it('rejects raw values', () => {
    for (const raw of [1, 'a', true, null, undefined, {}, [], { value: 1 }]) {
      assert.equal(Freshest.isMigrated(raw), false, `expected ${JSON.stringify(raw)} to be raw`);
    }
  });
});

describe('lastVersion', () => {
  it('counts registered migrations', () => {
    assert.equal(Freshest.create<number>().lastVersion, 0);
    assert.equal(chain.lastVersion, 3);
  });

  it('does not mutate the chain it was derived from', () => {
    const base = Freshest.create<number>().add(n => n + 1);
    base.add(n => n + 1);
    assert.equal(base.lastVersion, 1);
  });
});

describe('migrate', () => {
  it('runs every migration on a raw value', () => {
    assert.deepEqual(chain.migrate(true), { __vintage__: 3, value: 3 });
  });

  it('resumes from the version of an already-migrated vintage', () => {
    assert.deepEqual(chain.migrate({ __vintage__: 1, value: 'hello' }), {
      __vintage__: 3,
      value: 5,
    });
  });

  it('is a no-op for a vintage already at the latest version', () => {
    const latest = { __vintage__: 3, value: 42 } as const;
    assert.deepEqual(chain.migrate(latest), { __vintage__: 3, value: 42 });
  });

  it('passes the raw value straight through when nothing is registered', () => {
    assert.deepEqual(Freshest.create<number>().migrate(7), { __vintage__: 0, value: 7 });
  });
});

describe('migrateTo forwards', () => {
  it('stops at the requested version', () => {
    assert.deepEqual(chain.migrateTo(true, 0), { __vintage__: 0, value: true });
    assert.deepEqual(chain.migrateTo(true, 1), { __vintage__: 1, value: 'yes' });
    assert.deepEqual(chain.migrateTo(true, 2), { __vintage__: 2, value: { s: 'yes' } });
    assert.deepEqual(chain.migrateTo(true, 3), { __vintage__: 3, value: 3 });
  });

  it('advances from an intermediate version', () => {
    assert.deepEqual(chain.migrateTo({ __vintage__: 1, value: 'abcd' }, 3), {
      __vintage__: 3,
      value: 4,
    });
  });

  it('is a no-op when the target is the current version', () => {
    const at2 = { __vintage__: 2, value: { s: 'keep' } } as const;
    assert.deepEqual(chain.migrateTo(at2, 2), { __vintage__: 2, value: { s: 'keep' } });
  });
});

describe('migrateTo down', () => {
  it('walks down migrations to the target', () => {
    const latest = chain.migrate(true);
    assert.deepEqual(chain.migrateTo(latest, 2), { __vintage__: 2, value: { s: 'xxx' } });
    assert.deepEqual(chain.migrateTo(latest, 1), { __vintage__: 1, value: 'xxx' });
  });

  it('applies down migrations in reverse registration order', () => {
    const order: string[] = [];
    const traced = Freshest.create<number>()
      .add(
        n => n + 1,
        n => {
          order.push('down:0');
          return n - 1;
        }
      )
      .add(
        n => n * 2,
        n => {
          order.push('down:1');
          return n / 2;
        }
      );

    assert.deepEqual(traced.migrateTo({ __vintage__: 2, value: 10 }, 0), {
      __vintage__: 0,
      value: 4,
    });
    assert.deepEqual(order, ['down:1', 'down:0']);
  });

  it('throws when a step in the range has no down migration', () => {
    assert.throws(
      // @ts-expect-error v3 -> v0 crosses step 0, which is one-way
      () => chain.migrateTo(chain.migrate(true), 0),
      /No down migration registered for v1 -> v0/
    );
  });

  it('rejects a partially walkable range without applying anything', () => {
    const seen: number[] = [];
    const partial = Freshest.create<number>()
      .add(n => n + 1)
      .add(
        n => n * 2,
        n => {
          seen.push(n);
          return n / 2;
        }
      );

    assert.throws(
      // @ts-expect-error step 0 is one-way, so v0 is unreachable from v2
      () => partial.migrateTo({ __vintage__: 2, value: 8 }, 0),
      /No down migration registered/
    );
    assert.deepEqual(
      seen,
      [],
      'no down migration should run when the range is not fully walkable'
    );
  });
});

describe('createTwoWay', () => {
  const strict = Freshest.createTwoWay<number>()
    .add(
      (n): string => `${n}`,
      s => Number(s)
    )
    .add(
      (s): { s: string } => ({ s }),
      ({ s }) => s
    );

  it('reaches every version in both directions', () => {
    const latest = strict.migrate(3);
    assert.deepEqual(latest, { __vintage__: 2, value: { s: '3' } });
    assert.deepEqual(strict.migrateTo(latest, 1), { __vintage__: 1, value: '3' });
    assert.deepEqual(strict.migrateTo(latest, 0), { __vintage__: 0, value: 3 });
  });

  it('rejects a migration registered without a down', () => {
    assert.throws(
      // @ts-expect-error createTwoWay makes `down` a required argument
      () => strict.add((n: number) => n + 1),
      /requires a `down` for every step/
    );
  });

  it('leaves `create` chains unrestricted', () => {
    assert.equal(Freshest.create<number>().add(n => n + 1).lastVersion, 1);
  });
});

describe('round trips', () => {
  it('returns the original value through a fully two-way chain', () => {
    const twoWay = Freshest.create<number>()
      .add(
        n => `${n}`,
        s => Number(s)
      )
      .add(
        s => ({ s }),
        ({ s }) => s
      );

    const latest = twoWay.migrate(12);
    assert.deepEqual(latest, { __vintage__: 2, value: { s: '12' } });
    assert.deepEqual(twoWay.migrateTo(latest, 0), { __vintage__: 0, value: 12 });
  });
});
