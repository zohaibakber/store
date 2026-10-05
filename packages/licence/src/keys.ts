export type LicencePublicKey = {
  readonly id: string;
  readonly publicKey: string;
  readonly developmentOnly: boolean;
};

export const LICENCE_PUBLIC_KEYS: ReadonlyArray<LicencePublicKey> = [
  {
    id: "dev-2026",
    publicKey: "9fTDHW_kA2ApWUZ23pyH_rbHRF5TXbV0IkKftL_1DIc",
    developmentOnly: true,
  },
];
