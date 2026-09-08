/**
 * Root not-found. The vault page's own not-found register (VaultDetail.tsx)
 * is the precedent: kicker, one sentence, one key back to the directory.
 * Without this file Next's placeholder 404 renders inside the chrome and its
 * 100vh block pushes the footer below the fold.
 */
import Link from "next/link";
import "./vaults/vaults.css";

export default function NotFound() {
  return (
    <div className="vx-root vx-notfound">
      <span className="vx-kicker">Priime Build</span>
      <h1 className="vx-title">This page does not exist</h1>
      <Link className="vx-cta" href="/vaults">
        Browse all vaults
      </Link>
    </div>
  );
}
