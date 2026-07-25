import { defineRelations } from "drizzle-orm";

import { storeRelations } from "../shared/relations";
import * as schema from "./schema";

export const durableObjectRelations = defineRelations(schema, (r) => storeRelations(r));
