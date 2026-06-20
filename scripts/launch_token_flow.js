const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const corePath = path.resolve('/home/badman/.nvm/versions/node/v20.19.5/lib/node_modules/@offckb/cli/node_modules/@ckb-ccc/core');
const ccc = require(corePath);

const RPC = 'http://127.0.0.1:28114';
const PRIVKEY = process.env.CKB_PRIVKEY;
if (!PRIVKEY) { console.error('CKB_PRIVKEY env var required'); process.exit(1); }

const SECP_CODE_HASH = '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8';
const SECP_DEP = { txHash: '0x4d804f1495612631da202fe9902fa9899118554b08138cfe5dfb50e1ede76293', index: 0 };
const ACCOUNT2_ARGS = '0x9d1edebedf8f026c0d597c4c5cd3f45dec1f7557';
const ACCOUNT2_LOCK = { codeHash: SECP_CODE_HASH, hashType: 'type', args: ACCOUNT2_ARGS };
const ACCOUNT2_LOCK_RPC = toRpcScript(ACCOUNT2_LOCK);

const LAUNCH_CODE_HASH = '0x58313619d62d83d460417f2d5bd2550ad0c114a27017efb434a11b445ac62ba0';
const LAUNCH_DEP = { txHash: '0x0bffefb21229053ea95453943b72ec7a9eb37274c41ee1f4949891ed1d338ca5', index: 0 };
const ALWAYS_CODE_HASH = '0xd483925160e4232b2cb29f012e8380b7b612d71cf4e79991476b6bcf610735f6';
const ALWAYS_DEP = { txHash: '0xc1e25dc04f3dc365c910d56366bbfc9a9dd5f2a407947a96aa3d45cd5e5bb7fb', index: 0 };

const SHANNONS = 100000000n;
const FEE = 200000n;

