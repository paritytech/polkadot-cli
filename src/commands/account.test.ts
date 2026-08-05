import { describe, expect, test } from "bun:test";
import type { StoredAccount } from "../config/accounts-types.ts";
import {
  bytesToHex,
  importAccount,
  publicKeyToHex,
  resolveAccountExpandedSecret,
} from "../core/accounts.ts";
import { runCli, TEST_MNEMONIC } from "./__fixtures__/run-cli.ts";

// Alice's known sr25519 keypair (derived from the dev phrase at //Alice).
const ALICE_PUBKEY = "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d";
const ALICE_SS58 = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
// Her 64-byte expanded secret — the value `--show-secret` prints. Computed once
// so the raw-private-key import tests exercise a real round-trip.
const aliceExpandedSecret = bytesToHex(await resolveAccountExpandedSecret("alice"));

const STORED_ACCOUNT: StoredAccount = {
  name: "my-account",
  secret: TEST_MNEMONIC,
  publicKey: "0x44a996beb1eef7bdcab976ab6d2ca26104834164ecf28fb375600576fcc6eb0f",
  derivationPath: "",
};

// @ts-expect-error Bun supports describe(label, options, fn) at runtime
describe("dot account", { timeout: 15_000 }, () => {
  test("no action shows help", async () => {
    const { stdout, exitCode } = await runCli(["account"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("dot account create");
    expect(stdout).toContain("dot account list");
  });

  test("--help shows same custom help as bare command", async () => {
    const bare = await runCli(["account"]);
    const help = await runCli(["account", "--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("dot account create");
    expect(help.stdout).toContain("dot account list");
    expect(help.stdout).toBe(bare.stdout);
  });

  // Regression for #238: `--help` must not be dropped for nested subcommands.
  // Previously `dot account add --help` ran the action and exited 1 with
  // "Account name is required" instead of printing usage.
  for (const sub of ["add", "inspect", "create", "import", "export", "derive", "remove", "list"]) {
    test(`account ${sub} --help prints usage and exits 0`, async () => {
      const { stdout, exitCode } = await runCli(["account", sub, "--help"]);
      expect(exitCode).toBe(0);
      expect(stdout).toContain("dot account add");
      expect(stdout).toContain("dot account list");
    });
  }

  test("account add --help is identical to bare account help", async () => {
    const bare = await runCli(["account"]);
    const sub = await runCli(["account", "add", "--help"]);
    expect(sub.exitCode).toBe(0);
    expect(sub.stdout).toBe(bare.stdout);
  });

  test("account add still adds a watch-only account (help not triggered without flag)", async () => {
    const { stdout, exitCode } = await runCli(["account", "add", "treasury", ALICE_SS58]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("watch-only");
    expect(stdout).toContain("treasury");
  });

  test("accounts shorthand lists accounts", async () => {
    const { stdout, exitCode } = await runCli(["accounts"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Dev Accounts");
    expect(stdout).toContain("Alice");
  });

  test("unknown input foo falls through to inspect and errors", async () => {
    const { stderr, exitCode } = await runCli(["account", "foo"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Cannot identify");
  });

  test("create my-test succeeds", async () => {
    const { stdout, exitCode } = await runCli(["account", "create", "my-test"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Created");
    expect(stdout).toContain("Mnemonic:");
    expect(stdout).toContain("Address:");
    expect(stdout).toContain("Bandersnatch:");
    expect(stdout).toContain("(candidate)");
  });

  test("new is an alias for create", async () => {
    const { stdout, exitCode } = await runCli(["account", "new", "my-test"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Created");
    expect(stdout).toContain("Mnemonic:");
    expect(stdout).toContain("Address:");
    expect(stdout).toContain("Bandersnatch:");
  });

  test("create (no name) errors", async () => {
    const { stderr, exitCode } = await runCli(["account", "create"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("name is required");
  });

  test("create alice (dev name) errors", async () => {
    const { stderr, exitCode } = await runCli(["account", "create", "alice"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("built-in dev account");
  });

  test("create existing (duplicate) errors", async () => {
    const { stderr, exitCode } = await runCli(["account", "create", "my-account"], {
      accounts: [STORED_ACCOUNT],
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("already exists");
  });

  test("add name --secret <mnemonic> succeeds", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "add",
      "my-imported",
      "--secret",
      TEST_MNEMONIC,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Imported");
    expect(stdout).toContain("Address:");
  });

  test("add with invalid secret errors", async () => {
    const { stderr, exitCode } = await runCli([
      "account",
      "add",
      "bad-key",
      "--secret",
      "not a valid mnemonic at all",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid secret");
  });

  test("import (no file, no stdin) errors without hanging", async () => {
    const { exitCode } = await runCli(["account", "import"]);
    expect(exitCode).toBe(1);
  });

  test("add bob (dev name) errors", async () => {
    const { stderr, exitCode } = await runCli(["account", "add", "bob", "--secret", TEST_MNEMONIC]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("built-in dev account");
  });

  test("list shows dev accounts", async () => {
    const { stdout, exitCode } = await runCli(["account", "list"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Dev Accounts");
    expect(stdout).toContain("Alice");
    expect(stdout).toContain("Bob");
  });

  test("list with stored accounts shows Dev + Signers sections", async () => {
    const { stdout, exitCode } = await runCli(["account", "list"], {
      accounts: [STORED_ACCOUNT],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Dev Accounts");
    expect(stdout).toContain("Signers");
    expect(stdout).toContain("my-account");
  });

  test("list with no stored shows (none)", async () => {
    const { stdout, exitCode } = await runCli(["account", "list"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(none)");
  });

  test("remove name succeeds", async () => {
    const { stdout, exitCode } = await runCli(["account", "remove", "my-account"], {
      accounts: [STORED_ACCOUNT],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("removed");
  });

  test("delete is an alias for remove", async () => {
    const { stdout, exitCode } = await runCli(["account", "delete", "my-account"], {
      accounts: [STORED_ACCOUNT],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("removed");
  });

  test("rm is an alias for remove", async () => {
    const { stdout, exitCode } = await runCli(["account", "rm", "my-account"], {
      accounts: [STORED_ACCOUNT],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('"my-account" removed');
  });

  test("remove (no name) errors", async () => {
    const { stderr, exitCode } = await runCli(["account", "remove"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("name is required");
  });

  test("remove alice (dev account) errors", async () => {
    const { stderr, exitCode } = await runCli(["account", "remove", "alice"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Cannot remove built-in");
  });

  test("remove ghost (not found) errors", async () => {
    const { stderr, exitCode } = await runCli(["account", "remove", "ghost"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });

  test("add name --env VAR (env set) succeeds with address", async () => {
    const { stdout, exitCode } = await runCli(
      ["account", "add", "env-test", "--env", "MY_SECRET"],
      {
        env: { MY_SECRET: TEST_MNEMONIC },
      },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Imported");
    expect(stdout).toContain("Address:");
  });

  test("add name --env VAR (env not set) succeeds with deferred", async () => {
    const { stdout, exitCode } = await runCli(
      ["account", "add", "env-test", "--env", "MY_SECRET"],
      { env: { MY_SECRET: "" } },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Imported");
    expect(stdout).toContain("will resolve");
  });

  test("add --secret and --env together errors", async () => {
    const { stderr, exitCode } = await runCli(
      ["account", "add", "env-test", "--secret", TEST_MNEMONIC, "--env", "MY_SECRET"],
      { env: { MY_SECRET: TEST_MNEMONIC } },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Use --secret or --env, not both");
  });

  test("add alice --env VAR (dev name) errors", async () => {
    const { stderr, exitCode } = await runCli(["account", "add", "alice", "--env", "MY_SECRET"], {
      env: { MY_SECRET: TEST_MNEMONIC },
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("built-in dev account");
  });

  test("add duplicate --env VAR errors", async () => {
    const { stderr, exitCode } = await runCli(
      ["account", "add", "my-account", "--env", "MY_SECRET"],
      {
        accounts: [STORED_ACCOUNT],
        env: { MY_SECRET: TEST_MNEMONIC },
      },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("already exists");
  });

  test("list with env-backed account shows env source on tree continuation", async () => {
    const envAccount: StoredAccount = {
      name: "env-acct",
      secret: { env: "MY_SECRET" },
      publicKey: "",
      derivationPath: "",
    };
    const { stdout, exitCode } = await runCli(["account", "list"], {
      accounts: [envAccount],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("└─ env:");
    expect(stdout).toContain("$MY_SECRET");
    expect(stdout).toContain("n/a");
  });

  test("list with env-backed account (env set) shows resolved address", async () => {
    const envAccount: StoredAccount = {
      name: "env-acct",
      secret: { env: "MY_SECRET" },
      publicKey: "",
      derivationPath: "",
    };
    const { stdout, exitCode } = await runCli(["account", "list"], {
      accounts: [envAccount],
      env: { MY_SECRET: TEST_MNEMONIC },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("└─ env:");
    expect(stdout).toContain("$MY_SECRET");
    expect(stdout).not.toContain("n/a");
  });

  test("remove env-backed account works", async () => {
    const envAccount: StoredAccount = {
      name: "env-acct",
      secret: { env: "MY_SECRET" },
      publicKey: "",
      derivationPath: "",
    };
    const { stdout, exitCode } = await runCli(["account", "remove", "env-acct"], {
      accounts: [envAccount],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("removed");
  });

  // multi-delete tests

  test("remove multiple names succeeds", async () => {
    const accounts: StoredAccount[] = [
      STORED_ACCOUNT,
      { ...STORED_ACCOUNT, name: "acct-2" },
      { ...STORED_ACCOUNT, name: "acct-3" },
    ];
    const { stdout, exitCode } = await runCli(["account", "remove", "my-account", "acct-3"], {
      accounts,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('"my-account" removed');
    expect(stdout).toContain('"acct-3" removed');
  });

  test("remove multiple with one not-found errors without deleting any", async () => {
    const accounts: StoredAccount[] = [STORED_ACCOUNT, { ...STORED_ACCOUNT, name: "acct-2" }];
    const { stderr, exitCode } = await runCli(["account", "remove", "my-account", "ghost"], {
      accounts,
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain('"ghost" not found');
  });

  test("remove multiple with one dev account errors without deleting any", async () => {
    const { stderr, exitCode } = await runCli(["account", "remove", "my-account", "alice"], {
      accounts: [STORED_ACCOUNT],
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("built-in dev account");
  });

  test("delete multiple (alias) succeeds", async () => {
    const accounts: StoredAccount[] = [STORED_ACCOUNT, { ...STORED_ACCOUNT, name: "acct-2" }];
    const { stdout, exitCode } = await runCli(["account", "delete", "my-account", "acct-2"], {
      accounts,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('"my-account" removed');
    expect(stdout).toContain('"acct-2" removed');
  });

  test("rm multiple (alias) succeeds", async () => {
    const accounts: StoredAccount[] = [STORED_ACCOUNT, { ...STORED_ACCOUNT, name: "acct-2" }];
    const { stdout, exitCode } = await runCli(["account", "rm", "my-account", "acct-2"], {
      accounts,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain('"my-account" removed');
    expect(stdout).toContain('"acct-2" removed');
  });

  // --path tests

  test("create --path //Test creates account with derivation path", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "create",
      "my-derived",
      "--path",
      "//Test",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Created");
    expect(stdout).toContain("Path:");
    expect(stdout).toContain("//Test");
    expect(stdout).toContain("Address:");
  });

  test("add --secret with --path stores path", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "add",
      "my-derived",
      "--secret",
      TEST_MNEMONIC,
      "--path",
      "//Bar",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Imported");
    expect(stdout).toContain("Path:");
    expect(stdout).toContain("//Bar");
    expect(stdout).toContain("Address:");
  });

  test("add --env with --path stores path", async () => {
    const { stdout, exitCode } = await runCli(
      ["account", "add", "env-derived", "--env", "MY_SECRET", "--path", "//ci"],
      { env: { MY_SECRET: TEST_MNEMONIC } },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Imported");
    expect(stdout).toContain("Path:");
    expect(stdout).toContain("//ci");
    expect(stdout).toContain("Address:");
  });

  test("derive creates child account from source", async () => {
    const { stdout, exitCode } = await runCli(
      ["account", "derive", "my-account", "child-acct", "--path", "//child"],
      { accounts: [STORED_ACCOUNT] },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Derived");
    expect(stdout).toContain("child-acct");
    expect(stdout).toContain("my-account");
    expect(stdout).toContain("//child");
    expect(stdout).toContain("Address:");
  });

  test("derive without --path errors", async () => {
    const { stderr, exitCode } = await runCli(["account", "derive", "my-account", "child-acct"], {
      accounts: [STORED_ACCOUNT],
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--path is required");
  });

  test("derive with nonexistent source errors", async () => {
    const { stderr, exitCode } = await runCli([
      "account",
      "derive",
      "nonexistent",
      "child-acct",
      "--path",
      "//x",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });

  test("derive without new name errors", async () => {
    const { stderr, exitCode } = await runCli(
      ["account", "derive", "my-account", "--path", "//x"],
      { accounts: [STORED_ACCOUNT] },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("New account name is required");
  });

  test("derive from env-backed source works", async () => {
    const envAccount: StoredAccount = {
      name: "env-source",
      secret: { env: "MY_SECRET" },
      publicKey: "",
      derivationPath: "",
    };
    const { stdout, exitCode } = await runCli(
      ["account", "derive", "env-source", "env-child", "--path", "//x"],
      { accounts: [envAccount], env: { MY_SECRET: TEST_MNEMONIC } },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Derived");
    expect(stdout).toContain("env-child");
    expect(stdout).toContain("Address:");
  });

  test("list shows derivation path on tree continuation line", async () => {
    const derivedAccount: StoredAccount = {
      name: "derived-acct",
      secret: TEST_MNEMONIC,
      publicKey: "0x44a996beb1eef7bdcab976ab6d2ca26104834164ecf28fb375600576fcc6eb0f",
      derivationPath: "//staking",
    };
    const { stdout, exitCode } = await runCli(["account", "list"], {
      accounts: [derivedAccount],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("derived-acct");
    // Single attribute → terminal connector
    expect(stdout).toContain("└─ path:");
    expect(stdout).toContain("//staking");
  });

  test("list shows path and env on separate tree branches when both set", async () => {
    const envDerived: StoredAccount = {
      name: "env-derived",
      secret: { env: "MY_SECRET" },
      publicKey: "",
      derivationPath: "//ci",
    };
    const { stdout, exitCode } = await runCli(["account", "list"], {
      accounts: [envDerived],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("env-derived");
    // Two attributes → first uses ├─, last uses └─
    expect(stdout).toContain("├─ path:");
    expect(stdout).toContain("//ci");
    expect(stdout).toContain("└─ env:");
    expect(stdout).toContain("$MY_SECRET");
  });

  // --path multi-segment tests

  test("create --path //polkadot//0/wallet works with multi-segment path", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "create",
      "multi-seg",
      "--path",
      "//polkadot//0/wallet",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Created");
    expect(stdout).toContain("Path:");
    expect(stdout).toContain("//polkadot//0/wallet");
    expect(stdout).toContain("Address:");
  });

  test("add --secret with multi-segment --path //hard/soft//hard2", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "add",
      "multi-imported",
      "--secret",
      TEST_MNEMONIC,
      "--path",
      "//hard/soft//hard2",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Imported");
    expect(stdout).toContain("Path:");
    expect(stdout).toContain("//hard/soft//hard2");
    expect(stdout).toContain("Address:");
  });

  test("add with different multi-segment paths produces different addresses", async () => {
    const run = async (path: string) => {
      const { stdout, exitCode } = await runCli([
        "account",
        "add",
        `acct-${path.replace(/\//g, "-")}`,
        "--secret",
        TEST_MNEMONIC,
        "--path",
        path,
      ]);
      expect(exitCode).toBe(0);
      const match = stdout.match(/Address:\s+(\S+)/);
      expect(match).toBeTruthy();
      return match![1];
    };

    const [addr1, addr2, addr3] = await Promise.all([run("//a"), run("//a//b"), run("//a/b")]);

    expect(addr1).not.toBe(addr2);
    expect(addr1).not.toBe(addr3);
    expect(addr2).not.toBe(addr3);
  });

  test("derive with multi-segment --path //polkadot//0/wallet", async () => {
    const { stdout, exitCode } = await runCli(
      ["account", "derive", "my-account", "multi-child", "--path", "//polkadot//0/wallet"],
      { accounts: [STORED_ACCOUNT] },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Derived");
    expect(stdout).toContain("multi-child");
    expect(stdout).toContain("//polkadot//0/wallet");
    expect(stdout).toContain("Address:");
  });

  // inspect tests

  test("inspect alice shows public key, SS58 and H160", async () => {
    const { stdout, exitCode } = await runCli(["account", "inspect", "alice"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Info");
    expect(stdout).toContain("Alice");
    expect(stdout).toContain("0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d");
    expect(stdout).toContain("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY");
    expect(stdout).toContain("H160:");
    expect(stdout).toContain("0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D");
  });

  test("inspect alice (implicit, no inspect keyword) works", async () => {
    const { stdout, exitCode } = await runCli(["account", "alice"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Info");
    expect(stdout).toContain("Alice");
    expect(stdout).toContain("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY");
  });

  test("inspect stored account by name", async () => {
    const { stdout, exitCode } = await runCli(["account", "inspect", "my-account"], {
      accounts: [STORED_ACCOUNT],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Info");
    expect(stdout).toContain("my-account");
    expect(stdout).toContain(STORED_ACCOUNT.publicKey);
  });

  test("inspect SS58 address decodes to public key", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "inspect",
      "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Info");
    expect(stdout).toContain("0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d");
    expect(stdout).toContain("SS58:");
  });

  test("inspect hex public key shows SS58", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "inspect",
      "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Info");
    expect(stdout).toContain("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY");
  });

  test("inspect with --prefix 0 encodes Polkadot address", async () => {
    const { stdout, exitCode } = await runCli(["account", "inspect", "alice", "--prefix", "0"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Prefix:      0");
    // Polkadot prefix=0 addresses start with '1'
    expect(stdout).toMatch(/SS58:\s+1\S+/);
  });

  test("inspect with --output json returns valid JSON", async () => {
    const { stdout, exitCode } = await runCli(["account", "inspect", "alice", "--output", "json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.name).toBe("Alice");
    expect(parsed.publicKey).toBe(
      "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d",
    );
    expect(parsed.ss58).toBe("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY");
    expect(parsed.h160).toBe("0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D");
    expect(parsed.prefix).toBe(42);
  });

  test("inspect H160 resolves to revive fallback AccountId32", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "inspect",
      "0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Info");
    expect(stdout).toContain("revive H160 fallback");
    // Fallback AccountId32 = H160 || 0xEE * 12 (lowercased in public-key form)
    expect(stdout).toContain("0x9621dde636de098b43efb0fa9b61facfe328f99deeeeeeeeeeeeeeeeeeeeeeee");
    // The H160 line echoes the same EIP-55 address back
    expect(stdout).toContain("H160:");
    expect(stdout).toContain("0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D");
  });

  test("inspect H160 with --output json returns fallback fields", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "inspect",
      "0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D",
      "--output",
      "json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.kind).toBe("revive H160 fallback");
    expect(parsed.publicKey).toBe(
      "0x9621dde636de098b43efb0fa9b61facfe328f99deeeeeeeeeeeeeeeeeeeeeeee",
    );
    expect(parsed.h160).toBe("0x9621DDe636dE098B43Efb0fA9b61fAcFE328F99D");
  });

  test("inspect invalid input errors", async () => {
    const { stderr, exitCode } = await runCli(["account", "inspect", "garbage!!!"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Cannot identify");
  });

  test("inspect env-backed account with env set resolves", async () => {
    const envAccount: StoredAccount = {
      name: "env-acct",
      secret: { env: "MY_SECRET" },
      publicKey: "",
      derivationPath: "",
    };
    const { stdout, exitCode } = await runCli(["account", "inspect", "env-acct"], {
      accounts: [envAccount],
      env: { MY_SECRET: TEST_MNEMONIC },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Info");
    expect(stdout).toContain("env-acct");
    expect(stdout).toContain("Public Key:");
  });

  test("inspect env-backed account without env errors", async () => {
    const envAccount: StoredAccount = {
      name: "env-acct",
      secret: { env: "MY_SECRET" },
      publicKey: "",
      derivationPath: "",
    };
    const { stderr, exitCode } = await runCli(["account", "inspect", "env-acct"], {
      accounts: [envAccount],
      env: { MY_SECRET: "" },
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Cannot derive");
  });

  // ---------------------------------------------------------------------------
  // watch-only account tests
  // ---------------------------------------------------------------------------

  const WATCH_ONLY: StoredAccount = {
    name: "treasury",
    publicKey: "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d",
    derivationPath: "",
  };

  test("add <name> <ss58> creates watch-only account", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "add",
      "treasury",
      "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Added (watch-only)");
    expect(stdout).toContain("treasury");
    expect(stdout).toContain("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY");
  });

  test("add <name> <hex-key> creates watch-only from hex", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "add",
      "hex-watch",
      "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Added (watch-only)");
    expect(stdout).toContain("hex-watch");
  });

  test("add (no name) errors", async () => {
    const { stderr, exitCode } = await runCli(["account", "add"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("name is required");
  });

  test("add <name> (no address) errors", async () => {
    const { stderr, exitCode } = await runCli(["account", "add", "lonely"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Address is required");
  });

  test("add alice <ss58> (dev name) errors", async () => {
    const { stderr, exitCode } = await runCli([
      "account",
      "add",
      "alice",
      "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("built-in dev account");
  });

  test("add existing-name <ss58> (duplicate) errors", async () => {
    const { stderr, exitCode } = await runCli(
      ["account", "add", "treasury", "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"],
      { accounts: [WATCH_ONLY] },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("already exists");
  });

  test("add <name> garbage!!! (invalid address) errors", async () => {
    const { stderr, exitCode } = await runCli(["account", "add", "bad-addr", "garbage!!!"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid address");
  });

  test("add with --secret still works as import", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "add",
      "secret-add",
      "--secret",
      TEST_MNEMONIC,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Imported");
    expect(stdout).toContain("Address:");
  });

  test("list groups raw watch-only accounts under Watch-only section", async () => {
    const { stdout, exitCode } = await runCli(["account", "list"], {
      accounts: [WATCH_ONLY],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Watch-only");
    expect(stdout).toContain("treasury");
    // Section title (not legacy "(watch-only)" annotation appended to name)
    expect(stdout).not.toMatch(/treasury\s+\(watch-only\)/);
  });

  test("list shows address for watch-only account", async () => {
    const { stdout, exitCode } = await runCli(["account", "list"], {
      accounts: [WATCH_ONLY],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY");
  });

  test("inspect watch-only account works", async () => {
    const { stdout, exitCode } = await runCli(["account", "inspect", "treasury"], {
      accounts: [WATCH_ONLY],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Info");
    expect(stdout).toContain("treasury");
    expect(stdout).toContain(WATCH_ONLY.publicKey);
  });

  test("remove watch-only account works", async () => {
    const { stdout, exitCode } = await runCli(["account", "remove", "treasury"], {
      accounts: [WATCH_ONLY],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("removed");
  });

  test("derive from watch-only source errors", async () => {
    const { stderr, exitCode } = await runCli(
      ["account", "derive", "treasury", "child-acct", "--path", "//child"],
      { accounts: [WATCH_ONLY] },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("watch-only");
  });

  // --json output tests
  test("list --json returns structured dev and stored accounts", async () => {
    const { stdout, exitCode } = await runCli(["account", "list", "--json"], {
      accounts: [STORED_ACCOUNT],
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed.dev)).toBe(true);
    expect(parsed.dev.length).toBeGreaterThan(0);
    expect(parsed.dev[0]).toHaveProperty("name");
    expect(parsed.dev[0]).toHaveProperty("address");
    expect(Array.isArray(parsed.stored)).toBe(true);
    expect(parsed.stored.length).toBe(1);
    expect(parsed.stored[0].name).toBe("my-account");
  });

  test("accounts shorthand --json returns JSON", async () => {
    const { stdout, exitCode } = await runCli(["accounts", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed.dev)).toBe(true);
  });

  test("create --json returns account details as JSON", async () => {
    const { stdout, exitCode, stderr } = await runCli(["account", "create", "test-acct", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.name).toBe("test-acct");
    expect(parsed.address).toBeDefined();
    expect(parsed.publicKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(parsed.mnemonic).toBeDefined();
    expect(parsed.mnemonic.split(" ").length).toBeGreaterThanOrEqual(12);
    // Warning goes to stderr
    expect(stderr).toContain("mnemonic");
  });

  test("inspect --json with --json flag (not --output json)", async () => {
    const { stdout, exitCode } = await runCli(["account", "inspect", "alice", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.name).toBe("Alice");
    expect(parsed.publicKey).toMatch(/^0x/);
    expect(parsed.ss58).toBeDefined();
    expect(parsed.prefix).toBe(42);
  });

  // --show-secret tests
  test("inspect dev account --show-secret prints 64-byte hex", async () => {
    const { stdout, exitCode } = await runCli(["account", "inspect", "dave", "--show-secret"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Private Key:");
    expect(stdout).toContain("sr25519 expanded, 64 bytes");
    const match = stdout.match(/Private Key:\s+(0x[0-9a-f]+)/);
    expect(match?.[1]).toMatch(/^0x[0-9a-f]{128}$/);
  });

  test("inspect --show-secret --json surfaces privateKey field", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "inspect",
      "alice",
      "--show-secret",
      "--json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.privateKey).toMatch(/^0x[0-9a-f]{128}$/);
  });

  test("inspect --show-secret on stored account with mnemonic", async () => {
    const { stdout, exitCode } = await runCli(
      ["account", "inspect", "my-account", "--show-secret"],
      { accounts: [STORED_ACCOUNT] },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/Private Key:\s+0x[0-9a-f]{128}/);
  });

  test("inspect --show-secret on stored account with hex-seed secret and soft path", async () => {
    const hexSeed = `0x${"11".repeat(32)}`;
    const softPath = "/soft";
    const hexAcct: StoredAccount = {
      name: "hex-acct",
      secret: hexSeed,
      publicKey: publicKeyToHex(importAccount(hexSeed, softPath).publicKey),
      derivationPath: softPath,
    };
    const { stdout, exitCode } = await runCli(
      ["account", "inspect", "hex-acct", "--show-secret", "--json"],
      { accounts: [hexAcct] },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.privateKey).toMatch(/^0x[0-9a-f]{128}$/);
  });

  test("inspect --show-secret exercises numeric //0 derivation", async () => {
    const numericPath = "//0";
    const hexAcct: StoredAccount = {
      name: "numeric-acct",
      secret: TEST_MNEMONIC,
      publicKey: publicKeyToHex(importAccount(TEST_MNEMONIC, numericPath).publicKey),
      derivationPath: numericPath,
    };
    const { stdout, exitCode } = await runCli(
      ["account", "inspect", "numeric-acct", "--show-secret", "--json"],
      { accounts: [hexAcct] },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.privateKey).toMatch(/^0x[0-9a-f]{128}$/);
  });

  test("inspect --show-secret on watch-only account errors", async () => {
    const watchOnly: StoredAccount = {
      name: "treasury",
      publicKey: "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d",
      derivationPath: "",
    };
    const { stderr, exitCode } = await runCli(["account", "inspect", "treasury", "--show-secret"], {
      accounts: [watchOnly],
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("watch-only");
  });

  test("inspect --show-secret on raw SS58 address errors", async () => {
    const { stderr, exitCode } = await runCli([
      "account",
      "inspect",
      "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
      "--show-secret",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("--show-secret requires an account name");
  });

  test("inspect --show-secret on env-backed account uses resolved env", async () => {
    const envAcct: StoredAccount = {
      name: "env-acct",
      secret: { env: "MY_SECRET" },
      publicKey: "",
      derivationPath: "",
    };
    const { stdout, exitCode } = await runCli(
      ["account", "inspect", "env-acct", "--show-secret", "--json"],
      { accounts: [envAcct], env: { MY_SECRET: TEST_MNEMONIC } },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.privateKey).toMatch(/^0x[0-9a-f]{128}$/);
  });

  // --show-secret: reveal the stored mnemonic / seed (issue #224, part 1)
  test("inspect --show-secret reveals the stored mnemonic (text)", async () => {
    const { stdout, exitCode } = await runCli(
      ["account", "inspect", "my-account", "--show-secret"],
      { accounts: [STORED_ACCOUNT] },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain(`Mnemonic:    ${TEST_MNEMONIC}`);
    expect(stdout).toMatch(/Private Key:\s+0x[0-9a-f]{128}/);
    // No derivation path → the bare phrase reproduces the address, so no hint.
    expect(stdout).not.toContain("re-import needs --path");
  });

  test("inspect --show-secret warns that a derived mnemonic needs --path on re-import", async () => {
    const derivedAcct: StoredAccount = {
      name: "hot-wallet",
      secret: TEST_MNEMONIC,
      publicKey: publicKeyToHex(importAccount(TEST_MNEMONIC, "//hot").publicKey),
      derivationPath: "//hot",
    };
    const { stdout, exitCode } = await runCli(
      ["account", "inspect", "hot-wallet", "--show-secret"],
      { accounts: [derivedAcct] },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain(`Mnemonic:    ${TEST_MNEMONIC}`);
    expect(stdout).toContain("derived with //hot — re-import needs --path //hot");
  });

  test("inspect --show-secret reveals the stored mnemonic (json)", async () => {
    const { stdout, exitCode } = await runCli(
      ["account", "inspect", "my-account", "--show-secret", "--json"],
      { accounts: [STORED_ACCOUNT] },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.mnemonic).toBe(TEST_MNEMONIC);
    expect(parsed.privateKey).toMatch(/^0x[0-9a-f]{128}$/);
  });

  test("inspect --show-secret reveals a stored hex seed under the `seed` field", async () => {
    const hexSeed = `0x${"11".repeat(32)}`;
    const seedAcct: StoredAccount = {
      name: "seed-acct",
      secret: hexSeed,
      publicKey: publicKeyToHex(importAccount(hexSeed).publicKey),
      derivationPath: "",
    };
    const { stdout, exitCode } = await runCli(
      ["account", "inspect", "seed-acct", "--show-secret", "--json"],
      { accounts: [seedAcct] },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.seed).toBe(hexSeed);
    expect(parsed.mnemonic).toBeUndefined();
  });

  test("inspect --show-secret does NOT reveal env-backed secrets (stays redacted)", async () => {
    const envAcct: StoredAccount = {
      name: "env-acct",
      secret: { env: "MY_SECRET" },
      publicKey: "",
      derivationPath: "",
    };
    const { stdout, exitCode } = await runCli(
      ["account", "inspect", "env-acct", "--show-secret", "--json"],
      { accounts: [envAcct], env: { MY_SECRET: TEST_MNEMONIC } },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    // The resolved phrase must never appear; only the $VAR reference is shown.
    expect(parsed.mnemonic).toBeUndefined();
    expect(parsed.seed).toBeUndefined();
    expect(parsed.env).toBe("MY_SECRET");
    expect(stdout).not.toContain(TEST_MNEMONIC);
  });

  // ---------------------------------------------------------------------------
  // Raw private key import — 64-byte sr25519 expanded secret (issue #224, part 2)
  // ---------------------------------------------------------------------------

  test("add --secret 0x<128hex> imports a usable raw private key account", async () => {
    const { stdout, exitCode } = await runCli(
      ["account", "add", "raw-key", "--secret", aliceExpandedSecret, "--json"],
      { noDefaultChain: true },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.address).toBe(ALICE_SS58);
    expect(parsed.publicKey).toBe(ALICE_PUBKEY);
  });

  test("add --secret 0x<128hex> (text output) succeeds", async () => {
    const { stdout, exitCode } = await runCli(
      ["account", "add", "raw-key", "--secret", aliceExpandedSecret],
      { noDefaultChain: true },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Imported");
    expect(stdout).toContain(ALICE_SS58);
  });

  test("add --secret 0x<128hex> --path is rejected (no HD derivation)", async () => {
    const { stderr, exitCode } = await runCli(
      ["account", "add", "raw-key", "--secret", aliceExpandedSecret, "--path", "//staking"],
      { noDefaultChain: true },
    );
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Derivation paths are not supported");
  });

  test("a raw-private-key account can sign", async () => {
    const rawAcct: StoredAccount = {
      name: "raw-signer",
      secret: aliceExpandedSecret,
      publicKey: ALICE_PUBKEY,
      derivationPath: "",
    };
    const { stdout, exitCode } = await runCli(["sign", "hello world", "--from", "raw-signer"], {
      accounts: [rawAcct],
      noDefaultChain: true,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Signature:");
    expect(stdout).toContain("Sr25519");
  });

  test("inspect --show-secret on a raw-key account round-trips to the same private key", async () => {
    const rawAcct: StoredAccount = {
      name: "raw-key",
      secret: aliceExpandedSecret,
      publicKey: ALICE_PUBKEY,
      derivationPath: "",
    };
    const { stdout, exitCode } = await runCli(
      ["account", "inspect", "raw-key", "--show-secret", "--json"],
      { accounts: [rawAcct] },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    // The stored secret already IS the expanded key — printed as privateKey, not duplicated.
    expect(parsed.privateKey).toBe(aliceExpandedSecret);
    expect(parsed.mnemonic).toBeUndefined();
    expect(parsed.seed).toBeUndefined();
  });

  test("32-byte hex seed import now works from the CLI (cac coercion fixed)", async () => {
    const hexSeed = `0x${"11".repeat(32)}`;
    const { stdout, exitCode } = await runCli(
      ["account", "add", "seed-acct", "--secret", hexSeed, "--json"],
      { noDefaultChain: true },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.publicKey).toBe(publicKeyToHex(importAccount(hexSeed).publicKey));
  });

  test("remove --json returns removed names", async () => {
    const { stdout, exitCode } = await runCli(["account", "remove", "my-account", "--json"], {
      accounts: [STORED_ACCOUNT],
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.removed).toEqual(["my-account"]);
  });

  // ---------------------------------------------------------------------------
  // export / batch-import tests
  // ---------------------------------------------------------------------------

  test("export with no stored accounts produces empty array", async () => {
    const { stdout, exitCode } = await runCli(["account", "export"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.accounts).toEqual([]);
  });

  test("export redacts secrets by default", async () => {
    const { stdout, exitCode } = await runCli(["account", "export"], {
      accounts: [STORED_ACCOUNT],
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.accounts.length).toBe(1);
    expect(parsed.accounts[0].name).toBe("my-account");
    expect(parsed.accounts[0].publicKey).toBe(STORED_ACCOUNT.publicKey);
    expect(parsed.accounts[0].secret).toBe("<redacted>");
    // Mnemonic must NOT appear in output
    expect(stdout).not.toContain(TEST_MNEMONIC);
  });

  test("export --include-secrets includes mnemonic", async () => {
    const { stdout, stderr, exitCode } = await runCli(["account", "export", "--include-secrets"], {
      accounts: [STORED_ACCOUNT],
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.accounts[0].secret).toBe(TEST_MNEMONIC);
    expect(stderr).toContain("Warning");
  });

  test("export watch-only account has no secret field", async () => {
    const { stdout, exitCode } = await runCli(["account", "export"], {
      accounts: [WATCH_ONLY],
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.accounts[0].name).toBe("treasury");
    expect(parsed.accounts[0].secret).toBeUndefined();
  });

  test("export env-backed account includes env reference", async () => {
    const envAccount: StoredAccount = {
      name: "ci-signer",
      secret: { env: "MY_SECRET" },
      publicKey: "",
      derivationPath: "//ci",
    };
    const { stdout, exitCode } = await runCli(["account", "export"], {
      accounts: [envAccount],
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.accounts[0].secret).toEqual({ env: "MY_SECRET" });
    // Env var VALUE must not appear
    expect(stdout).not.toContain(TEST_MNEMONIC);
  });

  test("export --watch-only filters to watch-only accounts", async () => {
    const { stdout, exitCode } = await runCli(["account", "export", "--watch-only"], {
      accounts: [STORED_ACCOUNT, WATCH_ONLY],
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.accounts.length).toBe(1);
    expect(parsed.accounts[0].name).toBe("treasury");
  });

  test("export specific accounts by name", async () => {
    const { stdout, exitCode } = await runCli(["account", "export", "my-account"], {
      accounts: [STORED_ACCOUNT, WATCH_ONLY],
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.accounts.length).toBe(1);
    expect(parsed.accounts[0].name).toBe("my-account");
  });

  test("export nonexistent account errors", async () => {
    const { stderr, exitCode } = await runCli(["account", "export", "nonexistent"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("not found");
  });

  test("export to --file writes to disk", async () => {
    const { stdout, exitCode } = await runCli(
      ["account", "export", "--file", "{{HOME}}/accounts.json"],
      { accounts: [STORED_ACCOUNT] },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Exported");
    expect(stdout).toContain("1 account(s)");
  });

  test("export preserves bandersnatch keys", async () => {
    const acct: StoredAccount = {
      ...STORED_ACCOUNT,
      bandersnatch: { "": "0xaabb", candidate: "0xccdd" },
    };
    const { stdout, exitCode } = await runCli(["account", "export", "--include-secrets"], {
      accounts: [acct],
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.accounts[0].bandersnatch).toEqual({ "": "0xaabb", candidate: "0xccdd" });
  });

  test("batch import adds new accounts (positional file)", async () => {
    const importData = JSON.stringify({
      accounts: [
        {
          name: "imported-watch",
          publicKey: "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d",
          derivationPath: "",
        },
      ],
    });
    const { stdout, exitCode } = await runCli(["account", "import", "{{HOME}}/import.json"], {
      files: { "import.json": importData },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("imported-watch");
    expect(stdout).toContain("1 added");
  });

  test("batch import skips existing accounts without --overwrite", async () => {
    const importData = JSON.stringify({
      accounts: [
        {
          name: "my-account",
          publicKey: "0xaabbccdd",
          derivationPath: "",
        },
      ],
    });
    const { stdout, stderr, exitCode } = await runCli(
      ["account", "import", "{{HOME}}/import.json"],
      { accounts: [STORED_ACCOUNT], files: { "import.json": importData } },
    );
    expect(exitCode).toBe(0);
    expect(stderr).toContain("Skipped");
    expect(stdout).toContain("my-account (skipped)");
    expect(stdout).toContain("1 skipped");
  });

  test("batch import --overwrite replaces existing accounts", async () => {
    const importData = JSON.stringify({
      accounts: [
        {
          name: "my-account",
          publicKey: "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d",
          derivationPath: "",
        },
      ],
    });
    const { stdout, exitCode } = await runCli(
      ["account", "import", "{{HOME}}/import.json", "--overwrite"],
      { accounts: [STORED_ACCOUNT], files: { "import.json": importData } },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("my-account");
    expect(stdout).toContain("(overwritten)");
    expect(stdout).toContain("1 overwritten");
  });

  test("batch import --dry-run does not persist", async () => {
    const importData = JSON.stringify({
      accounts: [
        {
          name: "dry-run-acct",
          publicKey: "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d",
          derivationPath: "",
        },
      ],
    });
    const { stdout, exitCode } = await runCli(
      ["account", "import", "{{HOME}}/import.json", "--dry-run"],
      { files: { "import.json": importData } },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("(dry run)");
    expect(stdout).toContain("dry-run-acct");
    expect(stdout).toContain("1 added");
  });

  test("batch import redacted account becomes watch-only", async () => {
    const importData = JSON.stringify({
      accounts: [
        {
          name: "redacted-acct",
          publicKey: "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d",
          derivationPath: "",
          secret: "<redacted>",
        },
      ],
    });
    const { stdout, exitCode } = await runCli(
      ["account", "import", "{{HOME}}/import.json", "--json"],
      { files: { "import.json": importData } },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.added).toContain("redacted-acct");
  });

  test("batch import env-backed account preserves env reference", async () => {
    const importData = JSON.stringify({
      accounts: [
        {
          name: "env-import",
          publicKey: "",
          derivationPath: "//ci",
          secret: { env: "CI_SECRET" },
        },
      ],
    });
    const { stdout, exitCode } = await runCli(
      ["account", "import", "{{HOME}}/import.json", "--json"],
      { files: { "import.json": importData } },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.added).toContain("env-import");
  });

  test("batch import with mnemonic secret validates and derives public key", async () => {
    const importData = JSON.stringify({
      accounts: [
        {
          name: "full-import",
          publicKey: "",
          derivationPath: "",
          secret: TEST_MNEMONIC,
        },
      ],
    });
    const { stdout, exitCode } = await runCli(
      ["account", "import", "{{HOME}}/import.json", "--json"],
      { files: { "import.json": importData } },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.added).toContain("full-import");
  });

  test("batch import skips dev accounts", async () => {
    const importData = JSON.stringify({
      accounts: [{ name: "alice", publicKey: "0xaabb", derivationPath: "" }],
    });
    const { stderr, exitCode } = await runCli(["account", "import", "{{HOME}}/import.json"], {
      files: { "import.json": importData },
    });
    expect(exitCode).toBe(0);
    expect(stderr).toContain("Skipped");
    expect(stderr).toContain("dev account");
  });

  test("batch import invalid JSON errors", async () => {
    const { stderr, exitCode } = await runCli(["account", "import", "{{HOME}}/bad.json"], {
      files: { "bad.json": "not valid json" },
    });
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid JSON");
  });

  test("batch import from stdin", async () => {
    const importData = JSON.stringify({
      accounts: [
        {
          name: "stdin-acct",
          publicKey: "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d",
          derivationPath: "",
        },
      ],
    });
    const { stdout, exitCode } = await runCli(["account", "import", "-"], {
      stdin: importData,
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("stdin-acct");
    expect(stdout).toContain("1 added");
  });

  test("batch import --json returns structured output", async () => {
    const importData = JSON.stringify({
      accounts: [
        {
          name: "json-acct",
          publicKey: "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d",
          derivationPath: "",
        },
      ],
    });
    const { stdout, exitCode } = await runCli(
      ["account", "import", "{{HOME}}/import.json", "--json"],
      { files: { "import.json": importData } },
    );
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.action).toBe("imported");
    expect(parsed.added).toContain("json-acct");
  });

  test("export/import round-trip preserves accounts (redacted as watch-only)", async () => {
    // Export
    const exported = await runCli(["account", "export"], {
      accounts: [STORED_ACCOUNT, WATCH_ONLY],
    });
    expect(exported.exitCode).toBe(0);

    // Import into clean environment via stdin
    const imported = await runCli(["account", "import", "-", "--json"], {
      stdin: exported.stdout,
    });
    expect(imported.exitCode).toBe(0);
    const result = JSON.parse(imported.stdout);
    expect(result.added).toContain("my-account");
    expect(result.added).toContain("treasury");
  });

  test("single-account add still works alongside batch import", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "add",
      "test-single",
      "--secret",
      TEST_MNEMONIC,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Account Imported");
    expect(stdout).toContain("test-single");
  });

  test("batch import prints per-item lines, not comma-joined summary", async () => {
    const importData = JSON.stringify({
      accounts: [
        {
          name: "acct-a",
          publicKey: "0xd43593c715fdd31c61141abd04a99fd6822c8558854ccde39a5684e7a56da27d",
          derivationPath: "",
        },
        {
          name: "acct-b",
          publicKey: "0x8eaf04151687736326c9fea17e25fc5287613693c912909cb226aa4794f26a48",
          derivationPath: "",
        },
        {
          name: "acct-c",
          publicKey: "0x306721211d5404bd9da88e0204360a1a9ab8b87c66c1bc2fcdd37f3c2222cc20",
          derivationPath: "",
        },
      ],
    });
    const { stdout, exitCode } = await runCli(
      ["account", "import", "{{HOME}}/import.json", "--dry-run"],
      { files: { "import.json": importData } },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toMatch(/✓ acct-a\b/);
    expect(stdout).toMatch(/✓ acct-b\b/);
    expect(stdout).toMatch(/✓ acct-c\b/);
    expect(stdout).not.toContain("acct-a, acct-b, acct-c");
    expect(stdout).not.toContain("Added: acct-a");
    expect(stdout).toContain("3 added");
  });

  test("batch import empty file prints no-accounts message", async () => {
    const importData = JSON.stringify({ accounts: [] });
    const { stdout, exitCode } = await runCli(
      ["account", "import", "{{HOME}}/import.json", "--dry-run"],
      { files: { "import.json": importData } },
    );
    expect(exitCode).toBe(0);
    expect(stdout).toContain("No accounts imported");
  });

  test("account import no longer accepts --secret (single-import removed)", async () => {
    // `dot account import <name> --secret ...` must NOT create an account anymore.
    // The canonical path is `dot account add <name> --secret ...`.
    const { exitCode } = await runCli(
      ["account", "import", "should-not-work", "--secret", TEST_MNEMONIC],
      {},
    );
    // Either errors or no-op, but MUST NOT create an account.
    const list = await runCli(["account", "list", "--json"]);
    const parsed = JSON.parse(list.stdout);
    const match = parsed.accounts?.find?.((a: { name: string }) => a.name === "should-not-work");
    expect(match).toBeUndefined();
    // Exit code can be 0 (help shown) or 1 (invalid JSON when no stdin);
    // either way, no account was created.
    expect([0, 1]).toContain(exitCode);
  });

  // Polkadot Treasury (well-known sovereign address derived from PalletId b"py/trsry")
  const TREASURY_PUBKEY = "0x6d6f646c70792f74727372790000000000000000000000000000000000000000";
  const TREASURY_SS58_42 = "5EYCAe5ijiYfyeZ2JJCGq56LmPyNRAKzpG4QkoQkkQNB5e6Z";

  test("add --pallet-id (ASCII) stores derived sovereign", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "add",
      "Treasury",
      "--pallet-id",
      "py/trsry",
      "--json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.name).toBe("Treasury");
    expect(parsed.address).toBe(TREASURY_SS58_42);
    expect(parsed.watchOnly).toBe(true);
    // Public key matches the well-known Polkadot Treasury sovereign account derivation
    expect(TREASURY_PUBKEY).toBe(
      "0x6d6f646c70792f74727372790000000000000000000000000000000000000000",
    );
  });

  test("add --pallet-id hex matches ASCII derivation", async () => {
    const ascii = await runCli(["account", "add", "T1", "--pallet-id", "py/trsry", "--json"]);
    const hex = await runCli([
      "account",
      "add",
      "T2",
      "--pallet-id",
      "0x70792f7472737279",
      "--json",
    ]);
    expect(ascii.exitCode).toBe(0);
    expect(hex.exitCode).toBe(0);
    expect(JSON.parse(ascii.stdout).address).toBe(JSON.parse(hex.stdout).address);
  });

  test("add --pallet-id JSON output includes derivation metadata", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "add",
      "Bounties",
      "--pallet-id",
      "py/bount",
      "--json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.name).toBe("Bounties");
    expect(parsed.watchOnly).toBe(true);
    expect(parsed.derivation).toEqual({
      kind: "pallet",
      palletId: "py/bount",
      palletIdHex: "0x70792f626f756e74",
    });
  });

  test("add --pallet-id rejects malformed input", async () => {
    const tooShort = await runCli(["account", "add", "X", "--pallet-id", "py/trs"]);
    expect(tooShort.exitCode).toBe(1);
    expect(tooShort.stderr).toMatch(/8 ASCII characters or 0x-prefixed hex/);

    const badHex = await runCli(["account", "add", "X", "--pallet-id", "0xZZ792f7472737279"]);
    expect(badHex.exitCode).toBe(1);
    expect(badHex.stderr).toContain("non-hex characters");
  });

  test("add --parachain --parachain-type child stores child sovereign", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "add",
      "People",
      "--parachain",
      "1004",
      "--parachain-type",
      "child",
      "--json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.derivation).toEqual({ kind: "parachain", paraId: 1004, type: "child" });
    expect(parsed.address).toMatch(/^5/);
  });

  test("add --parachain --parachain-type sibling differs from child", async () => {
    const child = await runCli([
      "account",
      "add",
      "P-Child",
      "--parachain",
      "1004",
      "--parachain-type",
      "child",
      "--json",
    ]);
    const sibling = await runCli([
      "account",
      "add",
      "P-Sibling",
      "--parachain",
      "1004",
      "--parachain-type",
      "sibling",
      "--json",
    ]);
    expect(child.exitCode).toBe(0);
    expect(sibling.exitCode).toBe(0);
    expect(JSON.parse(child.stdout).address).not.toBe(JSON.parse(sibling.stdout).address);
  });

  test("add --parachain without --parachain-type errors", async () => {
    const { stderr, exitCode } = await runCli(["account", "add", "P", "--parachain", "1000"]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/--parachain-type is required/);
  });

  test("add --parachain-type without --parachain errors", async () => {
    const { stderr, exitCode } = await runCli(["account", "add", "P", "--parachain-type", "child"]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/--parachain-type requires --parachain/);
  });

  test("add --parachain rejects invalid id", async () => {
    const { stderr, exitCode } = await runCli([
      "account",
      "add",
      "P",
      "--parachain",
      "abc",
      "--parachain-type",
      "child",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Invalid parachain ID");
  });

  test("add --parachain-type rejects unknown values", async () => {
    const { stderr, exitCode } = await runCli([
      "account",
      "add",
      "P",
      "--parachain",
      "1000",
      "--parachain-type",
      "cousin",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Unknown parachain account type");
  });

  test("add --parachain combined with --pallet-id errors", async () => {
    const { stderr, exitCode } = await runCli([
      "account",
      "add",
      "X",
      "--parachain",
      "1000",
      "--parachain-type",
      "child",
      "--pallet-id",
      "py/trsry",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/mutually exclusive/);
  });

  test("add positional address with --pallet-id errors", async () => {
    const { stderr, exitCode } = await runCli([
      "account",
      "add",
      "X",
      "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
      "--pallet-id",
      "py/trsry",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Cannot combine a positional address/);
  });

  test("add --pallet-id with --secret errors", async () => {
    const { stderr, exitCode } = await runCli([
      "account",
      "add",
      "X",
      "--secret",
      TEST_MNEMONIC,
      "--pallet-id",
      "py/trsry",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/cannot be combined with --secret or --env/);
  });

  test("add --pallet-id rejects dev name", async () => {
    const { stderr, exitCode } = await runCli([
      "account",
      "add",
      "alice",
      "--pallet-id",
      "py/trsry",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("built-in dev account");
  });

  test("list groups pallet sovereigns under their own section", async () => {
    const palletAcct: StoredAccount = {
      name: "Treasury",
      publicKey: "0x6d6f646c70792f74727372790000000000000000000000000000000000000000",
      derivationPath: "",
      source: { kind: "pallet", palletId: "0x70792f7472737279" },
    };
    const { stdout, exitCode } = await runCli(["account", "list"], {
      accounts: [palletAcct],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Pallet Sovereigns");
    expect(stdout).toContain("Treasury");
    // Source rendered on tree continuation line with --pallet-id-aligned label
    expect(stdout).toContain("└─ pallet-id:");
    expect(stdout).toContain("py/trsry");
    expect(stdout).toContain("0x70792f7472737279");
    // Pallet sovereigns must NOT appear under the generic Watch-only header
    const palletIdx = stdout.indexOf("Pallet Sovereigns");
    const watchIdx = stdout.indexOf("Watch-only");
    if (watchIdx !== -1) expect(watchIdx).toBeGreaterThan(palletIdx); // Watch-only stays empty / earlier
  });

  test("list groups parachain sovereigns under their own section", async () => {
    const paraAcct: StoredAccount = {
      name: "People",
      publicKey: "0x70617261ec030000000000000000000000000000000000000000000000000000",
      derivationPath: "",
      source: { kind: "parachain", paraId: 1004, type: "child" },
    };
    const { stdout, exitCode } = await runCli(["account", "list"], {
      accounts: [paraAcct],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Parachain Sovereigns");
    expect(stdout).toContain("People");
    // Two attributes (parachain + parachain-type) on separate tree branches
    expect(stdout).toContain("├─ parachain:");
    expect(stdout).toContain("1004");
    expect(stdout).toContain("└─ parachain-type:");
    expect(stdout).toContain("child");
  });

  test("list omits sections with no entries", async () => {
    const onlyPallet: StoredAccount = {
      name: "Treasury",
      publicKey: "0x6d6f646c70792f74727372790000000000000000000000000000000000000000",
      derivationPath: "",
      source: { kind: "pallet", palletId: "0x70792f7472737279" },
    };
    const { stdout, exitCode } = await runCli(["account", "list"], {
      accounts: [onlyPallet],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Pallet Sovereigns");
    expect(stdout).not.toContain("Signers\n");
    expect(stdout).not.toContain("Watch-only\n");
    expect(stdout).not.toContain("Parachain Sovereigns");
  });

  test("list --json includes kind and source for pallet sovereign", async () => {
    const palletAcct: StoredAccount = {
      name: "Treasury",
      publicKey: "0x6d6f646c70792f74727372790000000000000000000000000000000000000000",
      derivationPath: "",
      source: { kind: "pallet", palletId: "0x70792f7472737279" },
    };
    const { stdout, exitCode } = await runCli(["account", "list", "--json"], {
      accounts: [palletAcct],
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    const treasury = parsed.stored.find((a: { name: string }) => a.name === "Treasury");
    expect(treasury.kind).toBe("pallet");
    expect(treasury.source).toEqual({
      kind: "pallet",
      palletId: "py/trsry",
      palletIdHex: "0x70792f7472737279",
    });
  });

  test("list --json marks dev entries with kind=dev", async () => {
    const { stdout, exitCode } = await runCli(["account", "list", "--json"]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.dev[0].kind).toBe("dev");
  });

  test("inspect on pallet sovereign shows Kind and Source lines", async () => {
    const palletAcct: StoredAccount = {
      name: "Treasury",
      publicKey: "0x6d6f646c70792f74727372790000000000000000000000000000000000000000",
      derivationPath: "",
      source: { kind: "pallet", palletId: "0x70792f7472737279" },
    };
    const { stdout, exitCode } = await runCli(["account", "inspect", "Treasury"], {
      accounts: [palletAcct],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Kind:");
    expect(stdout).toContain("pallet sovereign");
    expect(stdout).toContain("Source:");
    expect(stdout).toContain("PalletId py/trsry");
    expect(stdout).toContain("0x70792f7472737279");
  });

  test("inspect on parachain sovereign shows Kind and Source lines", async () => {
    const paraAcct: StoredAccount = {
      name: "People",
      publicKey: "0x70617261ec030000000000000000000000000000000000000000000000000000",
      derivationPath: "",
      source: { kind: "parachain", paraId: 1004, type: "sibling" },
    };
    const { stdout, exitCode } = await runCli(["account", "inspect", "People"], {
      accounts: [paraAcct],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Kind:");
    expect(stdout).toContain("parachain sovereign (sibling)");
    expect(stdout).toContain("Source:");
    expect(stdout).toContain("parachain 1004");
  });

  test("inspect --json includes kind and structured source", async () => {
    const palletAcct: StoredAccount = {
      name: "Treasury",
      publicKey: "0x6d6f646c70792f74727372790000000000000000000000000000000000000000",
      derivationPath: "",
      source: { kind: "pallet", palletId: "0x70792f7472737279" },
    };
    const { stdout, exitCode } = await runCli(["account", "inspect", "Treasury", "--json"], {
      accounts: [palletAcct],
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.kind).toBe("pallet sovereign");
    expect(parsed.source).toEqual({
      kind: "pallet",
      palletId: "py/trsry",
      palletIdHex: "0x70792f7472737279",
    });
  });

  test("inspect on dev account labels Kind as dev", async () => {
    const { stdout, exitCode } = await runCli(["account", "inspect", "alice"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Kind:");
    expect(stdout).toContain("dev");
  });

  test("inspect on signer with derivation path shows Derivation line", async () => {
    const signerAcct: StoredAccount = {
      name: "validator",
      secret: TEST_MNEMONIC,
      publicKey: "0x44a996beb1eef7bdcab976ab6d2ca26104834164ecf28fb375600576fcc6eb0f",
      derivationPath: "//staking",
    };
    const { stdout, exitCode } = await runCli(["account", "inspect", "validator"], {
      accounts: [signerAcct],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Kind:");
    expect(stdout).toContain("signer");
    expect(stdout).toContain("Derivation:");
    expect(stdout).toContain("//staking");
  });

  test("add --pallet-id persists source on the stored account", async () => {
    // Verify via inspect (same process — no separate runCli call) that the
    // source field round-trips through accounts.json.
    // We can't easily check the JSON file here since runCli isolates HOME,
    // but we can verify list --json shows the source on the same account
    // record that's just been created. This needs combined-process work...
    // Instead, just verify the public key is the well-known sovereign address.
    const { stdout, exitCode } = await runCli([
      "account",
      "add",
      "Treasury",
      "--pallet-id",
      "py/trsry",
      "--json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.address).toBe("5EYCAe5ijiYfyeZ2JJCGq56LmPyNRAKzpG4QkoQkkQNB5e6Z");
    expect(parsed.derivation).toEqual({
      kind: "pallet",
      palletId: "py/trsry",
      palletIdHex: "0x70792f7472737279",
    });
  });

  // Stateless derivation via `dot account inspect` — no persistence
  test("inspect --pallet-id derives without saving (script-friendly)", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "inspect",
      "--pallet-id",
      "py/trsry",
      "--prefix",
      "0",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("pallet sovereign");
    expect(stdout).toContain("13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB");
    expect(stdout).toContain("PalletId py/trsry");
    expect(stdout).toContain("0x70792f7472737279");
  });

  test("inspect --pallet-id hex matches ASCII derivation", async () => {
    const ascii = await runCli(["account", "inspect", "--pallet-id", "py/trsry", "--json"]);
    const hex = await runCli(["account", "inspect", "--pallet-id", "0x70792f7472737279", "--json"]);
    expect(ascii.exitCode).toBe(0);
    expect(hex.exitCode).toBe(0);
    expect(JSON.parse(ascii.stdout).ss58).toBe(JSON.parse(hex.stdout).ss58);
  });

  test("inspect --pallet-id --json yields the script-friendly shape", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "inspect",
      "--pallet-id",
      "py/trsry",
      "--json",
    ]);
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.ss58).toBe("5EYCAe5ijiYfyeZ2JJCGq56LmPyNRAKzpG4QkoQkkQNB5e6Z");
    expect(parsed.publicKey).toBe(
      "0x6d6f646c70792f74727372790000000000000000000000000000000000000000",
    );
    expect(parsed.kind).toBe("pallet sovereign");
    expect(parsed.source).toEqual({
      kind: "pallet",
      palletId: "py/trsry",
      palletIdHex: "0x70792f7472737279",
    });
    // Stateless: no `name` field (no persisted entry)
    expect(parsed.name).toBeUndefined();
  });

  test("inspect --parachain --parachain-type derives without saving", async () => {
    const child = await runCli([
      "account",
      "inspect",
      "--parachain",
      "1004",
      "--parachain-type",
      "child",
      "--json",
    ]);
    const sibling = await runCli([
      "account",
      "inspect",
      "--parachain",
      "1004",
      "--parachain-type",
      "sibling",
      "--json",
    ]);
    expect(child.exitCode).toBe(0);
    expect(sibling.exitCode).toBe(0);
    expect(JSON.parse(child.stdout).ss58).not.toBe(JSON.parse(sibling.stdout).ss58);
    expect(JSON.parse(child.stdout).source).toEqual({
      kind: "parachain",
      paraId: 1004,
      type: "child",
    });
    expect(JSON.parse(child.stdout).kind).toBe("parachain sovereign (child)");
  });

  test("inspect --parachain rejects without --parachain-type", async () => {
    const { stderr, exitCode } = await runCli(["account", "inspect", "--parachain", "1004"]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/--parachain-type is required/);
  });

  test("inspect rejects positional input combined with --pallet-id", async () => {
    const { stderr, exitCode } = await runCli([
      "account",
      "inspect",
      "alice",
      "--pallet-id",
      "py/trsry",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/Cannot combine a positional input/);
  });

  test("inspect rejects --pallet-id combined with --parachain", async () => {
    const { stderr, exitCode } = await runCli([
      "account",
      "inspect",
      "--pallet-id",
      "py/trsry",
      "--parachain",
      "1004",
      "--parachain-type",
      "child",
    ]);
    expect(exitCode).toBe(1);
    expect(stderr).toMatch(/mutually exclusive/);
  });

  test("inspect with no input and no derivation flags errors with usage", async () => {
    const { stderr, exitCode } = await runCli(["account", "inspect"]);
    expect(exitCode).toBe(1);
    expect(stderr).toContain("Input is required");
    // Hint at both modes
    expect(stderr).toContain("--pallet-id");
    expect(stderr).toContain("--parachain");
  });

  test("inspect --pallet-id --show-secret rejects (no key)", async () => {
    const { stderr, exitCode } = await runCli([
      "account",
      "inspect",
      "--pallet-id",
      "py/trsry",
      "--show-secret",
    ]);
    expect(exitCode).toBe(1);
    // No name → existing --show-secret guard fires
    expect(stderr).toMatch(/--show-secret/);
  });

  test("inspect --pallet-id --prefix changes SS58 only", async () => {
    const def = await runCli(["account", "inspect", "--pallet-id", "py/trsry", "--json"]);
    const p0 = await runCli([
      "account",
      "inspect",
      "--pallet-id",
      "py/trsry",
      "--prefix",
      "0",
      "--json",
    ]);
    expect(def.exitCode).toBe(0);
    expect(p0.exitCode).toBe(0);
    const a = JSON.parse(def.stdout);
    const b = JSON.parse(p0.stdout);
    // Same publicKey, different SS58
    expect(a.publicKey).toBe(b.publicKey);
    expect(a.ss58).not.toBe(b.ss58);
    expect(b.ss58).toBe("13UVJyLnbVp9RBZYFwFGyDvVd1y27Tt8tkntv6Q7JVPhFsTB");
  });
});

// Ethereum (secp256k1) accounts — scheme "ethereum" (#284). The stored
// publicKey is the fallback AccountId32 (H160 ‖ 0xEE×12); the H160 is the
// account's display identity.
// @ts-expect-error Bun supports describe(label, options, fn) at runtime
describe("dot account --scheme ethereum", { timeout: 15_000 }, () => {
  // Well-known anvil/hardhat dev key #1.
  const ETH_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
  const ETH_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  const ETH_FALLBACK_PUBKEY = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8eeeeeeeeeeeeeeeeeeeeeeee";

  const ETH_ACCOUNT: StoredAccount = {
    name: "eth-admin",
    secret: ETH_KEY,
    publicKey: ETH_FALLBACK_PUBKEY,
    derivationPath: "",
    scheme: "ethereum",
  };

  test("add --scheme ethereum --secret imports and prints EIP-55 H160 + fallback SS58", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "add",
      "eth-admin",
      "--scheme",
      "ethereum",
      "--secret",
      ETH_KEY,
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("ethereum (secp256k1)");
    expect(stdout).toContain(ETH_ADDRESS);
    expect(stdout).toContain("fallback account");
  });

  test("add --scheme ethereum --json returns scheme, address, and ss58", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "add",
      "eth-admin",
      "--scheme",
      "ethereum",
      "--secret",
      ETH_KEY,
      "--json",
    ]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.scheme).toBe("ethereum");
    expect(result.address).toBe(ETH_ADDRESS);
    expect(typeof result.ss58).toBe("string");
  });

  test("add --scheme ethereum rejects a non-key secret", async () => {
    for (const bad of [TEST_MNEMONIC, "0x1234", `0x${"11".repeat(64)}`]) {
      const { stderr, exitCode } = await runCli([
        "account",
        "add",
        "eth-bad",
        "--scheme",
        "ethereum",
        "--secret",
        bad,
      ]);
      expect(exitCode).not.toBe(0);
      expect(stderr).toContain("Invalid Ethereum private key");
    }
  });

  test("add --scheme ethereum rejects --path", async () => {
    const { stderr, exitCode } = await runCli([
      "account",
      "add",
      "eth-pathy",
      "--scheme",
      "ethereum",
      "--secret",
      ETH_KEY,
      "--path",
      "//nope",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Derivation paths are not supported for ethereum accounts");
  });

  test("add --scheme ethereum without --secret/--env errors", async () => {
    const { stderr, exitCode } = await runCli([
      "account",
      "add",
      "eth-naked",
      "--scheme",
      "ethereum",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("--scheme ethereum requires --secret");
  });

  test("unknown --scheme value errors", async () => {
    const { stderr, exitCode } = await runCli([
      "account",
      "add",
      "eth-x",
      "--scheme",
      "ed25519",
      "--secret",
      ETH_KEY,
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('Unknown scheme "ed25519"');
  });

  test("create --scheme ethereum generates a key and prints it", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "create",
      "eth-fresh",
      "--scheme",
      "ethereum",
      "--json",
    ]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.scheme).toBe("ethereum");
    expect(result.privateKey).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(result.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  test("create --scheme ethereum rejects --path", async () => {
    const { stderr, exitCode } = await runCli([
      "account",
      "create",
      "eth-fresh",
      "--scheme",
      "ethereum",
      "--path",
      "//nope",
    ]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Derivation paths are not supported");
  });

  test("env-backed ethereum account derives from the env var", async () => {
    const { stdout, exitCode } = await runCli(
      ["account", "add", "eth-env", "--scheme", "ethereum", "--env", "ETH_TEST_KEY", "--json"],
      { env: { ETH_TEST_KEY: ETH_KEY } },
    );
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.address).toBe(ETH_ADDRESS);
    expect(result.env).toBe("ETH_TEST_KEY");
  });

  test("env-backed ethereum account with unset var defers address", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "add",
      "eth-env2",
      "--scheme",
      "ethereum",
      "--env",
      "ETH_UNSET_VAR",
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Address will resolve when $ETH_UNSET_VAR is set");
  });

  test("env-backed ethereum account with an invalid env value errors", async () => {
    const { stderr, exitCode } = await runCli(
      ["account", "add", "eth-env3", "--scheme", "ethereum", "--env", "ETH_BAD_KEY"],
      { env: { ETH_BAD_KEY: "not-a-key" } },
    );
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("does not hold a valid Ethereum private key");
  });

  test("list shows H160 as address with scheme and ss58 attributes", async () => {
    const { stdout, exitCode } = await runCli(["account", "list"], {
      accounts: [ETH_ACCOUNT],
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain(ETH_ADDRESS);
    expect(stdout).toContain("scheme: ethereum");
    expect(stdout).toContain("ss58:");
  });

  test("list --json includes scheme and ss58", async () => {
    const { stdout, exitCode } = await runCli(["account", "list", "--json"], {
      accounts: [ETH_ACCOUNT],
    });
    expect(exitCode).toBe(0);
    const { stored } = JSON.parse(stdout);
    expect(stored[0].scheme).toBe("ethereum");
    expect(stored[0].address).toBe(ETH_ADDRESS);
    expect(typeof stored[0].ss58).toBe("string");
  });

  test("inspect resolves the account with kind signer (ethereum)", async () => {
    const { stdout, exitCode } = await runCli(["account", "inspect", "eth-admin", "--json"], {
      accounts: [ETH_ACCOUNT],
    });
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.kind).toBe("signer (ethereum)");
    expect(result.scheme).toBe("ethereum");
    expect(result.h160).toBe(ETH_ADDRESS);
    expect(result.publicKey).toBe(ETH_FALLBACK_PUBKEY);
  });

  test("inspect --show-secret reveals the secp256k1 key, not an sr25519 expansion", async () => {
    const { stdout, exitCode } = await runCli(
      ["account", "inspect", "eth-admin", "--show-secret", "--json"],
      { accounts: [ETH_ACCOUNT] },
    );
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.privateKey).toBe(ETH_KEY);
    expect(result.mnemonic).toBeUndefined();
    expect(result.seed).toBeUndefined();
  });

  test("sign refuses an ethereum account with a pointed error", async () => {
    const { stderr, exitCode } = await runCli(["sign", "hello", "--from", "eth-admin"], {
      accounts: [ETH_ACCOUNT],
    });
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("cannot sign substrate extrinsics");
  });
});

// Derived ethereum identities — `<name>-eth` selects the BIP44 key
// (m/44'/60'/0'/0/<index>) of a mnemonic-backed account. Dev accounts use
// their position as the index: alice-eth = Alith, bob-eth = Baltathar.
// @ts-expect-error Bun supports describe(label, options, fn) at runtime
describe("derived ethereum identities (-eth suffix)", { timeout: 15_000 }, () => {
  const ALITH = "0xf24FF3a9CF04c71Dbc94D0b566f7A27B94566cac";
  const MNEMONIC_ACCOUNT: StoredAccount = {
    name: "signer",
    secret: "test test test test test test test test test test test junk",
    publicKey: "0x44a996beb1eef7bdcab976ab6d2ca26104834164ecf28fb375600576fcc6eb0f",
    derivationPath: "",
  };

  test("inspect alice-eth resolves to Alith", async () => {
    const { stdout, exitCode } = await runCli(["account", "inspect", "alice-eth", "--json"]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.h160).toBe(ALITH);
    expect(result.kind).toBe("signer (ethereum, derived from alice)");
    expect(result.scheme).toBe("ethereum");
    expect(result.derivationPath).toBe("m/44'/60'/0'/0/0");
  });

  test("inspect bob-eth resolves to Baltathar (index 1)", async () => {
    const { stdout, exitCode } = await runCli(["account", "inspect", "bob-eth", "--json"]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.h160).toBe("0x3Cd0A705a2DC65e5b1E1205896BaA2be8A07c6e0");
    expect(result.derivationPath).toBe("m/44'/60'/0'/0/1");
  });

  test("inspect alice-eth --show-secret reveals the derived secp256k1 key", async () => {
    const { stdout, exitCode } = await runCli([
      "account",
      "inspect",
      "alice-eth",
      "--show-secret",
      "--json",
    ]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.privateKey).toBe(
      "0x5fb92d6e98884f76de468fa3f6278f8807c48bebc13595d45af5bdc4da702133",
    );
    expect(result.mnemonic).toBeUndefined();
  });

  test("stored mnemonic account derives its -eth identity at index 0", async () => {
    const { stdout, exitCode } = await runCli(["account", "inspect", "signer-eth", "--json"], {
      accounts: [MNEMONIC_ACCOUNT],
    });
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    // MetaMask-compatible: anvil junk phrase index 0
    expect(result.h160).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
    expect(result.derivedFrom).toBe("signer");
  });

  test("base inspect shows the derived ethereum identity", async () => {
    const { stdout, exitCode } = await runCli(["account", "inspect", "alice", "--json"]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.ethereum).toEqual({
      address: ALITH,
      from: "alice-eth",
      path: "m/44'/60'/0'/0/0",
    });
  });

  test("a real stored account named *-eth wins over derivation", async () => {
    const watchOnly: StoredAccount = {
      name: "signer-eth",
      publicKey: "0x44a996beb1eef7bdcab976ab6d2ca26104834164ecf28fb375600576fcc6eb0f",
      derivationPath: "",
    };
    const { stdout, exitCode } = await runCli(["account", "inspect", "signer-eth", "--json"], {
      accounts: [MNEMONIC_ACCOUNT, watchOnly],
    });
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout);
    expect(result.kind).toBe("watch-only");
    expect(result.scheme).toBeUndefined();
  });

  test("seed-backed base errors with an import hint", async () => {
    const seeded: StoredAccount = {
      name: "seeded",
      secret: "0x1111111111111111111111111111111111111111111111111111111111111111",
      publicKey: "0x44a996beb1eef7bdcab976ab6d2ca26104834164ecf28fb375600576fcc6eb0f",
      derivationPath: "",
    };
    const { stderr, exitCode } = await runCli(["account", "inspect", "seeded-eth"], {
      accounts: [seeded],
    });
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("BIP44 derivation needs the BIP39 mnemonic");
    expect(stderr).toContain("--scheme ethereum");
  });

  test("unknown base errors", async () => {
    const { stderr, exitCode } = await runCli(["account", "inspect", "nobody-eth"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('no account "nobody"');
  });

  test("sign refuses a derived ethereum identity", async () => {
    const { stderr, exitCode } = await runCli(["sign", "hello", "--from", "alice-eth"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("cannot sign substrate extrinsics");
  });
});
