export interface Vintage<V extends number, T> {
  /** Which vintage the value is. Freshest manages this, do not modify manually */
  __vintage__: V;
  /** The value at that vintage */
  value: T;
}

type Migration = (value: never) => unknown;
type Step = { up: Migration; down?: Migration };

/** One entry per registered migration: `input` is the value type at that version. */
type Steps = Array<{ input: unknown; twoWay: boolean }>;

/** A tuple of length `N`, used for index arithmetic. */
type Count<N extends number, T extends unknown[] = []> = T['length'] extends N
  ? T
  : Count<N, [...T, unknown]>;
type Inc<N extends number> = [...Count<N>, unknown]['length'] & number;
type Dec<N extends number> = Count<N> extends [unknown, ...infer T] ? T['length'] : never;

/** The value type at version `V` — the latest version holds `Output`. */
type ValueAt<S extends Steps, V extends number, Output> = V extends S['length']
  ? Output
  : S[V]['input'];

/** Every version at or ahead of `From`. Migrating forwards is always possible. */
type Ahead<S extends Steps, From extends number> = From extends S['length']
  ? From
  : From | Ahead<S, Inc<From>>;

/** Versions behind `From`, stopping at the first step registered without a `down`. */
type Behind<S extends Steps, From extends number> = From extends 0
  ? never
  : S[Dec<From>] extends { twoWay: true }
  ? Dec<From> | Behind<S, Dec<From>>
  : never;

/** The versions `migrateTo` accepts as a target for a value at version `From`. */
type Targets<S extends Steps, From extends number> = number extends From
  ? number
  : (Ahead<S, From> | Behind<S, From>) & number;

/** A vintage at any known version, each carrying that version's value type. */
type AnyVintage<S extends Steps, Output, V extends number = Ahead<S, 0>> = V extends number
  ? Vintage<V, ValueAt<S, V, Output>>
  : never;

/** Anything migratable: a raw, never-migrated value or a vintage at any known version. */
type AnyInput<S extends Steps, Output> = ValueAt<S, 0, Output> | AnyVintage<S, Output>;

type VersionOf<T> = T extends Vintage<infer V, unknown> ? V : 0;

export class Freshest<Output, S extends Steps = [], TwoWay extends boolean = false> {
  readonly type = 'Freshest';
  /** Whether a value is a stored `Vintage` wrapper rather than a raw, never-migrated value. */
  static isMigrated<T>(v: unknown): v is Vintage<number, T> {
    return typeof (v as Vintage<number, T>)?.__vintage__ === 'number';
  }
  /** A chain whose migrations may be one-way. */
  static create<Initial>() {
    return new Freshest<Initial>();
  }
  /** A chain where every `add` must register a `down`, so any version is reachable from any other. */
  static createTwoWay<Initial>() {
    return new Freshest<Initial, [], true>([], true);
  }
  private constructor(
    private steps: Step[] = [],
    private twoWay = false
  ) {}
  /**
   * Registers the next migration. Pass `down` to also make this version reachable
   * backwards — required on a `Freshest.createTwoWay` chain.
   */
  add<Input extends Output, O>(
    up: (input: Input) => O,
    ...down: TwoWay extends true ? [down: (output: O) => Input] : []
  ): Freshest<O, [...S, { input: Input; twoWay: TwoWay }], TwoWay>;
  add<Input extends Output, O>(
    up: (input: Input) => O,
    down: (output: O) => Input
  ): Freshest<O, [...S, { input: Input; twoWay: true }], TwoWay>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  add(up: any, down?: Migration): any {
    if (this.twoWay && !down) {
      throw new Error('Freshest.createTwoWay requires a `down` for every step');
    }
    return new Freshest(this.steps.concat({ up, down }), this.twoWay);
  }
  get lastVersion() {
    return this.steps.length;
  }
  /** Migrates to the latest version. */
  migrate(input: AnyInput<S, Output>): Vintage<S['length'], Output> {
    return this.run(input, this.steps.length) as never;
  }
  /**
   * Migrates up, or down as far as the registered `down` migrations reach — a
   * version behind a one-way step is not a valid target.
   */
  migrateTo<Input extends AnyInput<S, Output>, V extends Targets<S, VersionOf<Input>>>(
    input: Input,
    version: V
  ): Vintage<V, ValueAt<S, V, Output>> {
    return this.run(input, version) as never;
  }
  private run(input: unknown, version: number) {
    const from = Freshest.isMigrated(input) ? input.__vintage__ : 0;
    // `downs[i]` walks version `from - i` back to `from - i - 1`.
    const downs = this.steps.slice(version, from).reverse();
    // Checked up front so a rejected migration leaves the value untouched.
    const gap = downs.findIndex(step => !step.down);
    if (gap >= 0) {
      throw new Error(
        `No down migration registered for v${from - gap} -> v${from - gap - 1}`
      );
    }
    let value: unknown = Freshest.isMigrated(input) ? input.value : input;
    for (const { up } of this.steps.slice(from, version)) {
      value = up(value as never);
    }
    for (const { down } of downs) {
      value = down!(value as never);
    }
    return { __vintage__: version, value };
  }
}
