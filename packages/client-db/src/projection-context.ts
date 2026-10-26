import { Money, PositiveInt } from "@store/contracts";
import { CatalogRefusal, decideField } from "@store/contracts/catalog-refusal";
import { CatalogName, type CatalogRowWrite } from "@store/contracts/catalog-write";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

export type CatalogActor = {
  readonly organizationId: string;
  readonly userId: string;
  readonly deviceId: string;
};

export type CatalogWriteIds = {
  readonly now: () => number;
  readonly operationId: () => string;
  readonly rowId: () => string;
};

export type CatalogReadableCollection<Row extends { readonly id: string }> = {
  readonly state: {
    get: (id: string) => Row | undefined;
    values: () => Iterable<Row>;
  };
};

export type ProjectionContext<Tables> = {
  readonly actor: CatalogActor;
  readonly commandId: string;
  readonly occurredAt: number;
  readonly ids: CatalogWriteIds;
  readonly tables: Tables;
};

export const requiredRow = <Row>(
  row: Row | undefined,
  label: string,
): Result.Result<Row, CatalogRefusal> =>
  Result.gen(function* () {
    if (!row)
      return yield* Result.fail(
        new CatalogRefusal({ reason: "missingReference", message: `${label} no longer exists.` }),
      );
    return row;
  });

export const commandIds = (context: ProjectionContext<unknown>) => ({
  now: () => context.occurredAt,
  operationId: () => context.commandId,
});

export type Projected<Row = void> = {
  readonly writes: ReadonlyArray<CatalogRowWrite>;
  readonly row: Row;
};

export const naturalField = (value: number, message: string, field?: string) =>
  decideField(Schema.Natural, value, { message, field });

export const moneyField = (value: number, message: string, field?: string) =>
  decideField(Money, value, { message, field });

export const positiveField = (value: number, message: string, field?: string) =>
  decideField(PositiveInt, value, { message, field });

export const nameField = (
  value: string,
  messages: { readonly empty: string; readonly tooLong?: string },
) =>
  Result.gen(function* () {
    const name = value.trim();
    if (!name)
      return yield* Result.fail(
        new CatalogRefusal({ reason: "invalidInput", message: messages.empty, field: "name" }),
      );
    return yield* decideField(CatalogName, name, { message: messages.tooLong, field: "name" });
  });
