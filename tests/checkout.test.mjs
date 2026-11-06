import {test, beforeEach, after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const state = mkdtempSync(join(tmpdir(), 'tc-checkout-test-'));
process.env.TASTYCOFFEE_STATE_DIR = state;
const api = await import('../dist/api.js');
const checkout = await import('../dist/checkout.js');
const originalFetch = globalThis.fetch;
const dadata = {country_iso_code:'RU', city_fias_id:'test-city', city:'Test city', postal_code:'000000'};
const suggestion = {value:'Test address', unrestricted_value:'Test address', data:dadata};
const form = {delivery_type:'pvz', shipping_code:'fivepost.1', pvz_id:'test-point', payment_code:'gazprombank', dadata_address:suggestion};
let requests;
beforeEach(() => {
  requests=[];
  api.saveCart([{product_id:1,options:[2],quantity:1}]);
  api.saveCheckout(form);
  globalThis.fetch=async (url,options) => {
    requests.push({url,body:options.body ? JSON.parse(options.body) : null});
    return new Response(JSON.stringify({data:{items:[],prices:{total:100}}}),{status:200});
  };
});
after(() => {
  globalThis.fetch = originalFetch;
  rmSync(state, {recursive: true, force: true});
});

test('legacy saved Dadata suggestion is unwrapped when building the payload', () => {
  const payload=api.buildCartPayload(api.loadCheckout(),api.loadCart());
  assert.deepEqual(payload.cart.dadata_address,dadata);
  assert.equal(payload.cart.pvz_id,form.pvz_id);
  assert.equal(payload.cart.shipping_code,form.shipping_code);
  assert.deepEqual(api.buildCartPayload({...form,dadata_address:dadata},[]).cart.dadata_address,dadata);
});
test('set_checkout_form stores canonical address data', async () => {
  await checkout.setCheckoutForm({dadata_address:suggestion});
  assert.deepEqual(api.loadCheckout().dadata_address,dadata);
});
test('saved account address hydrates exactly the fields used by web checkout', async () => {
  globalThis.fetch=async (url) => {
    assert.ok(url.endsWith('/user/addresses?from=basket'));
    return Response.json({data:[{id:123,address:'Saved account address',dadata_address:dadata,postcode:'000000',flat:'7'}]});
  };
  const result=await checkout.setCheckoutForm({address_id:123});
  assert.equal(result.address_id,123);
  assert.deepEqual(result.dadata_address,dadata);
  assert.equal(result.address,'Saved account address');
  assert.equal(result.shipping_flat,'7');
  assert.equal(result.pvz_id,form.pvz_id);
  assert.equal(result.shipping_code,form.shipping_code);
  assert.equal(result.payment_code,form.payment_code);
});
test('unknown saved address is rejected without changing the form', async () => {
  const before=api.loadCheckout();
  globalThis.fetch=async () => Response.json({data:[]});
  await assert.rejects(checkout.setCheckoutForm({address_id:999}),/address_id/);
  assert.deepEqual(api.loadCheckout(),before);
});
test('explicit flat overrides the saved address flat', async () => {
  globalThis.fetch = async () => Response.json({
    data: [{id: 123, dadata_address: dadata, flat: '7'}],
  });
  const result = await checkout.setCheckoutForm({address_id: 123, shipping_flat: '9'});
  assert.equal(result.shipping_flat, '9');
});
test('explicit null clears the saved address flat', async () => {
  globalThis.fetch = async () => Response.json({
    data: [{id: 123, dadata_address: dadata, flat: '7'}],
  });
  const result = await checkout.setCheckoutForm({address_id: 123, shipping_flat: null});
  assert.equal(result.shipping_flat, null);
});
test('address search uses the current value/type contract', async () => {
  await checkout.searchAddress('Test address');
  assert.deepEqual(requests[0].body,{value:'Test address',type:'address'});
});
test('dry run normalizes address, checks cart only and never submits', async () => {
  const result=await checkout.placeOrder();
  assert.equal(result.dry_run,true);
  assert.deepEqual(result.missing_fields,[]);
  assert.deepEqual(result.payload_will_be_sent.cart.dadata_address,dadata);
  assert.equal(requests.length,1);
  assert.ok(requests[0].url.endsWith('/cart'));
});
test('PVZ also requires structured address data or an address_id', async () => {
  api.saveCheckout({...form,address:'A display string',dadata_address:null});
  const result=await checkout.placeOrder();
  assert.ok(result.missing_fields.includes('dadata_address|address_id'));
  await assert.rejects(checkout.placeOrder({confirm:true}),/dadata_address\|address_id/);
  assert.ok(requests.every(r=>r.url.endsWith('/cart')));
});
test('saved account address_id is accepted without Dadata', async () => {
  api.saveCheckout({...form,address_id:123,dadata_address:null});
  assert.deepEqual((await checkout.placeOrder()).missing_fields,[]);
});
test('async 422 preserves precise validation fields and failed status', async () => {
  globalThis.fetch=async (url,options) => {
    requests.push({url,body:options.body ? JSON.parse(options.body) : null});
    if(url.endsWith('/cart')) return Response.json({data:{}});
    if(url.endsWith('/checkout')) return Response.json({data:{pending:true,checkout_request_id:'test-request',checkout_request_token:'fake-test-token'}});
    assert.ok(url.endsWith('/checkout/test-request/status'));
    return Response.json({message:'Укажите адрес',errors:{'cart.dadata_address':['Укажите адрес']},checkout_status:'validation_failed'},{status:422});
  };
  const result=await checkout.placeOrder({confirm:true});
  assert.equal(result.checkout_status,'validation_failed');
  assert.equal(result.order_created,false);
  assert.deepEqual(result.validation_errors,{'cart.dadata_address':['Укажите адрес']});
  assert.equal(result.success_url,null);
  assert.equal(result.checkout_request_id,'test-request');
  assert.equal(api.loadCart().length,1);
});
test('successful response exposes shop URL and clears only the local cart', async () => {
  globalThis.fetch=async (url) => url.endsWith('/cart') ? Response.json({data:{}}) : Response.json({data:{pending:false,checkout_status:'succeeded',order_id:123,url:'https://example.com/payment/test-only'}});
  const result=await checkout.placeOrder({confirm:true});
  assert.equal(result.success_url,'https://example.com/payment/test-only');
  assert.equal(result.order_created,true);
  assert.deepEqual(api.loadCart(),[]);
});
