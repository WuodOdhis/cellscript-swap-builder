#!/usr/bin/env python3
import argparse
import json
import struct
import subprocess
import sys
from hashlib import blake2b
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RPC_URL = "http://127.0.0.1:28114"
DEFAULT_PACKAGE_DIR = str(ROOT.parent / "cellscript" / "examples" / "launch.cell")
DEFAULT_IDENTITY_PLAN = str(ROOT.parent / "cellscript" / "build" / "latest.resource-identities.json")
DEFAULT_OUTPUT_TX = str(ROOT / "launch_tx_final.json")
DEFAULT_WITNESS_OUT = str(ROOT / "launch_witness.bin")

DEFAULT_USER_LOCK_ARGS = "0x9d1edebedf8f026c0d597c4c5cd3f45dec1f7557"
DEFAULT_LAUNCH_DEP_TX = "0x0bffefb21229053ea95453943b72ec7a9eb37274c41ee1f4949891ed1d338ca5"
DEFAULT_PASSIVE_ID_TX = "0x6a02e9379e6aef065611ec05405bfa13d1f4f21c2d84d35b979e563c1d368d48"
DEFAULT_SECP_DEP_GROUP = "0x4d804f1495612631da202fe9902fa9899118554b08138cfe5dfb50e1ede76293"
DEFAULT_SECP_CODE_HASH = "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8"

HTYPE_BYTE = {"data": 0, "type": 1, "data1": 2, "data2": 4}


def normalize_hex(value, byte_len=None):
    if not value.startswith("0x"):
        value = "0x" + value
    body = value[2:]
    if len(body) % 2 != 0:
        raise ValueError(f"hex value has odd length: {value}")
    if byte_len is not None and len(body) != byte_len * 2:
        raise ValueError(f"expected {byte_len} bytes, got {len(body) // 2}: {value}")
    return value.lower()


def blake2b256(data):
    return "0x" + blake2b(data, digest_size=32, person=b"ckb-default-hash").hexdigest()


def pack_script(script):
    code_hash = bytes.fromhex(script["codeHash"][2:])
    hash_type = bytes([HTYPE_BYTE[script["hashType"]]])
    args = bytes.fromhex(script["args"][2:])
    args_item = len(args).to_bytes(4, "little") + args
    header_size = 16
    offsets = [header_size, header_size + 32, header_size + 33]
    total_size = offsets[-1] + len(args_item)
    return total_size.to_bytes(4, "little") + b"".join(offset.to_bytes(4, "little") for offset in offsets) + code_hash + hash_type + args_item


def script_hash(script):
    return blake2b256(pack_script(script))


def to_builder_script(script):
    return {"codeHash": script["code_hash"], "hashType": script["hash_type"], "args": script["args"]}


def load_launch_scripts(plan_path):
    with open(plan_path) as f:
        plan = json.load(f)
    scripts = {}
    for resource in plan["resource_identities"]:
        for created in resource.get("create_scripts", []):
            if created.get("origin") == "action:launch_token":
                scripts[created["binding"]] = to_builder_script(created["script"])
    required = ["auth", "dist0", "dist1", "dist2", "dist3", "pool", "lp_receipt", "change"]
    missing = [binding for binding in required if binding not in scripts]
    if missing:
        raise ValueError(f"identity plan missing launch bindings: {', '.join(missing)}")
    return scripts


def pack_u64(value):
    return struct.pack("<Q", value).hex()


def pack_u16(value):
    return struct.pack("<H", value).hex()


def symbol_hex(symbol):
    raw = symbol.encode("ascii")
    if len(raw) > 8:
        raise ValueError("symbol must be at most 8 ASCII bytes")
    return raw.ljust(8, b"\0").hex()


def make_mint_auth_data(symbol, max_supply, minted):
    return symbol_hex(symbol) + pack_u64(max_supply) + pack_u64(minted)


def make_token_data(amount, symbol):
    return pack_u64(amount) + symbol_hex(symbol)


def make_pool_data(symbol_a, symbol_b, reserve_a, reserve_b, lp_supply, fee_rate_bps):
    return symbol_hex(symbol_a) + symbol_hex(symbol_b) + pack_u64(reserve_a) + pack_u64(reserve_b) + pack_u64(lp_supply) + pack_u16(fee_rate_bps)


def make_lp_receipt_data(pool_type_hash, lp_amount, provider):
    return pool_type_hash[2:] + pack_u64(lp_amount) + provider[2:]


def user_lock(args, secp_code_hash):
    return {"codeHash": secp_code_hash, "hashType": "type", "args": args}


def rpc(rpc_url, method, params):
    result = subprocess.run(
        ["curl", "-s", rpc_url, "-X", "POST", "-H", "Content-Type: application/json", "-d", json.dumps({"id": 1, "jsonrpc": "2.0", "method": method, "params": params})],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "RPC command failed")
    response = json.loads(result.stdout)
    if "error" in response:
        raise RuntimeError(json.dumps(response["error"], indent=2))
    return response["result"]


