/**
 * IPFS port against a kubo node: pin service.json via the HTTP API, fetch
 * the current one via the gateway. Same endpoints deploy/vault-service.sh
 * uses (`ipfs add -Q`, gateway on :8080).
 */

import { isRecord } from "./guards.ts";

export interface IpfsPort {
  /** Fetch the document behind an ipfs:// URI as text. */
  fetchText(uri: string): Promise<string>;
  /** Pin a document. Returns its ipfs:// URI. */
  pinText(content: string, name: string): Promise<string>;
}

export interface IpfsOptions {
  /** kubo API base, e.g. http://127.0.0.1:5001 */
  apiUrl: string;
  /** gateway base, e.g. http://127.0.0.1:8080 */
  gatewayUrl: string;
}

export function makeIpfs(options: IpfsOptions): IpfsPort {
  const api = options.apiUrl.replace(/\/$/, "");
  const gateway = options.gatewayUrl.replace(/\/$/, "");

  return {
    async fetchText(uri: string): Promise<string> {
      const cid = uri.replace(/^ipfs:\/\//, "");
      if (cid === uri) throw new Error(`not an ipfs URI: ${uri}`);
      const res = await fetch(`${gateway}/ipfs/${cid}`);
      if (!res.ok) throw new Error(`gateway fetch of ${uri} failed: ${res.status} ${res.statusText}`);
      return await res.text();
    },

    async pinText(content: string, name: string): Promise<string> {
      const form = new FormData();
      form.append("file", new Blob([content], { type: "application/json" }), name);
      const res = await fetch(`${api}/api/v0/add?pin=true`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`ipfs add failed: ${res.status} ${res.statusText}`);
      const body: unknown = await res.json();
      if (!isRecord(body) || typeof body.Hash !== "string" || body.Hash.length === 0) {
        throw new Error(`ipfs add returned no Hash: ${JSON.stringify(body).slice(0, 200)}`);
      }
      return `ipfs://${body.Hash}`;
    },
  };
}
