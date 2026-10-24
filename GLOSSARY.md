# Glossary

The words for one shop's inventory and the people who run it. A conversation about a rule uses these words, and so does the code.

## Shop

The business whose stock, sales and purchases the software keeps. One shop has one catalogue.

## Catalogue

The shop's categories, products, batches, suppliers and purchase orders. A change to the catalogue is a request the shop can refuse.

## Category

A named group of products. A category that still has products cannot be removed.

## Product

Something the shop sells. It belongs to one category. Its units per pack stay fixed while any of its batches still hold stock.

## Batch

One lot of a product, with its own quantities. A batch that still holds stock cannot be removed.

## Stock

The packs and loose units a batch currently holds. A sale cannot take more than that.

## Sale

A request to sell one or more lines. When it is accepted, it becomes an invoice and the stock it took is remembered as movements.

## Invoice

The record of an accepted sale: who it was for, its lines, and its total.

## Supplier

A business the shop buys from. A supplier that still has purchase orders cannot be removed.

## Purchase order

A request to a supplier. It is drafted, sent, closed or cancelled. A closed or cancelled order no longer changes. Only a draft with no lines can be removed.

## Delivery

Stock received against a purchase order line, recorded as a new batch. It is refused when the order can no longer change, or when the batch is for a different product.

## Staff

The people who use one shop's software. Until an owner is set up, anyone at the shop works alone. Afterwards the shop is locked until someone unlocks it.

## Owner

The staff member who sets the shop up. The owner cannot be removed or given another role. The owner can be recovered.

## Role

What a staff member is allowed to do: cashier, manager or owner. A cashier sells. A manager also changes stock and reads reports. Only an owner manages the shop.

## Unlock

A staff member's request to work, checked against their PIN. Repeated failures make the next attempt wait.

## Licence

The shop's right to use the software. A licence the shop cannot verify is refused.

## Command

A request that something in the shop change. It names what is asked and can be refused. Accepting it records what happened.

## Refusal

A command turned down, with the reason the shop would give. The request leaves no change behind.

## Replica

One device's copy of the shop. It accepts a command locally, then agrees it with the shop's authority. The authority can still refuse.

## Authority

The shop's decision of record. It accepts or refuses each command once, and every replica catches up to that decision.
