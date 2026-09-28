import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Predicate from "effect/Predicate";
import * as Tracer from "effect/Tracer";

const STATEMENT_SPAN = "sql.execute";
const TRANSACTION_SPAN = "sql.transaction";
const QUERY_TEXT_ATTRIBUTE = "db.query.text";

export interface StatementCount {
  readonly statements: number;
  readonly sql: ReadonlyArray<string>;
  readonly transactions: number;
  readonly roundTrips: number;
}

export interface Counted<A> extends StatementCount {
  readonly result: A;
}

export interface StatementRecorder {
  readonly tracer: Tracer.Tracer;
  readonly snapshot: () => StatementCount;
  readonly reset: () => void;
}

const insideTransaction = (span: Tracer.Span): boolean =>
  span.parent._tag === "Some" &&
  span.parent.value._tag === "Span" &&
  (span.parent.value.name === TRANSACTION_SPAN || insideTransaction(span.parent.value));

const failed = (span: Tracer.Span) =>
  span.status._tag === "Ended" && Exit.isFailure(span.status.exit);

const controlStatements = (transaction: Tracer.Span) =>
  insideTransaction(transaction) ? (failed(transaction) ? 3 : 2) : 2;

const summarize = (spans: ReadonlyArray<Tracer.Span>): StatementCount => {
  const statements = spans.filter((span) => span.name === STATEMENT_SPAN);
  const transactions = spans.filter((span) => span.name === TRANSACTION_SPAN);
  return {
    statements: statements.length,
    sql: statements
      .map((span) => span.attributes.get(QUERY_TEXT_ATTRIBUTE))
      .filter(Predicate.isString),
    transactions: transactions.filter((span) => !insideTransaction(span)).length,
    roundTrips:
      statements.length +
      transactions.reduce((total, transaction) => total + controlStatements(transaction), 0),
  };
};

export const makeStatementRecorder = (): StatementRecorder => {
  const spans: Array<Tracer.Span> = [];
  return {
    tracer: Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    }),
    snapshot: () => summarize(spans),
    reset: () => {
      spans.length = 0;
    },
  };
};

export const countStatements = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<Counted<A>, E, R> =>
  Effect.suspend(() => {
    const recorder = makeStatementRecorder();
    return effect.pipe(
      Effect.withTracer(recorder.tracer),
      Effect.withTracerEnabled(true),
      Effect.map((result) => ({ result, ...recorder.snapshot() })),
    );
  });
