import { describe, expect, test } from "bun:test";
import { runCli, TEST_MNEMONIC } from "../../commands/__fixtures__/run-cli.ts";
import type { StoredAccount } from "../../config/accounts-types.ts";

const STORED_ACCOUNT: StoredAccount = {
  name: "my-account",
  secret: TEST_MNEMONIC,
  publicKey: "0x44a996beb1eef7bdcab976ab6d2ca26104834164ecf28fb375600576fcc6eb0f",
  derivationPath: "",
};

const WATCH_ONLY: StoredAccount = {
  name: "watcher",
  publicKey: "0x44a996beb1eef7bdcab976ab6d2ca26104834164ecf28fb375600576fcc6eb0f",
  derivationPath: "",
};

const HEX_SEED_ACCOUNT: StoredAccount = {
  name: "hex-account",
  secret: "0x0000000000000000000000000000000000000000000000000000000000000001",
  publicKey: "0x44a996beb1eef7bdcab976ab6d2ca26104834164ecf28fb375600576fcc6eb0f",
  derivationPath: "",
};

// @ts-expect-error Bun supports describe(label, options, fn) at runtime
describe("dot verifiable", { timeout: 15_000 }, () => {
  test("no account shows help", async () => {
    const { stdout, exitCode } = await runCli(["verifiable"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("dot verifiable");
    expect(stdout).toContain("--entropy-key");
  });

  test("alice (unkeyed) derives member key", async () => {
    const { stdout, exitCode } = await runCli(["verifiable", "alice"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Bandersnatch Member Key");
    expect(stdout).toContain("Account:");
    expect(stdout).toContain("Member Key:");
    expect(stdout).toContain("0x");
    // Should NOT show separate Context: line for unkeyed (only Member Key:)
    expect(stdout).not.toMatch(/^\s+Context:/m);
  });

  test("alice --context candidate derives keyed member key", async () => {
    const { stdout, exitCode } = await runCli(["verifiable", "alice", "--context", "candidate"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Bandersnatch Member Key");
    expect(stdout).toContain("Context:    candidate");
    expect(stdout).toContain("Member Key:");
  });

  test("unkeyed and --context candidate produce different keys for alice", async () => {
    const unkeyed = await runCli(["verifiable", "alice", "--output", "json"]);
    const candidate = await runCli([
      "verifiable",
      "alice",
      "--context",
      "candidate",
      "--output",
      "json",
    ]);
    expect(unkeyed.exitCode).toBe(0);
    expect(candidate.exitCode).toBe(0);
    const unkeyedKey = JSON.parse(unkeyed.stdout).memberKey;
    const candidateKey = JSON.parse(candidate.stdout).memberKey;
    expect(unkeyedKey).not.toBe(candidateKey);
  });

  test("deterministic: same call produces same key", async () => {
    const run1 = await runCli(["verifiable", "alice", "--output", "json"]);
    const run2 = await runCli(["verifiable", "alice", "--output", "json"]);
    expect(JSON.parse(run1.stdout).memberKey).toBe(JSON.parse(run2.stdout).memberKey);
  });

  test("all dev accounts work", async () => {
    for (const name of ["alice", "bob", "charlie", "dave", "eve", "ferdie"]) {
      const { stdout, exitCode } = await runCli(["verifiable", name, "--output", "json"]);
      expect(exitCode).toBe(0);
      const result = JSON.parse(stdout);
      expect(result.memberKey).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  test("all dev accounts produce same key (same mnemonic)", async () => {
    const results = [];
    for (const name of ["alice", "bob"]) {
      const { stdout } = await runCli(["verifiable", name, "--output", "json"]);
      results.push(JSON.parse(stdout).memberKey);
    }
    // Dev accounts share the same DEV_PHRASE, so same Bandersnatch key
    expect(results[0]).toBe(results[1]);
  });

  test("stored account derives member key", async () => {
    const { stdout, exitCode } = await runCli(["verifiable", "my-account"], {
      accounts: [STORED_ACCOUNT],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Bandersnatch Member Key");
    expect(stdout).toContain("Member Key:");
  });

  test("stored account with --context candidate", async () => {
    const { stdout, exitCode } = await runCli(
      ["verifiable", "my-account", "--context", "candidate"],
      { accounts: [STORED_ACCOUNT] },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Context:    candidate");
  });

  test("JSON output has correct structure", async () => {
    const { stdout, exitCode } = await runCli([
      "verifiable",
      "alice",
      "--context",
      "candidate",
      "--output",
      "json",
    ]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.account).toBe("alice");
    expect(result.context).toBe("candidate");
    expect(result.memberKey).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("JSON output without context omits context field", async () => {
    const { stdout, exitCode } = await runCli(["verifiable", "alice", "--output", "json"]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.account).toBe("alice");
    expect(result.memberKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(result.context).toBeUndefined();
  });

  test("unknown account errors", async () => {
    const { stderr, exitCode } = await runCli(["verifiable", "ghost"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown account");
  });

  test("watch-only account errors", async () => {
    const { stderr, exitCode } = await runCli(["verifiable", "watcher"], {
      accounts: [WATCH_ONLY],
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("watch-only");
  });

  test("hex seed account errors", async () => {
    const { stderr, exitCode } = await runCli(["verifiable", "hex-account"], {
      accounts: [HEX_SEED_ACCOUNT],
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("hex seed");
    expect(stderr).toContain("BIP39 mnemonic");
  });

  test("arbitrary --context string works", async () => {
    const { stdout, exitCode } = await runCli([
      "verifiable",
      "alice",
      "--context",
      "pps",
      "--output",
      "json",
    ]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.context).toBe("pps");
    expect(result.memberKey).toMatch(/^0x[0-9a-f]{64}$/);
  });

  test("different --context strings produce different member keys", async () => {
    const candidate = await runCli([
      "verifiable",
      "alice",
      "--context",
      "candidate",
      "--output",
      "json",
    ]);
    const pps = await runCli(["verifiable", "alice", "--context", "pps", "--output", "json"]);
    expect(JSON.parse(candidate.stdout).memberKey).not.toBe(JSON.parse(pps.stdout).memberKey);
  });

  // Pins the exact member keys produced by the underlying verifiablejs WASM
  // (verifiable crate v0.5.0). These bytes must match what the on-chain
  // `verifiable` pallet expects, so a silent crypto/serialization change in the
  // library — like the wire-incompatible bump from beta.2 — fails this test.
  test("alice derives known member keys (verifiablejs wire format)", async () => {
    const unkeyed = await runCli(["verifiable", "alice", "--output", "json"]);
    const candidate = await runCli([
      "verifiable",
      "alice",
      "--context",
      "candidate",
      "--output",
      "json",
    ]);
    expect(JSON.parse(unkeyed.stdout).memberKey).toBe(
      "0xbb6ee099b568f1844d62fc00e6305c2e83aa8da30ce59e664ef39e089204d43c",
    );
    expect(JSON.parse(candidate.stdout).memberKey).toBe(
      "0x5f915576987547d3e55bb4129ac8cae1d338f8933073dc74272b4c825f738592",
    );
  });

  test("saves bandersnatch key for stored accounts", async () => {
    // First derive
    const derive = await runCli(["verifiable", "my-account", "--context", "candidate"], {
      accounts: [STORED_ACCOUNT],
    });
    expect(derive.exitCode).toBe(0);

    // The key should be visible in the output
    expect(derive.stdout).toContain("Member Key:");
  });
});

const ALICE_FULL_MEMBER = "0x5f915576987547d3e55bb4129ac8cae1d338f8933073dc74272b4c825f738592";

// @ts-expect-error Bun supports describe(label, options, fn) at runtime
describe("dot verifiable member (--entropy-key)", { timeout: 15_000 }, () => {
  test("--entropy-key candidate matches the pinned full member key", async () => {
    const { stdout, exitCode } = await runCli([
      "verifiable",
      "member",
      "alice",
      "--entropy-key",
      "candidate",
      "--output",
      "json",
    ]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.memberKey).toBe(ALICE_FULL_MEMBER);
    expect(result.entropyKey).toBe("candidate");
    expect(result.context).toBeUndefined();
  });

  test("bare account still derives (back-compat) and --context warns on stderr", async () => {
    const { stdout, stderr, exitCode } = await runCli([
      "verifiable",
      "alice",
      "--context",
      "candidate",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Member Key:");
    expect(stderr).toContain("--entropy-key");
  });
});

// @ts-expect-error Bun supports describe(label, options, fn) at runtime
describe("dot verifiable alias / sign / prove / verify", { timeout: 20_000 }, () => {
  test("alias is deterministic for (account, entropy-key, context)", async () => {
    const run = () =>
      runCli([
        "verifiable",
        "alias",
        "alice",
        "--entropy-key",
        "candidate",
        "--context",
        "dotns",
        "--output",
        "json",
      ]);
    const a = JSON.parse((await run()).stdout);
    const b = JSON.parse((await run()).stdout);
    expect(a.alias).toMatch(/^0x[0-9a-f]{64}$/);
    expect(a.context).toBe("dotns");
    expect(a.alias).toBe(b.alias);
  });

  test("sign then verify-sig round-trips; wrong message fails", async () => {
    const signed = JSON.parse(
      (
        await runCli([
          "verifiable",
          "sign",
          "alice",
          "--message",
          "hello",
          "--entropy-key",
          "candidate",
          "--output",
          "json",
        ])
      ).stdout,
    );
    expect(signed.type).toBe("Bandersnatch");
    expect(signed.signature).toMatch(/^0x[0-9a-f]{128}$/);

    const ok = await runCli([
      "verifiable",
      "verify-sig",
      "--signature",
      signed.signature,
      "--member",
      signed.member,
      "--message",
      "hello",
    ]);
    expect(ok.exitCode).toBe(0);

    const bad = await runCli([
      "verifiable",
      "verify-sig",
      "--signature",
      signed.signature,
      "--member",
      signed.member,
      "--message",
      "goodbye",
    ]);
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toContain("invalid");
  });

  test("prove then verify round-trips, alias matches the alias command", async () => {
    const members = JSON.parse(
      (await runCli(["verifiable", "members", ALICE_FULL_MEMBER, "--output", "json"])).stdout,
    ).members;

    const proved = JSON.parse(
      (
        await runCli([
          "verifiable",
          "prove",
          "alice",
          "--entropy-key",
          "candidate",
          "--context",
          "dotns",
          "--message",
          "0xabcd",
          "--members",
          members,
          "--output",
          "json",
        ])
      ).stdout,
    );
    expect(proved.proof).toMatch(/^0x[0-9a-f]+$/);
    expect(proved.alias).toMatch(/^0x[0-9a-f]{64}$/);

    const aliasOut = JSON.parse(
      (
        await runCli([
          "verifiable",
          "alias",
          "alice",
          "--entropy-key",
          "candidate",
          "--context",
          "dotns",
          "--output",
          "json",
        ])
      ).stdout,
    );
    expect(proved.alias).toBe(aliasOut.alias);

    const verified = await runCli([
      "verifiable",
      "verify",
      "--proof",
      proved.proof,
      "--context",
      "dotns",
      "--message",
      "0xabcd",
      "--members",
      members,
      "--output",
      "json",
    ]);
    expect(verified.exitCode).toBe(0);
    expect(JSON.parse(verified.stdout).alias).toBe(proved.alias);
  });

  test("verify fails (exit 1) on a tampered message", async () => {
    const members = JSON.parse(
      (await runCli(["verifiable", "members", ALICE_FULL_MEMBER, "--output", "json"])).stdout,
    ).members;
    const proved = JSON.parse(
      (
        await runCli([
          "verifiable",
          "prove",
          "alice",
          "--entropy-key",
          "candidate",
          "--context",
          "dotns",
          "--message",
          "0xabcd",
          "--members",
          members,
          "--output",
          "json",
        ])
      ).stdout,
    );
    const bad = await runCli([
      "verifiable",
      "verify",
      "--proof",
      proved.proof,
      "--context",
      "dotns",
      "--message",
      "0xdead",
      "--members",
      members,
    ]);
    expect(bad.exitCode).toBe(1);
  });

  test("members encode reports count and hex", async () => {
    const { stdout, exitCode } = await runCli([
      "verifiable",
      "members",
      ALICE_FULL_MEMBER,
      ALICE_FULL_MEMBER,
      "--output",
      "json",
    ]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.count).toBe(2);
    // compact(2)=0x08 prefix + 2*32 bytes => 65 bytes => 130 hex chars + "0x"
    expect(result.members).toMatch(/^0x08[0-9a-f]{128}$/);
  });

  // `bandersnatch` is a command alias for `verifiable` (issue #192). These
  // mirror the primary tests above to prove the alias reaches the same handler
  // and produces identical output.
  describe("bandersnatch alias", () => {
    test("no account shows the same help as verifiable", async () => {
      const { stdout, exitCode } = await runCli(["bandersnatch"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("dot verifiable");
      expect(stdout).toContain("--entropy-key");
    });

    test("bandersnatch alice derives the member key", async () => {
      const { stdout, exitCode } = await runCli(["bandersnatch", "alice"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Bandersnatch Member Key");
      expect(stdout).toContain("Member Key:");
    });

    test("bandersnatch output is byte-identical to verifiable", async () => {
      const viaAlias = await runCli(["bandersnatch", "alice", "--output", "json"]);
      const viaVerifiable = await runCli(["verifiable", "alice", "--output", "json"]);
      expect(viaAlias.exitCode).toBe(0);
      expect(viaVerifiable.exitCode).toBe(0);
      expect(viaAlias.stdout).toBe(viaVerifiable.stdout);
    });
  });
});
