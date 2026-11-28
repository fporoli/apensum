import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addressee, cleanContacts, cleanCustomer, cleanReference, parseCustomerTerm, termKey } from './customers.ts';

test('the term and its text variants', () => {
  assert.equal(parseCustomerTerm('client'), 'client');
  assert.equal(parseCustomerTerm('boss'), 'customer');
  const has = (k) => k === 'customers.title.client';
  assert.equal(termKey('customers.title', 'client', has), 'customers.title.client');
  assert.equal(termKey('customers.title', 'principal', has), 'customers.title');
  assert.equal(termKey('customers.title', 'customer', has), 'customers.title');
});

test('a customer from a request: a name, a country, a valid e-mail', () => {
  const ok = cleanCustomer({ name: ' KESB Bern ', city: 'Bern', country: 'ch', email: 'kesb@be.ch', language: 'fr', phone: ' 031 ' });
  assert.deepEqual(ok, { ok: true, value: { name: 'KESB Bern', street: null, houseNumber: null, zip: null, city: 'Bern', country: 'CH', email: 'kesb@be.ch', phone: '031', language: 'fr', active: true } });
  assert.deepEqual(cleanCustomer({ name: '' }), { ok: false, error: 'customer-name-missing' });
  assert.deepEqual(cleanCustomer({ name: 'x', country: 'Schweiz' }), { ok: false, error: 'invalid-country' });
  assert.deepEqual(cleanCustomer({ name: 'x', email: 'nope' }), { ok: false, error: 'invalid-email' });
  assert.equal(cleanCustomer({ name: 'x', language: 'rm' }).value.language, 'de');
});

test('contacts: names required, ids once, at most 30', () => {
  assert.deepEqual(cleanContacts([{ name: ' Anna Meier ', role: 'Behördenmitglied' }]), { ok: true, value: [{ id: null, name: 'Anna Meier', role: 'Behördenmitglied', email: null, phone: null }] });
  assert.deepEqual(cleanContacts([{ name: '' }]), { ok: false, error: 'contact-name-missing' });
  const id = '11111111-1111-4111-8111-111111111111';
  assert.deepEqual(cleanContacts([{ id, name: 'a' }, { id, name: 'b' }]), { ok: false, error: 'invalid-contacts' });
  assert.deepEqual(cleanContacts(Array.from({ length: 31 }, () => ({ name: 'x' }))), { ok: false, error: 'invalid-contacts' });
});

test('reference and addressee: the subproject\'s wins', () => {
  assert.equal(cleanReference('  KES 2026-114 '), 'KES 2026-114');
  assert.equal(cleanReference('   '), null);
  assert.deepEqual(addressee({ reference: 'P', contactName: 'Frau A' }, { reference: 'S', contactName: null }), { theirReference: 'S', attention: 'Frau A' });
  assert.deepEqual(addressee(null, null), { theirReference: null, attention: null });
});
