# Tapes

Terminal recordings of the CLI, scripted with [VHS](https://github.com/charmbracelet/vhs). Each `*.tape` renders to a GIF (used in `README.md`) and a WebM + MP4 pair (used on the docs site) under `docs/static/vhs/`.

## Recording

```bash
brew install vhs        # also pulls in ttyd and ffmpeg
bun run tapes           # every tape
bun run tapes hero      # just tapes/hero.tape
```

`bun run tapes` builds `dist/cli.mjs`, wipes and re-creates `/tmp/dot-demo` as the recording config root, caches metadata for the chains the selected tapes use, then renders each tape. Always record through the script — tapes reference `tapes/theme.tape` and `tapes/demo/` by repo-relative path, so `vhs` must run from the repo root with the right environment.

Rendered assets are committed. Regenerate them when the output they show actually changes; recordings run against live public RPC, so re-recording always rewrites every frame.

### Tapes that submit

`submit.tape` signs a real extrinsic on Paseo Asset Hub. It needs a funded throwaway signer, supplied as a mnemonic in `DOT_TAPE_SIGNER`:

```bash
export DOT_TAPE_SIGNER="<throwaway paseo mnemonic>"
bun run tapes submit
```

The runner registers it as the env-backed account `demo`, so the secret is read at signing time and never written to disk or to a tape file. Without the variable the tape is skipped with a note and the rest still record. Each recording spends real testnet funds, so keep the signer topped up from the Paseo faucet.

### Anatomy of a tape

```
Output docs/static/vhs/<name>.gif    # plus .webm and .mp4
Source tapes/theme.tape              # shared settings
Set Height <n>                        # per-tape overrides go here
Source tapes/shell.tape              # starts the shell, off camera
… beats …
```

The order matters: VHS applies settings in sequence and they must all precede the first command, so a tape's own `Set` lines belong *between* the two sourced files. Put them before `theme.tape` and the shared values win; put them after `shell.tape` and the terminal has already started.

## How a recording is isolated

- **`DOT_HOME=/tmp/dot-demo`** — a recording never reads or writes `~/.polkadot`. The path is short and tidy on purpose: it is visible on screen in any tape that prints the active config root.
- **Rebuilt before every tape** — `/tmp/dot-demo` is wiped and refilled with just the metadata that tape declares in `tapeChains`, copied from a warm cache at `/tmp/dot-demo-cache`. So `bun run tapes chains` produces the same frames as a full run: no tape inherits the accounts another one created, and `chains.tape` can add a chain that is genuinely not configured yet.
- **`tapes/demo/bin/dot`** — a shim resolving `dot` to this checkout's `dist/cli.mjs`, so a tape can never accidentally record a globally installed version.
- **`tapes/demo/files/`** — fixtures for the file-input tapes, `cd`'d into off camera so the recorded command reads the way the docs write it.
- **`tapes/demo/zdotdir/.zshrc`** — a minimal shell: pink `❯` prompt, no history, no autocorrect, completions loaded, `#` captions treated as comments. Sourced twice over (via `ZDOTDIR` and again from `shell.tape`) so a personal `~/.zshrc` can never leak into a frame.
- **`DOT_NO_UPDATE_CHECK=1`** — the update notifier must not interrupt a take.

## Conventions

- **One idea per tape**, 20–30s. A tape that needs a second sentence to explain it should be two tapes.
- **`Set Height` lives in the tape**, not in `theme.tape`: size the canvas to the tallest screen, then check that its *first* line is still in frame — a `Height` two lines short silently scrolls the command that produced the output off the top. Everything else — font, colours, width, typing speed — is shared, and overriding any of it needs a reason written in the tape (`submit.tape`, `dry-run.tape` and `xcm-file.tape` each drop the font size to stop a call hash or a 32-byte key from wrapping).
- **End on the tallest screen** where the narrative allows it. The last frame is the one that lingers — in the README GIF between loops, and on the docs page before autoplay starts — so a short closing screen leaves a band of dead black as the lasting impression. `xcm-file.tape` runs its beats in reverse partly for this reason.
- **Captions are typed shell comments** (`# …`), which is why `INTERACTIVE_COMMENTS` is set. No overlays, no post-production.
- **Live data.** Tapes query public RPC and show real numbers. Nothing is faked or replayed.
- **Nothing lands on chain.** Transaction tapes use `--dry-run`. A tape that submits for real must target a testnet with a throwaway account.
- **Verify keystrokes against the completer.** After `Tab`, zsh inserts the longest common prefix, so a following `Type` must supply only the missing characters. Check candidate sets with `dot __complete -- "<word>"` before scripting a completion beat.
- **Check frames, not just exit codes.** `ffmpeg -sseof -0.5 -i docs/static/vhs/<name>.mp4 -frames:v 1 out.png` grabs the final frame; a tape can render successfully and still show an error.

## Recorded

| Tape | Shows |
|---|---|
| `hero.tape` | Three chains queried with no endpoint, no config, no setup step |
| `inspect.tape` | Storage shapes, call args, event fields and error docs, all offline |
| `completions.tape` | Tab-completing chain → pallet → item → call → account, then a dry-run |
| `submit.tape` | A real transfer on Paseo Asset Hub: dry-run, sign, broadcast, block, events, explorer links |
| `workspaces.tape` | `dot init` in a directory, an account created inside it, and that identity gone on the way out |
| `accounts.tape` | Create a key, name a watch-only address, derive a child, then query by name |
| `jq.tape` | `--json` and a full `--dump` storage map piped into `jq` and aggregated |
| `env-accounts.tape` | An env-backed signer: the workspace stores a variable name, and nothing signs without it |
| `dry-run.tape` | `--dry-run`, `--encode`, and `DOT_DRY_RUN` as a session-wide safety net |
| `chains.tape` | The preconfigured topology, then adding a chain by RPC with its paraId detected |
| `sovereign.tape` | Pallet and parachain (child / sibling) sovereign addresses derived offline |
| `xcm-file.tape` | An XCM call encoded from a YAML file, with a variable filled at run time |
| `did-you-mean.tape` | Fuzzy suggestions for misspelled pallets, items and account names, and a call's arity |

## Planned

Pitched but not yet recorded:

| Tape | Shows |
|---|---|
| `stale-metadata` | A tx failing on out-of-date metadata and the CLI naming the `dot chain update` to run |

`stale-metadata` is unrecorded on purpose. The suggestion only fires when a call
fails *and* the cached runtime fingerprint differs from the live chain, so a take
needs a real runtime upgrade to happen mid-recording, a tampered cache, or a local
fork with a bumped spec version. The first is not schedulable and the second would
mean a staged frame, which no other tape here does — so this one waits for a
chopsticks-based setup that can produce the mismatch honestly.