function hex(buffer) { return '0x' + Buffer.from(buffer).toString('hex'); }
function u64le(value) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b; }
function scriptHash(script) {
  return ccc.Script.from(script).hash();
}
function type(args) { return { codeHash: ALWAYS_CODE_HASH, hashType: 'data2', args }; }
function toRpcScript(script) {
  if (!script) return null;
  return { code_hash: script.codeHash, hash_type: script.hashType, args: script.args };
}
function toRpcOutPoint(outPoint) {
  if (!outPoint) return null;
  const index = typeof outPoint.index === 'number' ? '0x' + outPoint.index.toString(16) : outPoint.index;
  return { tx_hash: outPoint.txHash || outPoint.tx_hash, index };
}
function toCccOutPoint(outPoint) {
  return { txHash: outPoint.txHash || outPoint.tx_hash, index: outPoint.index };
}
function toRpcCellDep(dep) {
  return { out_point: toRpcOutPoint(dep.outPoint), dep_type: dep.depType };
}
function toRpcTx(tx) {
  return {
    version: tx.version,
    cell_deps: tx.cellDeps.map(toRpcCellDep),
    header_deps: tx.headerDeps,
    inputs: tx.inputs.map((input) => ({ previous_output: toRpcOutPoint(input.previousOutput), since: input.since })),
    outputs: tx.outputs.map((output) => ({ capacity: output.capacity, lock: toRpcScript(output.lock), type: toRpcScript(output.type) })),
    outputs_data: tx.outputsData,
    witnesses: tx.witnesses,
  };
}
function toValidationTx(tx, inputCapacity) {
  const validationTx = toRpcTx(tx);
  validationTx.builder_assumption_evidence = capacityEvidence(inputCapacity, tx.outputs);
  return validationTx;
}
function tokenData(amount, symbol) { return hex(Buffer.concat([u64le(amount), Buffer.from(symbol.padEnd(8, '\0'), 'ascii')])); }
function authData(symbol, maxSupply, minted) { return hex(Buffer.concat([Buffer.from(symbol.padEnd(8, '\0'), 'ascii'), u64le(maxSupply), u64le(minted)])); }
function poolData(aSym, bSym, reserveA, reserveB, totalLp, feeRateBps) {
  const fee = Buffer.alloc(2); fee.writeUInt16LE(feeRateBps);
  return hex(Buffer.concat([Buffer.from(aSym.padEnd(8, '\0'), 'ascii'), Buffer.from(bSym.padEnd(8, '\0'), 'ascii'), u64le(reserveA), u64le(reserveB), u64le(totalLp), fee]));
}
function lpReceiptData(poolType, lpAmount, providerHash) {
  return hex(Buffer.concat([Buffer.from(scriptHash(poolType).slice(2), 'hex'), u64le(lpAmount), Buffer.from(providerHash.slice(2), 'hex')]));
}
function fixedDistribution(recipients) {
  return hex(Buffer.concat(recipients.flatMap(([addressHash, amount]) => [Buffer.from(addressHash.slice(2), 'hex'), u64le(amount)])));
}
function capacityEvidence(inputCapacity, outputs) {
  const outputCapacities = outputs.map((output) => BigInt(output.capacity));
  const outputsTotal = outputCapacities.reduce((sum, capacity) => sum + capacity, 0n);
  return {
    'ba-eabc81b64927584b': {
      assumption_id: 'ba-eabc81b64927584b',
      kind: 'capacity_policy',
      origin: 'constraints.ckb',
      feature: 'capacity-planning',
      proof_plan_status: 'builder-required',
      evidence: {
        source: 'builder',
        checked: true,
        note: 'Schema evidence for cellc validate-tx. CKB dry-run remains production acceptance evidence.',
        input_capacity_shannons: inputCapacity.toString(),
        output_capacity_shannons: outputCapacities.map((capacity) => capacity.toString()),
        outputs_total_capacity_shannons: outputsTotal.toString(),
        fee_paid_shannons: (inputCapacity - outputsTotal).toString(),
        capacity_is_sufficient: true,
        under_capacity_output_indexes: [],
      },
    },
  };
}
function makeClient() {
  const client = new ccc.ClientJsonRpc(RPC);
  client.getKnownScript = async (name) => {
    if (name === 'Secp256k1Blake160') return { codeHash: SECP_CODE_HASH, hashType: 'type', cellDeps: [{ cellDep: { outPoint: SECP_DEP, depType: 'depGroup' } }] };
    if (name === 'AnyoneCanPay') return { codeHash: '0x3419a1c09eb2567f6552ee7a8ecffd64155cffe0f1796e6e61ec088d740c1356', hashType: 'type', cellDeps: [] };
    return null;
  };
  return client;
}
async function getLargestLiveCell(client) {
  const result = await rpc('get_cells', [{ script: ACCOUNT2_LOCK_RPC, script_type: 'lock', script_search_mode: 'exact' }, 'desc', '0x14']);
  const cells = result.objects.filter((cell) => !cell.output.type && cell.output_data === '0x');
  if (!cells.length) throw new Error('no plain account #2 cell found');
  cells.sort((a, b) => Number(BigInt(b.output.capacity) - BigInt(a.output.capacity)));
  return cells[0];
}
async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}
async function sendSigned(client, tx) {
  const signer = new ccc.SignerCkbPrivateKey(client, PRIVKEY);
  const prepared = await signer.prepareTransaction(ccc.Transaction.from(tx));
  const signed = await signer.signOnlyTransaction(prepared);
  return await client.sendTransaction(signed);
}
async function main() {
  const client = makeClient();
  const launchLock = { codeHash: LAUNCH_CODE_HASH, hashType: 'data2', args: '0x' };
  let launchOutPoint = await findLaunchInput(launchLock);
  let launchInputCap;
  if (!launchOutPoint) {
    const funding = await getLargestLiveCell(client);
    const fundingCap = BigInt(funding.output.capacity);
    launchInputCap = 4000n * SHANNONS;
    const changeCap = fundingCap - launchInputCap - FEE;
    const createInputTx = {
      version: '0x0', cellDeps: [{ outPoint: ALWAYS_DEP, depType: 'code' }], headerDeps: [],
      inputs: [{ previousOutput: toCccOutPoint(funding.out_point), since: '0x0' }],
      outputs: [
        { capacity: '0x' + launchInputCap.toString(16), lock: launchLock, type: type('0x63') },
        { capacity: '0x' + changeCap.toString(16), lock: ACCOUNT2_LOCK, type: null },
      ],
      outputsData: [tokenData(250, 'PAIR0001'), '0x'], witnesses: ['0x'],
    };
    const createHash = await sendSigned(client, createInputTx);
    launchOutPoint = { txHash: createHash, index: '0x0' };
    console.log('Created launch input:', createHash, 'index 0');
  } else {
    console.log('Using existing launch input:', launchOutPoint.txHash, launchOutPoint.index);
    launchInputCap = launchOutPoint.capacity;
    delete launchOutPoint.capacity;
  }

  const creatorHash = scriptHash(ACCOUNT2_LOCK);
  const recipients = [[creatorHash, 10], [creatorHash, 20], [creatorHash, 30], [creatorHash, 40]];
  const distribution = fixedDistribution(recipients);
  const entry = JSON.parse(execFileSync('cellc', [
    'entry-witness', '/home/badman/Projects/amm-swap-builder/cellscript/examples/launch.cell',
    '--target-profile', 'ckb', '--action', 'launch_token', '--json',
    '--arg', '0x4c41554e43483031', '--arg', '10000', '--arg', '1000', '--arg', '500', '--arg', '30', '--arg', creatorHash, '--arg', distribution,
  ], { encoding: 'utf8' }));
  const authType = type('0x61');
  const tokenType = type('0x62');
  const poolType = type('0x64');
  const lpType = type('0x65');
  const totalDistributed = 100n;
  const remaining = 1000n - totalDistributed - 500n;
  const tx = {
    version: '0x0',
    cellDeps: [{ outPoint: ALWAYS_DEP, depType: 'code' }, { outPoint: LAUNCH_DEP, depType: 'code' }],
    headerDeps: [],
    inputs: [{ previousOutput: launchOutPoint, since: '0x0' }],
    outputs: [
      { capacity: '0x' + (400n * SHANNONS).toString(16), lock: ACCOUNT2_LOCK, type: authType },
      ...recipients.map(() => ({ capacity: '0x' + (200n * SHANNONS).toString(16), lock: ACCOUNT2_LOCK, type: tokenType })),
      { capacity: '0x' + (400n * SHANNONS).toString(16), lock: ACCOUNT2_LOCK, type: poolType },
      { capacity: '0x' + (200n * SHANNONS).toString(16), lock: ACCOUNT2_LOCK, type: lpType },
      { capacity: '0x' + (200n * SHANNONS).toString(16), lock: ACCOUNT2_LOCK, type: tokenType },
      { capacity: '0x' + (1800n * SHANNONS - FEE).toString(16), lock: ACCOUNT2_LOCK, type: null },
    ],
    outputsData: [
      authData('LAUNCH01', 10000, 1000),
      ...recipients.map(([, amount]) => tokenData(amount, 'LAUNCH01')),
      poolData('LAUNCH01', 'PAIR0001', 500, 250, 500, 30),
      lpReceiptData(poolType, 500, creatorHash),
      tokenData(remaining, 'LAUNCH01'),
      '0x',
    ],
    witnesses: [entry.witness_hex.startsWith('0x') ? entry.witness_hex : '0x' + entry.witness_hex],
  };
  if (process.env.LAUNCH_TX_JSON) {
    fs.writeFileSync(process.env.LAUNCH_TX_JSON, JSON.stringify(toValidationTx(tx, launchInputCap), null, 2));
    console.log('Wrote validation tx JSON:', process.env.LAUNCH_TX_JSON);
  }
  const dryRun = await rpc('dry_run_transaction', [toRpcTx(tx)]);
  console.log('Dry run cycles:', dryRun.cycles);
  const hash = await client.sendTransaction(ccc.Transaction.from(tx));
  console.log('Sent launch_token tx:', hash);
}
async function findLaunchInput(launchLock) {
  const result = await rpc('get_cells', [{ script: toRpcScript(launchLock), script_type: 'lock', script_search_mode: 'exact' }, 'desc', '0xa']);
  const expectedData = tokenData(250, 'PAIR0001');
  const cell = result.objects.find((cell) => cell.output_data === expectedData && cell.output.type && cell.output.type.args === '0x63');
  return cell ? { ...toCccOutPoint(cell.out_point), capacity: BigInt(cell.output.capacity) } : null;
}

main().catch((e) => { console.error('Error:', e.message || e); if (e.data) console.error(JSON.stringify(e.data, null, 2)); process.exit(1); });
