use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const ENTRY_WITNESS_MAGIC: &[u8; 8] = b"CSARGv1\0";

fn encode_token(amount: u64, symbol: &[u8; 8]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(16);
    buf.extend_from_slice(&amount.to_le_bytes());
    buf.extend_from_slice(symbol);
    buf
}

fn decode_token(data: &[u8]) -> Result<(u64, [u8; 8])> {
    if data.len() < 16 {
        return Err(anyhow!("Token data too short: {} bytes", data.len()));
    }
    let amount = u64::from_le_bytes(data[0..8].try_into()?);
    let mut symbol = [0u8; 8];
    symbol.copy_from_slice(&data[8..16]);
    Ok((amount, symbol))
}

fn encode_pool(
    a_sym: &[u8; 8], b_sym: &[u8; 8],
    ra: u64, rb: u64, lp: u64, fee: u16,
) -> Vec<u8> {
    let mut buf = Vec::with_capacity(42);
    buf.extend_from_slice(a_sym);
    buf.extend_from_slice(b_sym);
    buf.extend_from_slice(&ra.to_le_bytes());
    buf.extend_from_slice(&rb.to_le_bytes());
    buf.extend_from_slice(&lp.to_le_bytes());
    buf.extend_from_slice(&fee.to_le_bytes());
    buf
}

fn decode_pool(data: &[u8]) -> Result<([u8; 8], [u8; 8], u64, u64, u64, u16)> {
    if data.len() < 42 {
        return Err(anyhow!("Pool data too short: {} bytes", data.len()));
    }
    let mut a_sym = [0u8; 8];
    let mut b_sym = [0u8; 8];
    a_sym.copy_from_slice(&data[0..8]);
    b_sym.copy_from_slice(&data[8..16]);
    let ra = u64::from_le_bytes(data[16..24].try_into()?);
    let rb = u64::from_le_bytes(data[24..32].try_into()?);
    let lp = u64::from_le_bytes(data[32..40].try_into()?);
    let fee = u16::from_le_bytes(data[40..42].try_into()?);
    Ok((a_sym, b_sym, ra, rb, lp, fee))
}

/// Encode a CellScript swap entry witness: CSARGv1 + min_output + to.
fn encode_swap_witness(min_output: u64, to: &[u8; 32]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(48);
    buf.extend_from_slice(ENTRY_WITNESS_MAGIC);
    buf.extend_from_slice(&min_output.to_le_bytes());
    buf.extend_from_slice(to);
    buf
}

/// Encode a CKB Molecule WitnessArgs with input_type set.
/// Molecule table WitnessArgs { lock: BytesOpt, input_type: BytesOpt, output_type: BytesOpt }
fn encode_witness_args(input_type: &[u8]) -> Vec<u8> {
    // WitnessArgs fields are fixed-size optionals: each is either 0 bytes (None)
    // or a molecule Bytes (u32 length prefix + data).
    // The table has 3 fields. We only set input_type.
    // Molecule table: total_size (u32) + field offsets (u32 * 3) + field data
    let input_type_bytes: Vec<u8> = {
        // Bytes: u32 length + data
        let mut b = Vec::with_capacity(4 + input_type.len());
        b.extend_from_slice(&(input_type.len() as u32).to_le_bytes());
        b.extend_from_slice(input_type);
        b
    };
    // Offsets: lock=16 (None → points past itself = same as start), input_type=16, output_type=16+input_len
    let lock_offset: u32 = 16; // None → offset points to itself (or 4 for empty)
    let input_type_offset: u32 = 16; // start of input_type field
    let output_type_offset: u32 = 16 + input_type_bytes.len() as u32;

    let mut buf = Vec::with_capacity(16 + input_type_bytes.len());
    buf.extend_from_slice(&lock_offset.to_le_bytes());
    buf.extend_from_slice(&input_type_offset.to_le_bytes());
    buf.extend_from_slice(&output_type_offset.to_le_bytes());
    // lock field: None = 0x00000000 (empty BytesOpt)
    buf.extend_from_slice(&[0u8; 4]);
    // input_type field
    buf.extend_from_slice(&input_type_bytes);
    // output_type field: None
    // output_type_offset already points here, and empty BytesOpt = 4 bytes of zero
    buf.extend_from_slice(&[0u8; 4]);
    buf
}

