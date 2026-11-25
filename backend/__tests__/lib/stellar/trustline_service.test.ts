import {
  resolveVaultTrustlineAsset,
  TrustlineError,
} from "@/lib/stellar/trustline_service";

const VAULT_CONTRACT_ID =
  "CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR";
const USDC_ISSUER =
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

describe("resolveVaultTrustlineAsset", () => {
  it("uses the vault-specific asset from SAVINGS_VAULT_TRUSTLINE_ASSETS", () => {
    const asset = resolveVaultTrustlineAsset(VAULT_CONTRACT_ID, {
      SAVINGS_VAULT_TRUSTLINE_ASSETS: JSON.stringify({
        [VAULT_CONTRACT_ID]: { code: "USDC", issuer: USDC_ISSUER },
      }),
      STELLAR_USDC_ISSUER: "GDIFFERENTISSUER",
    });

    expect(asset).toEqual({ code: "USDC", issuer: USDC_ISSUER });
  });

  it("falls back to the default savings asset for unlisted vaults", () => {
    const asset = resolveVaultTrustlineAsset(VAULT_CONTRACT_ID, {
      SAVINGS_VAULT_TRUSTLINE_ASSETS: JSON.stringify({
        CUNKNOWN: { code: "EURC", issuer: USDC_ISSUER },
      }),
      STELLAR_USDC_ISSUER: USDC_ISSUER,
    });

    expect(asset).toEqual({ code: "USDC", issuer: USDC_ISSUER });
  });

  it("honours the default asset code and issuer overrides", () => {
    const asset = resolveVaultTrustlineAsset(VAULT_CONTRACT_ID, {
      SAVINGS_TRUSTLINE_ASSET_CODE: "EURC",
      SAVINGS_TRUSTLINE_ASSET_ISSUER: USDC_ISSUER,
    });

    expect(asset).toEqual({ code: "EURC", issuer: USDC_ISSUER });
  });

  it("rejects malformed SAVINGS_VAULT_TRUSTLINE_ASSETS JSON", () => {
    expect(() =>
      resolveVaultTrustlineAsset(VAULT_CONTRACT_ID, {
        SAVINGS_VAULT_TRUSTLINE_ASSETS: "{not json",
      }),
    ).toThrow(TrustlineError);
  });

  it("rejects a missing default issuer", () => {
    expect(() => resolveVaultTrustlineAsset(VAULT_CONTRACT_ID, {})).toThrow(
      TrustlineError,
    );
  });

  it("rejects an invalid configured issuer", () => {
    expect(() =>
      resolveVaultTrustlineAsset(VAULT_CONTRACT_ID, {
        SAVINGS_VAULT_TRUSTLINE_ASSETS: JSON.stringify({
          [VAULT_CONTRACT_ID]: { code: "USDC", issuer: "GNOTVALID" },
        }),
      }),
    ).toThrow(TrustlineError);
  });
});
