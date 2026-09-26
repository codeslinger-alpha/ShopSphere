"""Rebuild docs/SCHEMA.md from the CREATE TABLE statements; no database needed."""
from pathlib import Path
import re

root = Path(__file__).resolve().parent.parent
sql = (root / 'server/sql/schema.sql').read_text()
sql = re.sub(r'/\*.*?\*/|--[^\n]*', '', sql, flags=re.S)
tables = {}
for match in re.finditer(r'create\s+table\s+(\w+)\s*\((.*?)\)\s*;', sql, re.I | re.S):
    name, body = match.groups()
    fields, start, depth = [], 0, 0
    for i, char in enumerate(body):
        depth += (char == '(') - (char == ')')
        if char == ',' and depth == 0:
            fields.append(body[start:i].strip())
            start = i + 1
    fields.append(body[start:].strip())
    composite = []
    columns = []
    for field in fields:
        if field.upper().startswith('PRIMARY KEY'):
            composite = re.search(r'\((.*?)\)', field).group(1).replace(' ', '').split(',')
        else:
            col, dtype, *rest = field.split()
            definition = ' '.join(rest)
            reference = re.search(r'REFERENCES\s+(\w+)\s*\((\w+)\)', definition, re.I)
            columns.append({'name':col,'type':dtype,'definition':definition,'reference':reference.groups() if reference else None})
    for col in columns:
        col['pk'] = col['name'] in composite or 'PRIMARY KEY' in col['definition'].upper()
        col['required'] = col['pk'] or 'NOT NULL' in col['definition'].upper()
    tables[name] = columns

def entity(name):
    words = name.split('_')
    return words[0] + ''.join(word.title() for word in words[1:])

out = ['# ShopSphere schema and ERD', '',
       'Generated from `server/sql/schema.sql` by `python3 scripts/document-schema.py`.',
       'The schema contains **%d application tables**.' % len(tables), '',
       '## Entity relationships', '',
       'The ERD reflects SQL nullability and cardinality, including optional references.',
       'Solid edges identify a child through its foreign key; dotted edges are non-identifying.',
       '`o{` means zero or many, `o|` zero or one, and `||` exactly one.', '', '```mermaid', 'erDiagram']
for name, columns in tables.items():
    out.append(f'    {entity(name)}["{name}"] {{')
    for col in columns:
        keys = []
        if col['pk']: keys.append('PK')
        if col['reference']: keys.append('FK')
        if 'UNIQUE' in col['definition'].upper(): keys.append('UK')
        dtype = col['type'].split('(')[0].lower()
        out.append(f'        {dtype} {col["name"]}' + (' '+', '.join(keys) if keys else ''))
    out.append('    }')
for name, columns in tables.items():
    for col in columns:
        if col['reference']:
            parent, _ = col['reference']
            left = '||' if col['required'] else '|o'
            right = 'o|' if col['pk'] and sum(c['pk'] for c in columns)==1 else 'o{'
            edge = '--' if col['pk'] else '..'
            out.append(f'    {entity(parent)} {left}{edge}{right} {entity(name)} : "{col["name"]}"')
out += ['```', '', '## Relational definitions', '',
        'Composite PK means that the listed PK columns jointly identify a row.',
        'Required reflects NOT NULL and primary-key declarations in CREATE TABLE.',
        'Refer to the SQL file for exact CHECK expressions, identity generation and defaults.', '']
for name, columns in tables.items():
    out += ['### '+name, '', '| Column | SQL type | Key | Required | Definition |', '| --- | --- | --- | --- | --- |']
    for col in columns:
        keys = ('PK ' if col['pk'] else '') + ('FK' if col['reference'] else '')
        definition = col['definition'].replace('|', '\\|')
        out.append(f'| `{col["name"]}` | `{col["type"]}` | {keys.strip() or "—"} | {"Yes" if col["required"] else "No"} | {definition} |')
    out.append('')
out += ['## Normalization and deliberate exceptions', '',
        '- Country/location, role/user, shop/listing and category/master relationships separate independent facts.',
        '- Many-to-many relationships use category_attributes, attribute_values, cart_items, wish_list_items, product_reviews, shop_reviews and order_items.',
        '- Listing name/images duplicate master identity for compatibility with the original schema; master edits synchronize them through the API. Direct SQL maintenance must preserve this rule. This is a deliberate denormalization rather than a claim of strict 3NF for every table.',
        '- Wholesale and order unit prices are historical snapshots. They must not change when current catalog prices change.',
        '- Order total is a derived cache maintained by a trigger, and `shops.balance` is a running total of delivered sales, recharges, wholesale purchases and refunds, so gross value and a shop\'s spendable money never share a field.',
        '- Points retain the existing schema but have no accounting policy; `users.point` is read and never written. The shop balance and courier earnings do have one, invented rather than supplied: see docs/REFUNDS_AND_READ_SURFACES.md. There is no platform commission anywhere.',
        '- Attribute values are text (an entity/attribute/value model); category requirements are enforced on available masters at transaction commit.',
        '- Images and phone_numbers currently store one URL/phone per row. Multi-image and multi-phone storage is not modeled as comma-separated lists.',
        '- There is no permissions/role_permissions pair. They are not part of the canonical schema; authorization is requireRole per mounted router.',
        '', '## Computed function and workflow procedure', '',
        '- `fn_order_subtotal(order_id)` returns the numeric sum of historical line prices times quantities. Checkout reads and the order-total trigger call it.',
        '- `settle_delivery(order_id, courier_id, result)` is called by the delivery API inside an explicit transaction. It advances an assigned shipped order, completes its pending payment, credits the courier the order\'s own stored delivery cost and credits each shop for its own lines, and returns a JSON result. A stale transition returns NULL so the controller can return 404/409.',
        '- Transaction control stays with the caller; a procedure failure rolls back all its writes. `tests/order.integration.test.js` verifies settlement rollback and the delivery suites verify exactly-once earnings.',
        '', '## Trigger behavior', '',
        '- Hard deletion is blocked for users, shops, master_products, products, delivery_personnel and orders; status fields preserve history.',
        '- Removing a role disables affected users. Disabling a user disables their shops and makes their delivery profile unavailable.',
        '- Disabling a shop discontinues listings. An unavailable courier releases pending/shipped assignments.',
        '- Cancelling a pending order restores stock once, detaches its courier and marks pending payments failed; line items remain.',
        '- Order status transitions are restricted; line-item changes recalculate both old and new order totals when moved.',
        '- Product reviews require a delivered order for that exact customer/listing, and shop reviews require a delivered order for any listing from that shop, on both INSERT and UPDATE.',
        '- A return is only legal on a delivered order, and the units returned across all non-rejected requests for one order line cannot exceed the quantity bought. A partial unique index keeps one open request per line; a rejected one frees the line for a second attempt.',
        '- Deferred category-value constraints validate masters, requirements and value edits atomically.',
        '', 'Country/category cascade deletes exist in the original DDL. There are no public country-delete endpoints, and the admin API rejects deletion of categories with children or master products. Shop-owner/delivery role ownership is enforced by API write paths, not by role-specific foreign keys.', '']
(root / 'docs/SCHEMA.md').write_text('\n'.join(out))
print('Documented', len(tables), 'tables and', sum(bool(c['reference']) for cs in tables.values() for c in cs), 'foreign keys.')