fn blake2b_256(data: &[u8]) -> [u8; 32] {
    use blake2b_simd::Params;
    let mut params = Params::new();
    params.hash_length(32);
    params.personal(b"ckb-default-hash");
    let hash = params.hash(data);
    let mut out = [0u8; 32];
    out.copy_from_slice(hash.as_bytes());
    out
}

fn compute_tx_hash(tx_json: &serde_json::Value) -> String {
    let json_str = serde_json::to_string(tx_json).unwrap();
    let hash = blake2b_256(json_str.as_bytes());
    format!("0x{}", hex::encode(hash))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapInput {
    pub pool_outpoint: OutPointStruct,
    pub pool_cell_data: String,
    pub pool_lock: ScriptStruct,
    pub input_outpoint: OutPointStruct,
    pub input_cell_data: String,
    pub input_lock: ScriptStruct,
    pub min_output: u64,
    pub recipient: String,
    pub pool_type_script: ScriptStruct,
    pub token_type_script: ScriptStruct,
    pub pool_elf_cell_dep: CellDepStruct,
    pub token_type_cell_dep: CellDepStruct,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutPointStruct {
    pub tx_hash: String,
    pub index: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptStruct {
    pub code_hash: String,
    pub hash_type: String,
    pub args: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CellDepStruct {
    pub out_point: OutPointStruct,
    pub dep_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwapOutput {
    pub ckb_tx: serde_json::Value,
    pub tx_hash: String,
    pub witness_hex: String,
    pub pool_after_cell_data: String,
    pub token_out_cell_data: String,
}

fn to_json_outpoint(op: &OutPointStruct) -> serde_json::Value {
    serde_json::json!({
        "tx_hash": op.tx_hash,
        "index": format!("0x{:x}", op.index),
    })
}

fn to_json_script(script: &ScriptStruct) -> serde_json::Value {
    serde_json::json!({
        "code_hash": script.code_hash,
        "hash_type": script.hash_type,
        "args": script.args,
    })
}

fn to_json_cell_dep(dep: &CellDepStruct) -> serde_json::Value {
    serde_json::json!({
        "out_point": to_json_outpoint(&dep.out_point),
        "dep_type": dep.dep_type,
    })
}

/// Returns the 34 builder_assumptions from the ProofPlan metadata for swap_a_for_b.
fn get_builder_assumptions() -> Vec<serde_json::Value> {
    serde_json::from_str(include_str!("../builder_assumptions.json")).unwrap()
}

/// Returns the 8 builder_assumption_evidence entries for the runtime-required assumptions.
fn get_builder_assumption_evidence() -> Vec<serde_json::Value> {
    serde_json::from_str(include_str!("../evidence.json")).unwrap()
}

pub fn build_swap(input: &SwapInput) -> Result<SwapOutput> {
    let pool_before = {
        let v = parse_hex(&input.pool_cell_data)?;
        if v.len() != 42 {
            return Err(anyhow!("Pool data must be 42 bytes, got {}", v.len()));
        }
        let mut arr = [0u8; 42];
        arr.copy_from_slice(&v);
        arr
    };
    let input_token = {
        let v = parse_hex(&input.input_cell_data)?;
        if v.len() != 16 {
            return Err(anyhow!("Token data must be 16 bytes, got {}", v.len()));
        }
        let mut arr = [0u8; 16];
        arr.copy_from_slice(&v);
        arr
    };
    let recipient = parse_hex32(&input.recipient)?;

    let (a_sym, b_sym, reserve_a, reserve_b, total_lp, fee_rate_bps) = decode_pool(&pool_before)?;
    let (amount_in, _) = decode_token(&input_token)?;

    let fee = amount_in * fee_rate_bps as u64 / 10000;
    let net_input = amount_in - fee;
    let amount_out = reserve_b * net_input / (reserve_a + net_input);

    let pool_after = encode_pool(
        &a_sym, &b_sym,
        reserve_a + amount_in,
        reserve_b - amount_out,
        total_lp,
        fee_rate_bps,
    );

    let token_out = encode_token(amount_out, &b_sym);

    // Entry witness (CSARGv1 + scalar params)
    let entry_witness = encode_swap_witness(input.min_output, &recipient);
    // Wrap in WitnessArgs (input_type = entry witness)
    let witness_args = encode_witness_args(&entry_witness);

    // Build the CKB transaction JSON (standard RPC format)
    let ckb_tx = serde_json::json!({
        "version": "0x0",
        "cell_deps": [
            to_json_cell_dep(&input.pool_elf_cell_dep),
            to_json_cell_dep(&input.token_type_cell_dep),
        ],
        "header_deps": [],
        "inputs": [
            {
                "previous_output": to_json_outpoint(&input.pool_outpoint),
                "since": "0x0",
            },
            {
                "previous_output": to_json_outpoint(&input.input_outpoint),
                "since": "0x0",
            },
        ],
        "outputs": [
            {
                "capacity": "0x0",
                "lock": to_json_script(&input.pool_lock),
                "type": to_json_script(&input.pool_type_script),
            },
            {
                "capacity": "0x0",
                "lock": to_json_script(&input.input_lock),
                "type": to_json_script(&input.token_type_script),
            },
        ],
        "outputs_data": [
            format!("0x{}", hex::encode(&pool_after)),
            format!("0x{}", hex::encode(&token_out)),
        ],
        "witnesses": [
            format!("0x{}", hex::encode(&witness_args)),
        ],
        "builder_assumptions": get_builder_assumptions(),
        "builder_assumption_evidence": get_builder_assumption_evidence(),
    });

    let tx_hash = compute_tx_hash(&ckb_tx);

    Ok(SwapOutput {
        ckb_tx,
        tx_hash,
        witness_hex: format!("0x{}", hex::encode(&witness_args)),
        pool_after_cell_data: format!("0x{}", hex::encode(&pool_after)),
        token_out_cell_data: format!("0x{}", hex::encode(&token_out)),
    })
}

fn parse_hex(s: &str) -> Result<Vec<u8>> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    hex::decode(s).context("hex decode failed")
}

fn parse_hex32(s: &str) -> Result<[u8; 32]> {
    let bytes = parse_hex(s)?;
    if bytes.len() != 32 {
        return Err(anyhow!("expected 32 bytes, got {}", bytes.len()));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 2 {
        eprintln!("Usage: swap-builder <input.json>");
        eprintln!("       swap-builder --example");
        std::process::exit(1);
    }

    if args[1] == "--example" {
        print_example_input()?;
    } else {
        let path = PathBuf::from(&args[1]);
        let json = std::fs::read_to_string(&path).context("read input file")?;
        let input: SwapInput = serde_json::from_str(&json).context("parse input JSON")?;
        let output = build_swap(&input)?;
        println!("{}", serde_json::to_string_pretty(&output)?);
    }

    Ok(())
}

fn print_example_input() -> Result<()> {
    let example = serde_json::json!({
        "pool_outpoint": {
            "tx_hash": "0x0000000000000000000000000000000000000000000000000000000000000000",
            "index": 0
        },
        "pool_cell_data": format!("0x{}", hex::encode(encode_pool(
            b"USDC    ",
            b"CKB     ",
            1000000u64,
            50000000u64,
            7071067u64,
            30u16,
        ))),
        "pool_lock": {
            "code_hash": "0x0000000000000000000000000000000000000000000000000000000000000000",
            "hash_type": "data1",
            "args": "0x"
        },
        "input_outpoint": {
            "tx_hash": "0x1111111111111111111111111111111111111111111111111111111111111111",
            "index": 0
        },
        "input_cell_data": format!("0x{}", hex::encode(encode_token(1000u64, b"USDC    "))),
        "input_lock": {
            "code_hash": "0x0000000000000000000000000000000000000000000000000000000000000000",
            "hash_type": "data1",
            "args": "0x"
        },
        "min_output": 49000,
        "recipient": "0x0101010101010101010101010101010101010101010101010101010101010101",
        "pool_type_script": {
            "code_hash": "0x0000000000000000000000000000000000000000000000000000000000000000",
            "hash_type": "data1",
            "args": "0x"
        },
        "token_type_script": {
            "code_hash": "0x0000000000000000000000000000000000000000000000000000000000000000",
            "hash_type": "data1",
            "args": "0x"
        },
        "pool_elf_cell_dep": {
            "out_point": {
                "tx_hash": "0x0000000000000000000000000000000000000000000000000000000000000000",
                "index": 0
            },
            "dep_type": "code"
        },
        "token_type_cell_dep": {
            "out_point": {
                "tx_hash": "0x0000000000000000000000000000000000000000000000000000000000000000",
                "index": 0
            },
            "dep_type": "code"
        }
    });

    println!("{}", serde_json::to_string_pretty(&example)?);
    Ok(())
}
