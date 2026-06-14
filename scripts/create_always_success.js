const path = require('path');
const corePath = path.resolve('/home/badman/.nvm/versions/node/v20.19.5/lib/node_modules/@offckb/cli/node_modules/@ckb-ccc/core');
const ccc = require(corePath);

const RPC = 'http://127.0.0.1:28114';
const PRIVKEY = process.env.CKB_PRIVKEY;
if (!PRIVKEY) { console.error('CKB_PRIVKEY env var required'); process.exit(1); }

const ACCOUNT2_CELL = { txHash: '0xaf87842777674da2be0f1e74ad952d06ab5e6ec52a216394e766cd52027bf243', index: '0x1' };
const ACCOUNT2_ARGS = '0x9d1edebedf8f026c0d597c4c5cd3f45dec1f7557';

async function main() {
  const client = new ccc.ClientJsonRpc(RPC);
  client.getKnownScript = async (name) => {
    console.log('getKnownScript called with:', JSON.stringify(name));
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
    console.log('  -> returning null');
    return null;
  };

  const secpLock = { codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8', hashType: 'type', args: ACCOUNT2_ARGS };
  // NOTE: hash_type: data with zero code_hash does NOT work as always_success
  // on CKB v0.205.0 (ScriptNotFound). The always_success system cell is not
  // available on this devnet. Use the deployed always_success ELF instead.
  const alwaysLock = { codeHash: '0xd483925160e4232b2cb29f012e8380b7b612d71cf4e79991476b6bcf610735f6', hashType: 'data2', args: '0x' };

  const totalIn = 4198133169900000n; // account #2 change cell capacity
  const sendToAlways = 1000n * 100000000n; // 1000 CKB
  const fee = 100000n;
  const change = totalIn - sendToAlways - fee;

  const tx = ccc.Transaction.from({
    version: '0x0',
    cellDeps: [],
    headerDeps: [],
    inputs: [{ previousOutput: ACCOUNT2_CELL, since: '0x0' }],
    outputs: [
      { capacity: '0x' + sendToAlways.toString(16), lock: alwaysLock, type: null },
      { capacity: '0x' + change.toString(16), lock: secpLock, type: null },
    ],
    outputsData: ['0x', '0x'],
    witnesses: ['0x'],
  });

  console.log('Funding', Number(sendToAlways / 100000000n), 'CKB to always_success (hash_type: data)');

  const signer = new ccc.SignerCkbPrivateKey(client, PRIVKEY);
  const prepared = await signer.prepareTransaction(tx);
  const signed = await signer.signOnlyTransaction(prepared);
  const hash = await client.sendTransaction(signed);
  console.log('Success! Tx:', hash);
  console.log('Always_success UTXO at index 0');
}

main().catch(e => { console.error('Error:', e.message || e); if (e.data) console.error('Data:', JSON.stringify(e.data)); process.exit(1); });
