/**
 * Compile-time tests. These assert nothing at runtime — `tsc --noEmit` is the
 * assertion. A broken inference shows up as a type error in this file.
 */
import { Freshest, type Vintage } from './index';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
/** `expect(value).is<T>()` fails to compile unless the value's type is exactly `T`. */
const expect = <Actual>(_value?: Actual) => ({
  is: <Expected>(..._: Equal<Actual, Expected> extends true ? [] : [never]) => {},
});

// boolean -> string -> { s: string } -> number, walks down from v3 to v1 only.
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

// -- callback parameters are inferred from the previous version -----------------

Freshest.create<boolean>()
  .add(b => {
    expect(b).is<boolean>();
    return `${b}`;
  })
  .add(
    s => {
      expect(s).is<string>();
      return s.length;
    },
    n => {
      expect(n).is<number>();
      return `${n}`;
    }
  );

// -- migrate ------------------------------------------------------------------

expect(chain.migrate(true)).is<Vintage<3, number>>();
expect(chain.migrate({ __vintage__: 1, value: 'a' })).is<Vintage<3, number>>();
expect(Freshest.create<boolean>().migrate(true)).is<Vintage<0, boolean>>();

// @ts-expect-error the raw input must be the initial value type
chain.migrate(123);
// @ts-expect-error a vintage's value must match its version
chain.migrate({ __vintage__: 1, value: 123 });
// @ts-expect-error there is no version 9
chain.migrate({ __vintage__: 9, value: 'a' });

// -- migrateTo return types ---------------------------------------------------

expect(chain.migrateTo(true, 0)).is<Vintage<0, boolean>>();
expect(chain.migrateTo(true, 1)).is<Vintage<1, string>>();
expect(chain.migrateTo(true, 2)).is<Vintage<2, { s: string }>>();
expect(chain.migrateTo(true, 3)).is<Vintage<3, number>>();

const latest = chain.migrate(true);
expect(chain.migrateTo(latest, 2)).is<Vintage<2, { s: string }>>();
expect(chain.migrateTo(latest, 1)).is<Vintage<1, string>>();

// -- allowed targets ----------------------------------------------------------

// Up is always allowed, whether or not the step registered a `down`.
chain.migrateTo({ __vintage__: 0, value: true }, 3);
chain.migrateTo({ __vintage__: 1, value: 'a' }, 2);

// Down only while every step in the range registered a `down`.
chain.migrateTo({ __vintage__: 3, value: 1 }, 2);
chain.migrateTo({ __vintage__: 2, value: { s: 'a' } }, 1);
// @ts-expect-error step 0 is one-way, so v0 is unreachable
chain.migrateTo({ __vintage__: 3, value: 1 }, 0);
// @ts-expect-error step 0 is one-way, so v0 is unreachable
chain.migrateTo({ __vintage__: 1, value: 'a' }, 0);
// @ts-expect-error there is no version 4
chain.migrateTo(true, 4);

// A one-way step in the middle only blocks the versions behind it:
// 4 -> 3 -> 2 and 1 -> 0 walk down, 2 -> 1 does not.
const gapped = Freshest.create<0>()
  .add(
    () => 1 as const,
    () => 0 as const
  )
  .add(() => 2 as const)
  .add(
    () => 3 as const,
    () => 2 as const
  )
  .add(
    () => 4 as const,
    () => 3 as const
  );

gapped.migrateTo({ __vintage__: 4, value: 4 }, 3);
gapped.migrateTo({ __vintage__: 4, value: 4 }, 2);
gapped.migrateTo({ __vintage__: 1, value: 1 }, 0);
// @ts-expect-error v4 -> v1 crosses the one-way step 1
gapped.migrateTo({ __vintage__: 4, value: 4 }, 1);
// @ts-expect-error v3 -> v1 crosses the one-way step 1
gapped.migrateTo({ __vintage__: 3, value: 3 }, 1);
// @ts-expect-error v2 is already behind the one-way step 1
gapped.migrateTo({ __vintage__: 2, value: 2 }, 1);
// @ts-expect-error v2 -> v0 crosses the one-way step 1
gapped.migrateTo({ __vintage__: 2, value: 2 }, 0);

// -- createTwoWay -------------------------------------------------------------

const strict = Freshest.createTwoWay<boolean>()
  .add(
    (b): string => `${b}`,
    s => s === 'true'
  )
  .add(
    (s): number => s.length,
    n => 'x'.repeat(n)
  );

// Every step has a `down`, so any version is reachable from any other.
expect(strict.migrateTo(strict.migrate(true), 0)).is<Vintage<0, boolean>>();
expect(strict.migrateTo(strict.migrate(true), 1)).is<Vintage<1, string>>();
expect(strict.migrateTo(true, 2)).is<Vintage<2, number>>();

// @ts-expect-error createTwoWay makes `down` a required argument
strict.add((b: number) => `${b}`);

// The requirement carries through `add`, so later calls are gated too.
Freshest.createTwoWay<boolean>()
  .add(
    (b): string => `${b}`,
    s => s === 'true'
  )
  // @ts-expect-error createTwoWay makes `down` a required argument
  .add((s: string) => s.length);

// `create` leaves `down` optional.
Freshest.create<boolean>().add((b): string => `${b}`);

// -- a chain with no migrations -----------------------------------------------

const empty = Freshest.create<{ a: 1 }>();
expect(empty.migrateTo({ a: 1 }, 0)).is<Vintage<0, { a: 1 }>>();
// @ts-expect-error there is no version 1
empty.migrateTo({ a: 1 }, 1);
