export const stageUsesInventoryPostgres = (stage: string) => stage !== "nightly";

export const stageUsesNeonInventory = (stage: string) => stage === "dev";

export const stageUsesPlanetscaleInventory = (stage: string) =>
  stageUsesInventoryPostgres(stage) && !stageUsesNeonInventory(stage);
