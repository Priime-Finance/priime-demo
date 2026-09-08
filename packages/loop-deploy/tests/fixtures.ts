/**
 * A service document shaped like what deploy/vault-service.sh's wavs-cli run
 * produces: one cron workflow (vault-nav) with an aggregator submit. The
 * `x_future_field` entries stand in for schema additions the builder must
 * pass through untouched, and the timestamps exceed 2^53 on purpose.
 */

import { parseLossless } from "../src/json.ts";

export const TEMPLATE_WORKFLOW_ID = "wf0000000000000000000001";

export function fixtureServiceText(): string {
  return JSON.stringify(
    {
      name: "priime-vault",
      workflows: {
        [TEMPLATE_WORKFLOW_ID]: {
          trigger: {
            cron: {
              schedule: "*/10 * * * * *",
              start_time: null,
              end_time: null,
            },
          },
          component: {
            source: {
              download: {
                uri: "ipfs://QmTemplateNavComponent",
                digest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              },
            },
            permissions: { allowed_http_hosts: { only: ["localhost:8545"] }, file_system: false, raw_sockets: false, dns_resolution: false },
            fuel_limit: 1000000000000,
            time_limit_seconds: 30,
            config: {
              chain_id: "evm:31337",
              vault_address: "0x1111111111111111111111111111111111111111",
              usdc_address: "0x2222222222222222222222222222222222222222",
              usde_address: "0x3333333333333333333333333333333333333333",
              oracle_address: "0x4444444444444444444444444444444444444444",
              irm_address: "0x5555555555555555555555555555555555555555",
              morpho_address: "0x6666666666666666666666666666666666666666",
              market_id: "0x7777777777777777777777777777777777777777777777777777777777777777",
              lltv: "915000000000000000",
              pool_address: "0x8888888888888888888888888888888888888888",
              twap_window_secs: "1800",
              inputs_block_lag: "2",
            },
            env_keys: [],
            x_future_field: { keep: "me" },
          },
          submit: {
            aggregator: {
              component: {
                source: {
                  download: {
                    uri: "ipfs://QmTemplateAggregator",
                    digest: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                  },
                },
                permissions: { allowed_http_hosts: { only: ["localhost:8545"] }, file_system: false, raw_sockets: false, dns_resolution: false },
                fuel_limit: null,
                time_limit_seconds: null,
                config: { "evm:31337": "0x1111111111111111111111111111111111111111" },
                env_keys: [],
              },
              signature_kind: { algorithm: "secp256k1", prefix: "eip191" },
            },
          },
          x_future_field: 7,
        },
      },
      status: "active",
      manager: { evm: { chain: "evm:31337", address: "0x9999999999999999999999999999999999999999" } },
    },
    null,
    2,
  )
    // Inject >2^53 nanos timestamps as raw JSON so the fixture matches what
    // wavs-cli emits (JSON.stringify of a JS number would corrupt them).
    .replace('"start_time": null', '"start_time": 1786611911000000001')
    .replace('"end_time": null', '"end_time": 1786615511000000003');
}

export function fixtureServiceDoc(): unknown {
  return parseLossless(fixtureServiceText());
}

/**
 * Full LoopConfig shape (post-resolve). Used by tests that exercise the
 * stored path (validateLoopConfig, componentConfigFor, resume).
 */
export function validLoopInput(): Record<string, unknown> {
  return {
    name: "my recursive loop",
    strategist: "0xAbCd00000000000000000000000000000000AbCd",
    cronSeconds: 30,
    candidateId: "morpho-blue-base:8453:USDe-USDC:0x54cf9be5",
    targetLeverage: 5,
    marketId: "0x54cf9be57fdfa6457a660991907434ff9d295c465a603a50126ff647d50b7354",
    lltv: "915000000000000000",
    usdeAddress: "0x5d3a1Ff2b6BAb83b63cd9AD0787074081a52ef34",
    oracleAddress: "0xF4b17C79492d68775e22e8Dd0a2Bb22854A39A47",
    irmAddress: "0x46415998764C29aB2a25CbeA6254146D50D22687",
    morphoAddress: "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
    poolAddress: "0x15BC08D2E2B405afeD3fB872DCd2d962BcCfB7e0",
    twapWindowSecs: 1800,
    inputsBlockLag: 2,
  };
}

/**
 * User-input shape (pre-resolve). Used by tests that exercise
 * resolveLoopConfig and the deployer.createLoop path.
 */
export function validLoopResolveInput(): Record<string, unknown> {
  return {
    name: "my recursive loop",
    strategist: "0xAbCd00000000000000000000000000000000AbCd",
    cronSeconds: 30,
    candidateId: "morpho-blue-base:8453:USDe-USDC:0x54cf9be5",
    targetLeverage: 5,
  };
}
