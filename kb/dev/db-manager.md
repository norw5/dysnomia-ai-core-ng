# OnChainDatabaseManager — the Mirage-Concepts DB + alchemy game — **NOT DEPLOYED**

> **NOT DEPLOYED** — complete in source (779 lines, the largest file in the
> tree); no onchain match; not among the deployer's creates `[chain]`.

## 1. Identity

| | |
|---|---|
| Source | `OnChainDatabaseManager.sol` — "Inspired by the 1980s Mirage Concepts Database Manager" `[src: docstring]` |
| Onchain | absent `[chain]` |
| Not a DYSNOMIA token | plain Ownable contract (single-owner `onlyOwner`) — a different authority model from the family |

## 2. Role

A gas-optimized relational engine: records pack `{recordId:16b, fieldCount:
8b, flags:8b, fields:29 bytes}` into ONE storage slot via Yul (`getStorageSlot
= keccak(BASE, tableId, recordId)`), with raw sload/sstore field surgery.
SQL-isms: check constraints, column write permissions, unique fields,
sorted-by-lead indexes, joins (`joinAndCompareFieldsTable`), aggregates
(sum/min/max/avg), foreign keys, virtual join views, **triggers**
(field-0 writes auto-write field 2 = value/2), **journal + rollback**
(`stateHistory`), **schema migration** (`migrateSchemaTable` shifts all
fields), delete with swap-pop. Crowned by an **alchemy game**: fields are
Lead/Mercury/Sulfur/Salt/Gold — `executeDecay` decays lead into mercury
(1-per-20-blocks) and "combusts" records every 10 blocks when sulfur > 2×
salt (damaging gold); `transmute` computes a field from (A op B) plus a
mutation roll (×2 if <10, ÷2 if >90) and — when the target is Gold —
**mints/burns an "AlchemicalGold" ERC20 1:1 with the delta**; `buySalt`
burns 10 gold per salt.

## 3. Dependencies

Wired toward the main world in design: `systemRegistry`, `diyatContract`
setters + a RandomGenerator hook for mutation rolls. Owns the mintable/
burnable gold-token interface.

## 4. State

Slot-packing tables + constraint/permission/unique registries + journal +
the five-alchemon field data + the gold/diyat/registry addresses.

## 5. Functions

<!-- fntable: OnChainDatabaseManager @ OnChainDatabaseManager.sol -->
<!-- fntable-begin: OnChainDatabaseManager @ OnChainDatabaseManager.sol -->
Function table extracted mechanically from `OnChainDatabaseManager.sol`. Gate: `public` = anyone · `owners` = MultiOwnable set, **msg.sender OR tx.origin** · `bouncers` = QING bouncer rule · `single-owner` = classic owner · `deployer` = constructor wiring. `meter` = the call self-mints one unit via `_mintToCap()` (a call-counter against the constructor-lottery `maxSupply`).

