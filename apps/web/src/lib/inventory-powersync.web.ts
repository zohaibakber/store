import { PowerSyncDatabase } from "@powersync/web";
import { inventoryPowerSyncSchema } from "@store/client-db";

export const openWebInventoryPowerSync = async (databaseName: string) => {
  const database = new PowerSyncDatabase({
    database: { dbFilename: databaseName },
    schema: inventoryPowerSyncSchema,
  });
  await database.init();
  return database;
};
