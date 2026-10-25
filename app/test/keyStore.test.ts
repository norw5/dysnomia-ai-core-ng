import { describe, expect, it } from "vitest";
import { decryptKey, encryptKey, PBKDF2_ITERATIONS } from "@/wallet/keyStore";

const PRIV = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function webcrypto(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("this runtime has no WebCrypto — run node >= 19");
  return c.subtle;
}

describe("mode B key vault (AES-GCM + PBKDF2)", () => {
  it("round-trips a private key through passphrase encryption", async () => {
    webcrypto();
    const record = await encryptKey(PRIV, "correct horse battery", 1000);
    expect(record.iterations).toEqual(1000);
    expect(record.ct).not.toContain(PRIV.slice(2));
    const recovered = await decryptKey(record, "correct horse battery");
    expect(recovered).toEqual(PRIV);
  });

  it("wrong passphrase fails integrity (AES-GCM), not silently", async () => {
    const record = await encryptKey(PRIV, "correct horse battery", 1000);
    await expect(decryptKey(record, "wrong pass")).rejects.toThrow(/wrong passphrase/i);
  });

  it("refuses short passphrases and defaults to OWASP-grade iterations", async () => {
    await expect(encryptKey(PRIV, "short", 1000)).rejects.toThrow(/too short/i);
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it("salts every record (same passphrase → different ciphertext)", async () => {
    const a = await encryptKey(PRIV, "same pass", 1000);
    const b = await encryptKey(PRIV, "same pass", 1000);
    expect(a.salt).not.toEqual(b.salt);
    expect(a.ct).not.toEqual(b.ct);
  });
});