| signature | gate | meter | events | reverts |
|---|---|---|---|---|
| `constructor()` | deployer | — | — | — |
| `setGoldToken(address _goldToken)` | single-owner (external) | — | — | — |
| `setRandomGenerator(address _randomGenerator)` | single-owner (external) | — | — | — |
| `setSystemRegistry(address _registry)` | single-owner (external) | — | — | — |
| `setDiyatContract(address _diyat)` | single-owner (external) | — | — | — |
| `registerCheckConstraint(uint16 tableId, uint8 index, uint8 minVal, uint8 maxVal)` | single-owner (external) | — | — | — |
| `setColumnWritePermission(uint16 tableId, uint8 index, address user, bool allowed)` | single-owner (external) | — | — | — |
| `validateCheckConstraint(uint16 tableId, uint8 index, uint8 value)` | public | — | — | `require` |
| `verifyWritePermission(uint16 tableId, uint8 index, address user)` | public | — | — | `require` |
| `executeTriggers(uint16 tableId, uint16 recordId, uint8 index, uint8 value)` | internal | — | TriggerExecuted | — |
| `getStorageSlot(uint16 tableId, uint16 recordId) returns (bytes32)` | public | — | — | — |
| `getStorageSlot(uint16 recordId) returns (bytes32)` | public | — | — | — |
| `insertRecordTable(uint16 tableId, uint16 recordId, uint8 fieldCount, uint8 flags, bytes32 fieldData)` | public | — | RecordInserted, TableRecordInserted | — |
| `insertRecord(uint16 recordId, uint8 fieldCount, uint8 flags, bytes32 fieldData)` | single-owner (external) | — | — | — |
| `getRecordTable(uint16 tableId, uint16 recordId) returns (Record memory rec)` | public | — | — | — |
| `getRecord(uint16 recordId) returns (Record memory rec)` | public (external) | — | — | — |
| `calculateField(uint16 recordId, uint256 valA, uint256 valB, uint8 operator, uint8 targetField) returns (uint256 result)` | public (external) | — | FieldCalculated | — |
| `transmute(uint16 recordId, uint8 indexA, uint8 indexB, uint8 operator, uint8 targetIndex)` | public (external) | — | FieldCalculated, MutationTriggered | — |
| `executeDecay(uint16 recordId) returns (bytes32 newFieldData)` | public (external) | — | SubstrateDecayed | `require` |
| `buySalt(uint16 recordId, uint8 saltAmount)` | public (external) | — | SaltPurchased | `require` |
| `deleteRecordTable(uint16 tableId, uint16 recordId)` | public | — | RecordDeleted, TableRecordDeleted | — |
| `deleteRecord(uint16 recordId)` | single-owner (external) | — | — | — |
| `queryRecordsByFlagTable(uint16 tableId, uint8 flagMask) returns (uint16[] memory matches)` | public | — | — | — |
| `queryRecordsByFlag(uint8 flagMask) returns (uint16[] memory matches)` | public (external) | — | — | — |
| `joinAndCompareFieldsTable(uint16 tableIdA, uint16 recordIdA, uint8 indexA, uint16 tableIdB, uint16 recordIdB, uint8 indexB) returns (int256 diff)` | public | — | — | — |
| `joinAndCompareFields(uint16 recordIdA, uint8 indexA, uint16 recordIdB, uint8 indexB) returns (int256 diff)` | public (external) | — | — | — |
| `getCustomFieldTable(uint16 tableId, uint16 recordId, uint8 offsetBytes, uint8 sizeBytes) returns (bytes32 result)` | public | — | — | `require` |
| `getCustomField(uint16 recordId, uint8 offsetBytes, uint8 sizeBytes) returns (bytes32 result)` | public (external) | — | — | — |
| `aggregateFieldTable(uint16 tableId, uint8 index, uint8 op) returns (uint256 result)` | public | — | — | — |
| `aggregateField(uint8 index, uint8 op) returns (uint256 result)` | public (external) | — | — | — |
| `verifyForeignKeyTable(uint16 tableIdA, uint16 recordIdA, uint8 indexA) returns (bool)` | public | — | — | — |
| `verifyForeignKey(uint16 recordIdA, uint8 indexA) returns (bool)` | public (external) | — | — | — |
| `enforceUniqueFieldTable(uint16 tableId, uint16 recordId, uint8 index, uint8 value)` | public | — | JournalLogged, TableJournalLogged | `require` |
| `enforceUniqueField(uint16 recordId, uint8 index, uint8 value)` | single-owner (external) | — | — | — |
| `rollbackRecordTable(uint16 tableId, uint16 recordId)` | public | — | JournalLogged, TableJournalLogged | `require` |
| `rollbackRecord(uint16 recordId)` | single-owner (external) | — | — | — |
| `migrateSchemaTable(uint16 tableId, uint8 shiftBytes)` | single-owner | — | — | — |
| `migrateSchema(uint8 shiftBytes)` | single-owner (external) | — | — | — |
| `virtualJoinViewTable(uint16 tableIdA, uint16 recordIdA, uint16 tableIdB, uint16 recordIdB) returns (bytes32 viewData)` | public | — | — | — |
| `virtualJoinView(uint16 recordIdA, uint16 recordIdB) returns (bytes32 viewData)` | public (external) | — | — | — |
| `updateSortedLeadIndex(uint16 tableId, uint16 recordId, uint8 leadValue)` | internal | — | — | — |

Events declared: `RecordInserted(uint16 indexed recordId, uint8 fieldCount, uint8 flags)` · `RecordDeleted(uint16 indexed recordId)` · `FieldCalculated(uint16 indexed recordId, uint8 targetField, uint256 result)` · `MutationTriggered(uint16 indexed recordId, uint8 indexed targetIndex, uint256 oldVal, uint256 newVal)` · `JournalLogged(uint16 indexed recordId, uint8 indexed index, uint256 oldValue, uint256 newValue, uint256 blockNumber)` · `TableRecordInserted(uint16 indexed tableId, uint16 indexed recordId, uint8 fieldCount, uint8 flags)` · `TableRecordDeleted(uint16 indexed tableId, uint16 indexed recordId)` · `TableFieldCalculated(uint16 indexed tableId, uint16 indexed recordId, uint8 targetField, uint256 result)` · `TableJournalLogged(uint16 indexed tableId, uint16 indexed recordId, uint8 indexed index, uint256 oldValue, uint256 newValue, uint256 blockNumber)` · `TriggerExecuted(uint16 indexed tableId, uint16 indexed recordId, uint8 triggeredIndex, uint256 value)` · `SaltPurchased(uint16 indexed recordId, uint8 saltAmount)` · `SubstrateDecayed(uint16 indexed recordId, bytes32 newFieldData)`
<!-- fntable-end -->

The full 40+ function surface (schema/CRUD/joins/aggregates/alchemy) is in
the generated table above; the docstring-level semantics of the alchemy trio
(`executeDecay`, `transmute`, `buySalt`) are as described in §2.

## 6. Integration notes

- Reference-only. `[irc]` corroboration: "the alchemy doc written by dysnomia
  was intriguing" (2025-01-28 — line 34152) — the game was discussed
  publicly; nothing load-bearing taken.

## 7. Provenance

- [src] `OnChainDatabaseManager.sol`.
- [chain] absence probes; [irc] corroboration (07-semantics §8).
