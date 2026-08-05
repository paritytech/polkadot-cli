import type * as AbiFunctionType from "ox/AbiFunction";
import { h160FromHex } from "./h160.ts";

// This module is loaded eagerly on every CLI start (via commands/account.ts),
// so ALL ox modules are loaded lazily by the functions that need them —
// ox/Secp256k1 pulls @noble/curves' secp256k1 precompute tables (~110ms),
// ox/AbiFunction pulls the ABI parser/encoder chain (~130ms), and even the
// cheap modules add up across every CLI spawn. The indirection keeps the
// specifier non-literal at the import() call site — Bun eagerly prefetches
// literal dynamic imports, which would defeat the lazy-load.
const lazyImport = (specifier: string) => import(specifier);

async function loadSecp256k1(): Promise<typeof import("ox/Secp256k1")> {
  return lazyImport("ox/Secp256k1");
}

async function loadAddress(): Promise<typeof import("ox/Address")> {
  return lazyImport("ox/Address");
}

async function loadTxEnvelope(): Promise<typeof import("ox/TxEnvelopeEip1559")> {
  return lazyImport("ox/TxEnvelopeEip1559");
}

async function loadAbi(): Promise<{
  AbiFunction: typeof import("ox/AbiFunction");
  AbiParameters: typeof import("ox/AbiParameters");
}> {
  const [AbiFunction, AbiParameters] = await Promise.all([
    lazyImport("ox/AbiFunction"),
    lazyImport("ox/AbiParameters"),
  ]);
  return { AbiFunction, AbiParameters };
}

// A secp256k1 private key: 0x + 64 hex chars. Same byte shape as an sr25519
// mini-secret — the two are distinguished by the account's stored scheme, not
// by format.
const ETH_PRIVATE_KEY_RE = /^0x[0-9a-fA-F]{64}$/;

export function isEthereumPrivateKey(input: string): boolean {
  return ETH_PRIVATE_KEY_RE.test(input);
}

export async function generateEthereumPrivateKey(): Promise<string> {
  const Secp256k1 = await loadSecp256k1();
  return Secp256k1.randomPrivateKey();
}

// Derive the MetaMask-compatible BIP44 ethereum key from a BIP39 mnemonic:
// m/44'/60'/0'/0/<index>. Stored accounts use index 0 — importing the same
// phrase into MetaMask yields the same address. Dev accounts use their
// position as the index, which on the substrate dev phrase reproduces the
// well-known Moonbeam/revive dev accounts (0 = Alith, 1 = Baltathar, …).
export async function ethereumKeyFromMnemonic(mnemonic: string, index = 0): Promise<string> {
  const [Mnemonic, HdKey] = (await Promise.all([
    lazyImport("ox/Mnemonic"),
    lazyImport("ox/HdKey"),
  ])) as [typeof import("ox/Mnemonic"), typeof import("ox/HdKey")];
  const seed = Mnemonic.toSeed(mnemonic);
  return HdKey.fromSeed(seed).derive(HdKey.path({ index })).privateKey;
}

// The Ethereum address (20 bytes) controlled by a secp256k1 private key:
// keccak256(uncompressed pubkey)[12..].
export async function ethereumAddressFromPrivateKey(privateKey: string): Promise<Uint8Array> {
  if (!isEthereumPrivateKey(privateKey)) {
    throw new Error(
      "Invalid Ethereum private key. Expected a 0x-prefixed 32-byte hex string (64 hex chars).",
    );
  }
  const [Secp256k1, Address] = await Promise.all([loadSecp256k1(), loadAddress()]);
  const publicKey = Secp256k1.getPublicKey({ privateKey: privateKey as `0x${string}` });
  return h160FromHex(Address.fromPublicKey(publicKey));
}

export interface EthereumTransactionRequest {
  chainId: number;
  nonce: bigint;
  to: string; // 0x-prefixed H160
  value: bigint; // wei (18 EVM decimals)
  data: string; // 0x-prefixed calldata ("0x" for none)
  gas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas?: bigint;
}

// Build, sign (EIP-1559) and RLP-serialize an Ethereum transaction. The result
// is the exact payload `Revive.eth_transact` expects.
export async function signEthereumTransaction(
  privateKey: string,
  request: EthereumTransactionRequest,
): Promise<`0x${string}`> {
  const [Secp256k1, TxEnvelopeEip1559] = await Promise.all([loadSecp256k1(), loadTxEnvelope()]);
  const envelope = TxEnvelopeEip1559.from({
    chainId: request.chainId,
    nonce: request.nonce,
    to: request.to as `0x${string}`,
    value: request.value,
    data: request.data as `0x${string}`,
    gas: request.gas,
    maxFeePerGas: request.maxFeePerGas,
    maxPriorityFeePerGas: request.maxPriorityFeePerGas ?? 0n,
  });
  const signature = Secp256k1.sign({
    payload: TxEnvelopeEip1559.getSignPayload(envelope),
    privateKey: privateKey as `0x${string}`,
  });
  return TxEnvelopeEip1559.serialize(envelope, { signature });
}

// A human ABI function signature like `transfer(address,uint256)` or
// `available(string label)`. Distinguished from raw calldata (0x-hex) and from
// bare addresses by the parentheses.
const FUNCTION_SIGNATURE_RE = /^[A-Za-z_$][\w$]*\(.*\)$/;

