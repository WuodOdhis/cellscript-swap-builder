const path = require('path');
const corePath = path.resolve('/home/badman/.nvm/versions/node/v20.19.5/lib/node_modules/@offckb/cli/node_modules/@ckb-ccc/core');
const ccc = require(corePath);

const RPC = 'http://127.0.0.1:28114';
const PRIVKEY = process.env.CKB_PRIVKEY;
if (!PRIVKEY) { console.error('CKB_PRIVKEY env var required'); process.exit(1); }

const ACCOUNT2_CELL = { txHash: '0x82963c9d79aaddb07b2ddfffa140749a186faa9bdfb72037584fbba9f2c435ea', index: '0x1' };
const ACCOUNT2_ARGS = '0x9d1edebedf8f026c0d597c4c5cd3f45dec1f7557';

async function main() {
  const client = new ccc.ClientJsonRpc(RPC);
  client.getKnownScript = async (name) => {
    console.log('getKnownScript called:', name);
    if (name === 'Secp256k1Blake160') {
      return {
        codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8',
        hashType: 'type',
        cellDeps: [{ cellDep: { outPoint: { txHash: '0x4d804f1495612631da202fe9902fa9899118554b08138cfe5dfb50e1ede76293', index: 0 }, depType: 'depGroup' } }]
      };
    }
    if (name === 'AnyoneCanPay') {
      return { codeHash: '0x0000000000000000000000000000000000000000000000000000000000000000', hashType: 'data1', cellDeps: [] };
    }
    return null;
  };

  const secpLock = { codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8', hashType: 'type', args: ACCOUNT2_ARGS };
  const alwaysLock = { codeHash: '0x0000000000000000000000000000000000000000000000000000000000000000', hashType: 'data1', args: '0x' };

  const totalIn = 4198233170000000n; // From get_cells result: 41,982,331.70 CKB in shannons
  const sendToAlways = 1000n * 100000000n; // 1000 CKB
  const fee = 100000n; // tiny fee
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

  console.log('Sending', Number(sendToAlways / 100000000n), 'CKB to always_success');
  console.log('Change:', Number(change / 100000000n), 'CKB');

  const signer = new ccc.SignerCkbPrivateKey(client, PRIVKEY);
  const prepared = await signer.prepareTransaction(tx);
  const signed = await signer.signOnlyTransaction(prepared);
  const hash = await client.sendTransaction(signed);
  console.log('Success! Tx hash:', hash);
  console.log('Always_success UTXO at index 0');
}

main().catch(e => { console.error('Error:', e.message || e); if (e.data) console.error('Data:', JSON.stringify(e.data)); process.exit(1); });