def get_funding_token(rpc_url, tx_hash, index):
    cell = rpc(rpc_url, "get_live_cell", [{"tx_hash": tx_hash, "index": index}, True])
    if cell.get("status") != "live":
        raise ValueError(f"funding cell is not live: {tx_hash}:{index}")
    output = cell["cell"]["output"]
    data = bytes.fromhex(cell["cell"]["data"]["content"][2:])
    if len(data) != 16:
        raise ValueError(f"funding token data must be 16 bytes, got {len(data)}")
    return {
        "amount": struct.unpack("<Q", data[:8])[0],
        "symbol": data[8:16].rstrip(b"\0").decode("ascii"),
        "capacity": int(output["capacity"], 16),
    }


def gen_witness(args, creator_hash, distribution_hex):
    witness_path = Path(args.witness_out)
    result = subprocess.run(
        [
            "cellc", "entry-witness", args.package_dir,
            "--target-profile", "ckb", "--action", "launch_token",
            "--arg", "0x" + symbol_hex(args.symbol),
            "--arg", str(args.max_supply),
            "--arg", str(args.initial_mint),
            "--arg", str(args.pool_seed),
            "--arg", str(args.fee_rate_bps),
            "--arg", creator_hash,
            "--arg", "0x" + distribution_hex,
            "-o", str(witness_path),
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip())
    return "0x" + witness_path.read_bytes().hex()


def parse_amounts(value):
    amounts = [int(part) for part in value.split(",") if part]
    if len(amounts) != 4:
        raise argparse.ArgumentTypeError("expected exactly 4 comma-separated amounts")
    return amounts


def parse_addresses(value):
    addresses = [normalize_hex(part, 32) for part in value.split(",") if part]
    if len(addresses) != 4:
        raise argparse.ArgumentTypeError("expected exactly 4 comma-separated 32-byte addresses")
    return addresses


def build_parser():
    parser = argparse.ArgumentParser(description="Build and dry-run a CellScript launch_token transaction")
    parser.add_argument("--rpc-url", default=DEFAULT_RPC_URL)
    parser.add_argument("--package-dir", default=DEFAULT_PACKAGE_DIR)
    parser.add_argument("--identity-plan", default=DEFAULT_IDENTITY_PLAN)
    parser.add_argument("--output-tx", default=DEFAULT_OUTPUT_TX)
    parser.add_argument("--witness-out", default=DEFAULT_WITNESS_OUT)
    parser.add_argument("--funding-tx", default="0x74d9ee3dcb24a400f3064c1f14a33e3eeea38bd75b38a465fe72bc8a49759007")
    parser.add_argument("--funding-index", default="0x0")
    parser.add_argument("--user-lock-args", default=DEFAULT_USER_LOCK_ARGS)
    parser.add_argument("--secp-code-hash", default=DEFAULT_SECP_CODE_HASH)
    parser.add_argument("--launch-dep-tx", default=DEFAULT_LAUNCH_DEP_TX)
    parser.add_argument("--passive-id-tx", default=DEFAULT_PASSIVE_ID_TX)
    parser.add_argument("--secp-dep-group", default=DEFAULT_SECP_DEP_GROUP)
    parser.add_argument("--symbol", default="TEST0001")
    parser.add_argument("--max-supply", type=int, default=1_000_000_000)
    parser.add_argument("--initial-mint", type=int, default=500_000_000)
    parser.add_argument("--pool-seed", type=int, default=10_000)
    parser.add_argument("--fee-rate-bps", type=int, default=30)
    parser.add_argument("--distribution", type=parse_amounts, default=parse_amounts("250000000,200000000,0,0"))
    parser.add_argument("--distribution-addresses", type=parse_addresses)
    parser.add_argument("--normal-output-capacity", type=int, default=10_000_000_000, help="capacity per normal output in shannons")
    parser.add_argument("--pool-output-capacity", type=int, default=12_000_000_000, help="pool output capacity in shannons")
    parser.add_argument("--submit", action="store_true", help="broadcast after successful dry-run")
    return parser


def fix_script(script):
    if script is None:
        return None
    return {"code_hash": script["codeHash"], "hash_type": script["hashType"], "args": script["args"]}


def to_rpc_tx(tx):
    def outpoint(op):
        return {"tx_hash": op["txHash"], "index": op["index"]}
    dep_types = {"code": "code", "depGroup": "dep_group"}
    return {
        "version": tx["version"],
        "cell_deps": [{"out_point": outpoint(dep["outPoint"]), "dep_type": dep_types[dep["depType"]]} for dep in tx["cellDeps"]],
        "header_deps": [],
        "inputs": [{"previous_output": outpoint(cell_input["previousOutput"]), "since": cell_input["since"]} for cell_input in tx["inputs"]],
        "outputs": [{"capacity": output["capacity"], "lock": fix_script(output["lock"]), "type": fix_script(output["type"])} for output in tx["outputs"]],
        "outputs_data": tx["outputsData"],
        "witnesses": tx["witnesses"],
    }


def main():
    args = build_parser().parse_args()
    scripts = load_launch_scripts(args.identity_plan)
    funding = get_funding_token(args.rpc_url, args.funding_tx, args.funding_index)
    lock = user_lock(normalize_hex(args.user_lock_args), normalize_hex(args.secp_code_hash, 32))
    creator_hash = script_hash(lock)
    distribution_addresses = args.distribution_addresses or [creator_hash] * 4
    distribution_hex = "".join(address[2:] + pack_u64(amount) for address, amount in zip(distribution_addresses, args.distribution))
    dist_total = sum(args.distribution)
    change_amount = args.initial_mint - dist_total - args.pool_seed
    if change_amount < 0:
        raise ValueError("distribution plus pool seed exceeds initial mint")
    if args.pool_seed <= 0 or funding["amount"] <= 0:
        raise ValueError("pool reserves must be positive")
    if args.symbol == funding["symbol"]:
        raise ValueError("new token symbol must differ from paired funding token symbol")
    witness = gen_witness(args, creator_hash, distribution_hex)
    pool_type_hash = script_hash(scripts["pool"])
    output_specs = [
        (args.normal_output_capacity, scripts["auth"], "0x" + make_mint_auth_data(args.symbol, args.max_supply, args.initial_mint)),
        (args.normal_output_capacity, scripts["dist0"], "0x" + make_token_data(args.distribution[0], args.symbol)),
        (args.normal_output_capacity, scripts["dist1"], "0x" + make_token_data(args.distribution[1], args.symbol)),
        (args.normal_output_capacity, scripts["dist2"], "0x" + make_token_data(args.distribution[2], args.symbol)),
        (args.normal_output_capacity, scripts["dist3"], "0x" + make_token_data(args.distribution[3], args.symbol)),
        (args.pool_output_capacity, scripts["pool"], "0x" + make_pool_data(args.symbol, funding["symbol"], args.pool_seed, funding["amount"], args.pool_seed, args.fee_rate_bps)),
        (args.normal_output_capacity, scripts["lp_receipt"], "0x" + make_lp_receipt_data(pool_type_hash, args.pool_seed, creator_hash)),
        (args.normal_output_capacity, scripts["change"], "0x" + make_token_data(change_amount, args.symbol)),
    ]
    total_output_capacity = sum(capacity for capacity, _, _ in output_specs)
    if total_output_capacity > funding["capacity"]:
        raise ValueError(f"outputs exceed funding capacity: {total_output_capacity} > {funding['capacity']}")
    outputs = [{"capacity": hex(capacity), "lock": lock, "type": type_script, "data": data} for capacity, type_script, data in output_specs]
    tx = {
        "version": "0x0",
        "cellDeps": [
            {"outPoint": {"txHash": args.launch_dep_tx, "index": "0x0"}, "depType": "code"},
            {"outPoint": {"txHash": args.passive_id_tx, "index": "0x0"}, "depType": "code"},
            {"outPoint": {"txHash": args.secp_dep_group, "index": "0x0"}, "depType": "depGroup"},
        ],
        "headerDeps": [],
        "inputs": [{"previousOutput": {"txHash": args.funding_tx, "index": args.funding_index}, "since": "0x0"}],
        "outputs": [{"capacity": output["capacity"], "lock": output["lock"], "type": output["type"]} for output in outputs],
        "outputsData": [output["data"] for output in outputs],
        "witnesses": [witness, "0x"],
    }
    Path(args.output_tx).write_text(json.dumps(tx, indent=2) + "\n")
    dry_run = rpc(args.rpc_url, "dry_run_transaction", [to_rpc_tx(tx)])
    print(f"Funding token: {funding['amount']} {funding['symbol']} from {args.funding_tx}:{args.funding_index}")
    print(f"Creator lock hash: {creator_hash}")
    print(f"Pool type hash: {pool_type_hash}")
    print(f"Distribution total: {dist_total}")
    print(f"Change amount: {change_amount}")
    print(f"Output capacity: {total_output_capacity / 100_000_000} CKB")
    print(f"TX saved: {args.output_tx}")
    print(f"Dry run OK: {int(dry_run['cycles'], 16)} cycles")
    if not args.submit:
        print("Use --submit to broadcast this transaction.")
        return
    print(f"Submitted: {rpc(args.rpc_url, 'send_transaction', [to_rpc_tx(tx)])}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"error: {exc}", file=sys.stderr)
        sys.exit(1)
