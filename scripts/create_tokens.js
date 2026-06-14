const path = require('path');
const corePath = path.resolve('/home/badman/.nvm/versions/node/v20.19.5/lib/node_modules/@offckb/cli/node_modules/@ckb-ccc/core');
const ccc = require(corePath);

// NOTE: This script creates token cells using the always_success ELF as a
// stand-in type script because the token.elf creation path is not yet
// understood. The always_success ELF passes unconditionally -- these cells
// do NOT enforce token conservation or transfer rules. They are test cells
// for validating the AMM pool pipeline only. The real approach must use
// token.elf with the MintAuthority resource pattern once that is figured out.

const RPC = 'http://127.0.0.1:28114';
const PRIVKEY = process.env.CKB_PRIVKEY;
if (!PRIVKEY) { console.error('CKB_PRIVKEY env var required'); process.exit(1); }

const ACCOUNT2_CELL = { txHash: '0xc1e25dc04f3dc365c910d56366bbfc9a9dd5f2a407947a96aa3d45cd5e5bb7fb', index: '0x1' };
const ACCOUNT2_ARGS = '0x9d1edebedf8f026c0d597c4c5cd3f45dec1f7557';

// Always_success deployed ELF (no-op, unconditional pass)
const ALWAYS_ELF_HASH = '0xd483925160e4232b2cb29f012e8380b7b612d71cf4e79991476b6bcf610735f6';
const ALWAYS_ELF_DEP = { txHash: '0xc1e25dc04f3dc365c910d56366bbfc9a9dd5f2a407947a96aa3d45cd5e5bb7fb', index: '0x0' };

function encodeToken16(amount, symbol8) {
  const b = Buffer.alloc(16);
  b.writeBigUInt64LE(BigInt(amount), 0);
  Buffer.from(symbol8.padEnd(8, '\0'), 'ascii').copy(b, 8);
  return '0x' + b.toString('hex');
}

async function main() {
  const client = new ccc.ClientJsonRpc(RPC);
  client.getKnownScript = async (name) => {
    if (name === 'Secp256k1Blake160') {
      return {
        codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',
        hashType: 'type',
        cellDeps: [{ cellDep: { outPoint: { txHash: '0x4d804f1495612631da202fe9902fa9899118554b08138cfe5dfb50e1ede76293', index: 0 }, depType: 'depGroup' } }]
      };
    }
    if (name === 'AnyoneCanPay') {
      return { codeHash: '0x3419a1c09eb2567f6552ee7a8ecffd64155cffe0f1796e6e61ec088d740c1356', hashType: 'type', cellDeps: [] };
    }
    return null;
  };

  const secpLock = { codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8', hashType: 'type', args: ACCOUNT2_ARGS };

  const totalIn = BigInt('0xeea096c7eba6f');
  const tokenACap = 200n * 100000000n;
  const tokenBCap = 200n * 100000000n;
  const fee = 100000n;
  const change = totalIn - tokenACap - tokenBCap - fee;

  // Token A: type = always_success ELF with args=0x01
  // Token B: type = always_success ELF with args=0x02
  // Different args => different type_hash() for seed_pool check
  const tokenAType = { codeHash: ALWAYS_ELF_HASH, hashType: 'data2', args: '0x01' };
  const tokenBType = { codeHash: ALWAYS_ELF_HASH, hashType: 'data2', args: '0x02' };
  const tokenAData = encodeToken16(1000000, 'USDC');
  const tokenBData = encodeToken16(1000000, 'CKB');

  const tx = ccc.Transaction.from({
    version: '0x0',
    cellDeps: [
      { outPoint: ALWAYS_ELF_DEP, depType: 'code' },
    ],
    headerDeps: [],
    inputs: [{ previousOutput: ACCOUNT2_CELL, since: '0x0' }],
    outputs: [
      { capacity: '0x' + tokenACap.toString(16), lock: secpLock, type: tokenAType },
      { capacity: '0x' + tokenBCap.toString(16), lock: secpLock, type: tokenBType },
      { capacity: '0x' + change.toString(16), lock: secpLock, type: null },
    ],
    outputsData: [tokenAData, tokenBData, '0x'],
    witnesses: ['0x'],
  });

  console.log('Token A (USDC, type args=0x01) at index 0');
  console.log('Token B (CKB, type args=0x02) at index 1');

  const signer = new ccc.SignerCkbPrivateKey(client, PRIVKEY);
  const prepared = await signer.prepareTransaction(tx);
  const signed = await signer.signOnlyTransaction(prepared);
  const hash = await client.sendTransaction(signed);
  console.log('Success! Tx:', hash);
}

main().catch(e => { console.error('Error:', e.message || e); if (e.data) console.error('Data:', JSON.stringify(e.data)); process.exit(1); });