export function looksLikeFunctionSignature(input: string): boolean {
  return FUNCTION_SIGNATURE_RE.test(input);
}

// Convert one CLI string argument to the JS value ox's ABI encoder expects for
// the given Solidity type. Composite types (arrays, tuples) are passed as JSON.
function parseAbiArgument(type: string, raw: string): unknown {
  if (type.endsWith("]")) {
    return coerceJsonArgument(type, raw);
  }
  if (type === "tuple" || type.startsWith("tuple")) {
    return coerceJsonArgument(type, raw);
  }
  if (/^u?int\d*$/.test(type)) {
    try {
      return BigInt(raw);
    } catch {
      throw new Error(`Argument "${raw}" is not a valid ${type} (expected an integer).`);
    }
  }
  if (type === "bool") {
    if (raw === "true") return true;
    if (raw === "false") return false;
    throw new Error(`Argument "${raw}" is not a valid bool (expected "true" or "false").`);
  }
  if (type === "address") {
    if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) {
      throw new Error(`Argument "${raw}" is not a valid address (expected 0x + 40 hex chars).`);
    }
    return raw;
  }
  if (type === "string") {
    return raw;
  }
  if (type.startsWith("bytes")) {
    if (!/^0x[0-9a-fA-F]*$/.test(raw)) {
      throw new Error(`Argument "${raw}" is not valid ${type} (expected 0x-prefixed hex).`);
    }
    return raw;
  }
  return raw;
}

// Composite args (arrays, tuples) are passed as JSON. Large integers inside
// them should be quoted as strings — ox accepts numeric strings for int types.
function coerceJsonArgument(type: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Argument for ${type} must be JSON (e.g. '["0xabc…", "0xdef…"]'), got: ${raw}`);
  }
}

// Encode calldata from a human ABI signature and CLI string args, cast-style.
// `signature` accepts both bare (`transfer(address,uint256)`) and named-param
// (`transfer(address to, uint256 amount)`) forms.
export async function encodeFunctionCall(
  signature: string,
  args: string[],
): Promise<`0x${string}`> {
  const { AbiFunction } = await loadAbi();
  // With a runtime (non-literal) string, `from` types as the union of all ABI
  // item kinds — narrow via the runtime `type` tag.
  const fn = AbiFunction.from(
    signature.startsWith("function ") ? signature : `function ${signature}`,
  ) as AbiFunctionType.AbiFunction;
  if (fn.type !== "function") {
    throw new Error(`"${signature}" is not a function signature.`);
  }
  if (fn.inputs.length !== args.length) {
    throw new Error(
      `${fn.name} expects ${fn.inputs.length} argument(s) (${fn.inputs
        .map((i) => i.type)
        .join(", ")}), got ${args.length}.`,
    );
  }
  const values = fn.inputs.map((input, i) => parseAbiArgument(input.type, args[i]!));
  return AbiFunction.encodeData(fn, values as never);
}

const ERROR_STRING_SELECTOR = "0x08c379a0"; // Error(string)
const PANIC_UINT_SELECTOR = "0x4e487b71"; // Panic(uint256)

// Decode standard Solidity revert data into a human-readable message.
// Returns null when the data doesn't match a known revert shape (e.g. a
// custom error — shown raw by the caller).
export async function decodeRevertData(data: string): Promise<string | null> {
  const { AbiParameters } = await loadAbi();
  if (data.startsWith(ERROR_STRING_SELECTOR)) {
    try {
      const [message] = AbiParameters.decode(
        AbiParameters.from(["string"]),
        `0x${data.slice(ERROR_STRING_SELECTOR.length)}`,
      );
      return `reverted: ${message}`;
    } catch {
      return null;
    }
  }
  if (data.startsWith(PANIC_UINT_SELECTOR)) {
    try {
      const [code] = AbiParameters.decode(
        AbiParameters.from(["uint256"]),
        `0x${data.slice(PANIC_UINT_SELECTOR.length)}`,
      );
      return `panicked with code 0x${(code as bigint).toString(16)}`;
    } catch {
      return null;
    }
  }
  return null;
}

// primitive_types::U256 is SCALE-encoded as [u64; 4] little-endian limbs, which
// is how papi's unsafe API expects (and returns) it.
const LIMB_BITS = 64n;
const LIMB_MASK = (1n << LIMB_BITS) - 1n;

export function u256ToLimbs(value: bigint): [bigint, bigint, bigint, bigint] {
  if (value < 0n || value >= 1n << 256n) {
    throw new Error(`Value ${value} does not fit into a u256.`);
  }
  return [
    value & LIMB_MASK,
    (value >> LIMB_BITS) & LIMB_MASK,
    (value >> (LIMB_BITS * 2n)) & LIMB_MASK,
    (value >> (LIMB_BITS * 3n)) & LIMB_MASK,
  ];
}

export function limbsToU256(limbs: readonly (bigint | number | string)[]): bigint {
  if (limbs.length !== 4) {
    throw new Error(`Expected 4 u64 limbs, got ${limbs.length}.`);
  }
  return limbs.reduce<bigint>(
    (acc, limb, i) => acc + (BigInt(limb) << (LIMB_BITS * BigInt(i))),
    0n,
  );
}
