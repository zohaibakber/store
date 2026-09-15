/** Nightly ships auth and API without provisioning inventory Postgres. */
export const stageUsesInventoryPostgres = (stage: string) => stage !== "nightly";
