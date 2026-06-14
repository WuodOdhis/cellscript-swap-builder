const path = require('path');
const corePath = path.resolve('/home/badman/.nvm/versions/node/v20.19.5/lib/node_modules/@offckb/cli/node_modules/@ckb-ccc/core');
const ccc = require(corePath);

async function signTx(txJson, privkey) {
  // Convert our JSON tx to CCC Transaction
  const tx = ccc.Transaction.from(txJson);
  
  // Create a CCC client (we won't need it for signing, just as a parameter)
  const client = new ccc.ClientJsonRpc('http://127.0.0.1:28114');
  
  // Create signer
  const signer = new ccc.SignerCkbPrivateKey(client, privkey);
  
  // Prepare the transaction (adds empty witness for signing, adds cell deps)
  const preparedTx = await signer.prepareTransaction(tx);
  
  // Sign the transaction
  const signedTx = await signer.signTransaction(preparedTx);
  
  return signedTx;
}

// Read tx JSON from stdin
let input = '';
process.stdin.on('data', d => input += d);
process.stdin.on('end', async () => {
  try {
    const tx = JSON.parse(input);
    const privkey = process.env.CKB_PRIVKEY;
    if (!privkey) {
      console.error('CKB_PRIVKEY env var required');
      process.exit(1);
    }
    
    const signedTx = await signTx(tx, privkey);
    
    // Output the signed transaction as JSON
    // CCC Transaction has a toJSON() or similar method
    // Let's check what properties it has
    console.error('signedTx type:', typeof signedTx);
    console.error('signedTx keys:', Object.keys(signedTx));
    console.error('signedTx constructor:', signedTx.constructor.name);
    
    // Check for toJSON or serialize method
    if (typeof signedTx.toJSON === 'function') {
      console.log(JSON.stringify(signedTx.toJSON(), null, 2));
    } else if (typeof signedTx.toBytes === 'function') {
      // To use RPC, we need the JSON format
      // Output raw JSON
      console.log(JSON.stringify(signedTx, null, 2));
    } else {
      // Try to convert to JSON RPC format
      // CCC Transaction has methods to get the tx in different formats
      console.error('available methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(signedTx)));
      
      // Try rawToJSON or similar
      const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(signedTx));
      const jsonMethods = methods.filter(m => m.toLowerCase().includes('json') || m.toLowerCase().includes('rpc'));
      console.error('json methods:', jsonMethods);
    }
  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  }
});
