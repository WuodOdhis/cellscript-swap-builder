const fs = require('fs');
const corePath = require('path').resolve('/home/badman/.nvm/versions/node/v20.19.5/lib/node_modules/@offckb/cli/node_modules/@ckb-ccc/core');
const ccc = require(corePath);

async function main() {
  const privkeyHex = process.env.CKB_PRIVKEY;
  if (!privkeyHex) { console.error('CKB_PRIVKEY env var required'); process.exit(1); }

  const elfPath = process.argv[2];
  if (!elfPath) { console.error('Usage: node deploy.js <elf_path>'); process.exit(1); }
  
  const elfBinary = fs.readFileSync(elfPath);
  const elfHex = '0x' + elfBinary.toString('hex');
  
  const CHANGE_TX = '0xb30b2371667a36824f21d724f9461db4ebfa8079059129ea759c495e4718fd3c';
  const ACCOUNT2_ARGS = '0x9d1edebedf8f026c0d597c4c5cd3f45dec1f7557';

  const TOTAL_INPUT = 4199890000000000n;
  const FEE = 1000n * 100000000n;
  const CODE_CELL_CAP = 1556830000000n;
  const CHANGE_CAP = TOTAL_INPUT - CODE_CELL_CAP - FEE;

  const tx = ccc.Transaction.from({
    version: '0x0',
    cellDeps: [],
    headerDeps: [],
    inputs: [{
      previousOutput: { txHash: CHANGE_TX, index: '0x1' },
      since: '0x0'
    }],
    outputs: [
      {
        capacity: '0x' + CODE_CELL_CAP.toString(16),
        lock: { codeHash: '0x0000000000000000000000000000000000000000000000000000000000000000', hashType: 'data1', args: '0x' },
        type: null
      },
      {
        capacity: '0x' + CHANGE_CAP.toString(16),
        lock: { codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8', hashType: 'type', args: ACCOUNT2_ARGS },
        type: null
      }
    ],
    outputsData: [elfHex, '0x'],
    witnesses: ['0x']
  });

  const client = new ccc.ClientJsonRpc('http://127.0.0.1:28114');
  client.getKnownScript = async (scriptName) => {
    const scripts = {
      'Secp256k1Blake160': { codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8', hashType: 'type', cellDeps: [{ cellDep: { outPoint: { txHash: '0x4d804f1495612631da202fe9902fa9899118554b08138cfe5dfb50e1ede76293', index: 0 }, depType: 'depGroup' } }] },
      'AnyoneCanPay': { codeHash: '0x3419a1c09eb2567f6552ee7a8ecffd64155cffe0f1796e6e61ec088d740c1356', hashType: 'type', cellDeps: [] }
    };
    return scripts[scriptName];
  };

  const signer = new ccc.SignerCkbPrivateKey(client, privkeyHex);
  tx.cellDeps.length = 0;
  let prepared = await signer.prepareTransaction(tx);
  const signedTx = await signer.signOnlyTransaction(prepared);
  const hash = await client.sendTransaction(signedTx);
  console.log(hash);
}

main().catch(e => { console.error('Error:', e.message || e); if (e.data) console.error('Data:', JSON.stringify(e.data)); if (e.stack) console.error(e.stack.split('\n').slice(0,5).join('\n')); process.exit(1); });
