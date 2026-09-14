# freshest

[![npm version](https://img.shields.io/npm/v/freshest.svg)](https://www.npmjs.com/package/freshest)
[![npm downloads](https://img.shields.io/npm/dm/freshest.svg)](https://www.npmjs.com/package/freshest)

Versioned schema migrations for persisted data, with the version tracked in the type system.

Stored data outlives the shape you wrote it in. `Freshest` lets you describe how each shape
became the next one, then hands you a value at whatever version you ask for — and refuses, at
compile time, to migrate somewhere it can't actually reach.

## Quick start

```ts
import { Freshest } from './index';

const config = Freshest.create<{ name: string }>()
  .add((v0) => {
    const [firstName, ...rest] = v0.name.split(' ');
    return { firstName, lastName: rest.join(' ') };
  })
  .add((v1) => ({ ...v1, theme: 'dark' as 'dark' | 'light' }));

// A raw, never-migrated value:
config.migrate({ name: 'Ada Lovelace' });
// { __vintage__: 2, value: { firstName: 'Ada', lastName: 'Lovelace', theme: 'dark' } }

// Or something you read back from storage — it resumes from where it left off:
config.migrate({
  __vintage__: 1,
  value: { firstName: 'Ada', lastName: 'Lovelace' },
});
// { __vintage__: 2, value: { firstName: 'Ada', lastName: 'Lovelace', theme: 'dark' } }
```

Persist the whole `{ __vintage__, value }` wrapper — `__vintage__` is how the next run knows
which migrations still need to run.

## Down migrations

Each `add` registers an `up`. Pass a second function — the `down` — and that step becomes
walkable in both directions. `migrateTo` then takes any version you can actually get to:

```ts
const chain = Freshest.create<number>()
  .add(
    (n) => `${n}`,
    (s) => Number(s),
  ) // two-way
  .add(
    (s) => ({ s }),
    (o) => o.s,
  ); // two-way

const latest = chain.migrate(12); // { __vintage__: 2, value: { s: '12' } }
chain.migrateTo(latest, 0); // { __vintage__: 0, value: 12 }
```

Direction is tracked **per step**, so a chain can mix one-way and two-way migrations:

```ts
const mixed = Freshest.create<boolean>()
  .add((b) => `${b}`) // one-way
  .add(
    (s) => s.length,
    (n) => 'x'.repeat(n),
  ) // two-way
  .add(
    (n) => ({ n }),
    (o) => o.n,
  ); // two-way

const v3 = mixed.migrate(true);
mixed.migrateTo(v3, 2); // ok
mixed.migrateTo(v3, 1); // ok
mixed.migrateTo(v3, 0); // Argument of type '0' is not assignable to parameter of type '1 | 2 | 3'
```

Going up is always allowed. Going down stops at the first step with no `down`, and it's a
compile error rather than a runtime surprise. A one-way step in the middle only blocks the
versions behind _it_ — everything above it stays reachable.

### Requiring a `down` everywhere

`Freshest.createTwoWay` makes the second argument to `add` mandatory, so no step can be left
one-way and every version is reachable from every other:

```ts
const strict = Freshest.createTwoWay<number>().add(
  (n) => `${n}`,
  (s) => Number(s),
);

strict.add((s) => s.length); // Expected 2 arguments, but got 1
```

## API

|                                    |                                                                             |
| ---------------------------------- | --------------------------------------------------------------------------- |
| `Freshest.create<Initial>()`       | A chain for stored values of type `Initial`. `down` is optional per step.   |
| `Freshest.createTwoWay<Initial>()` | Same, but every `add` must register a `down`.                               |
| `Freshest.isMigrated(value)`       | Whether a value is a `Vintage` wrapper rather than a raw value.             |
| `.add(up, down?)`                  | Registers the next version. Returns a new chain; the original is untouched. |
| `.migrate(input)`                  | Migrates a raw value or any stored `Vintage` up to the latest version.      |
| `.migrateTo(input, version)`       | Migrates to a specific version, up or down.                                 |
| `.lastVersion`                     | The latest version number, i.e. how many migrations are registered.         |

`Vintage<V, T>` is the wrapper: `{ __vintage__: V; value: T }`.

## Notes

**Version numbering.** Version `0` is the value before any migration ran, so version `N` is the
output of the `N`th `add`. A chain with no migrations produces `__vintage__: 0`.

**`__vintage__` is deliberately ugly.** `migrate` accepts raw, never-migrated values, and
`Freshest.isMigrated` has to tell those apart from stored wrappers by looking for this key. A
plain `version` would mean any raw object with a numeric `version` field gets mistaken for an
already-migrated value and skips its migrations.

**Annotate a migration's return type if you don't want literals.** `add(b => b ? 'yes' : 'no')`
makes the next version's type `'yes' | 'no'`, so stored values at that version must be one of
those two strings. Write `add((b): string => ...)` when you meant `string`.

**`as const` your version numbers.** In an object literal, `__vintage__: 2` widens to `number`,
and `migrateTo` can't check the target against a version it doesn't know. Reading a value back
through a typed boundary (or `as const`) keeps the literal, and the check stays exact.

**Down ranges are checked before any run.** If a downward range crosses a one-way step,
`migrateTo` throws without applying anything, so a rejected migration leaves the value as it
was. This only matters for untyped callers — the type system rejects it first.

## Development

```sh
npm test         # type tests + unit tests
npm run test:types   # tsc — this is what asserts types.test.ts
npm run test:unit    # node:test via tsx
```

`types.test.ts` is compile-time only: it asserts inferred types with an `Equal` helper and marks
every rejected call with `@ts-expect-error`, so a regression in the type-level rules fails `tsc`.
