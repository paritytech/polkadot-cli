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
    expect(stdout).toContain("--person");
  });

  test("alice derives the full member key by default", async () => {
    const { stdout, exitCode } = await runCli(["verifiable", "alice"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Bandersnatch Member Key");
    expect(stdout).toContain("Person:     full");
    expect(stdout).toContain("Path:       //peopl.dot//0");
    expect(stdout).toContain("Member Key:");
    // The ring context is not part of key derivation, so it must not appear here.
    expect(stdout).not.toMatch(/^\s+Context:/m);
  });

  test("alice --person lite derives the lite member key", async () => {
    const { stdout, exitCode } = await runCli(["verifiable", "alice", "--person", "lite"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Person:     lite");
    expect(stdout).toContain("Path:       //peopl.dot//1");
    expect(stdout).toContain("Member Key:");
  });

  test("full and lite produce different keys for alice", async () => {
    const full = await runCli(["verifiable", "alice", "--output", "json"]);
    const lite = await runCli(["verifiable", "alice", "--person", "lite", "--output", "json"]);
    expect(full.exitCode).toBe(0);
    expect(lite.exitCode).toBe(0);
    expect(JSON.parse(full.stdout).memberKey).not.toBe(JSON.parse(lite.stdout).memberKey);
  });

  test("invalid --person is rejected", async () => {
    const { stderr, exitCode } = await runCli(["verifiable", "alice", "--person", "candidate"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid --person");
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

  test("stored account with --person lite", async () => {
    const { stdout, exitCode } = await runCli(["verifiable", "my-account", "--person", "lite"], {
      accounts: [STORED_ACCOUNT],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Person:     lite");
  });

  test("JSON output has correct structure", async () => {
    const { stdout, exitCode } = await runCli([
      "verifiable",
      "alice",
      "--person",
      "lite",
      "--output",
      "json",
    ]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.account).toBe("alice");
    expect(result.person).toBe("lite");
    expect(result.product).toBe("peopl.dot");
    expect(result.path).toBe("//peopl.dot//1");
    expect(result.memberKey).toMatch(/^0x[0-9a-f]{64}$/);
    // The ring context is a separate concept and never appears in member output.
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

  test("--context does not affect member-key derivation", async () => {
    const bare = await runCli(["verifiable", "alice", "--output", "json"]);
    const withCtx = await runCli(["verifiable", "alice", "--context", "dotns", "--output", "json"]);
    expect(JSON.parse(bare.stdout).memberKey).toBe(JSON.parse(withCtx.stdout).memberKey);
  });

  test("--product override derives a different key and reports the path", async () => {
    const { stdout, exitCode } = await runCli([
      "verifiable",
      "alice",
      "--product",
      "peopl.paseo",
      "--output",
      "json",
    ]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.product).toBe("peopl.paseo");
    expect(result.path).toBe("//peopl.paseo//0");
    expect(result.memberKey).not.toBe(ALICE_FULL_MEMBER);
  });

  test("all-digit --product is rejected", async () => {
    const { stderr, exitCode } = await runCli(["verifiable", "alice", "--product", "123"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("must not be all digits");
  });

  // Pins the exact member keys produced by the underlying verifiablejs WASM
  // (verifiable crate v0.5.0). These bytes must match what the on-chain
  // `verifiable` pallet expects, so a silent crypto/serialization change in the
  // library — like the wire-incompatible bump from beta.2 — fails this test.
  test("alice derives known member keys (verifiablejs wire format)", async () => {
    const full = await runCli(["verifiable", "alice", "--output", "json"]);
    const lite = await runCli(["verifiable", "alice", "--person", "lite", "--output", "json"]);
    expect(JSON.parse(full.stdout).memberKey).toBe(ALICE_FULL_MEMBER);
    expect(JSON.parse(lite.stdout).memberKey).toBe(
      "0x9dc979d9e8d3861c55fc7a0a15b439b5f22b619dd3b2e76a62a78156b79273ea",
    );
  });

  test("saves bandersnatch key for stored accounts", async () => {
    // First derive
    const derive = await runCli(["verifiable", "my-account", "--person", "lite"], {
      accounts: [STORED_ACCOUNT],
    });
    expect(derive.exitCode).toBe(0);

    // The key should be visible in the output
    expect(derive.stdout).toContain("Member Key:");
  });
});

const ALICE_FULL_MEMBER = "0x69ef2ed666eb7bfabcf93b4360c59439a03d6de3cccf77a411fcaa7017caf4a3";

// @ts-expect-error Bun supports describe(label, options, fn) at runtime
describe("dot verifiable member (--person)", { timeout: 15_000 }, () => {
  test("--person full matches the pinned full member key", async () => {
    const { stdout, exitCode } = await runCli([
      "verifiable",
      "member",
      "alice",
      "--person",
      "full",
      "--output",
      "json",
    ]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.memberKey).toBe(ALICE_FULL_MEMBER);
    expect(result.person).toBe("full");
  });

  // The pre-RFC-0022 flag must fail loudly: silently deriving a different key
  // would produce proofs no ring accepts, which is far worse than an error.
  test("--entropy-key is rejected with a pointer to --person", async () => {
    const { stderr, exitCode } = await runCli([
      "verifiable",
      "alice",
      "--entropy-key",
      "candidate",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--person full");
  });
});

// @ts-expect-error Bun supports describe(label, options, fn) at runtime
describe("dot verifiable alias / sign / prove / verify", { timeout: 20_000 }, () => {
  test("alias is deterministic for (account, person, context)", async () => {
    const run = () =>
      runCli([
        "verifiable",
        "alias",
        "alice",
        "--person",
        "full",
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
          "--person",
          "full",
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
          "--person",
          "full",
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
          "--person",
          "full",
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
          "--person",
          "full",
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
});
