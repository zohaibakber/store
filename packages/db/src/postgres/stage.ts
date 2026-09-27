/** Nightly ships auth and API without provisioning inventory Postgres. */
export const stageUsesInventoryPostgres = (stage: string) => stage !== "nightly";

/** Dev runs its inventory Postgres on Neon; every other Postgres stage uses PlanetScale. */
export const stageUsesNeonInventory = (stage: string) => stage === "dev";

export const stageUsesPlanetscaleInventory = (stage: string) =>
  stageUsesInventoryPostgres(stage) && !stageUsesNeonInventory(stage);
